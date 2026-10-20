/**
 * Корень: сессия → маршрут → каркас (с вкладками или без).
 * Охрана маршрутов по ролям здесь — для удобства; настоящая проверка прав — в API.
 */
import { useEffect } from 'react';
import { api } from '@/api';
import { Welcome } from '@/features/auth/Welcome';
import { AppFrame, TabBar, Toaster } from '@/ui/kit';
import { useQuery, useSession } from './data';
import { matchPath, navigate, usePath } from './router';
import { ROUTES } from './routes';

export function App() {
  const session = useSession();
  const path = usePath();

  // Пустой маршрут или маршрут не своей роли — на главную.
  const found = session ? findRoute(path, session.role) : null;
  useEffect(() => {
    if (session && !found) navigate('/', { replace: true });
  }, [session, found]);
  // Новый экран — сверху. Фигурные скобки обязательны: в новых браузерах scrollTo возвращает Promise.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  if (!session) {
    return (
      <AppFrame tabs={false}>
        <Welcome />
        <Toaster />
      </AppFrame>
    );
  }
  if (!found) return null;
  const { route, params } = found;
  return (
    <AppFrame tabs={route.tab !== null}>
      <div key={`${session.memberId}:${path}`}>{route.render(params, session.role)}</div>
      {route.tab !== null && <Tabs active={route.tab} />}
      <Toaster />
    </AppFrame>
  );
}

function Tabs({ active }: { active: Parameters<typeof TabBar>[0]['active'] }) {
  const q = useQuery(() => api.notifications(), []);
  return <TabBar active={active} moreBadge={q.data?.filter((n) => !n.read).length} />;
}

function findRoute(path: string, role: 'parent' | 'child') {
  for (const route of ROUTES) {
    const params = matchPath(route.path, path);
    if (params && route.roles.includes(role)) return { route, params };
  }
  return null;
}
