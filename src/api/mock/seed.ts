/**
 * Демо-семья. Даты рождения считаются от «сейчас», чтобы возраст персонажей не «уплывал».
 * Все имена и суммы вымышлены.
 */
import { byn, defaultLevels, type Account, type Card, type ChildSettings, type Transaction } from '@/domain';
import { emptyDb, nextId, type Db } from './db';

function yearsAgo(now: Date, years: number, monthShift = 0): string {
  const d = new Date(now);
  d.setFullYear(d.getFullYear() - years);
  d.setMonth(d.getMonth() - monthShift);
  return d.toISOString().slice(0, 10);
}

function daysAgo(now: Date, days: number, hour = 12): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}

export function seed(now: Date): Db {
  const db = emptyDb();
  const iso = now.toISOString();
  const familyId = 'fam_demo';
  db.families.push({ id: familyId, name: 'Ивановы', packageId: 'family-start', createdAt: daysAgo(now, 40) });

  const mom = { id: 'm_anna', familyId, role: 'parent' as const, firstName: 'Анна', lastName: 'Иванова' };
  const dad = { id: 'm_sergey', familyId, role: 'parent' as const, firstName: 'Сергей', lastName: 'Иванов' };
  const misha = { id: 'm_misha', familyId, role: 'child' as const, firstName: 'Миша', lastName: 'Иванов', birthDate: yearsAgo(now, 10, 3) };
  const katya = { id: 'm_katya', familyId, role: 'child' as const, firstName: 'Катя', lastName: 'Иванова', birthDate: yearsAgo(now, 15, 1) };
  db.members.push(mom, dad, misha, katya);

  const acc = (ownerId: string, title: string, rub: number, kind: Account['kind'] = 'current'): Account => {
    const a: Account = { id: nextId(db, 'acc'), ownerId, kind, title, balance: byn(rub), createdAt: daysAgo(now, 40) };
    db.accounts.push(a);
    return a;
  };
  const momAcc = acc(mom.id, 'Основной счёт', 1938.22);
  acc(dad.id, 'Основной счёт', 2410.5);
  const mishaAcc = acc(misha.id, 'Карманные', 23.4);
  const katyaAcc = acc(katya.id, 'Мой счёт', 86.15);
  const bike: Account = {
    ...acc(misha.id, 'На велосипед', 41, 'goal'),
    goal: { target: byn(350), reachedAt: null },
  };
  db.accounts[db.accounts.length - 1] = bike;

  const card = (accountId: string, holderId: string, last4: string, form: Card['form']) =>
    db.cards.push({ id: nextId(db, 'card'), accountId, holderId, form, last4, status: 'active', replacedBy: null });
  card(momAcc.id, mom.id, '1234', 'physical');
  card(mishaAcc.id, misha.id, '4821', 'physical');
  card(katyaAcc.id, katya.id, '7390', 'digital');

  const settings = (childId: string, group: ChildSettings['ageGroup']): ChildSettings => ({
    childId,
    ageGroup: group,
    levels: defaultLevels(group),
    limits:
      group === 'junior'
        ? { perTransaction: byn(30), daily: byn(40), monthly: byn(150), approvalFrom: byn(20) }
        : { perTransaction: byn(150), daily: byn(200), monthly: byn(600), approvalFrom: null },
    blockedCategories: group === 'junior' ? ['games', 'subscriptions'] : [],
    moby: 'active',
    inviteCode: null,
    notifyParentOnEveryOperation: group === 'junior',
  });
  db.childSettings.push(settings(misha.id, 'junior'), settings(katya.id, 'teen'));

  for (const childId of [misha.id, katya.id]) {
    for (const type of ['package-offer', 'child-card', 'child-pd', 'child-moby-access'] as const) {
      db.consents.push({ id: nextId(db, 'cns'), parentId: mom.id, childId, type, givenAt: daysAgo(now, 40), revokedAt: null });
    }
  }

  const tx = (t: Omit<Transaction, 'id' | 'status' | 'declineReason'> & Partial<Transaction>) =>
    db.transactions.push({ id: nextId(db, 'tx'), status: 'completed', declineReason: null, ...t });
  tx({ accountId: mishaAcc.id, memberId: misha.id, kind: 'pocket_money', amount: byn(15), title: 'Карманные от мамы', category: null, channel: 'internal', createdAt: daysAgo(now, 6, 9) });
  tx({ accountId: mishaAcc.id, memberId: misha.id, kind: 'purchase', amount: byn(-3.2), title: 'Столовая школы', category: 'food', channel: 'offline', createdAt: daysAgo(now, 3, 11) });
  tx({ accountId: mishaAcc.id, memberId: misha.id, kind: 'purchase', amount: byn(-7.9), title: 'Книжный «Буквица»', category: 'books', channel: 'offline', createdAt: daysAgo(now, 2, 16) });
  tx({ accountId: mishaAcc.id, memberId: misha.id, kind: 'purchase', amount: byn(-12), title: 'GameStore', category: 'games', channel: 'online', status: 'declined', declineReason: 'CATEGORY_BLOCKED_BY_PARENT', createdAt: daysAgo(now, 1, 19) });
  tx({ accountId: katyaAcc.id, memberId: katya.id, kind: 'pocket_money', amount: byn(40), title: 'Карманные от мамы', category: null, channel: 'internal', createdAt: daysAgo(now, 6, 9) });
  tx({ accountId: katyaAcc.id, memberId: katya.id, kind: 'purchase', amount: byn(-5.6), title: 'Кофейня у школы', category: 'cafe', channel: 'offline', createdAt: daysAgo(now, 1, 8) });
  tx({ accountId: katyaAcc.id, memberId: katya.id, kind: 'purchase', amount: byn(-18.99), title: 'Онлайн-кинотеатр', category: 'subscriptions', channel: 'online', createdAt: daysAgo(now, 4, 20) });
  tx({ accountId: momAcc.id, memberId: mom.id, kind: 'purchase', amount: byn(-64.3), title: 'Гипермаркет', category: 'food', channel: 'offline', createdAt: daysAgo(now, 1, 18) });

  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 1);
  db.allowances.push(
    { id: nextId(db, 'alw'), parentId: mom.id, childId: misha.id, amount: byn(15), period: 'weekly', nextRunAt: nextWeek.toISOString(), active: true },
    { id: nextId(db, 'alw'), parentId: mom.id, childId: katya.id, amount: byn(40), period: 'weekly', nextRunAt: nextWeek.toISOString(), active: true },
  );

  db.tasks.push(
    { id: nextId(db, 'task'), familyId, childId: misha.id, createdBy: mom.id, title: 'Убрать в комнате', reward: { points: 20, money: byn(2) }, status: 'assigned', createdAt: daysAgo(now, 1), updatedAt: daysAgo(now, 1) },
    { id: nextId(db, 'task'), familyId, childId: katya.id, createdBy: dad.id, title: 'Составить бюджет на неделю', reward: { points: 40, money: null }, status: 'submitted', createdAt: daysAgo(now, 2), updatedAt: daysAgo(now, 0, 9) },
  );

  db.requests.push({
    id: nextId(db, 'req'),
    familyId,
    childId: katya.id,
    payload: { type: 'capability', capabilityId: 'card.cash', level: 'on' },
    comment: 'Нужно сдать наличными на экскурсию',
    status: 'pending',
    createdAt: daysAgo(now, 0, 8),
    resolvedAt: null,
    resolvedBy: null,
  });

  const pts = (memberId: string, delta: number, reason: string, d: number) =>
    db.points.push({ id: nextId(db, 'pt'), memberId, delta, reason, createdAt: daysAgo(now, d) });
  pts(misha.id, 30, 'Урок «Нужно или хочется»', 5);
  pts(misha.id, 20, 'Задание «Полить цветы»', 3);
  pts(katya.id, 120, 'Уроки и задания', 10);
  pts(mom.id, 64, 'Кешбэк у партнёров', 1);
  db.lessons.push({ memberId: misha.id, lessonId: 'need-vs-want', completedAt: daysAgo(now, 5), score: 1 });

  db.notifications.push({
    id: nextId(db, 'ntf'),
    memberId: mom.id,
    title: 'Катя просит доступ',
    body: 'Снятие наличных',
    link: '/requests',
    read: false,
    createdAt: iso,
  });
  return db;
}
