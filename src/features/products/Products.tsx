/** Вкладка «Продукты»: родитель видит пакет и что оформлено детям, ребёнок — свои продукты с замками. */
import { useEffect } from 'react';
import { api } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { navigate } from '@/app/router';
import { toast } from '@/app/toast';
import { AGE_GROUPS, formatMoney, goalsReserved, PACKAGE, packageDiscountPercent, packageMonthlyPrice, PACKAGE_PRICING, PRODUCTS, savingsAvailable, savingsTotal, type ProductDef } from '@/domain';
import { Amount, Button, Card, Locked, Page, PromoBanner, Row, Section, TopBar } from '@/ui/kit';
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
  const q = useQuery(async () => {
    const f = await api.familyView();
    const details = await Promise.all(f.children.map((c) => api.childOverview(c.member.id)));
    return { f, details };
  }, []);
  return (
    <>
      <TopBar title="Продукты" back={false} />
      <Page>
        <PromoBanner tone="brand" title={PACKAGE.title} text={PACKAGE.tagline} action="Добавить ребёнка" onClick={() => navigate('/enroll')} />
        <Load q={q}>
          {({ f, details }) => (
            <>
              {f.children.map((c, i) => {
                const o = details[i]!;
                return (
                  <Section key={c.member.id} title={`${c.member.firstName}, ${AGE_GROUPS[c.ageGroup].label}`}>
                    <Card flush>
                      <Row
                        icon="card"
                        title="Основной счёт"
                        end={<Amount value={o.account.balance} sign="auto" />}
                        to={`/child/${c.member.id}`}
                        chevron
                      />
                      {o.deposit && (() => {
                        const reserved = goalsReserved(o.goals);
                        return (
                          <Row
                            icon="piggy"
                            title="МТБелки"
                            subtitle={
                              o.goals.length > 0
                                ? `Свободно ${formatMoney(savingsAvailable(o.deposit, o.goals))} · в копилках ${formatMoney(reserved)}`
                                : 'Счёт на имя ребёнка'
                            }
                            end={<Amount value={savingsTotal(o.deposit)} sign="auto" />}
                            to={`/child/${c.member.id}/deposit`}
                            chevron
                          />
                        );
                      })()}
                      {o.goals.map((g) => (
                        <Row
                          key={g.id}
                          icon="piggy"
                          title={g.title}
                          subtitle={`Копилка · цель ${formatMoney(g.target)}`}
                          end={<Amount value={g.balance} sign="auto" />}
                          to={c.ageGroup === 'junior' ? `/child/${c.member.id}/goals` : `/child/${c.member.id}`}
                          chevron
                        />
                      ))}
                      <InsuranceRow childId={c.member.id} active={!!o.insurance} onChanged={() => q.reload()} />
                    </Card>
                  </Section>
                );
              })}
              <Section title="Обслуживание пакета">
                <Card>
                  <div className="ui-stack ui-stack--tight">
                    <div className="ui-between">
                      <span className="t-body">Детей в пакете</span>
                      <span className="t-body">{f.children.length}</span>
                    </div>
                    <div className="ui-between">
                      <span className="t-body muted">Стоимость обслуживания</span>
                      <span className="t-body">{formatMoney(PACKAGE_PRICING.monthly)} / мес</span>
                    </div>
                    <div className="ui-between">
                      <span className="t-body">Ваша цена</span>
                      <span className="t-heading">
                        {packageMonthlyPrice(f.children.length).minor === 0 ? 'Бесплатно' : `${formatMoney(packageMonthlyPrice(f.children.length))} / мес`}
                      </span>
                    </div>
                    <span className={packageDiscountPercent(f.children.length) === 100 ? 't-caption positive' : 't-caption muted'}>
                      {packageDiscountPercent(f.children.length) === 100
                        ? 'Многодетная семья — обслуживание бесплатно'
                        : 'Для многодетных семей (3+ детей) — бесплатно'}
                    </span>
                  </div>
                </Card>
              </Section>
            </>
          )}
        </Load>
      </Page>
    </>
  );
}

function InsuranceRow({ childId, active, onChanged }: { childId: string; active: boolean; onChanged: () => void }) {
  const [toggle, busy] = useAction(async () => {
    await api.setChildInsurance(childId, !active);
    toast(active ? 'Страхование отключено' : 'Страхование оформлено');
    onChanged();
  });
  return (
    <Row
      icon="shield"
      title="Страхование ребёнка"
      subtitle={active ? 'Оформлено · управляется родителем' : 'Не оформлено · условия — допущение'}
      end={
        <Button small variant={active ? 'secondary' : 'primary'} onClick={() => toggle()} disabled={busy}>
          {busy ? 'Сохраняем…' : active ? 'Отключить' : 'Оформить'}
        </Button>
      }
    />
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
  const junior = q.data?.o.settings.ageGroup === 'junior';
  useEffect(() => {
    if (junior) navigate('/', { replace: true });
  }, [junior]);
  if (junior) return null;

  return (
    <>
      <TopBar title="Мои продукты" back={false} />
      <Page>
        <Load q={q}>
          {({ o, requested }) => {
            const mine = PRODUCTS.filter(
              (p) => p.forGroups.includes(o.settings.ageGroup) && !(p.id === 'teen-deposit' && o.settings.ageGroup === 'junior'),
            );
            const canAsk = o.access['products.request'].kind !== 'denied';
            const selfRequest = (p: ProductDef) => !p.requestableBy || p.requestableBy.includes(o.settings.ageGroup);
            const isOpen = (p: ProductDef) => (p.id === 'kid-card' ? !!o.card : p.id === 'teen-deposit' ? !!o.deposit : p.capability ? o.access[p.capability].kind !== 'denied' : false);
            const askable = mine.filter((p) => !isOpen(p) && selfRequest(p));
            return (
              <>
                <Section title="Доступно">
                  <Card flush>
                    {mine.filter(isOpen).map((p) => (
                      <Row key={p.id} icon={KIND_ICON[p.kind]} title={p.title} subtitle={p.short} to={p.id === 'kid-card' ? '/card' : p.id === 'teen-deposit' ? '/deposit' : p.id === 'goal' ? '/goals' : undefined} chevron={p.id === 'kid-card' || p.id === 'teen-deposit' || p.id === 'goal'} />
                    ))}
                  </Card>
                </Section>
                {askable.length > 0 && (
                  <Section title="Можно попросить">
                    {askable.map((p) => (
                      <Locked
                        key={p.id}
                        title={p.title}
                        text={requested.has(p.id) ? 'Запрос уже у родителя' : canAsk ? p.short : 'Запросы выключены родителем'}
                        action={!requested.has(p.id) && canAsk ? { label: 'Запросить у родителя', onClick: () => ask(p.id), disabled: asking } : undefined}
                      />
                    ))}
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
