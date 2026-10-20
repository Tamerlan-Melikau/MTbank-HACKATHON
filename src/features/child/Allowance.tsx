/** Регулярные карманные деньги: отдельная настройка, не связанная с разовым пополнением. */
import { useEffect, useState } from 'react';
import { api } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { toast } from '@/app/toast';
import { formatMoney, parseMoney, type Money } from '@/domain';
import { Button, Card, Field, Screen, Section } from '@/ui/kit';
import { Load } from '../shared';

const toText = (m: Money) => formatMoney(m).replace(/\s?BYN$/, '').replace(/\u00a0/g, '');

export function AllowanceSettings({ id }: { id: string }) {
  const q = useQuery(() => api.childOverview(id), [id]);
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (q.data?.allowance) setAmount(toText(q.data.allowance.amount));
  }, [q.data]);

  const [save, saving] = useAction(async (off: boolean) => {
    if (off) {
      await api.setAllowance(id, null);
      toast('Карманные деньги выключены');
      q.reload();
      return;
    }
    const m = parseMoney(amount);
    if (!m || m.minor <= 0) throw new Error('Введите сумму карманных');
    await api.setAllowance(id, { amount: m });
    toast('Карманные деньги настроены');
    q.reload();
  });

  return (
    <Screen title="Карманные деньги" back={`/child/${id}`}>
      <Load q={q}>
        {(o) => (
          <Section>
            <p className="t-body muted" style={{ margin: 0 }}>
              {o.allowance
                ? `Сейчас: ${formatMoney(o.allowance.amount)} 1-го числа каждого месяца. Следующий перевод ${new Date(o.allowance.nextRunAt).toLocaleDateString('ru-RU')}.`
                : `Регулярный перевод со своего счёта на счёт ${o.member.firstName}. Ребёнок учится планировать.`}
            </p>
            <div className="ui-between">
              <span className="t-label">Период</span>
              <span className="t-body">1-го числа каждого месяца</span>
            </div>
            <Field label="Сумма, BYN" value={amount} onChange={setAmount} inputMode="decimal" placeholder="0,00" />
            <Button block onClick={() => save(false)} disabled={saving}>
              {o.allowance ? 'Изменить' : 'Настроить'}
            </Button>
            {o.allowance && (
              <Button block variant="ghost" onClick={() => save(true)} disabled={saving}>
                Выключить
              </Button>
            )}
          </Section>
        )}
      </Load>
      <Card>
        <div className="t-caption muted">Регулярный перевод настраивается отдельно. Разовое пополнение — на экране «Пополнить».</div>
      </Card>
    </Screen>
  );
}
