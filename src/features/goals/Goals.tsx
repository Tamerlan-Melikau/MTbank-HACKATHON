/** Копилки ребёнка: цель, прогресс, пополнение, снятие и удаление. */
import { useState } from 'react';
import { api } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { toast } from '@/app/toast';
import { formatMoney, parentManagesSavings, parseMoney, REWARDS, savingsAvailable, type Goal } from '@/domain';
import { Button, ButtonRow, Card, Field, Locked, Progress, Screen, Section } from '@/ui/kit';
import { Load } from '../shared';

export function Goals({ id }: { id?: string }) {
  const isParent = !!id;
  const q = useQuery(async () => api.childOverview(id ?? (await api.me()).id), [id]);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [create, creating] = useAction(async () => {
    const m = parseMoney(target);
    if (!m) throw new Error('Укажи сумму цели');
    await api.createGoal(title, m, id);
    setTitle('');
    setTarget('');
    toast('Копилка создана');
    q.reload();
  });
  const [askDeposit, askingDeposit] = useAction(async () => {
    await api.createRequest({ type: 'product', productId: 'teen-deposit' });
    toast('Запрос отправлен родителю');
    q.reload();
  });
  const [openDeposit, openingDeposit] = useAction(async () => {
    if (isParent) {
      if (!id) return;
      await api.openDeposit(id);
    } else {
      await api.openOwnDeposit();
    }
    toast('Счёт «МТБелки» открыт');
    q.reload();
  });

  return (
    <Screen title={isParent ? 'Копилки' : 'Копилка'} back={isParent ? `/child/${id}` : '/'}>
      <Load q={q}>
        {(o) => {
          const access = o.access['savings.goal'];
          const parentManages = parentManagesSavings(o.settings.ageGroup);
          const canManage = isParent ? parentManages : access.kind === 'allowed';
          return (
            <>
              {isParent && !parentManages && (
                <Locked
                  title="Копилки ребёнка 14+"
                  text="С 14 лет ребёнок управляет копилками сам. Родитель видит прогресс, но не может распоряжаться накоплениями."
                />
              )}
              {(!isParent || parentManages) && o.goals.map((g) => (
                <GoalCard
                  key={g.id}
                  goal={g}
                  childId={id}
                  isParent={isParent}
                  junior={!isParent && parentManages}
                  onChanged={() => q.reload()}
                />
              ))}
              {canManage && (
                <Section title="Новая цель">
                  {o.deposit ? (
                    <>
                      <p className="t-caption muted" style={{ margin: 0 }}>
                        Деньги на цель откладываются со свободного остатка счёта «МТБелки»{isParent ? ' ребёнка' : ''} · свободно {formatMoney(savingsAvailable(o.deposit, o.goals))}
                      </p>
                      <Field label="На что копишь" value={title} onChange={setTitle} placeholder="Например, самокат" />
                      <Field label="Сколько нужно, BYN" value={target} onChange={setTarget} inputMode="decimal" />
                      <Button block onClick={() => create()} disabled={creating}>
                        Создать копилку
                      </Button>
                      <p className="t-caption muted" style={{ margin: 0 }}>
                        Когда накопишь — получишь {REWARDS.goalReached} Маничек.
                      </p>
                    </>
                  ) : isParent ? (
                    <Locked
                      title="Сначала откройте счёт «МТБелки»"
                      text="Деньги на цели откладываются с счёта «МТБелки» ребёнка."
                      action={{ label: 'Открыть счёт «МТБелки»', onClick: () => openDeposit(), disabled: openingDeposit }}
                    />
                  ) : (
                    (() => {
                      const canOpen = o.access['savings.deposit'].kind === 'allowed';
                      const canRequest = o.settings.ageGroup === 'teen' && o.access['products.request'].kind !== 'denied';
                      const requested = o.pendingRequests.some((r) => r.payload.type === 'product' && r.payload.productId === 'teen-deposit');
                      return (
                        <Locked
                          title="Сначала откройте счёт «МТБелки»"
                          text={
                            canOpen
                              ? 'Деньги на цели откладываются с вашего счёта «МТБелки». Откройте его, чтобы начать копить.'
                              : canRequest
                                ? 'Деньги на цели откладываются с счёта «МТБелки». Попросите родителя открыть его.'
                                : 'Деньги на цели откладываются с счёта «МТБелки». Попросите родителя открыть его в вашем профиле.'
                          }
                          action={
                            canOpen
                              ? { label: 'Открыть счёт «МТБелки»', onClick: () => openDeposit(), disabled: openingDeposit }
                              : canRequest
                                ? { label: requested ? 'Запрос уже у родителя' : 'Попросить открыть счёт', onClick: () => askDeposit(), disabled: askingDeposit || requested }
                                : undefined
                          }
                        />
                      );
                    })()
                  )}
                </Section>
              )}
            </>
          );
        }}
      </Load>
    </Screen>
  );
}

function GoalCard({
  goal,
  junior,
  isParent,
  childId,
  onChanged,
}: {
  goal: Goal;
  junior: boolean;
  isParent: boolean;
  childId?: string;
  onChanged: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [requested, setRequested] = useState(false);
  const [move, busy] = useAction(async (dir: 'in' | 'out') => {
    const m = parseMoney(amount);
    if (!m || m.minor <= 0) throw new Error('Введи сумму');
    const r = await api.moveToGoal(goal.id, m, dir, childId);
    setAmount('');
    if (r.requestId) toast('Запрос родителю отправлен');
    else onChanged();
  });
  const [remove, removing] = useAction(async () => {
    const rest = formatMoney(goal.balance);
    const ok = window.confirm(
      junior
        ? `Отправить родителю запрос на удаление копилки «${goal.title}»? Деньги (${rest}) освободятся на счёте «МТБелки» после одобрения.`
        : `Удалить копилку «${goal.title}»? Все деньги (${rest}) останутся на счёте «МТБелки».`,
    );
    if (!ok) return;
    const r = await api.deleteGoal(goal.id, childId);
    if (r.requestId) {
      setRequested(true);
      toast('Запрос родителю отправлен');
    } else {
      toast('Копилка закрыта, деньги остались на счёте «МТБелки»');
    }
    onChanged();
  });
  const reached = !!goal.reachedAt;
  const progress = goal.balance.minor / goal.target.minor;
  return (
    <Card>
      <div className="ui-stack">
        <div className="ui-between">
          <span className="t-heading">{goal.title}</span>
          {reached && <span className="t-label positive">Цель достигнута</span>}
        </div>
        <Progress value={progress} label={`Прогресс: ${goal.title}`} />
        <span className="t-body">
          {formatMoney(goal.balance)} из {formatMoney(goal.target)}
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
        <p className="t-caption muted" style={{ margin: 0 }}>
          {isParent ? 'Вы управляете копилкой ребёнка до 14 лет.' : 'Копилка — часть счёта «МТБелки»: пополнение и вывод меняют только свободный остаток.'}
        </p>
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
