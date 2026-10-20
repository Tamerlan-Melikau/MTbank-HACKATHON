import { useState } from 'react';
import { api } from '@/api';
import { useQuery, useSession } from '@/app/data';
import { Screen, Segmented } from '@/ui/kit';
import { Load, TxList } from '../shared';

type Filter = 'all' | 'in' | 'out' | 'declined';

/** История операций: своя или (для родителя) ребёнка. */
export function History({ memberId }: { memberId?: string }) {
  const session = useSession();
  const [filter, setFilter] = useState<Filter>('all');
  const q = useQuery(async () => {
    const id = memberId ?? (await api.me()).id;
    const [txs, member] = await Promise.all([api.transactions(id), memberId ? api.childOverview(memberId).then((o) => o.member) : api.me()]);
    return { txs, member };
  }, [memberId]);

  return (
    <Load q={q}>
      {({ txs, member }) => {
        const items = txs.filter((t) =>
          filter === 'all' ? true : filter === 'declined' ? t.status !== 'completed' : filter === 'in' ? t.amount.minor > 0 && t.status === 'completed' : t.amount.minor < 0 && t.status === 'completed',
        );
        return (
          <Screen title={memberId ? `Операции: ${member.firstName}` : 'Операции'} back={memberId ? `/child/${memberId}` : '/'}>
            <Segmented
              label="Фильтр"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'in', label: 'Приход' },
                { value: 'out', label: 'Расход' },
                { value: 'declined', label: 'Отказы' },
              ]}
            />
            <TxList items={items} role={session?.role ?? 'parent'} empty="Таких операций нет" />
          </Screen>
        );
      }}
    </Load>
  );
}
