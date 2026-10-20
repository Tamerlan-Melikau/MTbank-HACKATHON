/** Общие для экранов кусочки: загрузка, список операций, форматирование дат. */
import type { ReactNode } from 'react';
import type { QueryState } from '@/app/data';
import { CATEGORIES, REASON_TEXT, type DeclineCode, type ApprovalCode, type Role, type Transaction, type TxKind } from '@/domain';
import { Amount, Card, Empty, ErrorBox, Row, Skeleton } from '@/ui/kit';
import type { IconName } from '@/ui/icons';

/** Рисует загрузку/ошибку, а когда данные есть — children(data). */
export function Load<T>({ q, children, skeleton = 2 }: { q: QueryState<T>; children: (data: T) => ReactNode; skeleton?: number }) {
  if (q.data !== undefined) return <>{children(q.data)}</>;
  if (q.error) return <ErrorBox text={q.error.message} onRetry={q.reload} />;
  return <Skeleton count={skeleton} />;
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  const t = timeFmt.format(d);
  if (diff === 0) return `Сегодня, ${t}`;
  if (diff === 1) return `Вчера, ${t}`;
  return `${dateFmt.format(d)}, ${t}`;
}

export function pluralDays(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} день`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

const KIND_ICON: Record<TxKind, IconName> = {
  purchase: 'pay',
  cash: 'card',
  transfer_out: 'transfer',
  transfer_in: 'transfer',
  pocket_money: 'topup',
  topup: 'topup',
  goal_in: 'piggy',
  goal_out: 'piggy',
  reward: 'star',
  cashback: 'gift',
};

export function reasonText(code: string | null, role: Role): string | null {
  if (!code) return null;
  const r = REASON_TEXT[code as DeclineCode | ApprovalCode];
  return r ? r[role] : null;
}

export function TxRow({ tx, role }: { tx: Transaction; role: Role }) {
  const status =
    tx.status === 'declined'
      ? `Отклонено: ${reasonText(tx.declineReason, role) ?? ''}`
      : tx.status === 'pending_approval'
        ? role === 'child'
          ? 'Ждёт подтверждения родителя'
          : 'Ждёт вашего подтверждения'
        : null;
  const cat = tx.category ? CATEGORIES[tx.category].title : null;
  return (
    <Row
      icon={KIND_ICON[tx.kind]}
      iconTone={tx.status === 'completed' ? 'brand' : 'muted'}
      title={tx.title}
      subtitle={status ?? [cat, formatWhen(tx.createdAt)].filter(Boolean).join(' · ')}
      end={<Amount value={tx.amount} className={tx.status !== 'completed' ? 'muted' : undefined} />}
    />
  );
}

export function TxList({ items, role, empty = 'Операций пока нет' }: { items: Transaction[]; role: Role; empty?: string }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  return (
    <Card flush>
      {items.map((t) => (
        <TxRow key={t.id} tx={t} role={role} />
      ))}
    </Card>
  );
}
