/** Экран родителя «Ребёнок»: баланс, карта, доступ в Moby, лимиты, права, прогресс. */
import { useState } from 'react';
import { api, type ChildOverview } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { navigate } from '@/app/router';
import { toast } from '@/app/toast';
import { AGE_GROUPS, CAPABILITY_LIST, formatMoney, goalsReserved, levelOf, savingsAvailable, savingsTotal } from '@/domain';
import { Amount, Button, ButtonRow, Card, Locked, QuickActions, Row, Screen, Section, Switch } from '@/ui/kit';
import { Load, TxList } from '../shared';
import { AllocationGate } from '../allocation/Allocation';

export function ChildManage({ id }: { id: string }) {
  const q = useQuery(async () => {
    const [o, txs] = await Promise.all([api.childOverview(id), api.transactions(id, { limit: 5 })]);
    return { o, txs };
  }, [id]);

  return (
    <Load q={q} skeleton={4}>
      {({ o, txs }) => (
        <>
        <Screen title={o.member.firstName} back="/">
          <Card>
            <div className="ui-stack ui-stack--tight">
              <span className="t-caption muted">
                {o.age} лет · {AGE_GROUPS[o.settings.ageGroup].label} · {o.account.title}
              </span>
              <span className="t-display ui-amount">{formatMoney(o.account.balance)}</span>
              <span className="t-caption muted">
                Сегодня потрачено {formatMoney(o.spentToday)}
                {o.settings.limits.daily ? ` из ${formatMoney(o.settings.limits.daily)}` : ''}
              </span>
            </div>
          </Card>

          <QuickActions
            actions={[
              { icon: 'topup-family', label: 'Пополнить', onClick: () => navigate(`/child/${id}/topup`) },
              { icon: 'limit', label: 'Лимиты', onClick: () => navigate(`/child/${id}/limits`) },
              { icon: 'shield', label: 'Права', onClick: () => navigate(`/child/${id}/permissions`) },
              { icon: 'task', label: 'Задания', onClick: () => navigate(`/tasks?child=${id}`) },
            ]}
          />

          {o.pendingRequests.length > 0 && (
            <Card flush>
              <Row icon="ask" iconTone="accent" title={`Запросы: ${o.pendingRequests.length}`} subtitle="Ждут вашего ответа" to="/requests" chevron />
            </Card>
          )}

          <MobyAccessBlock o={o} />
          <CardBlock o={o} />
          <DepositBlock o={o} />

          {o.settings.ageGroup === 'junior' && (
            <Section title="Копилки" end={<a className="t-label" style={{ color: 'var(--brand)', padding: '12px 0' }} href={`#/child/${id}/goals`}>Управлять</a>}>
              <Card flush>
                {o.goals.length === 0 ? (
                  <Row
                    icon="piggy"
                    title="Копилок пока нет"
                    subtitle={o.deposit ? 'Создать цель и откладывать с накопительного счёта' : 'Сначала откройте накопительный счёт'}
                    to={`/child/${id}/goals`}
                    chevron
                  />
                ) : (
                  o.goals.map((g) => (
                    <Row
                      key={g.id}
                      icon="piggy"
                      title={g.title}
                      subtitle={`${formatMoney(g.balance)} из ${formatMoney(g.target)}`}
                      end={g.reachedAt ? <span className="t-label positive">Цель есть</span> : undefined}
                      to={`/child/${id}/goals`}
                      chevron
                    />
                  ))
                )}
              </Card>
            </Section>
          )}

          <Section title="Настройки">
            <Card flush>
              <Row
                icon="topup"
                title="Карманные деньги"
                subtitle={o.allowance ? `${formatMoney(o.allowance.amount)} 1-го числа` : 'Не настроены'}
                to={`/child/${id}/allowance`}
                chevron
              />
              <Row
                icon="shield"
                title="Права и запреты"
                subtitle={`Включено ${CAPABILITY_LIST.filter((c) => o.access[c.id].kind !== 'denied').length} из ${CAPABILITY_LIST.length} · запрещённых категорий ${o.settings.blockedCategories.length}`}
                to={`/child/${id}/permissions`}
                chevron
              />
              <Row icon="bell" title="Уведомлять о каждой операции" end={<NotifySwitch o={o} />} />
            </Card>
          </Section>

          <Section title="Прогресс">
            <Card flush>
              <Row icon="star" iconTone="accent" title={`Уровень ${levelOf(o.points).level}: ${levelOf(o.points).title}`} subtitle={`${o.points} баллов`} />
              {o.settings.ageGroup !== 'junior' &&
                o.goals.map((g) => (
                  <Row key={g.id} icon="piggy" title={g.title} subtitle={`${formatMoney(g.balance)} из ${formatMoney(g.target)}`} end={g.reachedAt ? <span className="t-label positive">Цель есть</span> : undefined} />
                ))}
            </Card>
          </Section>

          <Section title="Операции" end={<a className="t-label" style={{ color: 'var(--brand)', padding: '12px 0' }} href={`#/child/${id}/history`}>Все</a>}>
            <TxList items={txs} role="parent" />
          </Section>

          <DeleteChildBlock id={id} name={o.member.firstName} />
        </Screen>
        {o.settings.ageGroup === 'junior' && o.pendingAllocation && (
          <AllocationGate allocation={o.pendingAllocation} onClose={() => q.reload()} />
        )}
        </>
      )}
    </Load>
  );
}

