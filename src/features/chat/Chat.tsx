import { useEffect } from 'react';
import { api } from '@/api';
import { useQuery, useSession } from '@/app/data';
import { navigate } from '@/app/router';
import { DemoNote, Empty, Page, TopBar } from '@/ui/kit';

/** Заглушка вкладки «Чат»: в Moby это чат с банком. Семейный чат — кандидат на развитие. */
export function Chat() {
  const session = useSession();
  const q = useQuery(
    () => (session?.role === 'child' ? api.childOverview(session.memberId) : Promise.resolve(null)),
    [session?.role, session?.memberId],
  );
  const isJunior = q.data?.settings.ageGroup === 'junior';
  useEffect(() => {
    if (isJunior) navigate('/', { replace: true });
  }, [isJunior]);
  if (isJunior) return null;

  return (
    <>
      <TopBar title="Чат" back={false} />
      <Page>
        <Empty>Здесь будет чат с банком: вопросы, спорные операции, утеря карты</Empty>
        <DemoNote>Вкладка из каркаса Moby. В прототипе не реализована.</DemoNote>
      </Page>
    </>
  );
}
