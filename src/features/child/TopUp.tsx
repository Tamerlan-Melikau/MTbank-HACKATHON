/** Пополнение ребёнка и карманные деньги. Без childId — выбор ребёнка. */
import { useState } from 'react';
import { api } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { goBack } from '@/app/router';
import { toast } from '@/app/toast';
import { formatMoney, parseMoney, byn, type Allowance } from '@/domain';
import { Button, Card, Chip, Field, Row, Screen, Section, Segmented, Amount } from '@/ui/kit';
import { Load } from '../shared';

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
  const [period, setPeriod] = useState<Allowance['period']>('weekly');
  const [allowance, setAllowance] = useState('');

  const [topUp, busy] = useAction(async () => {
    const m = parseMoney(amount);
    if (!m || m.minor <= 0) throw new Error('Введите сумму');
    await api.topUpChild(id, m);
    toast(`Отправлено ${formatMoney(m)}`);
    goBack(`/child/${id}`);
  });
  const [saveAllowance, saving] = useAction(async (off: boolean) => {
    if (off) {
      await api.setAllowance(id, null);
      toast('Карманные деньги выключены');
      return;
    }
    const m = parseMoney(allowance);
    if (!m || m.minor <= 0) throw new Error('Введите сумму карманных');
    await api.setAllowance(id, { amount: m, period });
    toast('Карманные деньги настроены');
    setAllowance('');
  });

  return (
    <Load q={q}>
      {(o) => (
        <Screen title={`Пополнить: ${o.member.firstName}`} back={`/child/${id}`}>
          <Section>
            <Field label="Сумма, BYN" value={amount} onChange={setAmount} inputMode="decimal" placeholder="0,00" />
            <div className="ui-chips">
              {QUICK.map((v) => (
                <Chip key={v} selected={parseMoney(amount)?.minor === byn(v).minor} onClick={() => setAmount(String(v))}>
                  {formatMoney(byn(v), { hideFraction: true })}
                </Chip>
              ))}
            </div>
            <Button block onClick={() => topUp()} disabled={busy}>
              Пополнить
            </Button>
          </Section>

          <Section title="Карманные деньги">
            <p className="t-body muted" style={{ margin: 0 }}>
              {o.allowance
                ? `Сейчас: ${formatMoney(o.allowance.amount)} ${o.allowance.period === 'weekly' ? 'каждую неделю' : 'каждый месяц'}. Следующий перевод ${new Date(o.allowance.nextRunAt).toLocaleDateString('ru-RU')}.`
                : 'Регулярный перевод со своего счёта. Ребёнок учится планировать.'}
            </p>
            <Segmented
              label="Период"
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'weekly', label: 'Раз в неделю' },
                { value: 'monthly', label: 'Раз в месяц' },
              ]}
            />
            <Field label="Сумма, BYN" value={allowance} onChange={setAllowance} inputMode="decimal" placeholder={o.allowance ? formatMoney(o.allowance.amount) : '0,00'} />
            <Button block variant="secondary" onClick={() => saveAllowance(false)} disabled={saving}>
              {o.allowance ? 'Изменить' : 'Настроить'}
            </Button>
            {o.allowance && (
              <Button block variant="ghost" onClick={() => saveAllowance(true)} disabled={saving}>
                Выключить
              </Button>
            )}
          </Section>
        </Screen>
      )}
    </Load>
  );
}
