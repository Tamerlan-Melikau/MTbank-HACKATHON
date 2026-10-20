/** Перевод денег другому человеку. До 14 лет перевод подтверждает родитель. */
import { useState } from 'react';
import { api, type TransferResult } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { navigate } from '@/app/router';
import { toast } from '@/app/toast';
import { formatMoney, parseMoney } from '@/domain';
import { Button, Card, DemoNote, Field, Locked, Screen, Section, Select } from '@/ui/kit';
import { Load } from '../shared';

export function Transfer() {
  const q = useQuery(async () => {
    const me = await api.me();
    const [o, recipients] = await Promise.all([api.childOverview(me.id), api.transferRecipients()]);
    return { o, recipients };
  }, []);
  const [recipient, setRecipient] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<TransferResult | null>(null);

  const [send, sending] = useAction(async (receiver: { title: string; memberId?: string }) => {
    const m = parseMoney(amount);
    if (!receiver.title.trim()) throw new Error('Укажи получателя');
    if (!m || m.minor <= 0) throw new Error('Введи сумму');
    const r = await api.transferMoney({ amount: m, recipient: receiver.title.trim(), recipientId: receiver.memberId, comment });
    setResult(r);
    setAmount('');
    setComment('');
    toast(r.requestId ? 'Запрос отправлен родителю' : 'Перевод выполнен');
  });

  return (
    <Screen title="Перевести деньги" back="/">
      <DemoNote>
        До 14 лет можно переводить только родителям и братьям или сёстрам, а перевод подтверждает родитель. С 14 лет перевод проходит
        сразу в рамках прав и лимитов.
      </DemoNote>

      <Load q={q}>
        {({ o, recipients }) => {
          const canSend = o.settings.ageGroup === 'junior' || o.access['transfer.p2p'].kind !== 'denied';
          const junior = o.settings.ageGroup === 'junior';
          const selectedId = recipientId || recipients[0]?.memberId || '';
          const selected = recipients.find((r) => r.memberId === selectedId);
          return (
            <>
              <Card>
                <div className="ui-stack ui-stack--tight">
                  <span className="t-caption muted">Доступно на счёте</span>
                  <span className="t-heading">{formatMoney(o.account.balance)}</span>
                </div>
              </Card>

              {!canSend ? (
                <Locked
                  title="Переводы выключены"
                  text="Родитель закрыл переводы. Можно попросить доступ в разделе «Попросить»."
                  action={{ label: 'Попросить доступ', onClick: () => navigate('/ask') }}
                />
              ) : (
                <Section>
                  {junior ? (
                    <Select
                      label="Получатель"
                      value={selectedId}
                      onChange={setRecipientId}
                      options={recipients.map((r) => ({ value: r.memberId, label: `${r.title} — ${r.subtitle}` }))}
                    />
                  ) : (
                    <Field label="Получатель" value={recipient} onChange={setRecipient} placeholder="Имя или номер телефона" />
                  )}
                  <Field label="Сумма, BYN" value={amount} onChange={setAmount} inputMode="decimal" placeholder="0,00" />
                  <Field label="Комментарий" value={comment} onChange={setComment} placeholder="Необязательно" />
                  <Button
                    block
                    onClick={() => {
                      if (junior && !selected) {
                        toast('Нет доступных получателей', 'error');
                        return;
                      }
                      send(junior ? { title: selected!.title, memberId: selected!.memberId } : { title: recipient });
                    }}
                    disabled={sending}
                  >
                    Перевести
                  </Button>
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
