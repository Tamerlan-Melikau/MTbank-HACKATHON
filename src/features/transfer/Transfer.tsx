/** Перевод денег другому человеку. До 14 лет перевод подтверждает родитель. */
import { useState } from 'react';
import { api, type ChildOverview, type TransferResult } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { navigate } from '@/app/router';
import { toast } from '@/app/toast';
import { formatMoney, parseMoney, type OwnTransferEndpoint } from '@/domain';
import { Button, Card, Field, Locked, Screen, Section, Segmented, Select } from '@/ui/kit';
import { Load } from '../shared';

type TransferMethod = 'person' | 'own';
type OwnEndpointValue = 'current' | 'deposit' | `goal:${string}`;

interface OwnEndpointOption {
  value: OwnEndpointValue;
  label: string;
}

function ownEndpointOptions(o: ChildOverview): OwnEndpointOption[] {
  return [
    { value: 'current', label: 'Основной счёт' },
    ...(o.deposit ? [{ value: 'deposit' as const, label: 'МТБелки (накопительный счёт)' }] : []),
    ...o.goals.map((g) => ({ value: `goal:${g.id}` as const, label: `Цель «${g.title}»` })),
  ];
}

function ownPair(o: ChildOverview, from: OwnEndpointValue, to: OwnEndpointValue) {
  const options = ownEndpointOptions(o);
  const fromValue = options.some((x) => x.value === from) ? from : options[0]?.value;
  const toValue = options.some((x) => x.value === to) && to !== fromValue ? to : options.find((x) => x.value !== fromValue)?.value;
  return { options, fromValue, toValue };
}

function toOwnEndpoint(value: OwnEndpointValue): OwnTransferEndpoint {
  if (value === 'current') return { kind: 'current' };
  if (value === 'deposit') return { kind: 'deposit' };
  return { kind: 'goal', goalId: value.slice('goal:'.length) };
}

export function Transfer() {
  const q = useQuery(async () => {
    const me = await api.me();
    const o = await api.childOverview(me.id);
    return { o };
  }, []);
  const [method, setMethod] = useState<TransferMethod>('person');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [from, setFrom] = useState<OwnEndpointValue>('current');
  const [to, setTo] = useState<OwnEndpointValue>('deposit');
  const [result, setResult] = useState<TransferResult | null>(null);

  const [send, sending] = useAction(async () => {
    const m = parseMoney(amount);
    if (!recipient.trim()) throw new Error('Укажи получателя');
    if (!m || m.minor <= 0) throw new Error('Введи сумму');
    const r = await api.transferMoney({ amount: m, recipient: recipient.trim(), comment });
    setResult(r);
    setAmount('');
    setComment('');
    toast(r.requestId ? 'Запрос отправлен родителю' : 'Перевод выполнен');
  });

  const [sendOwn, sendingOwn] = useAction(async () => {
    const o = q.data?.o;
    if (!o) throw new Error('Данные ещё загружаются');
    const pair = ownPair(o, from, to);
    if (!pair.fromValue || !pair.toValue || pair.fromValue === pair.toValue) throw new Error('Выберите два разных счёта');
    const m = parseMoney(amount);
    if (!m || m.minor <= 0) throw new Error('Введи сумму');
    const r = await api.transferOwn({ from: toOwnEndpoint(pair.fromValue), to: toOwnEndpoint(pair.toValue), amount: m });
    setAmount('');
    setResult(null);
    toast(r.requestId ? 'Запрос отправлен родителю' : 'Перевод выполнен');
  });

  return (
    <Screen title="Перевести деньги" back="/">
      <Load q={q}>
        {({ o }) => {
          const canSend = o.settings.ageGroup === 'junior' || o.access['transfer.p2p'].kind !== 'denied';
          const pair = ownPair(o, from, to);
          const canOwn = !!pair.fromValue && !!pair.toValue && pair.fromValue !== pair.toValue;
          return (
            <>
              <Card>
                <div className="ui-stack ui-stack--tight">
                  <span className="t-caption muted">Доступно на счёте</span>
                  <span className="t-heading">{formatMoney(o.account.balance)}</span>
                </div>
              </Card>

              <Section title="Способ перевода">
                <Segmented
                  label="Способ перевода"
                  value={method}
                  onChange={(m) => {
                    setMethod(m);
                    setResult(null);
                  }}
                  options={[
                    { value: 'person', label: 'Пользователю' },
                    { value: 'own', label: 'На свой счёт' },
                  ]}
                />
              </Section>

              {method === 'person' ? (
                !canSend ? (
                  <Locked
                    title="Переводы выключены"
                    text="Родитель закрыл переводы. Можно попросить доступ в разделе «Попросить»."
                    action={{ label: 'Попросить доступ', onClick: () => navigate('/ask') }}
                  />
                ) : (
                  <Section>
                    <Field label="Получатель" value={recipient} onChange={setRecipient} placeholder="Имя или номер телефона" />
                    <Field label="Сумма, BYN" value={amount} onChange={setAmount} inputMode="decimal" placeholder="0,00" />
                    <Field label="Комментарий" value={comment} onChange={setComment} placeholder="Необязательно" />
                    <Button block onClick={() => send()} disabled={sending}>
                      Перевести
                    </Button>
                  </Section>
                )
              ) : (
                <Section title="На свой счёт">
                  {!canOwn ? (
                    <Locked
                      title="Недостаточно счетов"
                      text="Откройте «МТБелки» или создайте копилку, чтобы переводить между своими счетами."
                    />
                  ) : (
                    <>
                      <Select
                        label="Откуда"
                        value={pair.fromValue!}
                        onChange={setFrom}
                        options={pair.options.filter((x) => x.value !== pair.toValue)}
                      />
                      <Select
                        label="Куда"
                        value={pair.toValue!}
                        onChange={setTo}
                        options={pair.options.filter((x) => x.value !== pair.fromValue)}
                      />
                      <Field label="Сумма, BYN" value={amount} onChange={setAmount} inputMode="decimal" placeholder="0,00" />
                      <Button block onClick={() => sendOwn()} disabled={sendingOwn}>
                        Перевести
                      </Button>
                    </>
                  )}
                </Section>
              )}
            </>
          );
        }}
      </Load>

      {result && (
        <Card>
          <div className="ui-stack">
            {result.requestId ? (
              <>
                <div className="t-heading">Ждём родителя</div>
                <div className="t-body">Запрос на перевод отправлен. Деньги спишутся только после одобрения родителя.</div>
              </>
            ) : result.transaction ? (
              <>
                <div className="t-heading positive">Переведено</div>
                <div className="t-body">
                  {result.transaction.title}, {formatMoney({ ...result.transaction.amount, minor: Math.abs(result.transaction.amount.minor) })}
                </div>
              </>
            ) : null}
          </div>
        </Card>
      )}
    </Screen>
  );
}
