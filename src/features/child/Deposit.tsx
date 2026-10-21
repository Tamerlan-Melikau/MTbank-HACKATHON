/** Накопительный счёт ребёнка: информация, операции, снятие/перевод и закрытие. */
import { useState } from 'react';
import { api } from '@/api';
import { useAction, useQuery, useSession } from '@/app/data';
import { goBack } from '@/app/router';
import { toast } from '@/app/toast';
import { DEPOSIT_ANNUAL_RATE_PCT, formatMoney, goalsReserved, managesInterestRule, monthlyInterest, monthlyInterestAt, parseMoney, savingsAvailable, savingsTotal, type Goal, type InterestRule } from '@/domain';
import { Button, Card, Checkbox, DemoNote, Empty, Field, Row, Screen, Section, Select } from '@/ui/kit';
import { Load, TxList } from '../shared';

export function Deposit({ id }: { id?: string }) {
  const session = useSession();
  const isParent = !!id;
  const childId = id ?? session?.memberId ?? '';
  const back = isParent ? `/child/${childId}` : '/products';
  const [amount, setAmount] = useState('');
  const [target, setTarget] = useState('own');

  const q = useQuery(async () => {
    if (!childId) return null;
    const [o, recipients] = await Promise.all([
      api.childOverview(childId),
      isParent ? Promise.resolve([]) : api.transferRecipients(),
    ]);
    const all = o.deposit ? await api.transactions(childId) : [];
    const canManageInterest = !!o.deposit && managesInterestRule(isParent ? 'parent' : 'child', o.settings.ageGroup);
    const [rule, parentRate] = await Promise.all([
      canManageInterest ? api.interestRule(childId) : Promise.resolve(null),
      isParent ? api.parentInterestRate(childId) : Promise.resolve(0),
    ]);
    return { o, recipients, txs: o.deposit ? all.filter((t) => t.accountId === o.deposit!.id) : [], canManageInterest, rule, parentRate };
  }, [childId, isParent]);

  const [close, closing] = useAction(async () => {
    const o = q.data?.o;
    if (!o?.deposit) return;
    const rest = o.deposit.balance;
    const ok = window.confirm(
      rest.minor > 0
        ? `Закрыть накопительный счёт? Остаток ${formatMoney(rest)} вернём на текущий счёт ${o.member.firstName}.`
        : 'Закрыть накопительный счёт?',
    );
    if (!ok) return;
    await api.closeDeposit(childId);
    toast('Накопительный счёт закрыт');
    goBack(`/child/${childId}`);
  });

  const [requestClose, requesting] = useAction(async () => {
    await api.createRequest({ type: 'deposit_close' });
    toast('Запрос на закрытие отправлен родителю');
    q.reload();
  });

  const [move, moving] = useAction(async () => {
    const m = parseMoney(amount);
    if (!m || m.minor <= 0) throw new Error('Введите сумму');
    const recipient = target === 'own' ? null : q.data?.recipients.find((r) => r.memberId === target);
    if (target !== 'own' && !recipient) throw new Error('Выберите получателя');
    const r = await api.moveDeposit({
      amount: m,
      recipientId: recipient?.memberId ?? null,
      recipient: recipient?.title ?? 'На основной счёт',
    });
    toast(r.requestId ? 'Запрос отправлен родителю' : 'Деньги переведены');
    setAmount('');
    q.reload();
  });

  return (
    <Screen title="Накопительный счёт" back={back}>
      <Load q={q}>
        {(d) =>
          !d ? (
            <Empty>Накопительный счёт не открыт</Empty>
          ) : (
            <>
              {d.o.deposit ? (
                (() => {
                  const reserved = goalsReserved(d.o.goals);
                  const total = savingsTotal(d.o.deposit);
                  const available = savingsAvailable(d.o.deposit, d.o.goals);
                  return (
                <>
                  <Card>
                    <div className="ui-stack ui-stack--tight">
                      <span className="t-caption muted">Всего на накопительном счёте</span>
                      <span className="t-display ui-amount">{formatMoney(total)}</span>
                      <span className="t-caption muted">
                        {d.o.goals.length > 0
                          ? `Свободно ${formatMoney(available)} · в копилках ${formatMoney(reserved)}`
                          : `Свободно ${formatMoney(available)}`}
                      </span>
                      <span className="t-caption muted">Счёт открыт на имя {d.o.member.firstName}</span>
                    </div>
                  </Card>

                  <Section title="Информация">
                    <Card flush>
                      <Row icon="user" title="Владелец" subtitle={`${d.o.member.firstName}, ${d.o.age} лет`} />
                      <Row icon="piggy" title="Тип счёта" subtitle={d.o.deposit.title} />
                      <Row icon="history" title="Открыт" subtitle={new Date(d.o.deposit.createdAt).toLocaleDateString('ru-RU')} />
                      <Row icon="star" title="Процентная ставка" subtitle={`${DEPOSIT_ANNUAL_RATE_PCT}% годовых · демо`} />
                      <Row icon="piggy" title="База процентов" subtitle="Весь остаток счёта, включая суммы в копилках" />
                    </Card>
                  </Section>

                  {d.canManageInterest && d.rule && (
                    <InterestSettings
                      childId={childId}
                      rule={d.rule}
                      goals={d.o.goals}
                      total={total}
                      parent={isParent}
                      onChanged={() => q.reload()}
                    />
                  )}

                  {isParent && (
                    <ParentInterestSettings childId={childId} total={total} rate={d.parentRate} onChanged={() => q.reload()} />
                  )}

                  <Section title="Операции">
                    <TxList items={d.txs} role={isParent ? 'parent' : 'child'} empty="Операций по накопительному счёту пока нет" />
                  </Section>

                  {!isParent && (
                    <Section title="Снять или перевести">
                      <Card>
                        <div className="ui-stack">
                          <div className="t-body muted">
                            {d.o.settings.ageGroup === 'junior'
                              ? 'До 14 лет снятие и перевод с накопительного счёта подтверждает родитель.'
                              : 'С 14 лет снятие и перевод проходят сразу.'}
                          </div>
                          <Select
                            label="Куда"
                            value={target}
                            onChange={setTarget}
                            options={[
                              { value: 'own', label: 'На основной счёт' },
                              ...d.recipients.map((r) => ({ value: r.memberId, label: `${r.title} — ${r.subtitle}` })),
                            ]}
                          />
                          <Field label="Сумма, BYN" value={amount} onChange={setAmount} inputMode="decimal" placeholder="0,00" />
                          {d.o.pendingRequests.some((r) => r.payload.type === 'deposit_withdraw' || r.payload.type === 'deposit_transfer') ? (
                            <Button block disabled>
                              Запрос уже у родителя
                            </Button>
                          ) : (
                            <Button block onClick={() => move()} disabled={moving}>
                              {moving
                                ? 'Отправляем…'
                                : d.o.settings.ageGroup === 'junior'
                                  ? target === 'own'
                                    ? 'Запросить снятие'
                                    : 'Запросить перевод'
                                  : target === 'own'
                                    ? 'Снять на основной счёт'
                                    : 'Перевести'}
                            </Button>
                          )}
                        </div>
                      </Card>
                    </Section>
                  )}

                  <Section title="Закрытие счёта">
                    <Card>
                      <div className="ui-stack">
                        <div className="t-body muted">
                          {d.o.deposit.balance.minor > 0
                            ? `При закрытии остаток ${formatMoney(d.o.deposit.balance)} вернётся на текущий счёт ребёнка.`
                            : 'На счёте нет денег — его можно закрыть без перевода остатка.'}
                        </div>
                        {d.o.goals.length > 0 && (
                          <div className="t-caption muted">Сначала закройте копилки — их деньги останутся на накопительном счёте.</div>
                        )}
                        {isParent ? (
                          <Button block variant="danger" onClick={() => close()} disabled={closing || d.o.goals.length > 0}>
                            {closing ? 'Закрываем…' : 'Закрыть накопительный счёт'}
                          </Button>
                        ) : d.o.pendingRequests.some((r) => r.payload.type === 'deposit_close') ? (
                          <Button block disabled>
                            Запрос уже у родителя
                          </Button>
                        ) : (
                          <Button block onClick={() => requestClose()} disabled={requesting || d.o.goals.length > 0}>
                            {requesting ? 'Отправляем…' : 'Запросить закрытие у родителя'}
                          </Button>
                        )}
                      </div>
                    </Card>
                  </Section>
                </>
                  );
                })()
              ) : (
                <Empty>Накопительный счёт не открыт</Empty>
              )}
            </>
          )
        }
      </Load>
      <DemoNote>Условия и ставка — допущения прототипа, требуют согласования с банком.</DemoNote>
    </Screen>
  );
}


