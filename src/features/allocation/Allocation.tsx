/** Распределение входящего поступления: сколько отложить на цель. */
import { useState } from 'react';
import { api, type ChildOverview } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { toast } from '@/app/toast';
import { formatMoney, minor, parseMoney, sub, ZERO, type IncomingAllocation } from '@/domain';
import { Button, Field, Select, Segmented } from '@/ui/kit';
import { Load } from '../shared';

type Unit = 'percent' | 'amount';

export function AllocationGate({ allocation, onClose }: { allocation: IncomingAllocation; onClose: () => void }) {
  const q = useQuery(() => api.childOverview(allocation.childId), [allocation.id, allocation.childId]);
  return (
    <Load q={q} skeleton={1}>
      {(o) => <AllocationSheet allocation={allocation} overview={o} onClose={onClose} />}
    </Load>
  );
}

export function AllocationSheet({ allocation, overview, onClose }: { allocation: IncomingAllocation; overview: ChildOverview; onClose: () => void }) {
  const isJunior = overview.settings.ageGroup === 'junior';
  const name = overview.member.firstName;
  const goals = overview.goals.filter((g) => !g.reachedAt);
  const [unit, setUnit] = useState<Unit>('percent');
  const [percent, setPercent] = useState('50');
  const [sum, setSum] = useState('');
  const [goalId, setGoalId] = useState(goals[0]?.id ?? '');

  const pct = Number(percent.replace(',', '.'));
  const percentValid = Number.isFinite(pct) && pct > 0 && pct <= 100;
  const money = parseMoney(sum);
  const amount = unit === 'percent' ? (percentValid ? minor(Math.floor((allocation.amount.minor * pct) / 100)) : ZERO) : money ?? ZERO;
  const valid = !!goalId && amount.minor > 0 && amount.minor <= allocation.amount.minor;

  const [submit, busy] = useAction(async (skip: boolean) => {
    if (skip) {
      await api.allocateIncoming(allocation.id, { unit: 'skip' });
      toast('Деньги остались на карте');
      onClose();
      return;
    }
    if (!goalId) throw new Error('Выберите цель');
    if (amount.minor <= 0) throw new Error(unit === 'percent' ? 'Укажите процент' : 'Введите сумму');
    if (amount.minor > allocation.amount.minor) throw new Error('Больше суммы поступления');
    if (unit === 'percent') await api.allocateIncoming(allocation.id, { unit: 'percent', percent: pct }, goalId);
    else await api.allocateIncoming(allocation.id, { unit: 'amount', amount }, goalId);
    toast(`Отложено ${formatMoney(amount)}`);
    onClose();
  });

  return (
    <div className="ui-modal" role="dialog" aria-modal="true" aria-label="Распределить поступление">
      <div className="ui-modal__backdrop" />
      <div className="ui-modal__panel">
        <div className="ui-stack">
          <div>
            <div className="t-title">{isJunior ? `Поступление для ${name}` : 'Тебе пришло поступление'}</div>
            <div className="t-caption muted">
              {allocation.title} · {formatMoney(allocation.amount)}
            </div>
          </div>

          <p className="t-body muted" style={{ margin: 0 }}>
            {isJunior
              ? `Решите, какую часть отложить на цель ${name}. Остальное останется на карте.`
              : 'Реши сам, какую часть отложить на цель. Остальное останется на карте.'}
          </p>

          {goals.length === 0 ? (
            <div className="ui-locked">
              <div className="ui-stack ui-stack--tight" style={{ flex: 1 }}>
                <div className="t-heading">Копилки пока нет</div>
                <div className="t-body muted">Сначала создайте цель в разделе «Копилка» — тогда поступление можно будет отложить.</div>
              </div>
            </div>
          ) : (
            <>
              {goals.length === 1 ? (
                <div className="ui-between">
                  <span className="t-label">Цель</span>
                  <span className="t-body">{goals[0]!.title}</span>
                </div>
              ) : (
                <Select
                  label="Цель"
                  value={goalId}
                  onChange={setGoalId}
                  options={goals.map((g) => ({ value: g.id, label: g.title }))}
                />
              )}
              <Segmented
                label="Как задать часть"
                value={unit}
                onChange={setUnit}
                options={[
                  { value: 'percent', label: '% от поступления' },
                  { value: 'amount', label: 'Сумма в BYN' },
                ]}
              />
              {unit === 'percent' ? (
                <Field label="Сколько, %" value={percent} onChange={setPercent} inputMode="decimal" placeholder="50" />
              ) : (
                <Field label="Сумма, BYN" value={sum} onChange={setSum} inputMode="decimal" placeholder="0,00" />
              )}
              <div className="ui-stack ui-stack--tight">
                <div className="ui-between">
                  <span className="t-caption muted">На цель</span>
                  <span className="t-body">{formatMoney(amount)}</span>
                </div>
                <div className="ui-between">
                  <span className="t-caption muted">Останется на карте</span>
                  <span className="t-body">{formatMoney(sub(allocation.amount, amount))}</span>
                </div>
              </div>
            </>
          )}

          <Button block onClick={() => submit(false)} disabled={busy || !valid || goals.length === 0}>
            Отложить на цель
          </Button>
          <Button block variant="ghost" onClick={() => submit(true)} disabled={busy}>
            Оставить всё на карте
          </Button>
        </div>
      </div>
    </div>
  );
}
