/**
 * Демо-терминал: ребёнок «платит», а движок авторизации решает. Показывает
 * все ветки: одобрено / отказ с причиной / ждёт родителя / попросить разрешение.
 * В бою этого экрана нет — решения принимаются при реальной оплате картой.
 */
import { useState } from 'react';
import { api, type PayResult } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { CATEGORIES, CATEGORY_LIST, formatMoney, minor, parseMoney, REASON_TEXT, type CategoryId, type PaymentOp } from '@/domain';
import { Button, Card, DemoNote, Field, Locked, Screen, Section, Segmented, Select } from '@/ui/kit';
import { toast } from '@/app/toast';
import { Load } from '../shared';

const PRESETS: { merchant: string; category: CategoryId; channel: PaymentOp['channel']; amount: string }[] = [
  { merchant: 'Столовая школы', category: 'food', channel: 'offline', amount: '3,50' },
  { merchant: 'Книжный «Буквица»', category: 'books', channel: 'offline', amount: '21' },
  { merchant: 'GameStore', category: 'games', channel: 'online', amount: '12' },
  { merchant: 'Букмекер', category: 'gambling', channel: 'online', amount: '5' },
  { merchant: 'Банкомат', category: 'food', channel: 'atm', amount: '10' },
];

export function Pay() {
  const q = useQuery(async () => api.childOverview((await api.me()).id), []);
  const [merchant, setMerchant] = useState('Столовая школы');
  const [category, setCategory] = useState<CategoryId>('food');
  const [channel, setChannel] = useState<PaymentOp['channel']>('offline');
  const [amount, setAmount] = useState('3,50');
  const [result, setResult] = useState<PayResult | null>(null);

  const [pay, paying] = useAction(async () => {
    const m = parseMoney(amount);
    if (!m || m.minor <= 0) throw new Error('Введи сумму');
    setResult(await api.pay({ amount: m, channel, category: channel === 'atm' ? null : category, merchant: merchant || 'Покупка' }));
  });
  const [askAllow, asking] = useAction(async (r: PayResult) => {
    // Не хватает денег — просим деньги; иначе — разовое разрешение на эту покупку.
    if (r.decision.outcome === 'decline' && r.decision.code === 'INSUFFICIENT_FUNDS') {
      await api.createRequest({ type: 'money', amount: minor(-r.transaction.amount.minor) }, `На покупку: ${r.transaction.title}`);
    } else await api.createRequest({ type: 'purchase', transactionId: r.transaction.id });
    toast('Запрос отправлен родителю');
    setResult(null);
  });

  return (
    <Screen title="Оплатить" back="/">
      <DemoNote>Демо-терминал: имитирует оплату картой, чтобы показать родительский контроль в действии.</DemoNote>
      <Load q={q}>
        {(o) =>
          o.card && o.card.status !== 'active' ? (
            <Locked title="Карта не работает" text={o.card.status === 'blocked' ? 'Родитель заблокировал карту.' : 'Карта утеряна.'} />
          ) : (
            <Section>
              <div className="ui-chips">
                {PRESETS.map((p) => (
                  <button
                    key={p.merchant}
                    className="ui-chip"
                    aria-pressed={merchant === p.merchant}
                    onClick={() => {
                      setMerchant(p.merchant);
                      setCategory(p.category);
                      setChannel(p.channel);
                      setAmount(p.amount);
                      setResult(null);
                    }}
                  >
                    {p.merchant}
                  </button>
                ))}
              </div>
              <Segmented
                label="Где платишь"
                value={channel}
                onChange={setChannel}
                options={[
                  { value: 'offline', label: 'Касса' },
                  { value: 'online', label: 'Интернет' },
                  { value: 'atm', label: 'Банкомат' },
                ]}
              />
              <Field label="Магазин" value={merchant} onChange={setMerchant} />
              {channel !== 'atm' && (
                <Select label="Категория" value={category} onChange={setCategory} options={CATEGORY_LIST.map((c) => ({ value: c.id, label: c.title }))} />
              )}
              <Field label="Сумма, BYN" value={amount} onChange={setAmount} inputMode="decimal" />
              <Button block onClick={() => pay()} disabled={paying}>
                Оплатить
              </Button>
            </Section>
          )
        }
      </Load>

      {result && (
        <Card>
          <div className="ui-stack">
            {result.decision.outcome === 'approve' && (
              <>
                <div className="t-heading positive">Оплачено</div>
                <div className="t-body">
                  {result.transaction.title}, {formatMoney(result.transaction.amount)}
                  {result.transaction.category && CATEGORIES[result.transaction.category].family ? '. Начислили баллы за покупку у партнёра' : ''}
                </div>
              </>
            )}
            {result.decision.outcome === 'needs_approval' && (
              <>
                <div className="t-heading">Ждём родителя</div>
                <div className="t-body">{REASON_TEXT[result.decision.code].child}. Родитель уже получил запрос.</div>
              </>
            )}
            {result.decision.outcome === 'decline' && (
              <>
                <div className="t-heading negative">Не прошло</div>
                <div className="t-body">{REASON_TEXT[result.decision.code].child}</div>
                {result.decision.requestable && (
                  <Button icon="ask" onClick={() => askAllow(result)} disabled={asking}>
                    {result.decision.code === 'INSUFFICIENT_FUNDS' ? 'Попросить денег' : 'Попросить разрешение'}
                  </Button>
                )}
              </>
            )}
          </div>
        </Card>
      )}
    </Screen>
  );
}