function ParentInterestSettings({
  childId,
  total,
  rate,
  onChanged,
}: {
  childId: string;
  total: ReturnType<typeof savingsTotal>;
  rate: number;
  onChanged: () => void;
}) {
  const [percent, setPercent] = useState(String(rate));
  const n = Number(percent.replace(',', '.'));
  const valid = Number.isFinite(n) && n >= 0 && n <= 100;

  const [save, saving] = useAction(async () => {
    if (!valid) throw new Error('Введите ставку от 0 до 100');
    await api.setParentInterestRate(childId, Math.round(n));
    toast('Ставка от родителя сохранена');
    onChanged();
  });

  const [accrue, accruing] = useAction(async () => {
    const amount = await api.accrueParentInterest(childId);
    toast(amount.minor > 0 ? `Начислено ${formatMoney(amount)} от вас` : 'Ставка не задана — начислять нечего');
    onChanged();
  });

  return (
    <Section title="Проценты от родителя">
      <Card>
        <div className="ui-stack">
          <div className="t-body muted">
            Дополнительный процент от себя на весь остаток счёта — {formatMoney(total)}. Деньги списываются с вашего основного счёта.
          </div>
          <Field
            label="Ваша ставка, % годовых"
            value={percent}
            onChange={setPercent}
            inputMode="decimal"
            hint="0 — не начислять проценты от родителя"
          />
          <span className="t-caption muted">
            {valid ? `За месяц примерно ${formatMoney(monthlyInterestAt(total, n))}` : 'Введите ставку от 0 до 100'}
          </span>
          <Button block onClick={() => save()} disabled={saving}>
            Сохранить ставку
          </Button>
          <Button block variant="secondary" onClick={() => accrue()} disabled={accruing}>
            Начислить проценты от родителя (демо)
          </Button>
        </div>
      </Card>
    </Section>
  );
}

