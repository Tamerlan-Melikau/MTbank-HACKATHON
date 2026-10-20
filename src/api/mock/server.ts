/**
 * MockBank — «бэкенд в браузере». Реализует BankApi поверх таблиц Db.
 *
 * Ведёт себя как настоящий сервер:
 *  - каждая операция проверяет сессию и права (родитель своей семьи / сам ребёнок);
 *  - права ребёнка решает domain/policy.ts, платежи — domain/payments.ts;
 *  - ответы — копии данных (UI не может мутировать «базу» по ссылке);
 *  - есть искусственная задержка, чтобы UI сразу учитывал состояние загрузки.
 *
 * Хранилище: localStorage (общая «база» для вкладок) + sessionStorage (сессия
 * на вкладку). Значит, в одной вкладке можно войти родителем, в другой — ребёнком,
 * и изменения видны обеим.
 */
import {
  AGE_GROUPS,
  CAPABILITY_LIST,
  CATEGORIES,
  LESSONS,
  PRODUCTS,
  REASON_TEXT,
  REWARDS,
  ZERO,
  add,
  ageAt,
  ageGroupOf,
  authorizePayment,
  canParentSet,
  capabilityAccess,
  clampLevel,
  defaultLevels,
  describePayload,
  formatMoney,
  gt,
  minor,
  presetLimits,
  sub,
  type AccessDecision,
  type AccessRequestPayload,
  type Account,
  type CapabilityId,
  type Card,
  type CategoryId,
  type ChildSettings,
  type Id,
  type Level,
  type Limits,
  type Member,
  type Money,
  type Transaction,
  type TxKind,
} from '@/domain';
import {
  ApiError,
  type BankApi,
  type ChildOverview,
  type EnrollInput,
  type FamilyView,
  type PayInput,
  type PayResult,
  type Persona,
  type Session,
} from '../contract';
import { DB_VERSION, nextId, type Db } from './db';
import { seed } from './seed';
import type { KeyValue } from './storage';

export interface MockBankOptions {
  db: KeyValue;
  session: KeyValue;
  now?: () => Date;
  latencyMs?: number;
  /** Слушать изменения из других вкладок (только в браузере). */
  crossTab?: boolean;
}

const DB_KEY = 'fw.db';
const SESSION_KEY = 'fw.session';
const OUTGOING: TxKind[] = ['purchase', 'cash', 'transfer_out'];

