import { describe, expect, it } from 'vitest';
import {
  ageGroupOf,
  authorizePayment,
  byn,
  canParentSet,
  capabilityAccess,
  defaultLevels,
  formatMoney,
  levelOf,
  packageDiscountPercent,
  packageMonthlyPrice,
  parseMoney,
  type Account,
  type Card,
  type ChildSettings,
} from '.';

const NBSP = ' ';

describe('money', () => {
  it('форматирует по дизайн-системе', () => {
    expect(formatMoney(byn(1938.22))).toBe(`1${NBSP}938,22${NBSP}BYN`);
    expect(formatMoney(byn(-5), { sign: 'always' })).toBe(`−5,00${NBSP}BYN`);
    expect(formatMoney(byn(15), { sign: 'always' })).toBe(`+15,00${NBSP}BYN`);
  });
  it('разбирает ввод', () => {
    expect(parseMoney('12,5')?.minor).toBe(1250);
    expect(parseMoney('1 200')?.minor).toBe(120000);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1,234')).toBeNull();
  });
});

describe('package pricing', () => {
  it('пакет платный, бесплатный только для многодетных', () => {
    expect([1, 2, 3, 4, 5].map(packageDiscountPercent)).toEqual([0, 0, 100, 100, 100]);
    expect([1, 2, 3, 4].map((n) => packageMonthlyPrice(n).minor)).toEqual([500, 500, 0, 0]);
  });
});

describe('age', () => {
  const now = new Date('2026-10-20T12:00:00');
  it('определяет группу', () => {
    expect(ageGroupOf('2016-01-01', now)).toBe('junior');
    expect(ageGroupOf('2012-10-20', now)).toBe('teen'); // ровно 14 сегодня
    expect(ageGroupOf('2012-10-21', now)).toBe('junior'); // 14 исполнится завтра
    expect(ageGroupOf('2021-01-01', now)).toBeNull();
    expect(ageGroupOf('2008-01-01', now)).toBeNull();
  });
});

describe('policy', () => {
  it('потолок по возрасту нельзя превысить', () => {
    expect(canParentSet('junior', 'card.cash', 'on')).toBe(false);
    expect(canParentSet('teen', 'card.cash', 'on')).toBe(true);
    expect(canParentSet('junior', 'savings.deposit', 'approval')).toBe(false);
  });
  it('выключено родителем → можно запросить; недоступно по возрасту → нельзя', () => {
    const teen = { ageGroup: 'teen' as const, levels: { ...defaultLevels('teen'), 'card.cash': 'off' as const } };
    expect(capabilityAccess(teen, 'card.cash')).toEqual({ kind: 'denied', reason: 'parent', canRequest: true, requestLevel: 'on' });
    const junior = { ageGroup: 'junior' as const, levels: defaultLevels('junior') };
    expect(capabilityAccess(junior, 'card.cash')).toMatchObject({ kind: 'denied', reason: 'age', canRequest: false });
  });
});

describe('authorizePayment', () => {
  const settings = (patch: Partial<ChildSettings> = {}): ChildSettings => ({
    childId: 'c',
    ageGroup: 'junior',
    levels: defaultLevels('junior'),
    limits: { daily: byn(40), monthly: byn(150), approvalFrom: byn(20) },
    blockedCategories: ['games'],
    moby: 'active',
    inviteCode: null,
    notifyParentOnEveryOperation: false,
    ...patch,
  });
  const account: Account = { id: 'a', ownerId: 'c', kind: 'current', title: '', balance: byn(100), status: 'active', createdAt: '' };
  const card: Card = { id: 'k', accountId: 'a', holderId: 'c', form: 'physical', last4: '0000', status: 'active', blockedByAccount: false, replacedBy: null };
  const ctx = (p: Partial<Parameters<typeof authorizePayment>[1]> = {}) => ({ settings: settings(), account, card, spentToday: byn(0), spentMonth: byn(0), ...p });

  it('одобряет обычную покупку', () => {
    expect(authorizePayment({ amount: byn(5), channel: 'offline', category: 'food' }, ctx())).toEqual({ outcome: 'approve' });
  });
  it('всегда запрещённая категория — даже если родитель ничего не запрещал', () => {
    const d = authorizePayment({ amount: byn(5), channel: 'offline', category: 'gambling' }, ctx({ settings: settings({ blockedCategories: [] }) }));
    expect(d).toEqual({ outcome: 'decline', code: 'CATEGORY_FORBIDDEN', requestable: false });
  });
  it('заблокированная карта проверяется раньше категории', () => {
    const d = authorizePayment({ amount: byn(5), channel: 'offline', category: 'gambling' }, ctx({ card: { ...card, status: 'blocked' } }));
    expect(d).toMatchObject({ outcome: 'decline', code: 'CARD_BLOCKED' });
  });
  it('заблокированный счёт останавливает оплату даже с активной картой', () => {
    const d = authorizePayment({ amount: byn(5), channel: 'offline', category: 'food' }, ctx({ account: { ...account, status: 'blocked' } }));
    expect(d).toMatchObject({ outcome: 'decline', code: 'ACCOUNT_BLOCKED', requestable: false });
  });
  it('блокировка счёта важнее блокировки карты', () => {
    const d = authorizePayment(
      { amount: byn(5), channel: 'offline', category: 'food' },
      ctx({ account: { ...account, status: 'blocked' }, card: { ...card, status: 'lost' } }),
    );
    expect(d).toMatchObject({ code: 'ACCOUNT_BLOCKED' });
  });
  it('категория родителя, лимиты и порог подтверждения', () => {
    expect(authorizePayment({ amount: byn(5), channel: 'offline', category: 'games' }, ctx())).toMatchObject({ code: 'CATEGORY_BLOCKED_BY_PARENT', requestable: true });
    expect(authorizePayment({ amount: byn(35), channel: 'offline', category: 'food' }, ctx())).toEqual({ outcome: 'needs_approval', code: 'ABOVE_THRESHOLD' });
    expect(authorizePayment({ amount: byn(10), channel: 'offline', category: 'food' }, ctx({ spentToday: byn(35) }))).toMatchObject({ code: 'LIMIT_DAILY' });
    expect(authorizePayment({ amount: byn(25), channel: 'offline', category: 'food' }, ctx())).toEqual({ outcome: 'needs_approval', code: 'ABOVE_THRESHOLD' });
    expect(authorizePayment({ amount: byn(5), channel: 'online', category: 'books' }, ctx())).toEqual({ outcome: 'needs_approval', code: 'CHANNEL_APPROVAL' });
  });
  it('банкомат для 7–13 недоступен по возрасту', () => {
    expect(authorizePayment({ amount: byn(5), channel: 'atm', category: null }, ctx())).toMatchObject({ code: 'CHANNEL_NOT_FOR_AGE', requestable: false });
  });
  it('не хватает денег', () => {
    expect(authorizePayment({ amount: byn(25), channel: 'offline', category: 'food' }, ctx({ account: { ...account, balance: byn(10) } }))).toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });
});

describe('levels', () => {
  it('уровни по Маничкам', () => {
    expect(levelOf(0).level).toBe(1);
    expect(levelOf(120)).toMatchObject({ level: 2, to: 300 });
  });
});