function InterestSettings({
  childId,
  rule,
  goals,
  total,
  parent,
  onChanged,
}: {
  childId: string;
  rule: InterestRule;
  goals: Goal[];
  total: ReturnType<typeof savingsTotal>;
  parent: boolean;
  onChanged: () => void;
}) {
  const [percent, setPercent] = useState(String(rule.percent));
  const [selected, setSelected] = useState<string[]>(rule.goalIds);
  const activeGoals = goals.filter((g) => !g.reachedAt);

  const [save, saving] = useAction(async () => {
    const n = Number(percent.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Введите долю от 0 до 100');
    await api.setInterestRule(childId, {
      percent: Math.round(n),
      goalIds: selected.filter((id) => activeGoals.some((g) => g.id === id)),
    });
    toast('Правило распределения процентов сохранено');
    onChanged();
  });

  const [accrue, accruing] = useAction(async () => {
    const r = await api.accrueInterest(childId);
    toast(`Начислено ${formatMoney(r.interest)} · в копилки ${formatMoney(r.toGoals)}`);
    onChanged();
  });

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));

  return (
    <Section title="Проценты банка">
      <Card>
        <div className="ui-stack">
          <div className="t-body muted">
            Проценты начисляются на весь остаток счёта — {formatMoney(total)}. За месяц примерно {formatMoney(monthlyInterest(total))}.
          </div>
          <Field
            label="Доля процентов в копилки, %"
            value={percent}
            onChange={setPercent}
            inputMode="decimal"
            hint="0 — все проценты остаются свободными"
          />
          {activeGoals.length > 0 ? (
            <div className="ui-stack ui-stack--tight">
              <span className="t-label">Куда откладывать</span>
              {activeGoals.map((g) => (
                <Checkbox key={g.id} checked={selected.includes(g.id)} onChange={(on) => toggle(g.id, on)}>
                  {g.title} · {formatMoney(g.balance)} из {formatMoney(g.target)}
                </Checkbox>
              ))}
              <span className="t-caption muted">Если копилки не выбраны, вся доля останется свободной.</span>
            </div>
          ) : (
            <div className="t-caption muted">Активных копилок нет — проценты будут оставаться свободными.</div>
          )}
          <Button block onClick={() => save()} disabled={saving}>
            Сохранить правило
          </Button>
          <Button block variant="secondary" onClick={() => accrue()} disabled={accruing}>
            Начислить проценты (демо)
          </Button>
          <span className="t-caption muted">
            {parent
              ? 'До 14 лет правило задаёте вы. Ребёнок его не видит.'
              : 'С 14 лет вы сами решаете, какую часть процентов откладывать.'}
          </span>
        </div>
      </Card>
    </Section>
  );
}
