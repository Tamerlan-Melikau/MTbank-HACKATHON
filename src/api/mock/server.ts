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
  DEPOSIT_MIN_FIRST_TOPUP,
  DEPOSIT_TITLE,
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
  managesInterestRule,
  minor,
  monthlyInterest,
  monthlyInterestAt,
  parentManagesSavings,
  presetLimits,
  savingsAvailable,
  sub,
  type AccessDecision,
  type AccessRequestPayload,
  type Account,
  type AllocationInput,
  type CapabilityId,
  type Card,
  type CategoryId,
  type ChildSettings,
  type Goal,
  type Id,
  type IncomingAllocation,
  type InterestAccrual,
  type InterestRule,
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
  type DepositMoveInput,
  type EnrollInput,
  type FamilyView,
  type PayInput,
  type PayResult,
  type Persona,
  type Session,
  type TransferInput,
  type TransferRecipient,
  type TransferResult,
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
        if (parsed.version === DB_VERSION) {
          if (this.alignMonthly(parsed)) this.opts.db.set(DB_KEY, JSON.stringify(parsed));
          return parsed;
        }
        if (parsed.version === 11 || parsed.version === 12) {
          const migrated: Db = {
            ...parsed,
            version: DB_VERSION,
            insurancePolicies: parsed.insurancePolicies ?? [],
            accounts: parsed.accounts.map((a) => (a.kind === 'deposit' ? { ...a, title: DEPOSIT_TITLE } : a)),
            childSettings: this.withoutPerTransaction(parsed.childSettings),
          };
          this.alignMonthly(migrated);
          this.opts.db.set(DB_KEY, JSON.stringify(migrated));
          return migrated;
        }
        if (parsed.version === 1) {
          const migrated = this.migrateV1(parsed);
          this.alignMonthly(migrated);
          this.opts.db.set(DB_KEY, JSON.stringify(migrated));
          return migrated;
        }
      } catch {
        /* битые данные — пересоздаём */
      }
    }
    const fresh = seed(this.now());
    this.opts.db.set(DB_KEY, JSON.stringify(fresh));
    return fresh;
  }

  /** Старые базы хранили лимит на одну покупку — в текущей модели его нет. */
  private withoutPerTransaction(items: ChildSettings[]): ChildSettings[] {
    return items.map((s) => {
      const limits = { ...s.limits } as Limits & { perTransaction?: Money | null };
      delete limits.perTransaction;
      return { ...s, limits };
    });
  }

  /** v1: копилки были отдельными счетами. Их остаток возвращаем на текущий счёт ребёнка, цели создаются заново. */
  private migrateV1(legacy: Db): Db {
    const accounts = legacy.accounts.map((a) => ({ ...a, status: a.status ?? 'active' }));
    const isLegacyGoal = (a: Account) => (a.kind as string) === 'goal';
    const kept = accounts.filter((a) => !isLegacyGoal(a));
    for (const g of accounts.filter(isLegacyGoal)) {
      const main = kept.find((a) => a.ownerId === g.ownerId && a.kind === 'current');
      if (main) main.balance = add(main.balance, g.balance);
    }
    return {
      ...legacy,
      version: DB_VERSION,
      accounts: kept.map((a) => (a.kind === 'deposit' ? { ...a, title: DEPOSIT_TITLE } : a)),
      insurancePolicies: [],
      childSettings: this.withoutPerTransaction(legacy.childSettings),
      cards: legacy.cards.map((c) => ({ ...c, blockedByAccount: c.blockedByAccount ?? false })),
      goals: [],
      interestRules: [],
      allocations: [],
    };
  }

  /** Карманные всегда переводятся 1-го числа: старые недельные расписания нормализуем. */
  private alignMonthly(db: Db): boolean {
    let changed = false;
    for (const a of db.allowances) {
      if (!a.active) continue;
      if (a.period === 'monthly' && new Date(a.nextRunAt).getDate() === 1) continue;
      a.period = 'monthly';
      a.nextRunAt = this.nextMonthlyRun(this.now()).toISOString();
      changed = true;
    }
    return changed;
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

  /** Копилкой управляет сам ребёнок или родитель ребёнка до 14 лет. */
  private goalActor(childId?: Id): { childId: Id; parent: boolean; settings: ChildSettings } {
    if (childId) {
      this.requireParentOf(childId);
      const st = this.settings(childId);
      this.syncAgeGroup(this.member(childId), st);
      if (!parentManagesSavings(st.ageGroup)) throw new ApiError('FORBIDDEN', 'Родитель управляет копилками ребёнка до 14 лет');
      return { childId, parent: true, settings: st };
    }
    const s = this.requireChild();
    const st = this.settings(s.memberId);
    this.syncAgeGroup(this.member(s.memberId), st);
    return { childId: s.memberId, parent: false, settings: st };
  }

  /** Правило процентов: родитель — только до 14 лет; подросток — сам. */
  private interestActor(childId: Id, action: 'read' | 'manage' | 'accrue'): { parent: boolean; settings: ChildSettings } {
    const s = this.requireSession();
    const parent = s.role === 'parent';
    const child = parent ? this.requireParentOf(childId).child : this.member(childId);
    if (!parent && s.memberId !== childId) throw new ApiError('FORBIDDEN', 'Нет доступа');
    const st = this.settings(childId);
    this.syncAgeGroup(child, st);
    // Родитель подростка видит правило, но менять его не может.
    if (!(parent && action === 'read') && !managesInterestRule(s.role, st.ageGroup)) {
      throw new ApiError('FORBIDDEN', parent ? 'С 14 лет ребёнок настраивает проценты сам' : 'Правило процентов задаёт родитель');
    }
    return { parent, settings: st };
  }

  /** Сумму можно забрать со счёта «МТБелки», только если он не заблокирован и она не закреплена за копилками. */
  private requireFreeSavings(db: Db, childId: Id, amount: Money, message = 'остальное закреплено за копилками'): Account {
    const deposit = db.accounts.find((a) => a.ownerId === childId && a.kind === 'deposit');
    if (!deposit) throw new ApiError('NOT_FOUND', 'Счёт «МТБелки» не открыт');
    if (deposit.status === 'blocked') throw new ApiError('POLICY_DENIED', 'Счёт «МТБелки» заблокирован родителем');
    const available = savingsAvailable(deposit, db.goals.filter((g) => g.ownerId === childId));
    if (gt(amount, available)) throw new ApiError('VALIDATION', `Свободно только ${formatMoney(available)}${message ? ` — ${message}` : ''}`);
    return deposit;
  }

  /** Проверяет пополнение «МТБелок» с текущего счёта ребёнка. */
  private depositTopUpSource(childId: Id, amount: Money): { current: Account; deposit: Account } {
    if (amount.minor <= 0) throw new ApiError('VALIDATION', 'Сумма должна быть больше нуля');
    const current = this.currentAccount(childId);
    const deposit = this.db.accounts.find((a) => a.ownerId === childId && a.kind === 'deposit');
    if (!deposit) throw new ApiError('NOT_FOUND', 'Счёт «МТБелки» не открыт');
    if (current.status === 'blocked') throw new ApiError('POLICY_DENIED', 'Основной счёт заблокирован родителем');
    if (deposit.status === 'blocked') throw new ApiError('POLICY_DENIED', 'Счёт «МТБелки» заблокирован родителем');
    if (gt(amount, current.balance)) throw new ApiError('VALIDATION', 'На основном счёте недостаточно средств');
    const firstFunding = deposit.balance.minor === 0 && !this.db.transactions.some((t) => t.accountId === deposit.id);
    if (firstFunding && amount.minor < DEPOSIT_MIN_FIRST_TOPUP.minor) {
      throw new ApiError('VALIDATION', `Минимальная сумма первого пополнения — ${formatMoney(DEPOSIT_MIN_FIRST_TOPUP)}`);
    }
    return { current, deposit };
  }

  /** Переводит деньги ребёнка с основного счёта на его «МТБелки». */
  private transferToDepositFromCurrent(childId: Id, amount: Money) {
    const { current, deposit } = this.depositTopUpSource(childId, amount);
    this.transfer(
      current,
      deposit,
      amount,
      { out: 'На счёт «МТБелки»', in: 'С основного счёта' },
      { out: 'transfer_out', in: 'transfer_in' },
    );
  }

  private removeGoal(db: Db, goal: Goal) {
    db.goals = db.goals.filter((g) => g.id !== goal.id);
    for (const rule of db.interestRules) rule.goalIds = rule.goalIds.filter((id) => id !== goal.id);
  }

  private completeGoal(goal: Goal, childId: Id) {
    if (goal.reachedAt || gt(goal.target, goal.balance)) return false;
    goal.reachedAt = this.iso();
    this.addPoints(childId, REWARDS.goalReached, `Цель «${goal.title}» достигнута`);
    const child = this.member(childId);
    this.notifyParents(child.familyId, `${child.firstName} накопил на цель`, goal.title, `/child/${child.id}`);
    return true;
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

  /** Входящее поступление, часть которого можно сразу отложить на цель. */
  private queueAllocation(childId: Id, amount: Money, title: string): Id {
    const child = this.member(childId);
    const id = nextId(this.db, 'alc');
    const allocation: IncomingAllocation = {
      id,
      familyId: child.familyId,
      childId,
      amount,
      title,
      status: 'pending',
      goalId: null,
      allocated: ZERO,
      createdAt: this.iso(),
      resolvedAt: null,
      resolvedBy: null,
    };
    this.db.allocations.push(allocation);
    return id;
  }

  /** Первое число следующего месяца, 09:00 по местному времени. */
  private nextMonthlyRun(from: Date): Date {
    return new Date(from.getFullYear(), from.getMonth() + 1, 1, 9, 0, 0, 0);
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
          this.queueAllocation(a.childId, a.amount, `Карманные от ${parent.firstName}`);
          this.notify(a.childId, 'Пришли карманные', formatMoney(a.amount, { sign: 'always' }), '/history');
        } else if (parent) {
          this.notify(parent.id, 'Карманные не отправлены', 'Недостаточно средств на счёте');
        }
        const next = new Date(a.nextRunAt);
        next.setTime(this.nextMonthlyRun(next).getTime());
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
      this.notifyParents(child.familyId, `${child.firstName} ввёл код`, 'Подтвердите доступ в Moby в профиле ребёнка', `/child/${child.id}`);
      return { childId: child.id, firstName: child.firstName };
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
        goals: this.db.goals.filter((g) => g.ownerId === childId),
        deposit: this.db.accounts.find((a) => a.ownerId === childId && a.kind === 'deposit') ?? null,
        insurance: this.db.insurancePolicies.find((p) => p.childId === childId && p.status === 'active') ?? null,
        spentToday: this.spent(account.id, this.startOfDay()),
        spentMonth: this.spent(account.id, this.startOfMonth()),
        allowance: this.db.allowances.find((a) => a.childId === childId && a.active) ?? null,
        pendingAllocation: this.db.allocations.find((a) => a.childId === childId && a.status === 'pending') ?? null,
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

  private newInviteCode(): string {
    return String(100000 + Math.floor(Math.random() * 900000));
  }

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

      const acc: Account = { id: nextId(db, 'acc'), ownerId: childId, kind: 'current', title: group === 'junior' ? 'Карманные' : 'Мой счёт', balance: ZERO, status: 'active', createdAt: this.iso() };
      db.accounts.push(acc);
      db.cards.push({ id: nextId(db, 'card'), accountId: acc.id, holderId: childId, form: input.cardForm, last4: String(1000 + (db.seq * 7919) % 9000), status: 'active', blockedByAccount: false, replacedBy: null });
      const inviteCode = this.newInviteCode();
      db.childSettings.push({
        childId,
        ageGroup: group,
        levels: defaultLevels(group),
        limits: presetLimits(group),
        blockedCategories: group === 'junior' ? ['games', 'subscriptions'] : [],
        moby: 'invited',
        inviteCode,
        notifyParentOnEveryOperation: group === 'junior',
      });
      return { childId, inviteCode };
    });
  }

  /** Удаление профиля ребёнка родителем: чистим все таблицы, где есть его данные. */
  async deleteChild(childId: Id) {
    await this.write((db) => {
      this.requireParentOf(childId);
      const accountIds = new Set(db.accounts.filter((a) => a.ownerId === childId).map((a) => a.id));
      db.members = db.members.filter((m) => m.id !== childId);
      db.childSettings = db.childSettings.filter((s) => s.childId !== childId);
      db.consents = db.consents.filter((c) => c.childId !== childId);
      db.accounts = db.accounts.filter((a) => a.ownerId !== childId);
      db.insurancePolicies = db.insurancePolicies.filter((p) => p.childId !== childId);
      db.cards = db.cards.filter((c) => c.holderId !== childId && !accountIds.has(c.accountId));
      db.transactions = db.transactions.filter((t) => t.memberId !== childId && !accountIds.has(t.accountId));
      db.goals = db.goals.filter((g) => g.ownerId !== childId);
      db.interestRules = db.interestRules.filter((r) => r.childId !== childId);
      db.parentInterestRates = db.parentInterestRates.filter((r) => r.childId !== childId);
      db.allowances = db.allowances.filter((a) => a.childId !== childId);
      db.allocations = db.allocations.filter((a) => a.childId !== childId);
      db.requests = db.requests.filter((r) => r.childId !== childId);
      db.tasks = db.tasks.filter((t) => t.childId !== childId);
      db.lessons = db.lessons.filter((l) => l.memberId !== childId);
      db.points = db.points.filter((p) => p.memberId !== childId);
      db.notifications = db.notifications.filter((n) => n.memberId !== childId);
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

  /** Блокировать счёт ребёнка может только родитель из этой же семьи. */
  private accountForParent(accountId: Id): Account {
    const account = this.db.accounts.find((a) => a.id === accountId);
    if (!account) throw new ApiError('NOT_FOUND', 'Счёт не найден');
    const holder = this.member(account.ownerId);
    const s = this.requireSession();
    if (s.role !== 'parent' || holder.role !== 'child' || holder.familyId !== s.familyId) throw new ApiError('FORBIDDEN', 'Нет доступа');
    return account;
  }

  async setCardBlocked(cardId: Id, blocked: boolean) {
    await this.write((db) => {
      const card = this.cardForParent(cardId);
      const account = db.accounts.find((a) => a.id === card.accountId);
      if (card.status === 'lost') throw new ApiError('CONFLICT', 'Утерянную карту нельзя разблокировать');
      if (!blocked && account?.status === 'blocked') throw new ApiError('CONFLICT', 'Сначала разблокируйте счёт');
      card.status = blocked ? 'blocked' : 'active';
      card.blockedByAccount = false;
      if (blocked && card.holderId !== this.requireSession().memberId) this.notify(card.holderId, 'Карта заблокирована', 'Родитель заблокировал карту');
    });
  }

  /** Блокировка счёта автоматически блокирует карты, привязанные к нему. */
  async setAccountBlocked(accountId: Id, blocked: boolean) {
    await this.write((db) => {
      const account = this.accountForParent(accountId);
      account.status = blocked ? 'blocked' : 'active';
      for (const card of db.cards.filter((c) => c.accountId === account.id && c.replacedBy === null)) {
        if (blocked) {
          if (card.status === 'active') {
            card.status = 'blocked';
            card.blockedByAccount = true;
          } else if (card.status === 'lost') {
            card.blockedByAccount = false;
          }
        } else if (card.blockedByAccount) {
          card.status = 'active';
          card.blockedByAccount = false;
        }
      }
      if (account.ownerId !== this.requireSession().memberId) {
        this.notify(account.ownerId, blocked ? 'Счёт заблокирован' : 'Счёт разблокирован', blocked ? 'Родитель закрыл счёт и карту' : 'Родитель снова разрешил операции по счёту');
      }
    });
  }

  /** Утеря: старая карта навсегда закрыта, выпускается цифровая замена сразу. */
  async reportCardLost(cardId: Id) {
    return this.write((db) => {
      const card = this.cardForParent(cardId);
      const account = db.accounts.find((a) => a.id === card.accountId);
      const accountBlocked = account?.status === 'blocked';
      card.status = 'lost';
      card.blockedByAccount = false;
      const fresh: Card = {
        ...card,
        id: nextId(db, 'card'),
        form: 'digital',
        status: accountBlocked ? 'blocked' : 'active',
        blockedByAccount: accountBlocked,
        last4: String(1000 + (db.seq * 4513) % 9000),
        replacedBy: null,
      };
      card.replacedBy = fresh.id;
      db.cards.push(fresh);
      this.notify(card.holderId, 'Новая карта', accountBlocked ? 'Старая карта закрыта, новая выпущена, но счёт заблокирован' : 'Старая карта закрыта, цифровая уже работает');
      return { newCardId: fresh.id };
    });
  }

  async inviteToMoby(childId: Id) {
    return this.write(() => {
      this.requireParentOf(childId);
      const st = this.settings(childId);
      if (st.moby === 'active') throw new ApiError('CONFLICT', 'Доступ уже выдан');
      if (st.moby === 'pending_confirm') throw new ApiError('CONFLICT', 'Код уже введён — подтвердите доступ');
      st.moby = 'invited';
      st.inviteCode = this.newInviteCode();
      return { code: st.inviteCode };
    });
  }

  async confirmMoby(childId: Id) {
    await this.write(() => {
      const { session } = this.requireParentOf(childId);
      const st = this.settings(childId);
      if (st.moby !== 'pending_confirm') throw new ApiError('CONFLICT', 'Нет запроса на подтверждение доступа');
      this.activateMoby(this.db, session.memberId, childId);
    });
  }

  private activateMoby(db: Db, parentId: Id, childId: Id) {
    const st = this.settings(childId);
    st.moby = 'active';
    st.inviteCode = null;
    if (!db.consents.some((c) => c.childId === childId && c.type === 'child-moby-access' && !c.revokedAt)) {
      db.consents.push({ id: nextId(db, 'cns'), parentId, childId, type: 'child-moby-access', givenAt: this.iso(), revokedAt: null });
    }
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

  async topUpChild(childId: Id, amount: Money, targetAccountId?: Id) {
    return this.write((db) => {
      const { session, child } = this.requireParentOf(childId);
      const parent = this.member(session.memberId);
      const current = this.currentAccount(childId);
      const goal = targetAccountId ? db.goals.find((g) => g.id === targetAccountId && g.ownerId === childId) : null;

      if (!goal && (!targetAccountId || targetAccountId === current.id)) {
        this.transfer(this.currentAccount(session.memberId), current, amount, { out: `Перевод: ${child.firstName}`, in: `Пополнение от ${parent.firstName}` }, { out: 'transfer_out', in: 'topup' });
        const allocationId = this.queueAllocation(childId, amount, `Пополнение от ${parent.firstName}`);
        this.notify(childId, 'Пополнение', `${formatMoney(amount, { sign: 'always' })} от ${parent.firstName}`, '/history');
        return { allocation: db.allocations.find((a) => a.id === allocationId)! };
      }

      const target = goal ? null : db.accounts.find((a) => a.id === targetAccountId && a.ownerId === childId);
      if (!goal && !target) throw new ApiError('NOT_FOUND', 'Счёт ребёнка не найден');
      const deposit = db.accounts.find((a) => a.ownerId === childId && a.kind === 'deposit');
      if (!deposit) throw new ApiError('NOT_FOUND', 'Счёт «МТБелки» не открыт');
      if (!goal && target!.kind !== 'deposit') throw new ApiError('NOT_FOUND', 'Счёт ребёнка не найден');
      if (goal?.reachedAt) throw new ApiError('CONFLICT', 'Цель уже достигнута — пополнение закрыто');
      const firstFunding = !db.transactions.some((t) => t.accountId === deposit.id);
      if (firstFunding && amount.minor < DEPOSIT_MIN_FIRST_TOPUP.minor) {
        throw new ApiError('VALIDATION', `Минимальная сумма первого пополнения — ${formatMoney(DEPOSIT_MIN_FIRST_TOPUP)}`);
      }

      const title = goal ? `копилку «${goal.title}»` : 'счёт «МТБелки»';
      this.transfer(
        this.currentAccount(session.memberId),
        deposit,
        amount,
        { out: `Пополнение: ${child.firstName}`, in: `Пополнение от ${parent.firstName}` },
        { out: 'transfer_out', in: goal ? 'goal_in' : 'transfer_in' },
      );
      if (goal) {
        goal.balance = add(goal.balance, amount);
        this.completeGoal(goal, childId);
      }
      this.notify(childId, 'Пополнение', `${formatMoney(amount, { sign: 'always' })} на ${title} от ${parent.firstName}`, '/history');
      return { allocation: null };
    });
  }

  async interestRule(childId: Id): Promise<InterestRule | null> {
    return this.read(() => {
      this.interestActor(childId, 'read');
      const deposit = this.db.accounts.find((a) => a.ownerId === childId && a.kind === 'deposit');
      if (!deposit) return null;
      const goals = this.db.goals.filter((g) => g.ownerId === childId);
      const record = this.db.interestRules.find((r) => r.childId === childId);
      return {
        percent: record?.percent ?? 0,
        goalIds: (record?.goalIds ?? []).filter((id) => goals.some((g) => g.id === id)),
      };
    });
  }

  async setInterestRule(childId: Id, rule: InterestRule) {
    await this.write((db) => {
      this.interestActor(childId, 'manage');
      if (!db.accounts.some((a) => a.ownerId === childId && a.kind === 'deposit')) throw new ApiError('NOT_FOUND', 'Счёт «МТБелки» не открыт');
      if (!Number.isFinite(rule.percent) || rule.percent < 0 || rule.percent > 100) throw new ApiError('VALIDATION', 'Доля процентов должна быть от 0 до 100');
      const percent = Math.round(rule.percent);
      const goals = db.goals.filter((g) => g.ownerId === childId);
      const goalIds = [...new Set(rule.goalIds)];
      if (goalIds.some((id) => !goals.some((g) => g.id === id))) throw new ApiError('VALIDATION', 'Выберите копилки этого ребёнка');
      const next = { childId, percent, goalIds };
      const index = db.interestRules.findIndex((r) => r.childId === childId);
      if (index >= 0) db.interestRules[index] = next;
      else db.interestRules.push(next);
    });
  }

  /** Демо-начисление: процент на весь остаток, затем распределение по правилу. */
  async accrueInterest(childId: Id): Promise<InterestAccrual> {
    return this.write((db) => {
      const actor = this.interestActor(childId, 'accrue');
      const deposit = db.accounts.find((a) => a.ownerId === childId && a.kind === 'deposit');
      if (!deposit) throw new ApiError('NOT_FOUND', 'Счёт «МТБелки» не открыт');
      const goals = db.goals.filter((g) => g.ownerId === childId);
      const since = this.startOfMonth();
      if (db.transactions.some((t) => t.accountId === deposit.id && t.kind === 'interest' && new Date(t.createdAt) >= since)) {
        throw new ApiError('CONFLICT', 'Проценты за этот месяц уже начислены');
      }
      const interest = monthlyInterest(deposit.balance);
      if (interest.minor <= 0) return { interest: ZERO, toGoals: ZERO, toFree: ZERO };

      this.postTx({ accountId: deposit.id, memberId: childId, kind: 'interest', amount: interest, title: 'Начислены проценты', category: null, channel: 'internal' });

      const record = db.interestRules.find((r) => r.childId === childId);
      let allocated = 0;
      if (record && record.percent > 0) {
        const pool = Math.floor((interest.minor * record.percent) / 100);
        const selected = record.goalIds
          .map((id) => goals.find((g) => g.id === id))
          .filter((g): g is Goal => !!g && !g.reachedAt && gt(g.target, g.balance));
        // Делим поровну; что не влезло в заполненную цель, достаётся остальным.
        let remaining = pool;
        let open = selected;
        while (remaining > 0 && open.length > 0) {
          const share = Math.max(1, Math.floor(remaining / open.length));
          for (const goal of open) {
            const amount = Math.min(share, goal.target.minor - goal.balance.minor, remaining);
            if (amount <= 0) continue;
            goal.balance = add(goal.balance, minor(amount));
            allocated += amount;
            remaining -= amount;
          }
          open = open.filter((g) => gt(g.target, g.balance));
        }
        for (const goal of selected) this.completeGoal(goal, childId);
      }

      const toGoals = minor(allocated);
      const toFree = sub(interest, toGoals);
      this.notify(childId, 'Начислены проценты', actor.parent ? `Родитель начислил ${formatMoney(interest)}` : `Начислено ${formatMoney(interest)}`, '/deposit');
      return { interest, toGoals, toFree };
    });
  }

  async parentInterestRate(childId: Id): Promise<number> {
    return this.read(() => {
      const { session } = this.requireParentOf(childId);
      return this.db.parentInterestRates.find((r) => r.childId === childId && r.parentId === session.memberId)?.percent ?? 0;
    });
  }

  async setParentInterestRate(childId: Id, percent: number) {
    await this.write((db) => {
      const { session } = this.requireParentOf(childId);
      if (!db.accounts.some((a) => a.ownerId === childId && a.kind === 'deposit')) throw new ApiError('NOT_FOUND', 'Счёт «МТБелки» не открыт');
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new ApiError('VALIDATION', 'Ставка должна быть от 0 до 100');
      const value = Math.round(percent);
      const record = db.parentInterestRates.find((r) => r.childId === childId && r.parentId === session.memberId);
      if (record) record.percent = value;
      else db.parentInterestRates.push({ childId, parentId: session.memberId, percent: value });
    });
  }

  /** Родитель платит ребёнку процент от всего остатка счёта «МТБелки». */
  async accrueParentInterest(childId: Id): Promise<Money> {
    return this.write((db) => {
      const { session } = this.requireParentOf(childId);
      const deposit = db.accounts.find((a) => a.ownerId === childId && a.kind === 'deposit');
      if (!deposit) throw new ApiError('NOT_FOUND', 'Счёт «МТБелки» не открыт');
      const record = db.parentInterestRates.find((r) => r.childId === childId && r.parentId === session.memberId);
      if (!record || record.percent <= 0) return ZERO;
      const interest = monthlyInterestAt(deposit.balance, record.percent);
      if (interest.minor <= 0) return ZERO;
      const payer = db.accounts.find((a) => a.ownerId === session.memberId && a.kind === 'current');
      if (!payer) throw new ApiError('NOT_FOUND', 'Ваш счёт не найден');
      if (gt(interest, payer.balance)) throw new ApiError('VALIDATION', 'На вашем счёте недостаточно средств для начисления процентов');
      const parent = this.member(session.memberId);
      const child = this.member(childId);
      this.transfer(
        payer,
        deposit,
        interest,
        { out: `Проценты для ${child.firstName}`, in: `Проценты от ${parent.firstName}` },
        { out: 'transfer_out', in: 'interest' },
      );
      this.notify(childId, 'Проценты от родителя', `${formatMoney(interest, { sign: 'always' })} от ${parent.firstName}`, '/deposit');
      return interest;
    });
  }

  /** Страхование ребёнка оформляет и отключает только родитель. */
  async setChildInsurance(childId: Id, active: boolean) {
    await this.write((db) => {
      const { session } = this.requireParentOf(childId);
      const current = db.insurancePolicies.find((p) => p.childId === childId && p.status === 'active');
      if (active) {
        if (current) throw new ApiError('CONFLICT', 'Страхование уже оформлено');
        db.insurancePolicies.push({
          id: nextId(db, 'ins'),
          childId,
          parentId: session.memberId,
          status: 'active',
          createdAt: this.iso(),
          cancelledAt: null,
        });
        this.notify(childId, 'Страхование оформлено', 'Родитель оформил страхование в разделе «Продукты»');
        return;
      }
      if (!current) throw new ApiError('CONFLICT', 'Страхование не оформлено');
      current.status = 'cancelled';
      current.cancelledAt = this.iso();
      this.notify(childId, 'Страхование отключено', 'Родитель отключил страхование в разделе «Продукты»');
    });
  }

  /** Счёт «МТБелки» ребёнку открывает родитель; подросток 14+ может открыть сам. */
  async openDeposit(childId: Id) {
    await this.write((db) => {
      this.requireParentOf(childId);
      this.openDepositAccount(db, childId, 'Родитель открыл счёт на твоё имя');
    });
  }

  /** Подросток 14+ открывает свой счёт «МТБелки» сам. */
  async openOwnDeposit() {
    await this.write((db) => {
      const s = this.requireChild();
      const child = this.member(s.memberId);
      const st = this.settings(child.id);
      this.syncAgeGroup(child, st);
      if (st.ageGroup !== 'teen') throw new ApiError('FORBIDDEN', 'До 14 лет счёт открывает родитель');
      if (capabilityAccess(st, 'savings.deposit').kind !== 'allowed') throw new ApiError('POLICY_DENIED', 'Открытие счёта не разрешено родителем');
      this.openDepositAccount(db, child.id, 'Ты открыл счёт на своё имя');
    });
  }

  private openDepositAccount(db: Db, childId: Id, message: string) {
    if (db.accounts.some((a) => a.ownerId === childId && a.kind === 'deposit')) throw new ApiError('CONFLICT', 'Счёт «МТБелки» уже открыт');
    db.accounts.push({ id: nextId(db, 'acc'), ownerId: childId, kind: 'deposit', title: DEPOSIT_TITLE, balance: ZERO, status: 'active', createdAt: this.iso() });
    this.notify(childId, 'Счёт «МТБелки» открыт', message);
  }

  /** Закрытие счёта «МТБелки»: остаток возвращается на текущий счёт ребёнка. */
  async closeDeposit(childId: Id) {
    await this.write((db) => {
      this.requireParentOf(childId);
      this.closeDepositAccount(db, childId);
    });
  }

  /** Подросток 14+ закрывает свой счёт «МТБелки» сам. */
  async closeOwnDeposit() {
    await this.write((db) => {
      const s = this.requireChild();
      const child = this.member(s.memberId);
      const st = this.settings(child.id);
      this.syncAgeGroup(child, st);
      if (st.ageGroup !== 'teen') throw new ApiError('FORBIDDEN', 'До 14 лет счёт закрывает родитель');
      if (capabilityAccess(st, 'savings.deposit').kind !== 'allowed') throw new ApiError('POLICY_DENIED', 'Закрытие счёта не разрешено родителем');
      this.closeDepositAccount(db, child.id);
    });
  }

  private closeDepositAccount(db: Db, childId: Id) {
    const deposit = db.accounts.find((a) => a.ownerId === childId && a.kind === 'deposit');
    if (!deposit) throw new ApiError('NOT_FOUND', 'Счёт «МТБелки» не открыт');
    if (db.goals.some((g) => g.ownerId === childId)) throw new ApiError('CONFLICT', 'Сначала закройте копилки — их деньги останутся на счёте «МТБелки»');
    if (deposit.balance.minor > 0) {
      this.transfer(deposit, this.currentAccount(childId), deposit.balance, { out: 'Закрытие счёта «МТБелки»', in: 'Со счёта «МТБелки»' }, { out: 'transfer_out', in: 'transfer_in' });
    }
    db.accounts = db.accounts.filter((a) => a.id !== deposit.id);
    db.interestRules = db.interestRules.filter((r) => r.childId !== childId);
    this.notify(childId, 'Счёт «МТБелки» закрыт', 'Остаток переведён на текущий счёт');
  }

  /** Пополнение «МТБелок» с основного счёта: подросток сразу, младший — через запрос родителю. */
  async topUpOwnDeposit(amount: Money) {
    return this.write((db) => {
      const s = this.requireChild();
      const child = this.member(s.memberId);
      const st = this.settings(s.memberId);
      this.syncAgeGroup(child, st);
      this.depositTopUpSource(child.id, amount);

      if (st.ageGroup === 'junior') {
        const payload: AccessRequestPayload = { type: 'deposit_topup', amount };
        const dup = db.requests.find((r) => r.childId === child.id && r.status === 'pending' && JSON.stringify(r.payload) === JSON.stringify(payload));
        if (dup) return { requestId: dup.id };
        const id = nextId(db, 'req');
        db.requests.push({ id, familyId: s.familyId, childId: child.id, payload, comment: '', status: 'pending', createdAt: this.iso(), resolvedAt: null, resolvedBy: null });
        this.notifyParents(s.familyId, `${child.firstName} просит`, describePayload(payload), '/requests');
        return { requestId: id };
      }

      this.transferToDepositFromCurrent(child.id, amount);
      return { requestId: null };
    });
  }

  /** Снятие со счёта «МТБелки»: подросток сразу, младший — через запрос родителю. */
  async moveDeposit(input: DepositMoveInput) {
    return this.write((db) => {
      const s = this.requireChild();
      const child = this.member(s.memberId);
      const st = this.settings(s.memberId);
      this.syncAgeGroup(child, st);
      const volume = this.depositMoveVolume(db, child.id, input);

      if (st.ageGroup === 'junior') {
        const payload: AccessRequestPayload = input.recipientId
          ? { type: 'deposit_transfer', amount: volume, recipientId: input.recipientId, recipient: input.recipient }
          : { type: 'deposit_withdraw', amount: volume };
        const dup = db.requests.find((r) => r.childId === child.id && r.status === 'pending' && JSON.stringify(r.payload) === JSON.stringify(payload));
        if (dup) return { requestId: dup.id };
        const id = nextId(db, 'req');
        db.requests.push({ id, familyId: s.familyId, childId: child.id, payload, comment: '', status: 'pending', createdAt: this.iso(), resolvedAt: null, resolvedBy: null });
        this.notifyParents(s.familyId, `${child.firstName} просит`, describePayload(payload), '/requests');
        return { requestId: id };
      }

      this.transferFromDeposit(db, child.id, volume, input.recipientId, input.recipient);
      return { requestId: null };
    });
  }

  private depositMoveVolume(db: Db, childId: Id, input: DepositMoveInput) {
    if (input.amount.minor <= 0) throw new ApiError('VALIDATION', 'Сумма должна быть больше нуля');
    this.requireFreeSavings(db, childId, input.amount);
    if (input.recipientId) {
      const target = this.member(input.recipientId);
      if (target.id === childId || target.familyId !== this.member(childId).familyId) throw new ApiError('FORBIDDEN', 'Можно переводить только членам своей семьи');
    }
    return input.amount;
  }

  private transferFromDeposit(db: Db, childId: Id, amount: Money, recipientId: Id | null, recipient: string) {
    const deposit = this.requireFreeSavings(db, childId, amount);
    const child = this.member(childId);
    const target = this.currentAccount(recipientId ?? childId);
    if (recipientId) {
      const to = this.member(recipientId);
      if (to.id === childId || to.familyId !== child.familyId) throw new ApiError('FORBIDDEN', 'Можно переводить только членам своей семьи');
    }
    this.transfer(
      deposit,
      target,
      amount,
      { out: recipientId ? `Перевод: ${recipient}` : 'Со счёта «МТБелки»', in: recipientId ? `Перевод от ${child.firstName}` : 'Со счёта «МТБелки»' },
      { out: 'transfer_out', in: 'transfer_in' },
    );
    return target;
  }

  async setAllowance(childId: Id, value: { amount: Money } | null) {
    await this.write((db) => {
      const { session } = this.requireParentOf(childId);
      for (const a of db.allowances.filter((x) => x.childId === childId)) a.active = false;
      if (!value) return;
      if (value.amount.minor <= 0) throw new ApiError('VALIDATION', 'Сумма должна быть больше нуля');
      db.allowances.push({ id: nextId(db, 'alw'), parentId: session.memberId, childId, amount: value.amount, period: 'monthly', nextRunAt: this.nextMonthlyRun(this.now()).toISOString(), active: true });
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
        this.queueAllocation(childId, p.amount, `От ${parent.firstName}`);
        return;
      }
      case 'transfer': {
        const child = this.member(childId);
        if (this.currentAccount(childId).status === 'blocked') throw new ApiError('POLICY_DENIED', 'Счёт ребёнка заблокирован');
        if (p.recipientId) {
          const target = this.member(p.recipientId);
          if (target.id === childId || target.familyId !== child.familyId) throw new ApiError('FORBIDDEN', 'Можно переводить только членам своей семьи');
          this.transfer(this.currentAccount(childId), this.currentAccount(target.id), p.amount, { out: `Перевод: ${p.recipient}`, in: `Перевод от ${child.firstName}` }, { out: 'transfer_out', in: 'transfer_in' });
          return;
        }
        const account = this.currentAccount(childId);
        if (gt(p.amount, account.balance)) throw new ApiError('VALIDATION', 'У ребёнка недостаточно средств — сначала пополните');
        this.postTx({
          accountId: account.id,
          memberId: childId,
          kind: 'transfer_out',
          amount: minor(-p.amount.minor),
          title: `Перевод: ${p.recipient}`,
          category: null,
          channel: 'p2p',
        });
        return;
      }
      case 'moby-access':
        this.activateMoby(db, s.memberId, childId);
        return;
      case 'goal_withdraw': {
        const goal = db.goals.find((g) => g.id === p.goalId && g.ownerId === childId);
        if (!goal) throw new ApiError('NOT_FOUND', 'Копилка не найдена');
        if (gt(p.amount, goal.balance)) throw new ApiError('VALIDATION', 'В копилке недостаточно средств');
        goal.balance = sub(goal.balance, p.amount);
        if (goal.reachedAt && goal.balance.minor === 0) {
          this.removeGoal(db, goal);
          this.notify(childId, 'Копилка закрыта', `Цель «${goal.title}» достигнута, деньги остались на счёте «МТБелки»`);
        }
        return;
      }
      case 'goal_close': {
        const goal = db.goals.find((g) => g.id === p.goalId && g.ownerId === childId);
        if (!goal) throw new ApiError('NOT_FOUND', 'Копилка не найдена');
        const hadMoney = goal.balance.minor > 0;
        this.removeGoal(db, goal);
        this.notify(childId, 'Копилка закрыта', hadMoney ? 'Деньги остались на счёте «МТБелки»' : 'Цель удалена');
        return;
      }
      case 'deposit_close': {
        this.closeDepositAccount(db, childId);
        return;
      }
      case 'deposit_topup': {
        this.transferToDepositFromCurrent(childId, p.amount);
        return;
      }
      case 'deposit_withdraw': {
        this.transferFromDeposit(db, childId, p.amount, null, 'На основной счёт');
        return;
      }
      case 'deposit_transfer': {
        this.transferFromDeposit(db, childId, p.amount, p.recipientId, p.recipient);
        return;
      }
      case 'product': {
        const product = PRODUCTS.find((x) => x.id === p.productId);
        if (!product) throw new ApiError('NOT_FOUND', 'Продукт не найден');
        if (product.capability && canParentSet(st.ageGroup, product.capability, 'on')) st.levels[product.capability] = 'on';
        else if (product.capability && canParentSet(st.ageGroup, product.capability, 'approval')) st.levels[product.capability] = 'approval';
        if (product.id === 'teen-deposit' && !db.accounts.some((a) => a.ownerId === childId && a.kind === 'deposit')) {
          db.accounts.push({ id: nextId(db, 'acc'), ownerId: childId, kind: 'deposit', title: DEPOSIT_TITLE, balance: ZERO, status: 'active', createdAt: this.iso() });
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
        if (acc.status === 'blocked') throw new ApiError('POLICY_DENIED', 'Счёт заблокирован родителем');
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
        if (t.reward.money) {
          this.transfer(this.currentAccount(s.memberId), this.currentAccount(t.childId), t.reward.money, { out: `Награда за задание`, in: `Награда: ${t.title}` }, { out: 'transfer_out', in: 'reward' });
          this.queueAllocation(t.childId, t.reward.money, `Награда: ${t.title}`);
        }
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

  /** Кому ребёнок может перевести: родители и братья/сёстры. */
  async transferRecipients(): Promise<TransferRecipient[]> {
    return this.read(() => {
      const s = this.requireSession();
      return this.db.members
        .filter((m) => m.familyId === s.familyId && m.id !== s.memberId)
        .sort((a, b) => (a.role === b.role ? a.firstName.localeCompare(b.firstName, 'ru') : a.role === 'parent' ? -1 : 1))
        .map((m) => ({
          memberId: m.id,
          title: `${m.firstName} ${m.lastName}`.trim(),
          subtitle: m.role === 'parent' ? 'Родитель' : 'Брат или сестра',
          role: m.role,
        }));
    });
  }

  /** Перевод: до 14 лет — любому получателю, но только с одобрения родителя. */
  async transferMoney(input: TransferInput): Promise<TransferResult> {
    return this.write((db) => {
      const s = this.requireChild();
      const child = this.member(s.memberId);
      const st = this.settings(child.id);
      this.syncAgeGroup(child, st);
      const amount = input.amount;
      if (amount.minor <= 0) throw new ApiError('VALIDATION', 'Сумма должна быть больше нуля');
      const account = this.currentAccount(child.id);
      if (account.status === 'blocked') throw new ApiError('POLICY_DENIED', 'Счёт заблокирован родителем');
      if (gt(amount, account.balance)) throw new ApiError('VALIDATION', 'Не хватает денег на счёте');

      const junior = st.ageGroup === 'junior';
      let target: Member | null = null;
      if (input.recipientId) {
        target = this.member(input.recipientId);
        if (target.id === child.id || target.familyId !== child.familyId) throw new ApiError('FORBIDDEN', 'Можно переводить только членам своей семьи');
      }
      const recipient = target ? `${target.firstName} ${target.lastName}`.trim() : input.recipient.trim();
      if (!recipient) throw new ApiError('VALIDATION', 'Укажи получателя');

      const access = capabilityAccess(st, 'transfer.p2p');
      if (!junior && access.kind === 'denied') throw new ApiError('POLICY_DENIED', 'Переводы выключены родителем');

      let needsParent = junior || access.kind === 'approval';
      if (!junior && access.kind === 'allowed') {
        const decision = authorizePayment(
          { amount, channel: 'p2p', category: null },
          {
            settings: st,
            account,
            card: null,
            spentToday: this.spent(account.id, this.startOfDay()),
            spentMonth: this.spent(account.id, this.startOfMonth()),
          },
        );
        if (decision.outcome === 'decline') throw new ApiError('POLICY_DENIED', REASON_TEXT[decision.code].child);
        needsParent = decision.outcome === 'needs_approval';
      }

      if (needsParent) {
        const payload: AccessRequestPayload = { type: 'transfer', recipient, recipientId: target?.id, amount };
        const dup = db.requests.find((r) => r.childId === child.id && r.status === 'pending' && JSON.stringify(r.payload) === JSON.stringify(payload));
        const requestId = dup?.id ?? nextId(db, 'req');
        if (!dup) {
          db.requests.push({
            id: requestId,
            familyId: child.familyId,
            childId: child.id,
            payload,
            comment: input.comment?.trim() ?? '',
            status: 'pending',
            createdAt: this.iso(),
            resolvedAt: null,
            resolvedBy: null,
          });
          this.notifyParents(child.familyId, `${child.firstName} просит перевод`, `${recipient}, ${formatMoney(amount)}`, '/requests');
        }
        return { requestId, transaction: null };
      }

      const tx = this.postTx({
        accountId: account.id,
        memberId: child.id,
        kind: 'transfer_out',
        amount: minor(-amount.minor),
        title: `Перевод: ${recipient}`,
        category: null,
        channel: target ? 'internal' : 'p2p',
      });
      if (target) {
        this.postTx({
          accountId: this.currentAccount(target.id).id,
          memberId: target.id,
          kind: 'transfer_in',
          amount,
          title: `Перевод от ${child.firstName}`,
          category: null,
          channel: 'internal',
        });
      }
      if (st.notifyParentOnEveryOperation) {
        this.notifyParents(child.familyId, `${child.firstName}: перевод`, `${recipient}, ${formatMoney(amount)}`, `/child/${child.id}`);
      }
      return { requestId: null, transaction: tx };
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
      if (payload.type === 'product') {
        if (capabilityAccess(st, 'products.request').kind === 'denied') throw new ApiError('POLICY_DENIED', 'Запросы продуктов выключены родителем');
        const product = PRODUCTS.find((x) => x.id === payload.productId);
        if (!product || !product.forGroups.includes(st.ageGroup)) throw new ApiError('NOT_FOUND', 'Продукт не найден');
        if (product.requestableBy && !product.requestableBy.includes(st.ageGroup)) throw new ApiError('POLICY_DENIED', 'Этот продукт оформляет родитель');
      }
      if (payload.type === 'purchase') {
        const tx = db.transactions.find((t) => t.id === payload.transactionId && t.memberId === s.memberId);
        if (!tx || tx.status !== 'declined') throw new ApiError('CONFLICT', 'Эту операцию нельзя запросить');
        if (tx.category && CATEGORIES[tx.category].hardBlocked) throw new ApiError('POLICY_DENIED', 'Такие покупки детям недоступны');
        if (tx.declineReason === 'ACCOUNT_BLOCKED' || tx.declineReason === 'CARD_BLOCKED' || tx.declineReason === 'CARD_LOST' || tx.declineReason === 'CHANNEL_NOT_FOR_AGE') throw new ApiError('POLICY_DENIED', 'Эту операцию разрешить нельзя');
        if (tx.declineReason === 'INSUFFICIENT_FUNDS') throw new ApiError('VALIDATION', 'Не хватает денег — попроси пополнить');
      }
      if (payload.type === 'transfer') throw new ApiError('VALIDATION', 'Оформите перевод на экране «Перевести»');
      if (payload.type === 'deposit_close') {
        if (st.ageGroup !== 'teen') throw new ApiError('POLICY_DENIED', 'Закрыть счёт может родитель');
        if (!db.accounts.some((a) => a.ownerId === s.memberId && a.kind === 'deposit')) throw new ApiError('NOT_FOUND', 'Счёт «МТБелки» не открыт');
      }
      if (payload.type === 'deposit_withdraw' || payload.type === 'deposit_transfer') {
        if (st.ageGroup !== 'junior') throw new ApiError('POLICY_DENIED', 'С 14 лет операция выполняется сразу');
        this.depositMoveVolume(db, s.memberId, { amount: payload.amount, recipientId: payload.type === 'deposit_transfer' ? payload.recipientId : null, recipient: payload.type === 'deposit_transfer' ? payload.recipient : 'На основной счёт' });
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

  async createGoal(title: string, target: Money, childId?: Id) {
    return this.write((db) => {
      const actor = this.goalActor(childId);
      if (!actor.parent) {
        const access = capabilityAccess(actor.settings, 'savings.goal');
        if (access.kind !== 'allowed') throw new ApiError('POLICY_DENIED', 'Копилка пока недоступна');
      }
      const deposit = db.accounts.find((a) => a.ownerId === actor.childId && a.kind === 'deposit');
      if (!deposit) throw new ApiError('CONFLICT', 'Сначала откройте счёт «МТБелки»');
      if (!title.trim()) throw new ApiError('VALIDATION', 'Назови цель');
      if (target.minor <= 0) throw new ApiError('VALIDATION', 'Укажи сумму цели');
      const id = nextId(db, 'goal');
      db.goals.push({ id, ownerId: actor.childId, depositId: deposit.id, title: title.trim(), balance: ZERO, target, reachedAt: null, createdAt: this.iso() });
      return { goalId: id };
    });
  }

  /** Удаление копилки: закреплённые деньги просто освобождаются на счёте. До 14 лет — через запрос родителю. */
  async deleteGoal(goalId: Id, childId?: Id) {
    return this.write((db) => {
      const actor = this.goalActor(childId);
      const goal = db.goals.find((g) => g.id === goalId && g.ownerId === actor.childId);
      if (!goal) throw new ApiError('NOT_FOUND', 'Копилка не найдена');
      const deposit = db.accounts.find((a) => a.ownerId === actor.childId && a.kind === 'deposit');
      if (!deposit) throw new ApiError('CONFLICT', 'Сначала откройте счёт «МТБелки»');
      const child = this.member(actor.childId);

      if (!actor.parent && parentManagesSavings(actor.settings.ageGroup)) {
        const payload: AccessRequestPayload = { type: 'goal_close', goalId };
        const dup = db.requests.find((r) => r.childId === actor.childId && r.status === 'pending' && JSON.stringify(r.payload) === JSON.stringify(payload));
        const id = dup?.id ?? nextId(db, 'req');
        if (!dup) {
          db.requests.push({ id, familyId: child.familyId, childId: actor.childId, payload, comment: `Копилка «${goal.title}»`, status: 'pending', createdAt: this.iso(), resolvedAt: null, resolvedBy: null });
          this.notifyParents(child.familyId, `${child.firstName} просит удалить копилку`, `${goal.title}, ${formatMoney(goal.balance)}`, '/requests');
        }
        return { requestId: id };
      }

      const hadMoney = goal.balance.minor > 0;
      this.removeGoal(db, goal);
      this.notify(actor.childId, 'Копилка закрыта', hadMoney ? 'Деньги остались на счёте «МТБелки»' : 'Цель удалена');
      return { requestId: null };
    });
  }

  async moveToGoal(goalId: Id, amount: Money, direction: 'in' | 'out', childId?: Id) {
    return this.write((db) => {
      const actor = this.goalActor(childId);
      const goal = db.goals.find((g) => g.id === goalId && g.ownerId === actor.childId);
      if (!goal) throw new ApiError('NOT_FOUND', 'Копилка не найдена');
      if (!db.accounts.some((a) => a.ownerId === actor.childId && a.kind === 'deposit')) throw new ApiError('CONFLICT', 'Сначала откройте счёт «МТБелки»');
      if (amount.minor <= 0) throw new ApiError('VALIDATION', 'Сумма должна быть больше нуля');
      if (direction === 'in' && goal.reachedAt) throw new ApiError('CONFLICT', 'Цель уже достигнута — пополнение закрыто');
      if (direction === 'out' && gt(amount, goal.balance)) throw new ApiError('VALIDATION', 'В копилке недостаточно средств');
      if (direction === 'in') this.requireFreeSavings(db, actor.childId, amount, '');
      const child = this.member(actor.childId);
      if (direction === 'out' && !actor.parent && parentManagesSavings(actor.settings.ageGroup)) {
        const payload: AccessRequestPayload = { type: 'goal_withdraw', goalId, amount };
        const dup = db.requests.find((r) => r.childId === actor.childId && r.status === 'pending' && JSON.stringify(r.payload) === JSON.stringify(payload));
        if (dup) return { requestId: dup.id };
        const id = nextId(db, 'req');
        db.requests.push({ id, familyId: child.familyId, childId: actor.childId, payload, comment: `Копилка «${goal.title}»`, status: 'pending', createdAt: this.iso(), resolvedAt: null, resolvedBy: null });
        this.notifyParents(child.familyId, `${child.firstName} просит забрать из копилки`, `${goal.title}: ${formatMoney(amount)}`, '/requests');
        return { requestId: id };
      }
      if (direction === 'in') {
        goal.balance = add(goal.balance, amount);
        this.completeGoal(goal, actor.childId);
      } else {
        goal.balance = sub(goal.balance, amount);
        if (goal.reachedAt && goal.balance.minor === 0) {
          this.removeGoal(db, goal);
          this.notify(actor.childId, 'Копилка закрыта', `Цель «${goal.title}» достигнута, деньги остались на счёте «МТБелки»`);
        }
      }
      return { requestId: null };
    });
  }

  async allocations() {
    return this.read(() => {
      const s = this.requireSession();
      return this.db.allocations
        .filter((a) => {
          if (a.status !== 'pending') return false;
          if (s.role === 'child') return a.childId === s.memberId && this.settings(a.childId).ageGroup === 'teen';
          const child = this.member(a.childId);
          return child.familyId === s.familyId && this.settings(a.childId).ageGroup === 'junior';
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }

  async allocateIncoming(allocationId: Id, input: AllocationInput, goalId?: Id) {
    await this.write((db) => {
      const s = this.requireSession();
      const a = db.allocations.find((x) => x.id === allocationId && x.familyId === s.familyId);
      if (!a) throw new ApiError('NOT_FOUND', 'Поступление не найдено');
      if (a.status !== 'pending') throw new ApiError('CONFLICT', 'Решение уже принято');
      const child = this.member(a.childId);
      const st = this.settings(a.childId);
      this.syncAgeGroup(child, st);
      if (st.ageGroup === 'junior') {
        if (s.role !== 'parent') throw new ApiError('FORBIDDEN', 'Сумму откладывает родитель');
      } else if (s.memberId !== a.childId) {
        throw new ApiError('FORBIDDEN', 'Подросток решает сам');
      }

      if (input.unit === 'skip') {
        a.status = 'skipped';
        a.resolvedAt = this.iso();
        a.resolvedBy = s.memberId;
        return;
      }

      const main = this.currentAccount(a.childId);
      const amount = input.unit === 'percent' ? minor(Math.floor((a.amount.minor * input.percent) / 100)) : input.amount;
      if (amount.minor <= 0) throw new ApiError('VALIDATION', 'Сумма должна быть больше нуля');
      if (gt(amount, a.amount)) throw new ApiError('VALIDATION', 'Больше суммы поступления');
      if (main.status === 'blocked') throw new ApiError('POLICY_DENIED', 'Счёт заблокирован родителем');
      if (gt(amount, main.balance)) throw new ApiError('VALIDATION', 'На счёте уже не хватает средств');
      const goal = goalId ? db.goals.find((x) => x.id === goalId && x.ownerId === a.childId) : null;
      if (!goal) throw new ApiError('VALIDATION', 'Выберите цель');
      if (goal.reachedAt) throw new ApiError('CONFLICT', 'Цель уже достигнута — выберите другую');
      const deposit = db.accounts.find((x) => x.ownerId === a.childId && x.kind === 'deposit');
      if (!deposit) throw new ApiError('CONFLICT', 'Сначала откройте счёт «МТБелки»');
      this.transfer(main, deposit, amount, { out: `В копилку «${goal.title}»`, in: 'Пополнение копилки' }, { out: 'goal_in', in: 'goal_in' });
      goal.balance = add(goal.balance, amount);
      this.completeGoal(goal, a.childId);
      a.status = 'done';
      a.goalId = goal.id;
      a.allocated = amount;
      a.resolvedAt = this.iso();
      a.resolvedBy = s.memberId;
      if (s.role === 'child') this.notifyParents(a.familyId, `${child.firstName} отложил на цель`, `${goal.title}: ${formatMoney(amount)}`, `/child/${child.id}`);
    });
  }

  // ---------------------------------------------------------------- общее

  async completeLesson(lessonId: string, answers: number[]) {
    return this.write((db) => {
      const s = this.requireSession();
      if (s.role !== 'child') throw new ApiError('FORBIDDEN', 'Уроки доступны только ребёнку');
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
