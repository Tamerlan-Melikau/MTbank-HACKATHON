/** Ребёнок просит родителя: деньги или доступ к закрытой возможности. */
import { useState } from 'react';
import { api } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { goBack } from '@/app/router';
import { toast } from '@/app/toast';
import { CAPABILITY_LIST, parseMoney } from '@/domain';
import { Button, Field, Locked, Screen, Section } from '@/ui/kit';
import { Load } from '../shared';

export function Ask() {
  const q = useQuery(async () => api.childOverview((await api.me()).id), []);
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');

  const [askMoney, busy] = useAction(async () => {
    const m = parseMoney(amount);
    if (!m || m.minor <= 0) throw new Error('Напиши сумму');
    await api.createRequest({ type: 'money', amount: m }, comment);
    toast('Запрос отправлен');
    goBack('/');
  });
  const [askCap, asking] = useAction(async (id: (typeof CAPABILITY_LIST)[number]['id'], level: 'on' | 'approval') => {
    await api.createRequest({ type: 'capability', capabilityId: id, level }, comment);
    toast('Запрос отправлен');
  });

  return (
    <Screen title="Попросить" back="/">
      <Load q={q}>
        {(o) => {
          const pendingCaps = new Set(o.pendingRequests.flatMap((r) => (r.payload.type === 'capability' ? [r.payload.capabilityId] : [])));
          const requestable = CAPABILITY_LIST.filter((c) => {
            if (c.id === 'card.cash') return false;
            const a = o.access[c.id];
            const hiddenForJunior =
              o.settings.ageGroup === 'junior' && (c.id === 'transfer.p2p' || c.id === 'partners.offers' || c.id === 'savings.deposit');
            return !hiddenForJunior && a.kind === 'denied' && a.canRequest;
          });
          return (
            <>
              <Section title="Деньги">
                <Field label="Сколько, BYN" value={amount} onChange={setAmount} inputMode="decimal" placeholder="0,00" />
                <Field label="Зачем" value={comment} onChange={setComment} placeholder="Например, на подарок другу" />
                <Button block onClick={() => askMoney()} disabled={busy}>
                  Попросить
                </Button>
              </Section>

              {requestable.length > 0 && (
                <Section title="Закрыто родителем">
                  {requestable.map((c) => {
                    const a = o.access[c.id];
                    const level = a.kind === 'denied' && a.requestLevel === 'approval' ? 'approval' : 'on';
                    const sent = pendingCaps.has(c.id);
                    return (
                      <Locked
                        key={c.id}
                        title={c.title}
                        text={sent ? 'Запрос уже у родителя' : c.childHint}
                        action={sent ? undefined : { label: 'Запросить доступ', onClick: () => askCap(c.id, level), disabled: asking }}
                      />
                    );
                  })}
                </Section>
              )}
            </>
          );
        }}
      </Load>
    </Screen>
  );
}
