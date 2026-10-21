import { describe, expect, it } from 'vitest';
import { byn, DEPOSIT_MIN_FIRST_TOPUP, DEPOSIT_TITLE, monthlyInterest, monthlyInterestAt, type Id } from '@/domain';
import { MockBank } from './server';
import { memoryStorage } from './storage';
import { seed } from './seed';

const NOW = new Date('2026-10-20T12:00:00');
const make = () => new MockBank({ db: memoryStorage(), session: memoryStorage(), now: () => new Date(NOW) });

describe('MockBank', () => {
  it('ребёнок не видит чужие данные и не меняет настройки', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    await expect(bank.childOverview('m_katya')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bank.setCapability('m_misha', 'card.pay.online', 'on')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('родитель не может превысить возрастной потолок', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await expect(bank.setCapability('m_misha', 'card.cash', 'on')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await bank.setCapability('m_katya', 'card.cash', 'on');
    expect((await bank.childOverview('m_katya')).access['card.cash'].kind).toBe('allowed');
  });

  it('уроки доступны только ребёнку', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await expect(bank.completeLesson('need-vs-want', [0, 1])).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('покупка выше порога ждёт родителя, одобрение списывает деньги', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    const before = (await bank.childOverview('m_misha')).account.balance.minor;
    const r = await bank.pay({ amount: byn(21), channel: 'offline', category: 'food', merchant: 'Магазин' });
    expect(r.decision.outcome).toBe('needs_approval');
    expect(r.requestId).not.toBeNull();
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before);

    await bank.signIn('m_anna');
    await bank.resolveRequest(r.requestId as Id, true);
    await bank.signIn('m_misha');
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before - 2100);
  });

  it('карта и счёт блокируются и разблокируются отдельно', async () => {
    const bank = make();
    const purchase = { amount: byn(5), channel: 'offline' as const, category: 'food' as const, merchant: 'Магазин' };

    await bank.signIn('m_anna');
    const katya = await bank.childOverview('m_katya');
    await bank.setCardBlocked(katya.card!.id, true);

    await bank.signIn('m_katya');
    expect((await bank.pay(purchase)).decision).toMatchObject({ outcome: 'decline', code: 'CARD_BLOCKED' });
    expect(await bank.transferMoney({ amount: byn(5), recipient: 'Анна Иванова', recipientId: 'm_anna' })).toMatchObject({ requestId: null });
    await expect(bank.setAccountBlocked(katya.account.id, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await bank.signIn('m_anna');
    await bank.setCardBlocked(katya.card!.id, false);
    await bank.setAccountBlocked(katya.account.id, true);
    expect((await bank.childOverview('m_katya')).card).toMatchObject({ status: 'blocked', blockedByAccount: true });

    await bank.signIn('m_katya');
    expect((await bank.pay(purchase)).decision).toMatchObject({ outcome: 'decline', code: 'ACCOUNT_BLOCKED' });
    await expect(bank.transferMoney({ amount: byn(5), recipient: 'Анна Иванова', recipientId: 'm_anna' })).rejects.toMatchObject({ code: 'POLICY_DENIED' });

    await bank.signIn('m_anna');
    await bank.setAccountBlocked(katya.account.id, false);
    expect((await bank.childOverview('m_katya')).card).toMatchObject({ status: 'active', blockedByAccount: false });

    await bank.signIn('m_katya');
    expect((await bank.pay(purchase)).decision).toEqual({ outcome: 'approve' });
  });

  it('ручная блокировка карты сохраняется после блокировки и разблокировки счёта', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    const katya = await bank.childOverview('m_katya');
    await bank.setCardBlocked(katya.card!.id, true);
    await bank.setAccountBlocked(katya.account.id, true);
    await bank.setAccountBlocked(katya.account.id, false);
    expect((await bank.childOverview('m_katya')).card).toMatchObject({ status: 'blocked', blockedByAccount: false });
  });

  it('запрос доступа: ребёнок просит, родитель разрешает', async () => {
    const bank = make();
    await bank.signIn('m_katya');
    await expect(bank.createRequest({ type: 'capability', capabilityId: 'card.pay.offline', level: 'on' })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    const { requestId } = await bank.createRequest({ type: 'capability', capabilityId: 'card.cash', level: 'on' });
    await bank.signIn('m_anna');
    await bank.resolveRequest(requestId, true);
    expect((await bank.childOverview('m_katya')).access['card.cash'].kind).toBe('allowed');
    await expect(bank.resolveRequest(requestId, true)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('оформление выдаёт код, вход открывается только после подтверждения родителя', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await expect(bank.enroll({ child: { firstName: 'Оля', lastName: 'Иванова', birthDate: '2017-03-01' }, cardForm: 'digital', consents: ['package-offer'] })).rejects.toMatchObject({ code: 'VALIDATION' });
    const { childId, inviteCode } = await bank.enroll({ child: { firstName: 'Оля', lastName: 'Иванова', birthDate: '2017-03-01' }, cardForm: 'digital', consents: ['package-offer', 'child-card', 'child-pd'] });
    expect(inviteCode).toMatch(/^\d{6}$/);
    expect((await bank.childOverview(childId)).settings).toMatchObject({ moby: 'invited', inviteCode });
    await expect(bank.signIn(childId)).rejects.toMatchObject({ code: 'NO_MOBY_ACCESS' });

    await bank.redeemInvite(inviteCode);
    await expect(bank.redeemInvite(inviteCode)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await bank.childOverview(childId)).settings).toMatchObject({ moby: 'pending_confirm', inviteCode: null });
    await expect(bank.signIn(childId)).rejects.toMatchObject({ code: 'NO_MOBY_ACCESS' });

    await bank.signIn('m_misha');
    await expect(bank.confirmMoby(childId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await bank.signIn('m_anna');
    await bank.confirmMoby(childId);
    expect((await bank.childOverview(childId)).settings).toMatchObject({ moby: 'active', inviteCode: null });
    await expect(bank.signIn(childId)).resolves.toMatchObject({ role: 'child' });
  });

  it('родитель удаляет ребёнка вместе со связанными данными', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    expect((await bank.familyView()).children.map((c) => c.member.id)).toContain('m_misha');
    await bank.deleteChild('m_misha');

    expect((await bank.familyView()).children.map((c) => c.member.id)).toEqual(['m_katya']);
    await expect(bank.childOverview('m_misha')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(bank.signIn('m_misha')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await bank.requests()).some((r) => r.childId === 'm_misha')).toBe(false);
    expect((await bank.tasks()).some((t) => t.childId === 'm_misha')).toBe(false);
    expect((await bank.transactions('m_katya')).every((t) => t.memberId === 'm_katya')).toBe(true);
  });

  it('ребёнок не может удалить себя или другого ребёнка', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    await expect(bank.deleteChild('m_katya')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bank.deleteChild('m_misha')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('демо начинается без истории, заданий и уведомлений', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    expect(await bank.transactions('m_misha')).toEqual([]);
    expect(await bank.tasks()).toEqual([]);
    expect(await bank.requests()).toEqual([]);
    expect(await bank.notifications()).toEqual([]);
    expect((await bank.childOverview('m_katya')).points).toBe(0);

    await bank.signIn('m_misha');
    expect(await bank.lessonProgress('m_misha')).toEqual([]);
    expect(await bank.notifications()).toEqual([]);
  });

  it('ошибка в команде не оставляет частичных изменений', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    const before = await bank.familyView();
    await expect(bank.topUpChild('m_misha', byn(1_000_000))).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await bank.familyView()).toEqual(before);
  });

  it('старое месячное расписание переносится на 1-е число', async () => {
    const store = memoryStorage();
    const legacy = seed(NOW);
    const monthly = { ...legacy.allowances[0]!, period: 'monthly' as const, amount: byn(50), nextRunAt: new Date(NOW.getTime() + 30 * 24 * 3600 * 1000).toISOString() };
    store.set('fw.db', JSON.stringify({ ...legacy, version: 1, allocations: undefined, allowances: [monthly] }));
    const bank = new MockBank({ db: store, session: memoryStorage(), now: () => new Date(NOW) });
    await bank.signIn('m_anna');
    const allowance = (await bank.childOverview('m_misha')).allowance!;
    expect(new Date(allowance.nextRunAt).getDate()).toBe(1);
    expect(allowance.amount.minor).toBe(5000);
  });

  it('старая база с лимитом на одну покупку мигрирует с сохранением данных', async () => {
    const store = memoryStorage();
    const legacy = seed(NOW);
    legacy.version = 12;
    const settings = legacy.childSettings.find((s) => s.childId === 'm_katya')!;
    (settings.limits as unknown as { perTransaction: ReturnType<typeof byn> }).perTransaction = byn(150);
    store.set('fw.db', JSON.stringify(legacy));

    const bank = new MockBank({ db: store, session: memoryStorage(), now: () => new Date(NOW) });
    await bank.signIn('m_anna');
    const limits = (await bank.childOverview('m_katya')).settings.limits;
    expect(limits).not.toHaveProperty('perTransaction');
    expect(limits.daily?.minor).toBe(byn(200).minor);
  });

  it('месячные карманные приходят 1-го числа, а не через 30 дней', async () => {
    let now = new Date('2026-10-20T12:00:00');
    const bank = new MockBank({ db: memoryStorage(), session: memoryStorage(), now: () => new Date(now) });
    await bank.signIn('m_anna');
    await bank.setAllowance('m_misha', { amount: byn(30) });
    const allowance = (await bank.childOverview('m_misha')).allowance!;
    expect(new Date(allowance.nextRunAt).getDate()).toBe(1);
    const before = (await bank.childOverview('m_misha')).account.balance.minor;

    now = new Date('2026-10-31T23:00:00');
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before);
    now = new Date('2026-11-01T09:00:00');
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before + 3000);
  });

  it('ребёнок 7–13 не забирает из копилки без родителя', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    const before = await bank.childOverview('m_misha');
    const goal = before.goals[0]!;
    const r = await bank.moveToGoal(goal.id, byn(10), 'out');
    expect(r.requestId).not.toBeNull();
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before.account.balance.minor);

    await bank.signIn('m_anna');
    await bank.resolveRequest(r.requestId as Id, true);
    await bank.signIn('m_misha');
    const after = await bank.childOverview('m_misha');
    expect(after.account.balance.minor).toBe(before.account.balance.minor);
    expect(after.deposit!.balance.minor).toBe(before.deposit!.balance.minor);
    expect(after.goals[0]!.balance.minor).toBe(goal.balance.minor - 1000);
  });

  it('родитель полностью управляет копилками ребёнка до 14', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    const before = await bank.childOverview('m_misha');
    const { goalId } = await bank.createGoal('Велосипед', byn(100), 'm_misha');
    await bank.moveToGoal(goalId, byn(20), 'in', 'm_misha');

    let o = await bank.childOverview('m_misha');
    expect(o.account.balance.minor).toBe(before.account.balance.minor);
    expect(o.deposit!.balance.minor).toBe(before.deposit!.balance.minor);
    expect(o.goals.find((g) => g.id === goalId)!.balance.minor).toBe(2000);

    await bank.moveToGoal(goalId, byn(5), 'out', 'm_misha');
    o = await bank.childOverview('m_misha');
    expect(o.deposit!.balance.minor).toBe(before.deposit!.balance.minor);
    expect(o.goals.find((g) => g.id === goalId)!.balance.minor).toBe(1500);

    const r = await bank.deleteGoal(goalId, 'm_misha');
    expect(r.requestId).toBeNull();
    o = await bank.childOverview('m_misha');
    expect(o.goals.some((g) => g.id === goalId)).toBe(false);
    expect(o.deposit!.balance.minor).toBe(before.deposit!.balance.minor);
  });

  it('родитель пополняет копилку ребёнка с основного счёта', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    const before = await bank.childOverview('m_misha');
    const parentBefore = (await bank.accounts('m_anna')).find((a) => a.kind === 'current')!.balance.minor;
    const { goalId } = await bank.createGoal('Ролики', byn(100), 'm_misha');

    const result = await bank.topUpChild('m_misha', byn(10), goalId);
    expect(result.allocation).toBeNull();
    const after = await bank.childOverview('m_misha');
    expect(after.deposit!.balance.minor).toBe(before.deposit!.balance.minor + 1000);
    expect(after.goals.find((g) => g.id === goalId)!.balance.minor).toBe(1000);
    expect((await bank.accounts('m_anna')).find((a) => a.kind === 'current')!.balance.minor).toBe(parentBefore - 1000);
  });

  it('нельзя снять закреплённые за копилкой деньги и закрыть счёт с копилками', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    await expect(
      bank.moveDeposit({ amount: byn(83), recipientId: null, recipient: 'На основной счёт' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await bank.signIn('m_anna');
    await expect(bank.closeDeposit('m_misha')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('родитель не управляет копилками подростка', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    await bank.signIn('m_katya');
    const { goalId } = await bank.createGoal('Наушники', byn(100));

    await bank.signIn('m_anna');
    await expect(bank.createGoal('Ноутбук', byn(200), 'm_katya')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bank.moveToGoal(goalId, byn(10), 'in', 'm_katya')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bank.deleteGoal(goalId, 'm_katya')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('ребёнок до 14 не видит и не меняет правило процентов', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    await expect(bank.interestRule('m_misha')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bank.setInterestRule('m_misha', { percent: 50, goalIds: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bank.accrueInterest('m_misha')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('родитель задаёт долю процентов в копилки ребёнка до 14', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    const before = await bank.childOverview('m_misha');
    const goal = before.goals[0]!;
    const total = before.deposit!.balance;
    const expected = monthlyInterest(total);
    const toGoals = Math.floor((expected.minor * 50) / 100);

    await bank.setInterestRule('m_misha', { percent: 50, goalIds: [goal.id] });
    const r = await bank.accrueInterest('m_misha');
    expect(r.interest.minor).toBe(expected.minor);
    expect(r.toGoals.minor).toBe(toGoals);

    const after = await bank.childOverview('m_misha');
    expect(after.account.balance.minor).toBe(before.account.balance.minor);
    expect(after.deposit!.balance.minor).toBe(before.deposit!.balance.minor + expected.minor);
    expect(after.goals.find((g) => g.id === goal.id)!.balance.minor).toBe(goal.balance.minor + toGoals);
    expect(after.deposit!.balance.minor).toBe(total.minor + expected.minor);
  });

  it('подросток сам задаёт правило процентов, родитель — нет', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    const dep = (await bank.childOverview('m_katya')).deposit!;
    await bank.topUpChild('m_katya', byn(1200), dep.id);

    await bank.signIn('m_katya');
    const { goalId } = await bank.createGoal('Ноутбук', byn(500));
    await bank.setInterestRule('m_katya', { percent: 100, goalIds: [goalId] });
    const before = await bank.childOverview('m_katya');
    const expected = monthlyInterest(before.deposit!.balance);
    const r = await bank.accrueInterest('m_katya');
    expect(r.toGoals.minor).toBe(expected.minor);

    const after = await bank.childOverview('m_katya');
    expect(after.deposit!.balance.minor).toBe(before.deposit!.balance.minor + expected.minor);
    expect(after.goals.find((g) => g.id === goalId)!.balance.minor).toBe(expected.minor);

    await bank.signIn('m_anna');
    await expect(bank.setInterestRule('m_katya', { percent: 0, goalIds: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bank.accrueInterest('m_katya')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('родитель начисляет ребёнку процент от себя с основного счёта', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    const before = await bank.childOverview('m_misha');
    const parentBefore = (await bank.accounts('m_anna')).find((a) => a.kind === 'current')!.balance.minor;

    await bank.setParentInterestRate('m_misha', 12);
    expect(await bank.parentInterestRate('m_misha')).toBe(12);
    const expected = monthlyInterestAt(before.deposit!.balance, 12);
    expect(await bank.accrueParentInterest('m_misha')).toMatchObject({ minor: expected.minor });

    const after = await bank.childOverview('m_misha');
    expect(after.deposit!.balance.minor).toBe(before.deposit!.balance.minor + expected.minor);
    expect(after.goals[0]!.balance.minor).toBe(before.goals[0]!.balance.minor);
    expect((await bank.accounts('m_anna')).find((a) => a.kind === 'current')!.balance.minor).toBe(parentBefore - expected.minor);
  });

  it('родитель задаёт свой процент подростку, но подросток не меняет ставку родителя', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    const deposit = (await bank.childOverview('m_katya')).deposit!;
    await bank.topUpChild('m_katya', byn(1200), deposit.id);
    await bank.setParentInterestRate('m_katya', 6);
    const before = (await bank.childOverview('m_katya')).deposit!.balance;
    const expected = monthlyInterestAt(before, 6);
    expect(await bank.accrueParentInterest('m_katya')).toMatchObject({ minor: expected.minor });
    expect((await bank.childOverview('m_katya')).deposit!.balance.minor).toBe(before.minor + expected.minor);

    await bank.signIn('m_katya');
    await expect(bank.parentInterestRate('m_katya')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bank.setParentInterestRate('m_katya', 50)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bank.accrueParentInterest('m_katya')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('без счёта «МТБелки» копилку создать нельзя', async () => {
    const bank = make();
    await bank.signIn('m_katya');
    await expect(bank.createGoal('Наушники', byn(100))).rejects.toMatchObject({ code: 'CONFLICT' });

    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    await bank.signIn('m_katya');
    await expect(bank.createGoal('Наушники', byn(100))).resolves.toHaveProperty('goalId');
  });

  it('деньги в копилке закрепляются внутри счёта «МТБелки»', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    const before = await bank.childOverview('m_misha');
    const { goalId } = await bank.createGoal('Самокат', byn(50));
    await bank.moveToGoal(goalId, byn(10), 'in');
    const after = await bank.childOverview('m_misha');
    expect(after.account.balance.minor).toBe(before.account.balance.minor);
    expect(after.deposit!.balance.minor).toBe(before.deposit!.balance.minor);
    expect(after.goals.find((g) => g.id === goalId)!.balance.minor).toBe(1000);
  });

  it('подросток забирает из копилки сам', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    const deposit = (await bank.childOverview('m_katya')).deposit!;
    await bank.topUpChild('m_katya', byn(50), deposit.id);

    await bank.signIn('m_katya');
    const { goalId } = await bank.createGoal('Наушники', byn(100));
    await bank.moveToGoal(goalId, byn(20), 'in');
    const r = await bank.moveToGoal(goalId, byn(5), 'out');
    expect(r.requestId).toBeNull();
    const after = await bank.childOverview('m_katya');
    const goal = after.goals.find((g) => g.id === goalId)!;
    expect(goal.balance.minor).toBe(1500);
    expect(after.deposit!.balance.minor).toBe(5000);
  });

  it('достигнутая цель не пополняется и закрывается после полного вывода', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    const before = (await bank.childOverview('m_misha')).account.balance.minor;
    const { goalId } = await bank.createGoal('Тестовая цель', byn(10));
    await bank.moveToGoal(goalId, byn(10), 'in');
    const reached = (await bank.childOverview('m_misha')).goals.find((g) => g.id === goalId)!;
    expect(reached.reachedAt).not.toBeNull();
    await expect(bank.moveToGoal(goalId, byn(1), 'in')).rejects.toMatchObject({ code: 'CONFLICT' });

    const r = await bank.moveToGoal(goalId, byn(10), 'out');
    expect(r.requestId).not.toBeNull();
    await bank.signIn('m_anna');
    await bank.resolveRequest(r.requestId as Id, true);
    await bank.signIn('m_misha');
    expect((await bank.childOverview('m_misha')).goals.some((g) => g.id === goalId)).toBe(false);
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before);
  });

  it('подросток удаляет копилку, деньги возвращаются на счёт «МТБелки»', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    const deposit = (await bank.childOverview('m_katya')).deposit!;
    await bank.topUpChild('m_katya', byn(50), deposit.id);

    await bank.signIn('m_katya');
    const before = await bank.childOverview('m_katya');
    const { goalId } = await bank.createGoal('Наушники', byn(25));
    await bank.moveToGoal(goalId, byn(25), 'in');
    const r = await bank.deleteGoal(goalId);
    expect(r.requestId).toBeNull();
    const after = await bank.childOverview('m_katya');
    expect(after.goals.some((g) => g.id === goalId)).toBe(false);
    expect(after.account.balance.minor).toBe(before.account.balance.minor);
    expect(after.deposit!.balance.minor).toBe(before.deposit!.balance.minor);
  });

  it('ребёнок до 14 удаляет копилку только с одобрения родителя', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    const { goalId } = await bank.createGoal('Самокат', byn(15));
    await bank.moveToGoal(goalId, byn(15), 'in');
    const r = await bank.deleteGoal(goalId);
    expect(r.requestId).not.toBeNull();
    expect((await bank.childOverview('m_misha')).goals.some((g) => g.id === goalId)).toBe(true);
    await bank.signIn('m_anna');
    await bank.resolveRequest(r.requestId as Id, true);
    await bank.signIn('m_misha');
    expect((await bank.childOverview('m_misha')).goals.some((g) => g.id === goalId)).toBe(false);
  });

  it('родитель открывает счёт «МТБелки» ребёнку 7–13', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    const { childId } = await bank.enroll({
      child: { firstName: 'Оля', lastName: 'Иванова', birthDate: '2017-03-01' },
      cardForm: 'digital',
      consents: ['package-offer', 'child-card', 'child-pd'],
    });
    await bank.openDeposit(childId);
    expect((await bank.childOverview(childId)).deposit).not.toBeNull();
    await expect(bank.openDeposit(childId)).rejects.toMatchObject({ code: 'CONFLICT' });

    await bank.signIn('m_misha');
    await expect(bank.openDeposit(childId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bank.createRequest({ type: 'product', productId: 'teen-deposit' })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('родитель закрывает счёт «МТБелки» ребёнка', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    expect((await bank.childOverview('m_katya')).deposit).not.toBeNull();
    await bank.closeDeposit('m_katya');
    expect((await bank.childOverview('m_katya')).deposit).toBeNull();

    await bank.signIn('m_katya');
    await expect(bank.closeDeposit('m_katya')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('родитель пополняет счёт «МТБелки» ребёнка', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    const o = await bank.childOverview('m_katya');
    const parentBefore = (await bank.accounts('m_anna')).find((a) => a.kind === 'current')!.balance.minor;
    const result = await bank.topUpChild('m_katya', byn(40), o.deposit!.id);
    expect(result.allocation).toBeNull();
    expect((await bank.childOverview('m_katya')).deposit!.balance.minor).toBe(4000);
    expect((await bank.accounts('m_anna')).find((a) => a.kind === 'current')!.balance.minor).toBe(parentBefore - 4000);
  });

  it('подросток пополняет «МТБелки» с основного счёта сразу', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');

    await bank.signIn('m_katya');
    const before = await bank.childOverview('m_katya');
    const result = await bank.topUpOwnDeposit(byn(20));
    expect(result.requestId).toBeNull();

    const after = await bank.childOverview('m_katya');
    expect(after.account.balance.minor).toBe(before.account.balance.minor - 2000);
    expect(after.deposit!.balance.minor).toBe(before.deposit!.balance.minor + 2000);
    expect(await bank.transactions('m_katya')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: after.deposit!.id, kind: 'transfer_in', amount: expect.objectContaining({ minor: 2000 }) }),
        expect.objectContaining({ accountId: after.account.id, kind: 'transfer_out', amount: expect.objectContaining({ minor: -2000 }) }),
      ]),
    );
  });

  it('ребёнок до 14 пополняет «МТБелки» только через запрос родителю', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    const before = await bank.childOverview('m_misha');
    const result = await bank.topUpOwnDeposit(byn(10));
    expect(result.requestId).toBeTruthy();
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before.account.balance.minor);
    expect((await bank.childOverview('m_misha')).deposit!.balance.minor).toBe(before.deposit!.balance.minor);

    const again = await bank.topUpOwnDeposit(byn(10));
    expect(again.requestId).toBe(result.requestId);

    await bank.signIn('m_anna');
    expect((await bank.requests({ status: 'pending' })).some((r) => r.payload.type === 'deposit_topup')).toBe(true);
    await bank.resolveRequest(result.requestId!, true);

    await bank.signIn('m_misha');
    const after = await bank.childOverview('m_misha');
    expect(after.account.balance.minor).toBe(before.account.balance.minor - 1000);
    expect(after.deposit!.balance.minor).toBe(before.deposit!.balance.minor + 1000);
  });

  it('ребёнок не может пополнить «МТБелки» сверх остатка основного счёта', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    const before = await bank.childOverview('m_misha');
    await expect(bank.topUpOwnDeposit(byn(100))).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before.account.balance.minor);
    expect((await bank.requests({ status: 'pending' })).some((r) => r.payload.type === 'deposit_topup')).toBe(false);
  });

  it('первое пополнение «МТБелок» ребёнком — не меньше 10 BYN', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');

    await bank.signIn('m_katya');
    await expect(bank.topUpOwnDeposit(byn(5))).rejects.toMatchObject({ code: 'VALIDATION' });
    await bank.topUpOwnDeposit(DEPOSIT_MIN_FIRST_TOPUP);
    expect((await bank.childOverview('m_katya')).deposit!.balance.minor).toBe(DEPOSIT_MIN_FIRST_TOPUP.minor);
  });

  it('первое пополнение «МТБелок» — не меньше 10 BYN', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    const deposit = (await bank.childOverview('m_katya')).deposit!;
    expect(deposit.title).toBe(DEPOSIT_TITLE);

    await expect(bank.topUpChild('m_katya', byn(5), deposit.id)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await bank.childOverview('m_katya')).deposit!.balance.minor).toBe(0);

    await bank.topUpChild('m_katya', DEPOSIT_MIN_FIRST_TOPUP, deposit.id);
    expect((await bank.childOverview('m_katya')).deposit!.balance.minor).toBe(DEPOSIT_MIN_FIRST_TOPUP.minor);
  });

  it('подросток запрашивает «МТБелки», родитель одобряет открытие', async () => {
    const bank = make();
    await bank.signIn('m_katya');
    const r = await bank.createRequest({ type: 'product', productId: 'teen-deposit' });
    expect((await bank.childOverview('m_katya')).deposit).toBeNull();

    await bank.signIn('m_anna');
    await bank.resolveRequest(r.requestId!, true);
    expect((await bank.childOverview('m_katya')).deposit).toMatchObject({ title: DEPOSIT_TITLE, balance: { minor: 0 } });
  });

  it('страхование оформляет только родитель, ребёнок управлять не может', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    expect((await bank.childOverview('m_katya')).insurance).toBeNull();
    await bank.setChildInsurance('m_katya', true);
    expect((await bank.childOverview('m_katya')).insurance).toMatchObject({ childId: 'm_katya', status: 'active' });
    await expect(bank.setChildInsurance('m_katya', true)).rejects.toMatchObject({ code: 'CONFLICT' });

    await bank.signIn('m_katya');
    expect((await bank.childOverview('m_katya')).insurance).not.toBeNull();
    await expect(bank.setChildInsurance('m_katya', false)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await bank.signIn('m_anna');
    await bank.setChildInsurance('m_katya', false);
    expect((await bank.childOverview('m_katya')).insurance).toBeNull();
  });

  it('подросток снимает с счёта «МТБелки» без согласия родителя', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    const deposit = (await bank.childOverview('m_katya')).deposit!;
    await bank.topUpChild('m_katya', byn(50), deposit.id);

    await bank.signIn('m_katya');
    const before = await bank.childOverview('m_katya');
    const result = await bank.moveDeposit({ amount: byn(20), recipientId: null, recipient: 'На основной счёт' });
    expect(result.requestId).toBeNull();
    const after = await bank.childOverview('m_katya');
    expect(after.deposit!.balance.minor).toBe(before.deposit!.balance.minor - 2000);
    expect(after.account.balance.minor).toBe(before.account.balance.minor + 2000);
  });

  it('ребёнок до 14 снимает с счёта «МТБелки» только с согласия родителя', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    const deposit = (await bank.childOverview('m_misha')).deposit!;
    await bank.topUpChild('m_misha', byn(30), deposit.id);

    await bank.signIn('m_misha');
    const before = await bank.childOverview('m_misha');
    const result = await bank.moveDeposit({ amount: byn(10), recipientId: null, recipient: 'На основной счёт' });
    expect(result.requestId).toBeTruthy();
    expect((await bank.childOverview('m_misha')).deposit!.balance.minor).toBe(before.deposit!.balance.minor);

    await bank.signIn('m_anna');
    await bank.resolveRequest(result.requestId!, true);
    await bank.signIn('m_misha');
    const after = await bank.childOverview('m_misha');
    expect(after.deposit!.balance.minor).toBe(before.deposit!.balance.minor - 1000);
    expect(after.account.balance.minor).toBe(before.account.balance.minor + 1000);
  });

  it('подросток закрывает счёт «МТБелки» по запросу родителю', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    await bank.signIn('m_katya');
    const r = await bank.createRequest({ type: 'deposit_close' });
    expect(r.requestId).toBeTruthy();
    expect((await bank.childOverview('m_katya')).deposit).not.toBeNull();
    await bank.signIn('m_anna');
    await bank.resolveRequest(r.requestId!, true);
    await bank.signIn('m_katya');
    expect((await bank.childOverview('m_katya')).deposit).toBeNull();
  });

  it('ребёнок до 14 переводит членам семьи через запрос', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    const recipients = await bank.transferRecipients();
    expect(recipients.map((r) => r.memberId)).toEqual(expect.arrayContaining(['m_anna', 'm_sergey', 'm_katya']));
    expect(recipients.some((r) => r.memberId === 'm_misha')).toBe(false);

    const before = (await bank.childOverview('m_misha')).account.balance.minor;
    const r = await bank.transferMoney({ amount: byn(10), recipient: 'Катя Иванова', recipientId: 'm_katya', comment: 'На кино' });
    expect(r.requestId).not.toBeNull();
    expect(r.transaction).toBeNull();
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before);

    await bank.signIn('m_anna');
    const katyaBefore = (await bank.childOverview('m_katya')).account.balance.minor;
    expect((await bank.requests({ status: 'pending' })).some((x) => x.payload.type === 'transfer')).toBe(true);
    await bank.resolveRequest(r.requestId as Id, true);
    expect((await bank.childOverview('m_katya')).account.balance.minor).toBe(katyaBefore + 1000);

    await bank.signIn('m_misha');
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before - 1000);
    expect((await bank.transactions('m_misha'))[0]).toMatchObject({ kind: 'transfer_out', title: 'Перевод: Катя Иванова', status: 'completed' });

    await bank.signIn('m_katya');
    expect((await bank.transactions('m_katya'))[0]).toMatchObject({ kind: 'transfer_in', amount: { minor: 1000 }, title: 'Перевод от Миша' });
  });

  it('ребёнок до 14 переводит любому получателю только после одобрения родителя', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    const before = (await bank.childOverview('m_misha')).account.balance.minor;
    const r = await bank.transferMoney({ amount: byn(15), recipient: 'Друг Олег', comment: 'На подарок' });
    expect(r.requestId).not.toBeNull();
    expect(r.transaction).toBeNull();
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before);

    await bank.signIn('m_anna');
    await bank.resolveRequest(r.requestId as Id, true);
    await bank.signIn('m_misha');
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before - 1500);
    expect((await bank.transactions('m_misha'))[0]).toMatchObject({ kind: 'transfer_out', title: 'Перевод: Друг Олег', channel: 'p2p' });
  });

  it('родитель может отклонить перевод ребёнка до 14', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    const before = (await bank.childOverview('m_misha')).account.balance.minor;
    const r = await bank.transferMoney({ amount: byn(10), recipient: 'Анна Иванова', recipientId: 'm_anna' });
    await bank.signIn('m_anna');
    await bank.resolveRequest(r.requestId as Id, false);
    await bank.signIn('m_misha');
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before);
    expect(await bank.transactions('m_misha')).toEqual([]);
  });

  it('подросток переводит сразу', async () => {
    const bank = make();
    await bank.signIn('m_katya');
    const before = (await bank.childOverview('m_katya')).account.balance.minor;
    const r = await bank.transferMoney({ amount: byn(20), recipient: 'Аня' });
    expect(r.requestId).toBeNull();
    expect(r.transaction).not.toBeNull();
    expect((await bank.childOverview('m_katya')).account.balance.minor).toBe(before - 2000);
  });

  it('родитель откладывает часть поступления ребёнка 7–13 на цель', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    const before = await bank.childOverview('m_misha');
    const goal = before.goals[0]!;
    const { allocation } = await bank.topUpChild('m_misha', byn(100));
    expect(allocation).not.toBeNull();
    expect(allocation!.amount.minor).toBe(10000);
    expect(await bank.allocations()).toHaveLength(1);

    await bank.allocateIncoming(allocation!.id, { unit: 'percent', percent: 50 }, goal.id);
    const after = await bank.childOverview('m_misha');
    expect(after.account.balance.minor).toBe(before.account.balance.minor + 5000);
    expect(after.deposit!.balance.minor).toBe(before.deposit!.balance.minor + 5000);
    expect(after.goals[0]!.balance.minor).toBe(goal.balance.minor + 5000);
  });

  it('подросток сам распределяет поступление', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    const { allocation } = await bank.topUpChild('m_katya', byn(50));
    expect(allocation).not.toBeNull();
    await expect(bank.allocateIncoming(allocation!.id, { unit: 'skip' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await bank.signIn('m_katya');
    const { goalId } = await bank.createGoal('Курс', byn(100));
    await bank.allocateIncoming(allocation!.id, { unit: 'amount', amount: byn(20) }, goalId);
    const goal = (await bank.childOverview('m_katya')).goals.find((g) => g.id === goalId)!;
    expect(goal.balance.minor).toBe(2000);
  });

  it('карманные деньги начисляются по расписанию', async () => {
    let now = new Date(NOW);
    const bank = new MockBank({ db: memoryStorage(), session: memoryStorage(), now: () => new Date(now) });
    await bank.signIn('m_misha');
    const before = (await bank.childOverview('m_misha')).account.balance.minor;
    now = new Date('2026-10-31T23:00:00');
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before);
    now = new Date('2026-11-01T09:00:00');
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before + 1500);
  });

  it('v1: копилки-счета возвращаются на текущий счёт, данные дополняются', async () => {
    const store = memoryStorage();
    const legacy = seed(NOW);
    const mishaCurrent = legacy.accounts.find((a) => a.ownerId === 'm_misha' && a.kind === 'current')!;
    const goalAccount = { id: 'acc_legacy', ownerId: 'm_misha', kind: 'goal', title: 'Старая копилка', balance: byn(15), createdAt: NOW.toISOString() };
    const { goals: _goals, interestRules: _rules, ...rest } = legacy;
    store.set(
      'fw.db',
      JSON.stringify({
        ...rest,
        version: 1,
        allocations: undefined,
        accounts: [...legacy.accounts.map(({ status: _s, ...a }) => a), goalAccount],
        cards: legacy.cards.map(({ blockedByAccount: _b, ...c }) => c),
      }),
    );
    const bank = new MockBank({ db: store, session: memoryStorage(), now: () => new Date(NOW) });
    await bank.signIn('m_anna');
    const o = await bank.childOverview('m_misha');
    expect(o.goals).toEqual([]);
    expect(o.account).toMatchObject({ status: 'active' });
    expect(o.account.balance.minor).toBe(mishaCurrent.balance.minor + 1500);
    expect(o.card).toMatchObject({ blockedByAccount: false });
  });

  it('заблокированный счёт не даёт отложить поступление на цель', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    const { allocation } = await bank.topUpChild('m_katya', byn(50));
    await bank.signIn('m_katya');
    const { goalId } = await bank.createGoal('Курс', byn(100));
    await bank.signIn('m_anna');
    await bank.setAccountBlocked((await bank.childOverview('m_katya')).account.id, true);
    await bank.signIn('m_katya');
    await expect(bank.allocateIncoming(allocation!.id, { unit: 'amount', amount: byn(20) }, goalId)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('с заблокированного счёта «МТБелки» деньги не снимаются', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    const dep = (await bank.childOverview('m_katya')).deposit!;
    await bank.topUpChild('m_katya', byn(50), dep.id);
    await bank.setAccountBlocked(dep.id, true);
    await bank.signIn('m_katya');
    await expect(bank.moveDeposit({ amount: byn(10), recipientId: null, recipient: 'На основной счёт' })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('проценты начисляются не чаще раза в месяц', async () => {
    let now = new Date(NOW);
    const bank = new MockBank({ db: memoryStorage(), session: memoryStorage(), now: () => new Date(now) });
    await bank.signIn('m_anna');
    await bank.accrueInterest('m_misha');
    await expect(bank.accrueInterest('m_misha')).rejects.toMatchObject({ code: 'CONFLICT' });
    now = new Date('2026-11-02T12:00:00');
    expect((await bank.accrueInterest('m_misha')).interest.minor).toBeGreaterThan(0);
  });

  it('родитель не пополняет уже достигнутую цель', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    const goal = (await bank.childOverview('m_misha')).goals[0]!;
    await bank.topUpChild('m_misha', byn(309), goal.id);
    expect((await bank.childOverview('m_misha')).goals[0]!.reachedAt).not.toBeNull();
    await expect(bank.topUpChild('m_misha', byn(10), goal.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('проценты, не поместившиеся в заполненную цель, уходят в другие выбранные', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_katya');
    const dep = (await bank.childOverview('m_katya')).deposit!;
    await bank.topUpChild('m_katya', byn(1200), dep.id);
    await bank.signIn('m_katya');
    const big = (await bank.createGoal('Ноутбук', byn(500))).goalId;
    const small = (await bank.createGoal('Брелок', byn(0.05))).goalId;
    await bank.setInterestRule('m_katya', { percent: 100, goalIds: [big, small] });
    const r = await bank.accrueInterest('m_katya');
    expect(r.toGoals.minor).toBe(r.interest.minor);
    const goals = (await bank.childOverview('m_katya')).goals;
    expect(goals.find((g) => g.id === small)!.balance.minor).toBe(5);
    expect(goals.find((g) => g.id === big)!.balance.minor).toBe(r.interest.minor - 5);
  });
});
