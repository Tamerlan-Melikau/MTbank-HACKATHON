/** Вкладка «Продукты»: родитель видит пакет и что оформлено детям, ребёнок — свои продукты с замками. */
import { api } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { navigate } from '@/app/router';
import { toast } from '@/app/toast';
import { AGE_GROUPS, PACKAGE, productsFor, PRODUCTS, type ProductDef } from '@/domain';
import { Card, DemoNote, Locked, Page, PromoBanner, Row, Section, TopBar } from '@/ui/kit';
import { Load } from '../shared';
import type { IconName } from '@/ui/icons';

const KIND_ICON: Record<ProductDef['kind'], IconName> = {
  card: 'card',
  savings: 'piggy',
  insurance: 'shield',
  subscription: 'book',
  content: 'book',
};

export function ParentProducts() {
  const q = useQuery(() => api.familyView(), []);
  return (
    <>
      <TopBar title="Продукты" back={false} />
      <Page>
        <PromoBanner tone="brand" title={PACKAGE.title} text={PACKAGE.tagline} action="Добавить ребёнка" onClick={() => navigate('/enroll')} />
        <Section title="Условия">
          <Card>
            <ul className="t-body" style={{ margin: 0, paddingLeft: 20 }}>
              {PACKAGE.terms.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Card>
        </Section>
        <Load q={q}>
          {(f) => (
            <>
              {f.children.map((c) => (
                <Section key={c.member.id} title={`${c.member.firstName}, ${AGE_GROUPS[c.ageGroup].label}`}>
                  <Card flush>
                    {productsFor(c.ageGroup).map((p) => (
                      <Row key={p.id} icon={KIND_ICON[p.kind]} title={p.title} subtitle={p.short} to={`/child/${c.member.id}/permissions`} chevron />
                    ))}
                  </Card>
                </Section>
              ))}
            </>
          )}
        </Load>
        <DemoNote>Условия и партнёры — допущения прототипа, требуют согласования с банком.</DemoNote>
      </Page>
    </>
  );
}

export function ChildProducts() {
  const q = useQuery(async () => {
    const me = await api.me();
    const [o, requests] = await Promise.all([api.childOverview(me.id), api.requests({ status: 'pending' })]);
    return { o, requested: new Set(requests.flatMap((r) => (r.payload.type === 'product' ? [r.payload.productId] : []))) };
  }, []);
  const [ask, asking] = useAction(async (productId: string) => {
    await api.createRequest({ type: 'product', productId });
    toast('Запрос отправлен родителю');
  });

  return (
    <>
      <TopBar title="Мои продукты" back={false} />
      <Page>
        <Load q={q}>
          {({ o, requested }) => {
            const mine = PRODUCTS.filter((p) => p.forGroups.includes(o.settings.ageGroup));
            const notYet = PRODUCTS.filter((p) => !p.forGroups.includes(o.settings.ageGroup));
            const canAsk = o.access['products.request'].kind !== 'denied';
            const isOpen = (p: ProductDef) => (p.id === 'kid-card' ? !!o.card : p.id === 'teen-deposit' ? !!o.deposit : p.capability ? o.access[p.capability].kind !== 'denied' : false);
            return (
              <>
                <Section title="Доступно">
                  <Card flush>
                    {mine.filter(isOpen).map((p) => (
                      <Row key={p.id} icon={KIND_ICON[p.kind]} title={p.title} subtitle={p.short} to={p.id === 'goal' ? '/goals' : undefined} chevron={p.id === 'goal'} />
                    ))}
                  </Card>
                </Section>
                {mine.filter((p) => !isOpen(p)).length > 0 && (
                  <Section title="Можно попросить">
                    {mine
                      .filter((p) => !isOpen(p))
                      .map((p) => (
                        <Locked
                          key={p.id}
                          title={p.title}
                          text={requested.has(p.id) ? 'Запрос уже у родителя' : canAsk ? p.short : 'Запросы выключены родителем'}
                          action={!requested.has(p.id) && canAsk ? { label: 'Запросить у родителя', onClick: () => ask(p.id), disabled: asking } : undefined}
                        />
                      ))}
                  </Section>
                )}
                {notYet.length > 0 && (
                  <Section title="Откроется позже">
                    <Card flush>
                      {notYet.map((p) => (
                        <Row key={p.id} icon="lock" iconTone="muted" title={p.title} subtitle="С 14 лет" />
                      ))}
                    </Card>
                  </Section>
                )}
              </>
            );
          }}
        </Load>
      </Page>
    </>
  );
}