function DepositBlock({ o }: { o: ChildOverview }) {
  const [open, busy] = useAction(async () => {
    await api.openDeposit(o.member.id);
    toast('Накопительный счёт открыт');
  });
  return (
    <Section title="Накопительный счёт">
      {o.deposit ? (
        <Card flush>
          <Row
            icon="piggy"
            title={o.deposit.title}
            subtitle={
              o.goals.length > 0
                ? `Свободно ${formatMoney(savingsAvailable(o.deposit, o.goals))} · в копилках ${formatMoney(goalsReserved(o.goals))}`
                : 'Счёт на имя ребёнка'
            }
            end={<Amount value={savingsTotal(o.deposit)} sign="auto" />}
            to={`/child/${o.member.id}/deposit`}
            chevron
          />
        </Card>
      ) : (
        <Card>
          <div className="ui-stack">
            {o.settings.ageGroup !== 'junior' && (
              <div className="t-body muted">Можно открыть счёт сейчас или одобрить запрос подростка в разделе «Запросы».</div>
            )}
            <Button block variant="secondary" onClick={() => open()} disabled={busy}>
              Создать накопительный счёт
            </Button>
          </div>
        </Card>
      )}
    </Section>
  );
}

function NotifySwitch({ o }: { o: ChildOverview }) {
  const [set] = useAction((v: boolean) => api.setNotifyEveryOperation(o.member.id, v));
  return <Switch checked={o.settings.notifyParentOnEveryOperation} onChange={set} label="Уведомлять о каждой операции" />;
}

function DeleteChildBlock({ id, name }: { id: string; name: string }) {
  const [remove, busy] = useAction(async () => {
    const ok = window.confirm(
      `Удалить профиль ${name}? Карта, счёт, история операций, задания и прогресс будут удалены без возможности восстановления.`,
    );
    if (!ok) return;
    await api.deleteChild(id);
    toast('Профиль ребёнка удалён');
    navigate('/', { replace: true });
  });
  return (
    <Section title="Удаление профиля">
      <Card>
        <div className="ui-stack">
          <div className="t-body muted">Профиль ребёнка, его карта, счёт, история и прогресс будут удалены навсегда.</div>
          <Button block variant="danger" onClick={() => remove()} disabled={busy}>
            {busy ? 'Удаляем…' : 'Удалить ребёнка'}
          </Button>
        </div>
      </Card>
    </Section>
  );
}

