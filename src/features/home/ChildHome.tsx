import { api } from '@/api';
import { useQuery } from '@/app/data';
import { navigate } from '@/app/router';
import { formatMoney, levelOf } from '@/domain';
import { BalanceHeader, Card, Page, Progress, PromoBanner, Row, Section } from '@/ui/kit';
import { Load, TxList } from '../shared';
import { AllocationSheet } from '../allocation/Allocation';

export function ChildHome() {
  const q = useQuery(async () => {
    const me = await api.me();
    const [o, txs, tasks, notifications] = await Promise.all([
      api.childOverview(me.id),
      api.transactions(me.id, { limit: 3 }),
      api.tasks(),
      api.notifications(),
    ]);
    return { o, txs, openTasks: tasks.filter((t) => t.status === 'assigned'), unread: notifications.filter((n) => !n.read).length };
  }, []);

  return (
    <Load q={q} skeleton={4}>
      {({ o, txs, openTasks, unread }) => {
        const lvl = levelOf(o.points);
        const goal = o.goals.find((g) => !g.reachedAt) ?? o.goals[0];
        return (
          <>
            <BalanceHeader
              title={o.member.firstName}
              caption={o.card ? `${o.account.title} · •••• ${o.card.last4}` : o.account.title}
              amount={o.account.balance}
              badge={unread}
              onAvatar={() => navigate('/notifications')}
              actions={[
                { icon: 'transfer', label: 'Перевести', onClick: () => navigate('/transfer') },
                { icon: 'ask', label: 'Попросить', onClick: () => navigate('/ask') },
                { icon: 'piggy', label: 'Копилка', onClick: () => navigate('/goals') },
                { icon: 'task', label: 'Задания', onClick: () => navigate('/tasks') },
              ]}
            />
            <Page>
              {o.card && o.card.status !== 'active' && o.account.status !== 'blocked' && (
                <PromoBanner
                  title="Карта не работает"
                  text={o.card.status === 'blocked' ? 'Родитель заблокировал карту. Переводы по счёту доступны' : 'Карта отмечена как утерянная'}
                  action="Попросить родителя"
                  onClick={() => navigate('/ask')}
                />
              )}
              {o.account.status === 'blocked' && (
                <PromoBanner
                  title="Счёт заблокирован"
                  text="Родитель закрыл покупки и переводы по счёту"
                  action="Попросить родителя"
                  onClick={() => navigate('/ask')}
                />
              )}
              {openTasks.length > 0 && (
                <PromoBanner title="Новые задания" text={`Ждут тебя: ${openTasks.length}. За них дают Манички`} action="Открыть" onClick={() => navigate('/tasks')} />
              )}

              <Card flush>
                <Row
                  icon="star"
                  iconTone="accent"
                  title={`Уровень ${lvl.level}: ${lvl.title}`}
                  subtitle={lvl.to ? `${o.points} из ${lvl.to} Маничек до следующего` : `${o.points} Маничек`}
                  to="/points"
                  chevron
                />
                {goal && (
                  <Row
                    icon="piggy"
                    title={goal.title}
                    subtitle={
                      <span style={{ display: 'grid', gap: 6, paddingTop: 4 }}>
                        <span>
                          {formatMoney(goal.balance)} из {formatMoney(goal.target)}
                        </span>
                        <Progress value={goal.balance.minor / goal.target.minor} label="Прогресс копилки" />
                      </span>
                    }
                    to="/goals"
                    chevron
                  />
                )}
                {o.deposit && (
                  <Row
                    icon="piggy"
                    title="МТБелки"
                    subtitle="Накопительный счёт"
                    to="/deposit"
                    chevron
                  />
                )}
                <Row icon="book" title="Уроки о деньгах" subtitle="Проходи и получай Манички" to="/learn" chevron />
              </Card>

              <Section title="Последние операции" end={<a className="t-label" style={{ color: 'var(--brand)', padding: '12px 0' }} href="#/history">Все</a>}>
                <TxList items={txs} role="child" empty="За последние дни операций нет" />
              </Section>
            </Page>
            {o.settings.ageGroup === 'teen' && o.pendingAllocation && (
              <AllocationSheet allocation={o.pendingAllocation} overview={o} onClose={() => q.reload()} />
            )}
          </>
        );
      }}
    </Load>
  );
}
