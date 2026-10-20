/** Накопительный счёт ребёнка: информация, операции, снятие/перевод и закрытие. */
import { useState } from 'react';
import { api } from '@/api';
import { useAction, useQuery, useSession } from '@/app/data';
import { goBack } from '@/app/router';
import { toast } from '@/app/toast';
import { formatMoney, parseMoney } from '@/domain';
import { Button, Card, DemoNote, Empty, Field, Row, Screen, Section, Select } from '@/ui/kit';
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
    return { o, recipients, txs: o.deposit ? all.filter((t) => t.accountId === o.deposit!.id) : [] };
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
                <>
                  <Card>
                    <div className="ui-stack ui-stack--tight">
                      <span className="t-caption muted">Баланс накопительного счёта</span>
                      <span className="t-display ui-amount">{formatMoney(d.o.deposit.balance)}</span>
                      <span className="t-caption muted">Счёт открыт на имя {d.o.member.firstName}</span>
                    </div>
                  </Card>

                  <Section title="Информация">
                    <Card flush>
                      <Row icon="user" title="Владелец" subtitle={`${d.o.member.firstName}, ${d.o.age} лет`} />
                      <Row icon="piggy" title="Тип счёта" subtitle={d.o.deposit.title} />
                      <Row icon="history" title="Открыт" subtitle={new Date(d.o.deposit.createdAt).toLocaleDateString('ru-RU')} />
                      <Row icon="shield" title="Процентная ставка" subtitle="По тарифам банка на дату открытия" />
                    </Card>
                  </Section>

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
                        {isParent ? (
                          <Button block variant="danger" onClick={() => close()} disabled={closing}>
                            {closing ? 'Закрываем…' : 'Закрыть накопительный счёт'}
                          </Button>
                        ) : d.o.pendingRequests.some((r) => r.payload.type === 'deposit_close') ? (
                          <Button block disabled>
                            Запрос уже у родителя
                          </Button>
                        ) : (
                          <Button block onClick={() => requestClose()} disabled={requesting}>
                            {requesting ? 'Отправляем…' : 'Запросить закрытие у родителя'}
                          </Button>
                        )}
                      </div>
                    </Card>
                  </Section>
                </>
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
