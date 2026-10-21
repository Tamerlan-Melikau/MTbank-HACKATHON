/**
 * Демо-семья. Даты рождения считаются от «сейчас», чтобы возраст персонажей не «уплывал».
 * Все имена и суммы вымышлены.
 */
import { byn, defaultLevels, type Account, type Card, type ChildSettings, type Goal } from '@/domain';
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
  const familyId = 'fam_demo';
  db.families.push({ id: familyId, name: 'Ивановы', packageId: 'family-start', createdAt: daysAgo(now, 40) });

  const mom = { id: 'm_anna', familyId, role: 'parent' as const, firstName: 'Анна', lastName: 'Иванова' };
  const dad = { id: 'm_sergey', familyId, role: 'parent' as const, firstName: 'Сергей', lastName: 'Иванов' };
  const misha = { id: 'm_misha', familyId, role: 'child' as const, firstName: 'Миша', lastName: 'Иванов', birthDate: yearsAgo(now, 10, 3) };
  const katya = { id: 'm_katya', familyId, role: 'child' as const, firstName: 'Катя', lastName: 'Иванова', birthDate: yearsAgo(now, 15, 1) };
  db.members.push(mom, dad, misha, katya);

  const acc = (ownerId: string, title: string, rub: number, kind: Account['kind'] = 'current'): Account => {
    const a: Account = { id: nextId(db, 'acc'), ownerId, kind, title, balance: byn(rub), status: 'active', createdAt: daysAgo(now, 40) };
    db.accounts.push(a);
    return a;
  };
  const momAcc = acc(mom.id, 'Основной счёт', 1938.22);
  acc(dad.id, 'Основной счёт', 2410.5);
  const mishaAcc = acc(misha.id, 'Карманные', 23.4);
  const mishaDeposit = acc(misha.id, 'Накопительный счёт', 123.1, 'deposit');
  const katyaAcc = acc(katya.id, 'Мой счёт', 86.15);
  const bike: Goal = {
    id: nextId(db, 'goal'),
    ownerId: misha.id,
    depositId: mishaDeposit.id,
    title: 'На велосипед',
    balance: byn(41),
    target: byn(350),
    reachedAt: null,
    createdAt: daysAgo(now, 40),
  };
  db.goals.push(bike);
  db.interestRules.push(
    { childId: misha.id, percent: 20, goalIds: [bike.id] },
    { childId: katya.id, percent: 0, goalIds: [] },
  );
  db.parentInterestRates.push({ childId: misha.id, parentId: mom.id, percent: 5 });

  const card = (accountId: string, holderId: string, last4: string, form: Card['form']) =>
    db.cards.push({ id: nextId(db, 'card'), accountId, holderId, form, last4, status: 'active', blockedByAccount: false, replacedBy: null });
  card(momAcc.id, mom.id, '1234', 'physical');
  card(mishaAcc.id, misha.id, '4821', 'physical');
  card(katyaAcc.id, katya.id, '7390', 'digital');

  const settings = (childId: string, group: ChildSettings['ageGroup']): ChildSettings => ({
    childId,
    ageGroup: group,
    levels: defaultLevels(group),
    limits:
      group === 'junior'
        ? { perTransaction: null, daily: byn(40), monthly: byn(150), approvalFrom: byn(20) }
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

  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 0, 0, 0);
  db.allowances.push(
    { id: nextId(db, 'alw'), parentId: mom.id, childId: misha.id, amount: byn(15), period: 'monthly', nextRunAt: nextMonth.toISOString(), active: true },
    { id: nextId(db, 'alw'), parentId: mom.id, childId: katya.id, amount: byn(40), period: 'monthly', nextRunAt: nextMonth.toISOString(), active: true },
  );

  return db;
}
