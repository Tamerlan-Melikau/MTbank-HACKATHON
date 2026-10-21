/** Разовое пополнение ребёнка. Регулярные карманные настраиваются отдельно. */
import { useState } from 'react';
import { api } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { goBack } from '@/app/router';
import { toast } from '@/app/toast';
import { DEPOSIT_MIN_FIRST_TOPUP, formatMoney, parseMoney, byn, type IncomingAllocation } from '@/domain';
import { Button, Card, Chip, Field, Row, Screen, Section, Amount, Select } from '@/ui/kit';
import { Load } from '../shared';
import { AllocationSheet } from '../allocation/Allocation';

export function TopUpPicker() {
  const q = useQuery(() => api.familyView(), []);
  return (
    <Screen title="Пополнить" back="/">
      <Load q={q}>
        {(f) => (
          <Card flush>
            {f.children.map((c) => (
              <Row key={c.member.id} icon="user" title={c.member.firstName} end={<Amount value={c.balance} sign="auto" />} to={`/child/${c.member.id}/topup`} chevron />
            ))}
          </Card>
        )}
      </Load>
    </Screen>
  );
}

const QUICK = [5, 10, 20, 50];

export function TopUp({ id }: { id: string }) {
  const q = useQuery(() => api.childOverview(id), [id]);
  const [amount, setAmount] = useState('');
  const [target, setTarget] = useState('current');
  const [allocation, setAllocation] = useState<IncomingAllocation | null>(null);

  const [topUp, busy] = useAction(async () => {
    const m = parseMoney(amount);
    if (!m || m.minor <= 0) throw new Error('Введите сумму');
    const r = await api.topUpChild(id, m, target === 'current' ? undefined : target);
    toast(`Отправлено ${formatMoney(m)}`);
    if (r.allocation && q.data?.settings.ageGroup === 'junior') setAllocation(r.allocation);
    else {
      if (target === 'current') toast(`${q.data?.member.firstName ?? 'Подросток'} сам решит, сколько отложить`);
      goBack(`/child/${id}`);
    }
  });

  return (
    <Load q={q}>
      {(o) => {
        const accounts = [
          { value: 'current', label: `Основной счёт · ${formatMoney(o.account.balance)}` },
          ...(o.deposit ? [{ value: o.deposit.id, label: `МТБелки · ${formatMoney(o.deposit.balance)}` }] : []),
          ...o.goals.map((g) => ({ value: g.id, label: `${g.title} · ${formatMoney(g.balance)}` })),
        ];
        const depositTarget = !!o.deposit && (target === o.deposit.id || o.goals.some((g) => g.id === target));
        const firstDepositFunding = depositTarget && o.deposit!.balance.minor === 0;
        const quick = firstDepositFunding ? QUICK.filter((v) => byn(v).minor >= DEPOSIT_MIN_FIRST_TOPUP.minor) : QUICK;
        return (
        <>
        <Screen title={`Пополнить: ${o.member.firstName}`} back={`/child/${id}`}>
          <Section>
            <Select label="Куда зачислить" value={target} options={accounts} onChange={setTarget} />
            <Field label="Сумма, BYN" value={amount} onChange={setAmount} inputMode="decimal" placeholder="0,00" />
            {firstDepositFunding && (
              <div className="t-caption muted">Минимум первого пополнения — {formatMoney(DEPOSIT_MIN_FIRST_TOPUP)}.</div>
            )}
            <div className="ui-chips">
              {quick.map((v) => (
                <Chip key={v} selected={parseMoney(amount)?.minor === byn(v).minor} onClick={() => setAmount(String(v))}>
                  {formatMoney(byn(v), { hideFraction: true })}
                </Chip>
              ))}
            </div>
            <Button block onClick={() => topUp()} disabled={busy}>
              Пополнить
            </Button>
          </Section>
        </Screen>
        {allocation && (
          <AllocationSheet
            allocation={allocation}
            overview={o}
            onClose={() => {
              setAllocation(null);
              goBack(`/child/${id}`);
            }}
          />
        )}
        </>
        );
      }}
    </Load>
  );
}
