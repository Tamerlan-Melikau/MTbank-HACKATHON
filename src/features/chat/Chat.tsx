import { DemoNote, Empty, Page, TopBar } from '@/ui/kit';

/** Заглушка вкладки «Чат»: в Moby это чат с банком. Семейный чат — кандидат на развитие. */
export function Chat() {
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
