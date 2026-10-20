/** Информация о детской карте: тип, номер, статус, держатель и счёт. */
import { api } from '@/api';
import { useQuery } from '@/app/data';
import type { CardStatus } from '@/domain';
import { Card, DemoNote, Empty, Row, Screen, Section } from '@/ui/kit';
import { Load } from '../shared';

const STATUS_LABEL: Record<CardStatus, string> = {
  active: 'Активна',
  blocked: 'Заблокирована родителем',
  lost: 'Утеряна',
};

export function CardInfo() {
  const q = useQuery(async () => {
    const me = await api.me();
    return api.childOverview(me.id);
  }, []);

  return (
    <Screen title="Детская карта" back="/products">
      <Load q={q}>
        {(o) => (
          <>
            {o.card ? (
              <>
                <Card>
                  <div className="ui-stack ui-stack--tight">
                    <span className="t-caption muted">Детская карта</span>
                    <span className="t-heading">{o.card.form === 'physical' ? 'Пластиковая карта' : 'Цифровая карта'}</span>
                    <span className="t-display" style={{ letterSpacing: '0.06em' }}>
                      •••• •••• •••• {o.card.last4}
                    </span>
                    <span className="t-caption muted">{STATUS_LABEL[o.card.status]}</span>
                  </div>
                </Card>

                <Section title="Информация">
                  <Card flush>
                    <Row icon="card" title="Номер карты" subtitle={`•••• •••• •••• ${o.card.last4}`} />
                    <Row icon="card" title="Тип карты" subtitle={o.card.form === 'physical' ? 'Пластиковая' : 'Цифровая'} />
                    <Row icon="check" title="Статус" subtitle={STATUS_LABEL[o.card.status]} />
                    <Row icon="user" title="Держатель" subtitle={`${o.member.firstName} ${o.member.lastName}`} />
                    <Row icon="pay" title="Счёт" subtitle={o.account.title} />
                  </Card>
                </Section>
              </>
            ) : (
              <Empty>Карта ещё не выпущена</Empty>
            )}
          </>
        )}
      </Load>
      <DemoNote>Номер карты скрыт. Полные реквизиты и срок действия в прототипе не показываются.</DemoNote>
    </Screen>
  );
}
