/**
 * Таблица маршрутов. Одна точка, где видно: какой экран, для какой роли, с вкладками или нет.
 * Новый экран = строка здесь + компонент в features/.
 */
import type { ReactNode } from 'react';
import type { Role } from '@/domain';
import type { TabId } from '@/ui/kit';
import { Ask } from '@/features/ask/Ask';
import { Chat } from '@/features/chat/Chat';
import { ChildManage } from '@/features/child/ChildManage';
import { Limits } from '@/features/child/Limits';
import { Permissions } from '@/features/child/Permissions';
import { TopUp, TopUpPicker } from '@/features/child/TopUp';
import { Enroll } from '@/features/enroll/Enroll';
import { Goals } from '@/features/goals/Goals';
import { History } from '@/features/history/History';
import { ChildHome } from '@/features/home/ChildHome';
import { ParentHome } from '@/features/home/ParentHome';
import { Learn, Lesson } from '@/features/learn/Learn';
import { More, Notifications, Points } from '@/features/more/More';
import { Pay } from '@/features/pay/Pay';
import { ChildProducts, ParentProducts } from '@/features/products/Products';
import { Requests } from '@/features/requests/Requests';
import { Tasks } from '@/features/tasks/Tasks';
import type { Params } from './router';

export interface RouteDef {
  path: string;
  /** Для кого маршрут. Если роли нет в списке — экран недоступен (редирект на главную). */
  roles: Role[];
  /** Вкладка, подсвеченная в TabBar. null — экран без панели вкладок. */
  tab: TabId | null;
  render: (p: Params, role: Role) => ReactNode;
}

const both: Role[] = ['parent', 'child'];

export const ROUTES: RouteDef[] = [
  { path: '/', roles: both, tab: 'home', render: (_, r) => (r === 'parent' ? <ParentHome /> : <ChildHome />) },
  { path: '/products', roles: both, tab: 'products', render: (_, r) => (r === 'parent' ? <ParentProducts /> : <ChildProducts />) },
  { path: '/chat', roles: both, tab: 'chat', render: () => <Chat /> },
  { path: '/more', roles: both, tab: 'more', render: () => <More /> },

  // Общие
  { path: '/requests', roles: both, tab: null, render: () => <Requests /> },
  { path: '/tasks', roles: both, tab: null, render: () => <Tasks /> },
  { path: '/learn', roles: both, tab: null, render: () => <Learn /> },
  { path: '/learn/:id', roles: both, tab: null, render: (p) => <Lesson id={p.id!} /> },
  { path: '/history', roles: both, tab: null, render: () => <History /> },
  { path: '/notifications', roles: both, tab: null, render: () => <Notifications /> },
  { path: '/points', roles: both, tab: null, render: () => <Points /> },

  // Родитель
  { path: '/enroll', roles: ['parent'], tab: null, render: () => <Enroll /> },
  { path: '/topup', roles: ['parent'], tab: null, render: () => <TopUpPicker /> },
  { path: '/child/:id', roles: ['parent'], tab: null, render: (p) => <ChildManage id={p.id!} /> },
  { path: '/child/:id/permissions', roles: ['parent'], tab: null, render: (p) => <Permissions id={p.id!} /> },
  { path: '/child/:id/limits', roles: ['parent'], tab: null, render: (p) => <Limits id={p.id!} /> },
  { path: '/child/:id/topup', roles: ['parent'], tab: null, render: (p) => <TopUp id={p.id!} /> },
  { path: '/child/:id/history', roles: ['parent'], tab: null, render: (p) => <History memberId={p.id!} /> },

  // Ребёнок
  { path: '/pay', roles: ['child'], tab: null, render: () => <Pay /> },
  { path: '/ask', roles: ['child'], tab: null, render: () => <Ask /> },
  { path: '/goals', roles: ['child'], tab: null, render: () => <Goals /> },
];