// JSON-копия: данные чисто JSON, а structuredClone нет в Safari < 15.4.
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export class MockBank implements BankApi {
  private db: Db;
  private currentSession: Session | null;
  private listeners = new Set<() => void>();
  private readonly now: () => Date;
  private readonly latency: number;

  constructor(private readonly opts: MockBankOptions) {
    this.now = opts.now ?? (() => new Date());
    this.latency = opts.latencyMs ?? 0;
    this.db = this.load();
    this.currentSession = this.loadSession();
    if (opts.crossTab && typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === DB_KEY) {
          this.db = this.load();
          this.emit();
        }
      });
    }
  }

  // ---------------------------------------------------------------- инфраструктура

  private load(): Db {
    const raw = this.opts.db.get(DB_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Db;
        if (parsed.version === DB_VERSION) return parsed;
      } catch {
        /* битые данные — пересоздаём */
      }
    }
    const fresh = seed(this.now());
    this.opts.db.set(DB_KEY, JSON.stringify(fresh));
    return fresh;
  }

  private loadSession(): Session | null {
    const raw = this.opts.session.get(SESSION_KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as Session;
      return this.db.members.some((m) => m.id === s.memberId) ? s : null;
    } catch {
      return null;
    }
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private async delay() {
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency));
  }

  /** Обёртка для чтения: задержка, тики расписания, копия ответа. */
  private async read<T>(fn: () => T): Promise<T> {
    await this.delay();
    this.runSchedules();
    return clone(fn());
  }

  /**
   * Обёртка для команды: транзакционность «всё или ничего». Работаем на копии базы
   * и подменяем её только при успехе — как BEGIN/COMMIT.
   */
  private async write<T>(fn: (db: Db) => T): Promise<T> {
    await this.delay();
    this.runSchedules();
    const draft = clone(this.db);
    const backup = this.db;
    this.db = draft;
    try {
      const result = fn(draft);
      this.opts.db.set(DB_KEY, JSON.stringify(draft));
      this.emit();
      return clone(result);
    } catch (e) {
      this.db = backup;
      throw e;
    }
  }

  private iso() {
    return this.now().toISOString();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  async resetDemo() {
    this.db = seed(this.now());
    this.opts.db.set(DB_KEY, JSON.stringify(this.db));
    this.currentSession = null;
    this.opts.session.remove(SESSION_KEY);
    this.emit();
  }

  // ---------------------------------------------------------------- доступ

  private requireSession(): Session {
    if (!this.currentSession) throw new ApiError('UNAUTHORIZED', 'Войдите в приложение');
    return this.currentSession;
  }

  private member(id: Id): Member {
    const m = this.db.members.find((x) => x.id === id);
    if (!m) throw new ApiError('NOT_FOUND', 'Участник не найден');
    return m;
  }

  private requireParent(): Session {
    const s = this.requireSession();
    if (s.role !== 'parent') throw new ApiError('FORBIDDEN', 'Действие доступно только родителю');
    return s;
  }

  private requireChild(): Session {
    const s = this.requireSession();
    if (s.role !== 'child') throw new ApiError('FORBIDDEN', 'Действие доступно только ребёнку');
    return s;
  }

  /** Родитель той же семьи, что и ребёнок. */
  private requireParentOf(childId: Id): { session: Session; child: Member } {
    const s = this.requireParent();
    const child = this.member(childId);
    if (child.role !== 'child' || child.familyId !== s.familyId) throw new ApiError('FORBIDDEN', 'Нет доступа к этому ребёнку');
    return { session: s, child };
  }

  /** Читать данные участника может он сам или родитель его семьи. */
  private requireCanView(memberId: Id): Member {
    const s = this.requireSession();
    const m = this.member(memberId);
    if (m.id === s.memberId) return m;
    if (s.role === 'parent' && m.familyId === s.familyId) return m;
    throw new ApiError('FORBIDDEN', 'Нет доступа');
  }

  private settings(childId: Id): ChildSettings {
    const s = this.db.childSettings.find((x) => x.childId === childId);
    if (!s) throw new ApiError('NOT_FOUND', 'Пакет для ребёнка не оформлен');
    return s;
  }

  /** Группа может смениться, когда ребёнку исполнится 14: права обрезаются по новому потолку. */
  private syncAgeGroup(child: Member, st: ChildSettings) {
    if (!child.birthDate) return;
    const g = ageGroupOf(child.birthDate, this.now());
    if (!g || g === st.ageGroup) return;
    st.ageGroup = g;
    for (const c of CAPABILITY_LIST) st.levels[c.id] = clampLevel(st.levels[c.id], c.rules[g].ceiling);
  }

  // ---------------------------------------------------------------- хелперы данных

  private currentAccount(memberId: Id): Account {
    const a = this.db.accounts.find((x) => x.ownerId === memberId && x.kind === 'current');
    if (!a) throw new ApiError('NOT_FOUND', 'Счёт не найден');
    return a;
  }

  private activeCard(memberId: Id): Card | null {
    const cards = this.db.cards.filter((c) => c.holderId === memberId && c.replacedBy === null);
    return cards[cards.length - 1] ?? null;
  }

  private spent(accountId: Id, since: Date): Money {
    const total = this.db.transactions
      .filter((t) => t.accountId === accountId && t.status === 'completed' && OUTGOING.includes(t.kind) && new Date(t.createdAt) >= since)
      .reduce((s, t) => s + Math.abs(t.amount.minor), 0);
    return minor(total);
  }

  private startOfDay() {
    const d = this.now();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  private startOfMonth() {
    const d = this.now();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  private postTx(t: Omit<Transaction, 'id' | 'createdAt' | 'status' | 'declineReason'> & Partial<Transaction>): Transaction {
    const tx: Transaction = { id: nextId(this.db, 'tx'), createdAt: this.iso(), status: 'completed', declineReason: null, ...t };
    this.db.transactions.push(tx);
    if (tx.status === 'completed') {
      const acc = this.db.accounts.find((a) => a.id === tx.accountId)!;
      acc.balance = add(acc.balance, tx.amount);
    }
    return tx;
  }

  /** Перевод между счетами с двумя проводками. */
  private transfer(from: Account, to: Account, amount: Money, titles: { out: string; in: string }, kinds: { out: TxKind; in: TxKind }) {
    if (gt(amount, from.balance)) throw new ApiError('VALIDATION', 'Недостаточно средств');
    if (amount.minor <= 0) throw new ApiError('VALIDATION', 'Сумма должна быть больше нуля');
    this.postTx({ accountId: from.id, memberId: from.ownerId, kind: kinds.out, amount: minor(-amount.minor), title: titles.out, category: null, channel: 'internal' });
    this.postTx({ accountId: to.id, memberId: to.ownerId, kind: kinds.in, amount, title: titles.in, category: null, channel: 'internal' });
  }

  private notify(memberId: Id, title: string, body: string, link: string | null = null) {
    this.db.notifications.push({ id: nextId(this.db, 'ntf'), memberId, title, body, link, read: false, createdAt: this.iso() });
  }

  private notifyParents(familyId: Id, title: string, body: string, link: string | null = null) {
    for (const p of this.db.members.filter((m) => m.familyId === familyId && m.role === 'parent')) this.notify(p.id, title, body, link);
  }

  private addPoints(memberId: Id, delta: number, reason: string) {
    if (delta === 0) return;
    this.db.points.push({ id: nextId(this.db, 'pt'), memberId, delta, reason, createdAt: this.iso() });
  }

  private pointsOf(memberId: Id) {
    return this.db.points.filter((p) => p.memberId === memberId).reduce((s, p) => s + p.delta, 0);
  }

  private accessMap(st: ChildSettings): Record<CapabilityId, AccessDecision> {
    const out = {} as Record<CapabilityId, AccessDecision>;
    for (const c of CAPABILITY_LIST) out[c.id] = capabilityAccess(st, c.id);
    return out;
  }

  /** Регулярные переводы «карманных денег»: догоняем все пропущенные периоды. */
  private runSchedules() {
    const now = this.now();
    let changed = false;
    for (const a of this.db.allowances) {
      if (!a.active) continue;
      let guard = 0;
      while (new Date(a.nextRunAt) <= now && guard++ < 60) {
        const from = this.db.accounts.find((x) => x.ownerId === a.parentId && x.kind === 'current');
        const to = this.db.accounts.find((x) => x.ownerId === a.childId && x.kind === 'current');
        const parent = this.db.members.find((m) => m.id === a.parentId);
        if (from && to && parent && !gt(a.amount, from.balance)) {
          this.transfer(from, to, a.amount, { out: 'Карманные деньги', in: `Карманные от ${parent.firstName}` }, { out: 'transfer_out', in: 'pocket_money' });
          this.notify(a.childId, 'Пришли карманные', formatMoney(a.amount, { sign: 'always' }), '/history');
        } else if (parent) {
          this.notify(parent.id, 'Карманные не отправлены', 'Недостаточно средств на счёте');
        }
        const next = new Date(a.nextRunAt);
        if (a.period === 'weekly') next.setDate(next.getDate() + 7);
        else next.setMonth(next.getMonth() + 1);
        a.nextRunAt = next.toISOString();
        changed = true;
      }
    }
    if (changed) this.opts.db.set(DB_KEY, JSON.stringify(this.db));
  }

  // ---------------------------------------------------------------- сессия

  async personas(): Promise<Persona[]> {
    return this.read(() =>
      this.db.members.map((m) => {
        if (m.role === 'parent') return { memberId: m.id, title: m.firstName, subtitle: 'Родитель', role: m.role };
        const st = this.db.childSettings.find((s) => s.childId === m.id);
        const age = m.birthDate ? ageAt(m.birthDate, this.now()) : 0;
        const group = st ? AGE_GROUPS[st.ageGroup].label : '';
        return { memberId: m.id, title: m.firstName, subtitle: `Ребёнок, ${age} лет · ${group}`, role: m.role };
      }),
    );
  }

  async signIn(memberId: Id): Promise<Session> {
    await this.delay();
    const m = this.member(memberId);
    if (m.role === 'child') {
      const st = this.settings(m.id);
      if (st.moby !== 'active') throw new ApiError('NO_MOBY_ACCESS', st.moby);
    }
    const s: Session = { memberId: m.id, familyId: m.familyId, role: m.role };
    this.currentSession = s;
    this.opts.session.set(SESSION_KEY, JSON.stringify(s));
    this.emit();
    return clone(s);
  }

  async signOut() {
    this.currentSession = null;
    this.opts.session.remove(SESSION_KEY);
    this.emit();
  }

  session() {
    return this.currentSession ? clone(this.currentSession) : null;
  }

  async redeemInvite(code: string) {
    return this.write(() => {
      const st = this.db.childSettings.find((s) => s.inviteCode && s.inviteCode === code.trim());
      if (!st || st.moby !== 'invited') throw new ApiError('NOT_FOUND', 'Код не найден или уже использован');
      const child = this.member(st.childId);
      st.moby = 'pending_confirm';
      st.inviteCode = null;
      this.notifyParents(child.familyId, `${child.firstName} ввёл код входа`, 'Подтвердите доступ в Moby', `/child/${child.id}`);
      return { childId: child.id, firstName: child.firstName };
    });
  }

  async requestMobyAccess(childId: Id) {
    await this.write(() => {
      const child = this.member(childId);
      const st = this.settings(childId);
      if (st.moby === 'active') return;
      const dup = this.db.requests.some((r) => r.childId === childId && r.status === 'pending' && r.payload.type === 'moby-access');
      if (dup) return;
      this.db.requests.push({
        id: nextId(this.db, 'req'),
        familyId: child.familyId,
        childId,
        payload: { type: 'moby-access' },
        comment: '',
        status: 'pending',
        createdAt: this.iso(),
        resolvedAt: null,
        resolvedBy: null,
      });
      this.notifyParents(child.familyId, `${child.firstName} просит доступ в Moby`, 'Откройте запросы, чтобы ответить', '/requests');
    });
  }

  // ---------------------------------------------------------------- чтение

  async me() {
    return this.read(() => this.member(this.requireSession().memberId));
  }

  async familyView(): Promise<FamilyView> {
    return this.read(() => {
      const s = this.requireSession();
      const family = this.db.families.find((f) => f.id === s.familyId)!;
      const members = this.db.members.filter((m) => m.familyId === s.familyId);
      const kids = s.role === 'parent' ? members.filter((m) => m.role === 'child') : [];
      return {
        family,
        parents: members.filter((m) => m.role === 'parent'),
        children: kids
          .filter((k) => this.db.childSettings.some((x) => x.childId === k.id))
          .map((k) => {
            const st = this.settings(k.id);
            this.syncAgeGroup(k, st);
            return {
              member: k,
              age: ageAt(k.birthDate!, this.now()),
              ageGroup: st.ageGroup,
              balance: this.currentAccount(k.id).balance,
              card: this.activeCard(k.id),
              moby: st.moby,
              pendingRequests: this.db.requests.filter((r) => r.childId === k.id && r.status === 'pending').length,
            };
          }),
      };
    });
  }

  async childOverview(childId: Id): Promise<ChildOverview> {
    return this.read(() => {
      const child = this.requireCanView(childId);
      if (child.role !== 'child') throw new ApiError('VALIDATION', 'Это не ребёнок');
      const st = this.settings(childId);
      this.syncAgeGroup(child, st);
      const account = this.currentAccount(childId);
      return {
        member: child,
        age: ageAt(child.birthDate!, this.now()),
        settings: st,
        access: this.accessMap(st),
        account,
        card: this.activeCard(childId),
        goals: this.db.accounts.filter((a) => a.ownerId === childId && a.kind === 'goal'),
        deposit: this.db.accounts.find((a) => a.ownerId === childId && a.kind === 'deposit') ?? null,
        spentToday: this.spent(account.id, this.startOfDay()),
        spentMonth: this.spent(account.id, this.startOfMonth()),
        allowance: this.db.allowances.find((a) => a.childId === childId && a.active) ?? null,
        points: this.pointsOf(childId),
        pendingRequests: this.db.requests.filter((r) => r.childId === childId && r.status === 'pending'),
      };
    });
  }

  async accounts(memberId: Id) {
    return this.read(() => {
      this.requireCanView(memberId);
      return this.db.accounts.filter((a) => a.ownerId === memberId);
    });
  }

  async cards(memberId: Id) {
    return this.read(() => {
      this.requireCanView(memberId);
      return this.db.cards.filter((c) => c.holderId === memberId && c.replacedBy === null);
    });
  }

  async transactions(memberId: Id, opts: { limit?: number } = {}) {
    return this.read(() => {
      this.requireCanView(memberId);
      const list = this.db.transactions.filter((t) => t.memberId === memberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return opts.limit ? list.slice(0, opts.limit) : list;
    });
  }

  async requests(opts: { status?: 'pending' | 'approved' | 'declined' | 'expired' } = {}) {
    return this.read(() => {
      const s = this.requireSession();
      return this.db.requests
        .filter((r) => r.familyId === s.familyId && (s.role === 'parent' || r.childId === s.memberId))
        .filter((r) => !opts.status || r.status === opts.status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }

  async tasks(childId?: Id) {
    return this.read(() => {
      const s = this.requireSession();
      const target = s.role === 'child' ? s.memberId : childId;
      return this.db.tasks
        .filter((t) => t.familyId === s.familyId && (!target || t.childId === target))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  async points(memberId: Id) {
    return this.read(() => {
      this.requireCanView(memberId);
      const entries = this.db.points.filter((p) => p.memberId === memberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { balance: this.pointsOf(memberId), entries };
    });
  }

  async lessonProgress(memberId: Id) {
    return this.read(() => {
      this.requireCanView(memberId);
      return this.db.lessons.filter((l) => l.memberId === memberId);
    });
  }

  async notifications() {
    return this.read(() => {
      const s = this.requireSession();
      return this.db.notifications.filter((n) => n.memberId === s.memberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }

  // ---------------------------------------------------------------- родитель

  async enroll(input: EnrollInput) {
    return this.write((db) => {
      const s = this.requireParent();
      const required = ['package-offer', 'child-card', 'child-pd'] as const;
      for (const c of required) if (!input.consents.includes(c)) throw new ApiError('VALIDATION', 'Нужны все обязательные согласия');
      const { firstName, lastName, birthDate } = input.child;
      if (!firstName.trim()) throw new ApiError('VALIDATION', 'Укажите имя ребёнка');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new ApiError('VALIDATION', 'Укажите дату рождения');
      const group = ageGroupOf(birthDate, this.now());
      if (!group) throw new ApiError('VALIDATION', 'Пакет доступен для детей от 7 до 17 лет');

      const childId = nextId(db, 'm');
      db.members.push({ id: childId, familyId: s.familyId, role: 'child', firstName: firstName.trim(), lastName: lastName.trim(), birthDate });
      const family = db.families.find((f) => f.id === s.familyId)!;
      family.packageId = 'family-start';
      for (const type of input.consents) db.consents.push({ id: nextId(db, 'cns'), parentId: s.memberId, childId, type, givenAt: this.iso(), revokedAt: null });

      const acc: Account = { id: nextId(db, 'acc'), ownerId: childId, kind: 'current', title: group === 'junior' ? 'Карманные' : 'Мой счёт', balance: ZERO, createdAt: this.iso() };
      db.accounts.push(acc);
      db.cards.push({ id: nextId(db, 'card'), accountId: acc.id, holderId: childId, form: input.cardForm, last4: String(1000 + (db.seq * 7919) % 9000), status: 'active', replacedBy: null });
      db.childSettings.push({
        childId,
        ageGroup: group,
        levels: defaultLevels(group),
        limits: presetLimits(group),
        blockedCategories: group === 'junior' ? ['games', 'subscriptions'] : [],
        moby: 'none',
        inviteCode: null,
        notifyParentOnEveryOperation: group === 'junior',
      });
      return { childId };
    });
  }

  async setCapability(childId: Id, id: CapabilityId, level: Level) {
    await this.write(() => {
      this.requireParentOf(childId);
      const st = this.settings(childId);
      if (!canParentSet(st.ageGroup, id, level)) throw new ApiError('POLICY_DENIED', 'Недоступно для этого возраста');
      st.levels[id] = level;
    });
  }

  async setLimits(childId: Id, limits: Limits) {
    await this.write(() => {
      this.requireParentOf(childId);
      for (const v of Object.values(limits)) if (v && v.minor < 0) throw new ApiError('VALIDATION', 'Лимит не может быть отрицательным');
      if (limits.daily && limits.monthly && gt(limits.daily, limits.monthly)) throw new ApiError('VALIDATION', 'Дневной лимит больше месячного');
      this.settings(childId).limits = limits;
    });
  }

  async setBlockedCategories(childId: Id, categories: CategoryId[]) {
    await this.write(() => {
      this.requireParentOf(childId);
      // Всегда запрещённые категории не храним: они запрещены на уровне домена.
      this.settings(childId).blockedCategories = categories.filter((c) => !CATEGORIES[c].hardBlocked);
    });
  }

  async setNotifyEveryOperation(childId: Id, value: boolean) {
    await this.write(() => {
      this.requireParentOf(childId);
      this.settings(childId).notifyParentOnEveryOperation = value;
    });
  }

  private cardForParent(cardId: Id): Card {
    const card = this.db.cards.find((c) => c.id === cardId);
    if (!card) throw new ApiError('NOT_FOUND', 'Карта не найдена');
    const holder = this.member(card.holderId);
    const s = this.requireSession();
    const own = holder.id === s.memberId;
    if (!own) this.requireParentOf(holder.id);
    return card;
  }

  async setCardBlocked(cardId: Id, blocked: boolean) {
    await this.write(() => {
      const card = this.cardForParent(cardId);
      if (card.status === 'lost') throw new ApiError('CONFLICT', 'Утерянную карту нельзя разблокировать');
      card.status = blocked ? 'blocked' : 'active';
      if (blocked && card.holderId !== this.requireSession().memberId) this.notify(card.holderId, 'Карта заблокирована', 'Родитель заблокировал карту');
    });
  }

  /** Утеря: старая карта навсегда закрыта, выпускается цифровая замена сразу. */
  async reportCardLost(cardId: Id) {
    return this.write((db) => {
      const card = this.cardForParent(cardId);
      card.status = 'lost';
      const fresh: Card = { ...card, id: nextId(db, 'card'), form: 'digital', status: 'active', last4: String(1000 + (db.seq * 4513) % 9000), replacedBy: null };
      card.replacedBy = fresh.id;
      db.cards.push(fresh);
      this.notify(card.holderId, 'Новая карта', 'Старая карта закрыта, цифровая уже работает');
      return { newCardId: fresh.id };
    });
  }

  async inviteToMoby(childId: Id) {
    return this.write(() => {
      this.requireParentOf(childId);
      const st = this.settings(childId);
      if (st.moby === 'active') throw new ApiError('CONFLICT', 'Доступ уже выдан');
      st.moby = 'invited';
      st.inviteCode = String(100000 + Math.floor(Math.random() * 900000));
      return { code: st.inviteCode };
    });
  }

  async confirmMoby(childId: Id) {
    await this.write((db) => {
      const { session } = this.requireParentOf(childId);
      const st = this.settings(childId);
      if (st.moby !== 'pending_confirm' && st.moby !== 'none' && st.moby !== 'invited') throw new ApiError('CONFLICT', 'Нечего подтверждать');
      this.activateMoby(db, session.memberId, childId);
    });
  }

  private activateMoby(db: Db, parentId: Id, childId: Id) {
    const st = this.settings(childId);
    st.moby = 'active';
    st.inviteCode = null;
    db.consents.push({ id: nextId(db, 'cns'), parentId, childId, type: 'child-moby-access', givenAt: this.iso(), revokedAt: null });
    this.notify(childId, 'Доступ открыт', 'Теперь ты можешь входить в Moby');
  }

  async setMobySuspended(childId: Id, suspended: boolean) {
    await this.write(() => {
      this.requireParentOf(childId);
      const st = this.settings(childId);
      if (suspended && st.moby !== 'active') throw new ApiError('CONFLICT', 'Доступ не активен');
      if (!suspended && st.moby !== 'suspended') throw new ApiError('CONFLICT', 'Доступ не приостановлен');
      st.moby = suspended ? 'suspended' : 'active';
    });
  }

  async topUpChild(childId: Id, amount: Money) {
    await this.write(() => {
      const { session, child } = this.requireParentOf(childId);
      const parent = this.member(session.memberId);
      this.transfer(this.currentAccount(session.memberId), this.currentAccount(childId), amount, { out: `Перевод: ${child.firstName}`, in: `Пополнение от ${parent.firstName}` }, { out: 'transfer_out', in: 'topup' });
      this.notify(childId, 'Пополнение', `${formatMoney(amount, { sign: 'always' })} от ${parent.firstName}`, '/history');
    });
  }

  async setAllowance(childId: Id, value: { amount: Money; period: 'weekly' | 'monthly' } | null) {
    await this.write((db) => {
      const { session } = this.requireParentOf(childId);
      for (const a of db.allowances.filter((x) => x.childId === childId)) a.active = false;
      if (!value) return;
      if (value.amount.minor <= 0) throw new ApiError('VALIDATION', 'Сумма должна быть больше нуля');
      const next = this.now();
      next.setDate(next.getDate() + (value.period === 'weekly' ? 7 : 30));
      db.allowances.push({ id: nextId(db, 'alw'), parentId: session.memberId, childId, amount: value.amount, period: value.period, nextRunAt: next.toISOString(), active: true });
    });
  }

  async resolveRequest(requestId: Id, approve: boolean) {
    await this.write((db) => {
      const s = this.requireParent();
      const req = db.requests.find((r) => r.id === requestId && r.familyId === s.familyId);
      if (!req) throw new ApiError('NOT_FOUND', 'Запрос не найден');
      if (req.status !== 'pending') throw new ApiError('CONFLICT', 'Запрос уже обработан');
      req.status = approve ? 'approved' : 'declined';
      req.resolvedAt = this.iso();
      req.resolvedBy = s.memberId;
      if (approve) this.applyRequest(db, s, req.childId, req.payload);
      else if (req.payload.type === 'purchase') {
        const txId = req.payload.transactionId;
        const tx = db.transactions.find((t) => t.id === txId);
        if (tx && tx.status === 'pending_approval') {
          tx.status = 'declined';
          tx.declineReason = 'CHANNEL_APPROVAL';
        }
      }
      this.notify(req.childId, approve ? 'Родитель разрешил' : 'Родитель отказал', describePayload(req.payload), '/requests');
    });
  }

  private applyRequest(db: Db, s: Session, childId: Id, p: AccessRequestPayload) {
    const st = this.settings(childId);
    switch (p.type) {
      case 'capability': {
        const level = clampLevel(p.level, CAPABILITY_LIST.find((c) => c.id === p.capabilityId)!.rules[st.ageGroup].ceiling);
        st.levels[p.capabilityId] = level;
        return;
      }
      case 'limit':
        st.limits = { ...st.limits, [p.limit]: p.amount };
        return;
      case 'money': {
        const parent = this.member(s.memberId);
        this.transfer(this.currentAccount(s.memberId), this.currentAccount(childId), p.amount, { out: 'Перевод по просьбе ребёнка', in: `От ${parent.firstName}` }, { out: 'transfer_out', in: 'topup' });
        return;
      }
      case 'moby-access':
        this.activateMoby(db, s.memberId, childId);
        return;
      case 'product': {
        const product = PRODUCTS.find((x) => x.id === p.productId);
        if (!product) throw new ApiError('NOT_FOUND', 'Продукт не найден');
        if (product.capability && canParentSet(st.ageGroup, product.capability, 'on')) st.levels[product.capability] = 'on';
        else if (product.capability && canParentSet(st.ageGroup, product.capability, 'approval')) st.levels[product.capability] = 'approval';
        if (product.id === 'teen-deposit' && !db.accounts.some((a) => a.ownerId === childId && a.kind === 'deposit')) {
          db.accounts.push({ id: nextId(db, 'acc'), ownerId: childId, kind: 'deposit', title: 'Накопительный', balance: ZERO, createdAt: this.iso() });
        }
        return;
      }
      case 'purchase': {
        // Разовое разрешение: родитель снимает лимиты и подтверждение для этой покупки,
        // но не снимает жёсткие запреты (категории 18+, блокировку карты) и баланс.
        const tx = db.transactions.find((t) => t.id === p.transactionId);
        if (!tx || (tx.status !== 'pending_approval' && tx.status !== 'declined')) throw new ApiError('CONFLICT', 'Операция уже обработана');
        const acc = db.accounts.find((a) => a.id === tx.accountId)!;
        const amount = minor(Math.abs(tx.amount.minor));
        const card = this.activeCard(childId);
        if (tx.category && CATEGORIES[tx.category].hardBlocked) throw new ApiError('POLICY_DENIED', 'Категория запрещена для детей');
        if (card && card.status !== 'active' && tx.channel !== 'p2p') throw new ApiError('POLICY_DENIED', 'Карта не активна');
        if (gt(amount, acc.balance)) throw new ApiError('VALIDATION', 'У ребёнка недостаточно средств — сначала пополните');
        if (tx.status === 'declined') {
          // Отклонённую покупку проводим заново как новую операцию.
          this.postTx({ accountId: acc.id, memberId: childId, kind: tx.kind, amount: tx.amount, title: tx.title, category: tx.category, channel: tx.channel });
        } else {
          tx.status = 'completed';
          tx.declineReason = null;
          acc.balance = sub(acc.balance, amount);
        }
        return;
      }
    }
  }

  async createTask(childId: Id, title: string, reward: { points: number; money: Money | null }) {
    await this.write((db) => {
      const { session } = this.requireParentOf(childId);
      if (!title.trim()) throw new ApiError('VALIDATION', 'Опишите задание');
      db.tasks.push({ id: nextId(db, 'task'), familyId: session.familyId, childId, createdBy: session.memberId, title: title.trim(), reward, status: 'assigned', createdAt: this.iso(), updatedAt: this.iso() });
      this.notify(childId, 'Новое задание', title.trim(), '/tasks');
    });
  }

  async reviewTask(taskId: Id, accept: boolean) {
    await this.write((db) => {
      const s = this.requireParent();
      const t = db.tasks.find((x) => x.id === taskId && x.familyId === s.familyId);
      if (!t) throw new ApiError('NOT_FOUND', 'Задание не найдено');
      if (t.status !== 'submitted') throw new ApiError('CONFLICT', 'Задание ещё не сдано');
      t.status = accept ? 'done' : 'assigned';
      t.updatedAt = this.iso();
      if (accept) {
        this.addPoints(t.childId, t.reward.points, `Задание «${t.title}»`);
        if (t.reward.money) this.transfer(this.currentAccount(s.memberId), this.currentAccount(t.childId), t.reward.money, { out: `Награда за задание`, in: `Награда: ${t.title}` }, { out: 'transfer_out', in: 'reward' });
      }
      this.notify(t.childId, accept ? 'Задание принято' : 'Задание вернули', t.title, '/tasks');
    });
  }

  // ---------------------------------------------------------------- ребёнок

  async pay(input: PayInput): Promise<PayResult> {
    return this.write((db) => {
      const s = this.requireChild();
      const child = this.member(s.memberId);
      const st = this.settings(child.id);
      this.syncAgeGroup(child, st);
      if (input.amount.minor <= 0) throw new ApiError('VALIDATION', 'Сумма должна быть больше нуля');
      const account = this.currentAccount(child.id);
      const card = input.channel === 'p2p' ? null : this.activeCard(child.id);
      const decision = authorizePayment(input, {
        settings: st,
        account,
        card,
        spentToday: this.spent(account.id, this.startOfDay()),
        spentMonth: this.spent(account.id, this.startOfMonth()),
      });
      const kind: TxKind = input.channel === 'atm' ? 'cash' : input.channel === 'p2p' ? 'transfer_out' : 'purchase';
      const base = { accountId: account.id, memberId: child.id, kind, amount: minor(-input.amount.minor), title: input.merchant, category: input.category, channel: input.channel };
      let requestId: Id | null = null;
      let tx: Transaction;

      if (decision.outcome === 'approve') {
        tx = this.postTx(base);
        if (input.category && CATEGORIES[input.category].family) {
          const pts = Math.floor((input.amount.minor / 100) * REWARDS.familyCashbackPercent);
          this.addPoints(child.id, pts, `Кешбэк: ${input.merchant}`);
        }
        if (st.notifyParentOnEveryOperation) this.notifyParents(child.familyId, `${child.firstName}: покупка`, `${input.merchant}, ${formatMoney(tx.amount)}`, `/child/${child.id}`);
      } else if (decision.outcome === 'needs_approval') {
        tx = this.postTx({ ...base, status: 'pending_approval', declineReason: decision.code });
        requestId = nextId(db, 'req');
        db.requests.push({ id: requestId, familyId: child.familyId, childId: child.id, payload: { type: 'purchase', transactionId: tx.id }, comment: '', status: 'pending', createdAt: this.iso(), resolvedAt: null, resolvedBy: null });
        this.notifyParents(child.familyId, `${child.firstName} ждёт подтверждения`, `${input.merchant}, ${formatMoney(input.amount)}`, '/requests');
      } else {
        tx = this.postTx({ ...base, status: 'declined', declineReason: decision.code });
        this.notifyParents(child.familyId, `${child.firstName}: отказ`, `${input.merchant} — ${REASON_TEXT[decision.code].parent}`, `/child/${child.id}`);
      }
      return { decision, transaction: tx, requestId };
    });
  }

  async createRequest(payload: AccessRequestPayload, comment = '') {
    return this.write((db) => {
      const s = this.requireChild();
      const st = this.settings(s.memberId);
      if (payload.type === 'capability') {
        const access = capabilityAccess(st, payload.capabilityId);
        if (access.kind !== 'denied' || !access.canRequest) throw new ApiError('POLICY_DENIED', 'Запросить это нельзя');
      }
      if (payload.type === 'product' && capabilityAccess(st, 'products.request').kind === 'denied') {
        throw new ApiError('POLICY_DENIED', 'Запросы продуктов выключены родителем');
      }
      if (payload.type === 'purchase') {
        const tx = db.transactions.find((t) => t.id === payload.transactionId && t.memberId === s.memberId);
        if (!tx || tx.status !== 'declined') throw new ApiError('CONFLICT', 'Эту операцию нельзя запросить');
        if (tx.category && CATEGORIES[tx.category].hardBlocked) throw new ApiError('POLICY_DENIED', 'Такие покупки детям недоступны');
        if (tx.declineReason === 'CARD_BLOCKED' || tx.declineReason === 'CARD_LOST' || tx.declineReason === 'CHANNEL_NOT_FOR_AGE') throw new ApiError('POLICY_DENIED', 'Эту операцию разрешить нельзя');
        if (tx.declineReason === 'INSUFFICIENT_FUNDS') throw new ApiError('VALIDATION', 'Не хватает денег — попроси пополнить');
      }
      const dup = db.requests.find((r) => r.childId === s.memberId && r.status === 'pending' && JSON.stringify(r.payload) === JSON.stringify(payload));
      if (dup) return { requestId: dup.id };
      const id = nextId(db, 'req');
      db.requests.push({ id, familyId: s.familyId, childId: s.memberId, payload, comment: comment.trim(), status: 'pending', createdAt: this.iso(), resolvedAt: null, resolvedBy: null });
      const child = this.member(s.memberId);
      this.notifyParents(s.familyId, `${child.firstName} просит`, describePayload(payload), '/requests');
      return { requestId: id };
    });
  }

  async submitTask(taskId: Id) {
    await this.write((db) => {
      const s = this.requireChild();
      const t = db.tasks.find((x) => x.id === taskId && x.childId === s.memberId);
      if (!t) throw new ApiError('NOT_FOUND', 'Задание не найдено');
      if (t.status !== 'assigned') throw new ApiError('CONFLICT', 'Задание уже сдано');
      t.status = 'submitted';
      t.updatedAt = this.iso();
      const child = this.member(s.memberId);
      this.notifyParents(s.familyId, `${child.firstName} выполнил задание`, t.title, '/tasks');
    });
  }

  async createGoal(title: string, target: Money) {
    return this.write((db) => {
      const s = this.requireChild();
      const access = capabilityAccess(this.settings(s.memberId), 'savings.goal');
      if (access.kind !== 'allowed') throw new ApiError('POLICY_DENIED', 'Копилка пока недоступна');
      if (!title.trim()) throw new ApiError('VALIDATION', 'Назови цель');
      if (target.minor <= 0) throw new ApiError('VALIDATION', 'Укажи сумму цели');
      const id = nextId(db, 'acc');
      db.accounts.push({ id, ownerId: s.memberId, kind: 'goal', title: title.trim(), balance: ZERO, goal: { target, reachedAt: null }, createdAt: this.iso() });
      return { accountId: id };
    });
  }

  async moveToGoal(goalId: Id, amount: Money, direction: 'in' | 'out') {
    await this.write((db) => {
      const s = this.requireChild();
      const goal = db.accounts.find((a) => a.id === goalId && a.ownerId === s.memberId && a.kind === 'goal');
      if (!goal || !goal.goal) throw new ApiError('NOT_FOUND', 'Копилка не найдена');
      const main = this.currentAccount(s.memberId);
      if (direction === 'in') this.transfer(main, goal, amount, { out: `В копилку «${goal.title}»`, in: 'Пополнение копилки' }, { out: 'goal_in', in: 'goal_in' });
      else this.transfer(goal, main, amount, { out: 'Из копилки', in: `Из копилки «${goal.title}»` }, { out: 'goal_out', in: 'goal_out' });
      if (direction === 'in' && !goal.goal.reachedAt && !gt(goal.goal.target, goal.balance)) {
        goal.goal.reachedAt = this.iso();
        this.addPoints(s.memberId, REWARDS.goalReached, `Цель «${goal.title}» достигнута`);
        const child = this.member(s.memberId);
        this.notifyParents(s.familyId, `${child.firstName} накопил на цель`, goal.title, `/child/${child.id}`);
      }
    });
  }

  // ---------------------------------------------------------------- общее

  async completeLesson(lessonId: string, answers: number[]) {
    return this.write((db) => {
      const s = this.requireSession();
      const lesson = LESSONS.find((l) => l.id === lessonId);
      if (!lesson) throw new ApiError('NOT_FOUND', 'Урок не найден');
      const correct = lesson.quiz.filter((q, i) => answers[i] === q.correct).length;
      const score = lesson.quiz.length ? correct / lesson.quiz.length : 1;
      const already = db.lessons.some((l) => l.memberId === s.memberId && l.lessonId === lessonId);
      let points = 0;
      if (score >= 0.5 && !already) {
        points = lesson.points;
        db.lessons.push({ memberId: s.memberId, lessonId, completedAt: this.iso(), score });
        this.addPoints(s.memberId, points, `Урок «${lesson.title}»`);
        if (s.role === 'child') {
          const child = this.member(s.memberId);
          this.notifyParents(s.familyId, `${child.firstName} прошёл урок`, lesson.title, `/child/${child.id}`);
        }
      }
      return { score, points };
    });
  }

  async markNotificationsRead() {
    await this.write((db) => {
      const s = this.requireSession();
      for (const n of db.notifications) if (n.memberId === s.memberId) n.read = true;
    });
  }
}
