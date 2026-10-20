/** Запросы: родитель отвечает, ребёнок видит статус своих. */
import { api } from '@/api';
import { useAction, useQuery, useSession } from '@/app/data';
import { toast } from '@/app/toast';
import { describePayload, formatMoney, type AccessRequest, type Member, type Transaction } from '@/domain';
import { Button, ButtonRow, Card, Empty, Row, Screen, Section } from '@/ui/kit';
import { formatWhen, Load } from '../shared';

const STATUS: Record<AccessRequest['status'], string> = {
  pending: 'Ждёт ответа',
  approved: 'Разрешено',
  declined: 'Отказано',
  expired: 'Истёк',
};

export function Requests() {
  const session = useSession();
  const isParent = session?.role === 'parent';
  const q = useQuery(async () => {
    const me = await api.me();
    const list = await api.requests();
    // Для запросов покупки подтянем саму операцию: родителю важно видеть, что именно покупают.
    const childIds = [...new Set(list.map((r) => r.childId))];
    const txs = (await Promise.all(childIds.map((c) => api.transactions(c)))).flat();
    const family = isParent ? await api.familyView() : null;
    const names: Record<string, Member> = {};
    if (family) for (const c of family.children) names[c.member.id] = c.member;
    else names[me.id] = me;
    return { list, txs: Object.fromEntries(txs.map((t) => [t.id, t])) as Record<string, Transaction>, names };
  }, [isParent]);

  const [resolve, busy] = useAction(async (id: string, approve: boolean) => {
    await api.resolveRequest(id, approve);
    toast(approve ? 'Разрешено' : 'Отказано');
  });

  return (
    <Screen title="Запросы" back="/">
      <Load q={q}>
        {({ list, txs, names }) => {
          const pending = list.filter((r) => r.status === 'pending');
          const done = list.filter((r) => r.status !== 'pending').slice(0, 10);
          const subtitle = (r: AccessRequest) => {
            const parts = [isParent ? names[r.childId]?.firstName : null, formatWhen(r.createdAt)];
            if (r.payload.type === 'purchase') {
              const tx = txs[r.payload.transactionId];
              if (tx) parts.unshift(`${tx.title}, ${formatMoney({ ...tx.amount, minor: Math.abs(tx.amount.minor) })}`);
            }
            return parts.filter(Boolean).join(' · ');
          };
          return (
            <>
              <Section title="Ждут ответа">
                {pending.length === 0 && <Empty>Новых запросов нет</Empty>}
                {pending.map((r) => (
                  <Card key={r.id}>
                    <div className="ui-stack">
                      <div>
                        <div className="t-heading">{describePayload(r.payload)}</div>
                        <div className="t-caption muted">{subtitle(r)}</div>
                        {r.comment && <div className="t-body" style={{ marginTop: 8 }}>«{r.comment}»</div>}
                      </div>
                      {isParent ? (
                        <ButtonRow>
                          <Button variant="secondary" onClick={() => resolve(r.id, false)} disabled={busy}>
                            Отказать
                          </Button>
                          <Button onClick={() => resolve(r.id, true)} disabled={busy}>
                            Разрешить
                          </Button>
                        </ButtonRow>
                      ) : (
                        <span className="t-label muted">Родитель получил уведомление</span>
                      )}
                    </div>
                  </Card>
                ))}
              </Section>
              {done.length > 0 && (
                <Section title="История">
                  <Card flush>
                    {done.map((r) => (
                      <Row
                        key={r.id}
                        icon={r.status === 'approved' ? 'check' : 'close'}
                        iconTone={r.status === 'approved' ? 'brand' : 'muted'}
                        title={describePayload(r.payload)}
                        subtitle={subtitle(r)}
                        end={<span className="t-label muted">{STATUS[r.status]}</span>}
                      />
                    ))}
                  </Card>
                </Section>
              )}
            </>
          );
        }}
      </Load>
    </Screen>
  );
}
