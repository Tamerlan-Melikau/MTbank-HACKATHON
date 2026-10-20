import { describe, expect, it } from 'vitest';
import { byn, type Id } from '@/domain';
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

  it('оформление пакета → приглашение → подтверждение входа', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await expect(bank.enroll({ child: { firstName: 'Оля', lastName: 'Иванова', birthDate: '2017-03-01' }, cardForm: 'digital', consents: ['package-offer'] })).rejects.toMatchObject({ code: 'VALIDATION' });
    const { childId } = await bank.enroll({ child: { firstName: 'Оля', lastName: 'Иванова', birthDate: '2017-03-01' }, cardForm: 'digital', consents: ['package-offer', 'child-card', 'child-pd'] });
    await expect(bank.signIn(childId)).rejects.toMatchObject({ code: 'NO_MOBY_ACCESS' });
    const { code } = await bank.inviteToMoby(childId);
    await bank.redeemInvite(code);
    await expect(bank.signIn(childId)).rejects.toMatchObject({ code: 'NO_MOBY_ACCESS' });
    await bank.signIn('m_anna');
    await bank.confirmMoby(childId);
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
    expect(after.account.balance.minor).toBe(before.account.balance.minor + 1000);
    expect(after.goals[0]!.balance.minor).toBe(goal.balance.minor - 1000);
  });

  it('подросток забирает из копилки сам', async () => {
    const bank = make();
    await bank.signIn('m_katya');
    const { accountId } = await bank.createGoal('Наушники', byn(100));
    await bank.moveToGoal(accountId, byn(20), 'in');
    const r = await bank.moveToGoal(accountId, byn(5), 'out');
    expect(r.requestId).toBeNull();
    const goal = (await bank.childOverview('m_katya')).goals.find((g) => g.id === accountId)!;
    expect(goal.balance.minor).toBe(1500);
  });

  it('достигнутая цель не пополняется и закрывается после полного вывода', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    const before = (await bank.childOverview('m_misha')).account.balance.minor;
    const { accountId } = await bank.createGoal('Тестовая цель', byn(10));
    await bank.moveToGoal(accountId, byn(10), 'in');
    const reached = (await bank.childOverview('m_misha')).goals.find((g) => g.id === accountId)!;
    expect(reached.goal?.reachedAt).not.toBeNull();
    await expect(bank.moveToGoal(accountId, byn(1), 'in')).rejects.toMatchObject({ code: 'CONFLICT' });

    const r = await bank.moveToGoal(accountId, byn(10), 'out');
    expect(r.requestId).not.toBeNull();
    await bank.signIn('m_anna');
    await bank.resolveRequest(r.requestId as Id, true);
    await bank.signIn('m_misha');
    expect((await bank.childOverview('m_misha')).goals.some((g) => g.id === accountId)).toBe(false);
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before);
  });

  it('подросток удаляет копилку, деньги возвращаются на основной счёт', async () => {
    const bank = make();
    await bank.signIn('m_katya');
    const before = (await bank.childOverview('m_katya')).account.balance.minor;
    const { accountId } = await bank.createGoal('Наушники', byn(25));
    await bank.moveToGoal(accountId, byn(25), 'in');
    const r = await bank.deleteGoal(accountId);
    expect(r.requestId).toBeNull();
    expect((await bank.childOverview('m_katya')).goals.some((g) => g.id === accountId)).toBe(false);
    expect((await bank.childOverview('m_katya')).account.balance.minor).toBe(before);
  });

  it('ребёнок до 14 удаляет копилку только с одобрения родителя', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    const { accountId } = await bank.createGoal('Самокат', byn(15));
    await bank.moveToGoal(accountId, byn(15), 'in');
    const r = await bank.deleteGoal(accountId);
    expect(r.requestId).not.toBeNull();
    expect((await bank.childOverview('m_misha')).goals.some((g) => g.id === accountId)).toBe(true);
    await bank.signIn('m_anna');
    await bank.resolveRequest(r.requestId as Id, true);
    await bank.signIn('m_misha');
    expect((await bank.childOverview('m_misha')).goals.some((g) => g.id === accountId)).toBe(false);
  });

  it('родитель открывает накопительный счёт ребёнку 7–13', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_misha');
    expect((await bank.childOverview('m_misha')).deposit).not.toBeNull();
    await expect(bank.openDeposit('m_misha')).rejects.toMatchObject({ code: 'CONFLICT' });

    await bank.signIn('m_misha');
    await expect(bank.openDeposit('m_misha')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bank.createRequest({ type: 'product', productId: 'teen-deposit' })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('родитель закрывает накопительный счёт ребёнка', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_misha');
    expect((await bank.childOverview('m_misha')).deposit).not.toBeNull();
    await bank.closeDeposit('m_misha');
    expect((await bank.childOverview('m_misha')).deposit).toBeNull();

    await bank.signIn('m_misha');
    await expect(bank.closeDeposit('m_misha')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('родитель пополняет накопительный счёт ребёнка', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_misha');
    const o = await bank.childOverview('m_misha');
    const parentBefore = (await bank.accounts('m_anna')).find((a) => a.kind === 'current')!.balance.minor;
    const result = await bank.topUpChild('m_misha', byn(40), o.deposit!.id);
    expect(result.allocation).toBeNull();
    expect((await bank.childOverview('m_misha')).deposit!.balance.minor).toBe(4000);
    expect((await bank.accounts('m_anna')).find((a) => a.kind === 'current')!.balance.minor).toBe(parentBefore - 4000);
  });

  it('подросток снимает с накопительного счёта без согласия родителя', async () => {
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

  it('ребёнок до 14 снимает с накопительного счёта только с согласия родителя', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    await bank.openDeposit('m_misha');
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

  it('подросток закрывает накопительный счёт по запросу родителю', async () => {
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

  it('ребёнок до 14 переводит только родителям и братьям/сёстрам через запрос', async () => {
    const bank = make();
    await bank.signIn('m_misha');
    const recipients = await bank.transferRecipients();
    expect(recipients.map((r) => r.memberId)).toEqual(expect.arrayContaining(['m_anna', 'm_sergey', 'm_katya']));
    expect(recipients.some((r) => r.memberId === 'm_misha')).toBe(false);

    const before = (await bank.childOverview('m_misha')).account.balance.minor;
    await expect(bank.transferMoney({ amount: byn(10), recipient: 'Друг Олег' })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
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
    expect(after.goals[0]!.balance.minor).toBe(goal.balance.minor + 5000);
  });

  it('подросток сам распределяет поступление', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    const { allocation } = await bank.topUpChild('m_katya', byn(50));
    expect(allocation).not.toBeNull();
    await expect(bank.allocateIncoming(allocation!.id, { unit: 'skip' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await bank.signIn('m_katya');
    const { accountId } = await bank.createGoal('Курс', byn(100));
    await bank.allocateIncoming(allocation!.id, { unit: 'amount', amount: byn(20) }, accountId);
    const goal = (await bank.childOverview('m_katya')).goals.find((g) => g.id === accountId)!;
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
});