function MobyAccessBlock({ o }: { o: ChildOverview }) {
  const id = o.member.id;
  const [code, setCode] = useState<string | null>(o.settings.inviteCode);
  const [invite, inviting] = useAction(async () => {
    const r = await api.inviteToMoby(id);
    setCode(r.code);
  });
  const [confirmAccess, confirming] = useAction(() => api.confirmMoby(id));
  const [suspend, suspending] = useAction((v: boolean) => api.setMobySuspended(id, v));
  const name = o.member.firstName;

  let body;
  switch (o.settings.moby) {
    case 'none':
      body = (
        <Locked
          title="Нет доступа в Moby"
          text={`${name} не может входить в приложение. Выдайте одноразовый код: ${name} введёт его на своём телефоне.`}
          action={{ label: 'Выдать код', onClick: () => invite(), disabled: inviting }}
        />
      );
      break;
    case 'invited':
      body = (
        <Card>
          <div className="ui-stack">
            <span className="t-body">Одноразовый код для подключения</span>
            <span className="t-display ui-amount" style={{ letterSpacing: 4 }}>{code ?? o.settings.inviteCode}</span>
            <span className="t-caption muted">Ребёнок вводит код на экране входа в разделе «Подключиться к родителю по коду». После первого ввода код исчезнет.</span>
          </div>
        </Card>
      );
      break;
    case 'pending_confirm':
      body = (
        <Card>
          <div className="ui-stack">
            <span className="t-heading">Код введён</span>
            <span className="t-body">
              {name} ждёт вашего подтверждения. После него ребёнок сможет войти в Moby и пользоваться доступными продуктами.
            </span>
            <Button block onClick={() => confirmAccess()} disabled={confirming}>
              Подтвердить доступ
            </Button>
          </div>
        </Card>
      );
      break;
    case 'active':
      body = (
        <Card flush>
          <Row icon="check" title="Доступ в Moby открыт" subtitle="Ребёнок входит со своего телефона" end={<Button small variant="secondary" onClick={() => suspend(true)} disabled={suspending}>Приостановить</Button>} />
        </Card>
      );
      break;
    case 'suspended':
      body = (
        <Card flush>
          <Row icon="lock" iconTone="muted" title="Доступ приостановлен" subtitle="Карта работает, вход в приложение закрыт" end={<Button small onClick={() => suspend(false)} disabled={suspending}>Вернуть</Button>} />
        </Card>
      );
      break;
  }
  return <Section title="Доступ в Moby">{body}</Section>;
}

function CardBlock({ o }: { o: ChildOverview }) {
  const card = o.card;
  const accountBlocked = o.account.status === 'blocked';
  const [setBlocked, busy] = useAction((v: boolean) => api.setCardBlocked(card!.id, v));
  const [setAccountBlocked] = useAction((v: boolean) => api.setAccountBlocked(o.account.id, v));
  const [lost, losing] = useAction(async () => {
    if (!window.confirm('Карта будет закрыта навсегда, взамен сразу выпустим цифровую. Продолжить?')) return;
    await api.reportCardLost(card!.id);
    toast(accountBlocked ? 'Старая карта закрыта, новая выпущена, но счёт заблокирован' : 'Старая карта закрыта, новая цифровая уже работает');
  });
  if (!card) return null;
  return (
    <Section title="Карта и счёт">
      <Card flush>
        <Row
          icon="card"
          title={`${card.form === 'physical' ? 'Пластиковая' : 'Цифровая'} •••• ${card.last4}`}
          subtitle={
            card.status === 'lost'
              ? 'Утеряна'
              : accountBlocked
                ? 'Заблокирована вместе со счётом'
                : card.status === 'blocked'
                  ? 'Заблокирована вами: платежи картой закрыты, переводы работают'
                  : 'Платежи картой работают'
          }
          end={
            accountBlocked
              ? <span className="t-label muted">Со счётом</span>
              : <Switch checked={card.status === 'active'} onChange={(on) => setBlocked(!on)} label="Карта активна" />
          }
        />
        <Row
          icon={accountBlocked ? 'lock' : 'pay'}
          title="Счёт"
          subtitle={
            accountBlocked
              ? 'Заблокирован вами: покупки и переводы недоступны'
              : 'Активен: покупки и переводы доступны'
          }
          end={<Switch checked={!accountBlocked} onChange={(on) => setAccountBlocked(!on)} label="Счёт активен" />}
        />
        <Row
          icon="limit"
          title="Лимиты"
          subtitle={[
            o.settings.limits.perTransaction && `покупка до ${formatMoney(o.settings.limits.perTransaction)}`,
            o.settings.limits.daily && `день ${formatMoney(o.settings.limits.daily)}`,
            o.settings.limits.monthly && `месяц ${formatMoney(o.settings.limits.monthly)}`,
          ]
            .filter(Boolean)
            .join(' · ') || 'Без лимитов'}
          to={`/child/${o.member.id}/limits`}
          chevron
        />
        <Row icon="pay" title="Потрачено в этом месяце" end={<Amount value={{ ...o.spentMonth, minor: -o.spentMonth.minor }} />} />
      </Card>
      <ButtonRow>
        <Button variant="danger" onClick={() => lost()} disabled={losing || busy}>
          Карта утеряна
        </Button>
      </ButtonRow>
    </Section>
  );
}
