import { api } from '@/api';
import { useQuery } from '@/app/data';
import { navigate } from '@/app/router';
import { AGE_GROUPS } from '@/domain';
import { BalanceHeader, Card, Page, PromoBanner, Row, Section, Amount } from '@/ui/kit';
import { Load, TxList } from '../shared';
import { AllocationGate } from '../allocation/Allocation';

const MOBY_STATUS = {
  none: 'Нет доступа в Moby',
  invited: 'Код выдан, ждём входа',
  pending_confirm: 'Ждёт вашего подтверждения',
  active: 'Есть доступ в Moby',
  suspended: 'Доступ приостановлен',
} as const;

export function ParentHome() {
  const q = useQuery(async () => {
    const me = await api.me();
    const [family, accounts, cards, txs, requests, notifications, allocations] = await Promise.all([
      api.familyView(),
      api.accounts(me.id),
      api.cards(me.id),
      api.transactions(me.id, { limit: 3 }),
      api.requests({ status: 'pending' }),
      api.notifications(),
      api.allocations(),
    ]);
    return { me, family, account: accounts.find((a) => a.kind === 'current')!, card: cards[0] ?? null, txs, requests, allocation: allocations[0] ?? null, unread: notifications.filter((n) => !n.read).length };
  }, []);

  return (
    <Load q={q} skeleton={4}>
      {(d) => {
        return (
          <>
            <BalanceHeader
              title={`${d.me.firstName} ${d.me.lastName}`}
              caption={d.card ? `${d.account.title} · •••• ${d.card.last4}` : d.account.title}
              amount={d.account.balance}
              badge={d.unread}
              onAvatar={() => navigate('/notifications')}
              actions={[
                { icon: 'topup-family', label: 'Пополнить', onClick: () => navigate('/topup') },
                { icon: 'task', label: 'Задания', onClick: () => navigate('/tasks') },
                { icon: 'ask', label: 'Запросы', onClick: () => navigate('/requests') },
                { icon: 'history', label: 'История', onClick: () => navigate('/history') },
              ]}
            />
            <Page>
              {d.requests.length > 0 && (
                <PromoBanner
                  title="Запросы детей"
                  text={`Ждут ответа: ${d.requests.length}`}
                  action="Посмотреть"
                  onClick={() => navigate('/requests')}
                />
              )}
              <Section title="Дети">
                <Card flush>
                  {d.family.children.map((c) => (
                    <Row
                      key={c.member.id}
                      icon="user"
                      title={c.member.firstName}
                      subtitle={`${c.age} лет · ${AGE_GROUPS[c.ageGroup].label} · ${MOBY_STATUS[c.moby]}${c.card?.status === 'blocked' ? ' · карта заблокирована' : ''}`}
                      end={<Amount value={c.balance} sign="auto" />}
                      to={`/child/${c.member.id}`}
                      chevron
                    />
                  ))}
                  <Row icon="plus" iconTone="muted" title="Добавить ребёнка" subtitle="Оформить семейный пакет" to="/enroll" chevron />
                </Card>
              </Section>
              {d.family.children.length === 0 && (
                <PromoBanner tone="brand" title="Семейный пакет" text="Карта ребёнку, контроль и уроки о деньгах" action="Оформить" onClick={() => navigate('/enroll')} />
              )}
              <Section title="Последние операции" end={<a className="t-label" style={{ color: 'var(--brand)', padding: '12px 0' }} href="#/history">Все</a>}>
                <TxList items={d.txs} role="parent" empty="За последние дни операций нет" />
              </Section>
            </Page>
            {d.allocation && <AllocationGate allocation={d.allocation} onClose={() => q.reload()} />}
          </>
        );
      }}
    </Load>
  );
}
