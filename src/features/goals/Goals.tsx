/** Копилки ребёнка: цель, прогресс, пополнение и снятие. */
import { useState } from 'react';
import { api } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { toast } from '@/app/toast';
import { formatMoney, parseMoney, REWARDS, type Account } from '@/domain';
import { Button, ButtonRow, Card, Field, Locked, Progress, Screen, Section } from '@/ui/kit';
import { Load } from '../shared';

export function Goals() {
  const q = useQuery(async () => api.childOverview((await api.me()).id), []);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [create, creating] = useAction(async () => {
    const m = parseMoney(target);
    if (!m) throw new Error('Укажи сумму цели');
    await api.createGoal(title, m);
    setTitle('');
    setTarget('');
    toast('Копилка создана');
  });
  const [ask, asking] = useAction(async () => {
    await api.createRequest({ type: 'product', productId: 'goal' });
    toast('Запрос отправлен');
  });

  return (
    <Screen title="Копилка" back="/">
      <Load q={q}>
        {(o) => {
          const access = o.access['savings.goal'];
          return (
            <>
              {o.goals.map((g) => (
                <GoalCard key={g.id} goal={g} />
              ))}
              {access.kind === 'allowed' ? (
                <Section title="Новая цель">
                  <Field label="На что копишь" value={title} onChange={setTitle} placeholder="Например, самокат" />
                  <Field label="Сколько нужно, BYN" value={target} onChange={setTarget} inputMode="decimal" />
                  <Button block onClick={() => create()} disabled={creating}>
                    Создать копилку
                  </Button>
                  <p className="t-caption muted" style={{ margin: 0 }}>
                    Когда накопишь — получишь {REWARDS.goalReached} баллов.
                  </p>
                </Section>
              ) : (
                <Locked
                  title="Копилка закрыта"
                  text="Попроси родителя включить копилку."
                  action={access.kind === 'denied' && access.canRequest ? { label: 'Запросить доступ', onClick: () => ask(), disabled: asking } : undefined}
                />
              )}
            </>
          );
        }}
      </Load>
    </Screen>
  );
}

function GoalCard({ goal }: { goal: Account }) {
  const [amount, setAmount] = useState('');
  const [move, busy] = useAction(async (dir: 'in' | 'out') => {
    const m = parseMoney(amount);
    if (!m || m.minor <= 0) throw new Error('Введи сумму');
    await api.moveToGoal(goal.id, m, dir);
    setAmount('');
  });
  if (!goal.goal) return null;
  const progress = goal.balance.minor / goal.goal.target.minor;
  return (
    <Card>
      <div className="ui-stack">
        <div className="ui-between">
          <span className="t-heading">{goal.title}</span>
          {goal.goal.reachedAt && <span className="t-label positive">Цель достигнута</span>}
        </div>
        <Progress value={progress} label={`Прогресс: ${goal.title}`} />
        <span className="t-body">
          {formatMoney(goal.balance)} из {formatMoney(goal.goal.target)}
        </span>
        <Field label="Сумма, BYN" value={amount} onChange={setAmount} inputMode="decimal" />
        <ButtonRow>
          <Button variant="secondary" onClick={() => move('out')} disabled={busy || goal.balance.minor === 0}>
            Забрать
          </Button>
          <Button onClick={() => move('in')} disabled={busy}>
            Отложить
          </Button>
        </ButtonRow>
      </div>
    </Card>
  );
}
