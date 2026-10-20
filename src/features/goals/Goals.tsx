/** Копилки ребёнка: цель, прогресс, пополнение, снятие и удаление. */
import { useState } from 'react';
import { api } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { toast } from '@/app/toast';
import { formatMoney, parseMoney, REWARDS, type Account } from '@/domain';
import { Button, ButtonRow, Card, Field, Progress, Screen, Section } from '@/ui/kit';
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
    q.reload();
  });

  return (
    <Screen title="Копилка" back="/">
      <Load q={q}>
        {(o) => {
          const access = o.access['savings.goal'];
          return (
            <>
              {o.goals.map((g) => (
                <GoalCard key={g.id} goal={g} junior={o.settings.ageGroup === 'junior'} onChanged={() => q.reload()} />
              ))}
              {access.kind === 'allowed' && (
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
              )}
            </>
          );
        }}
      </Load>
    </Screen>
  );
}

function GoalCard({ goal, junior, onChanged }: { goal: Account; junior: boolean; onChanged: () => void }) {
  const [amount, setAmount] = useState('');
  const [requested, setRequested] = useState(false);
  const [move, busy] = useAction(async (dir: 'in' | 'out') => {
    const m = parseMoney(amount);
    if (!m || m.minor <= 0) throw new Error('Введи сумму');
    const r = await api.moveToGoal(goal.id, m, dir);
    setAmount('');
    if (r.requestId) toast('Запрос родителю отправлен');
    else onChanged();
  });
  const [remove, removing] = useAction(async () => {
    const rest = formatMoney(goal.balance);
    const ok = window.confirm(
      junior
        ? `Отправить родителю запрос на удаление копилки «${goal.title}»? Деньги (${rest}) вернутся на основной счёт после одобрения.`
        : `Удалить копилку «${goal.title}»? Все деньги (${rest}) вернутся на основной счёт.`,
    );
    if (!ok) return;
    const r = await api.deleteGoal(goal.id);
    if (r.requestId) {
      setRequested(true);
      toast('Запрос родителю отправлен');
    } else {
      toast('Копилка закрыта, деньги на основном счёте');
    }
    onChanged();
  });
  if (!goal.goal) return null;
  const reached = !!goal.goal.reachedAt;
  const progress = goal.balance.minor / goal.goal.target.minor;
  return (
    <Card>
      <div className="ui-stack">
        <div className="ui-between">
          <span className="t-heading">{goal.title}</span>
          {reached && <span className="t-label positive">Цель достигнута</span>}
        </div>
        <Progress value={progress} label={`Прогресс: ${goal.title}`} />
        <span className="t-body">
          {formatMoney(goal.balance)} из {formatMoney(goal.goal.target)}
        </span>
        <Field label="Сумма, BYN" value={amount} onChange={setAmount} inputMode="decimal" />
        {reached ? (
          <Button block variant="secondary" onClick={() => move('out')} disabled={busy || goal.balance.minor === 0}>
            {junior ? 'Попросить забрать' : 'Забрать'}
          </Button>
        ) : (
          <ButtonRow>
            <Button variant="secondary" onClick={() => move('out')} disabled={busy || goal.balance.minor === 0}>
              {junior ? 'Попросить забрать' : 'Забрать'}
            </Button>
            <Button onClick={() => move('in')} disabled={busy}>
              Отложить
            </Button>
          </ButtonRow>
        )}
        {reached && (
          <p className="t-caption muted" style={{ margin: 0 }}>
            Пополнения закрыты. Забери деньги — после полного вывода копилка закроется сама.
          </p>
        )}
        {junior && (
          <p className="t-caption muted" style={{ margin: 0 }}>
            До 14 лет вывод и удаление копилки подтверждает родитель.
          </p>
        )}
        <Button block variant="danger" onClick={() => remove()} disabled={removing || requested}>
          {requested ? 'Запрос отправлен' : junior ? 'Попросить удалить копилку' : 'Удалить копилку'}
        </Button>
      </div>
    </Card>
  );
}
