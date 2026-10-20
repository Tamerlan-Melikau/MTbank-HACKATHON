import { describe, expect, it } from 'vitest';
import { byn, type Id } from '@/domain';
import { MockBank } from './server';
import { memoryStorage } from './storage';

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

  it('ошибка в команде не оставляет частичных изменений', async () => {
    const bank = make();
    await bank.signIn('m_anna');
    const before = await bank.familyView();
    await expect(bank.topUpChild('m_misha', byn(1_000_000))).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await bank.familyView()).toEqual(before);
  });

  it('карманные деньги начисляются по расписанию', async () => {
    let now = new Date(NOW);
    const bank = new MockBank({ db: memoryStorage(), session: memoryStorage(), now: () => new Date(now) });
    await bank.signIn('m_misha');
    const before = (await bank.childOverview('m_misha')).account.balance.minor;
    now = new Date(NOW.getTime() + 3 * 24 * 3600 * 1000);
    expect((await bank.childOverview('m_misha')).account.balance.minor).toBe(before + 1500);
  });
});
