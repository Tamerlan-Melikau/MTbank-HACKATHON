import { useEffect } from 'react';
import { api } from '@/api';
import { useAction, useQuery, useSession } from '@/app/data';
import { navigate } from '@/app/router';
import { useTheme, type ThemePref } from '@/app/theme';
import { levelOf } from '@/domain';
import { Card, Empty, Row, Screen, Section, Segmented, TopBar, Page, DemoNote } from '@/ui/kit';
import { formatWhen, Load } from '../shared';

export function More() {
  const session = useSession();
  const [theme, setTheme] = useTheme();
  const q = useQuery(async () => {
    const me = await api.me();
    const [n, pts] = await Promise.all([api.notifications(), api.points(me.id)]);
    return { me, unread: n.filter((x) => !x.read).length, points: pts.balance };
  }, []);
  const [signOut] = useAction(() => api.signOut());
  const isParent = session?.role === 'parent';

  return (
    <>
      <TopBar title="Ещё" back={false} />
      <Page>
        <Load q={q}>
          {(d) => (
            <Card flush>
              <Row icon="user" title={`${d.me.firstName} ${d.me.lastName}`} subtitle={isParent ? 'Родитель' : 'Ребёнок'} />
              <Row icon="bell" title="Уведомления" end={d.unread ? <span className="t-label">{d.unread}</span> : undefined} to="/notifications" chevron />
              <Row icon="star" iconTone="accent" title="Баллы" subtitle={`${d.points} · ${levelOf(d.points).title}`} to="/points" chevron />
            </Card>
          )}
        </Load>
        <Section title="Разделы">
          <Card flush>
            <Row icon="ask" title="Запросы" to="/requests" chevron />
            <Row icon="task" title="Задания" to="/tasks" chevron />
            <Row icon="book" title="Уроки" to="/learn" chevron />
            <Row icon="history" title="Операции" to="/history" chevron />
            {isParent && <Row icon="family" title="Добавить ребёнка" to="/enroll" chevron />}
          </Card>
        </Section>
        <Section title="Безопасность">
          <Card flush>
            <Row icon="shield" title="Если карта потеряна" subtitle={isParent ? 'Откройте ребёнка → «Карта утеряна»: старая закроется, новая цифровая заработает сразу' : 'Сразу скажи родителю — он закроет карту в приложении'} />
            <Row icon="alert" title="Спорная операция" subtitle="Напишите в чат банка: оспорить операцию можно в течение срока по правилам платёжной системы (уточнить)" to="/chat" chevron />
          </Card>
        </Section>
        <Section title="Тема">
          <Segmented<ThemePref>
            label="Тема"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: 'Как в системе' },
              { value: 'light', label: 'Светлая' },
              { value: 'dark', label: 'Тёмная' },
            ]}
          />
        </Section>
        <Card flush>
          <Row icon="logout" title="Выйти" subtitle="В демо — сменить персонажа" onClick={() => signOut().then(() => navigate('/', { replace: true }))} />
        </Card>
        <DemoNote>Прототип для хакатона. Тарифы, ставки и партнёры — допущения.</DemoNote>
      </Page>
    </>
  );
}

export function Notifications() {
  const q = useQuery(() => api.notifications(), []);
  const [markRead] = useAction(() => api.markNotificationsRead());
  const hasUnread = q.data?.some((n) => !n.read);
  useEffect(() => {
    if (hasUnread) {
      const t = setTimeout(() => markRead(), 1500);
      return () => clearTimeout(t);
    }
  }, [hasUnread, markRead]);
  return (
    <Screen title="Уведомления" back="/">
      <Load q={q}>
        {(list) =>
          list.length === 0 ? (
            <Empty>Уведомлений нет</Empty>
          ) : (
            <Card flush>
              {list.map((n) => (
                <Row
                  key={n.id}
                  icon="bell"
                  iconTone={n.read ? 'muted' : 'accent'}
                  title={n.title}
                  subtitle={`${n.body} · ${formatWhen(n.createdAt)}`}
                  to={n.link ?? undefined}
                  chevron={!!n.link}
                />
              ))}
            </Card>
          )
        }
      </Load>
    </Screen>
  );
}

export function Points() {
  const q = useQuery(async () => api.points((await api.me()).id), []);
  return (
    <Screen title="Баллы" back="/">
      <Load q={q}>
        {(p) => {
          const lvl = levelOf(p.balance);
          return (
            <>
              <Card>
                <div className="ui-stack ui-stack--tight">
                  <span className="t-display">{p.balance}</span>
                  <span className="t-body">
                    Уровень {lvl.level}: {lvl.title}
                    {lvl.to ? ` · до следующего ${lvl.to - p.balance}` : ''}
                  </span>
                  <span className="t-caption muted">Баллы копятся отдельно у каждого в семье. Обмен на награды партнёров — в разработке.</span>
                </div>
              </Card>
              <Card flush>
                {p.entries.map((e) => (
                  <Row key={e.id} icon="star" iconTone="accent" title={e.reason} subtitle={formatWhen(e.createdAt)} end={<span className="t-label">{e.delta > 0 ? `+${e.delta}` : `−${Math.abs(e.delta)}`}</span>} />
                ))}
                {p.entries.length === 0 && <Empty>Пока баллов нет</Empty>}
              </Card>
            </>
          );
        }}
      </Load>
    </Screen>
  );
}
