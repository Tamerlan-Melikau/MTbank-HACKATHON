/**
 * Вход. В демо — выбор персонажа; в бою здесь будет вход Moby (телефон + код/биометрия).
 * Ребёнок подключается к родителю одноразовым кодом из профиля.
 */
import { useState } from 'react';
import { api, ApiError, type Persona } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { toast } from '@/app/toast';
import { Button, Card, DemoNote, Field, Hero, Locked, Page, Row, Section } from '@/ui/kit';
import { Load } from '../shared';

type View = { kind: 'list' } | { kind: 'no-access'; persona: Persona; status: string } | { kind: 'waiting'; name: string };

const STATUS_TEXT: Record<string, string> = {
  none: 'Получи у родителя одноразовый код и введи его ниже.',
  invited: 'Введи одноразовый код, который выдал родитель.',
  pending_confirm: 'Родитель проверяет доступ. Попробуй войти чуть позже.',
  suspended: 'Родитель временно закрыл вход.',
};

export function Welcome() {
  const q = useQuery(() => api.personas(), []);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [code, setCode] = useState('');
  const [signIn, signing] = useAction(async (p: Persona) => {
    try {
      await api.signIn(p.memberId);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NO_MOBY_ACCESS') setView({ kind: 'no-access', persona: p, status: e.message });
      else throw e;
    }
  });
  const [redeem, redeeming] = useAction(async () => {
    const r = await api.redeemInvite(code);
    setCode('');
    setView({ kind: 'waiting', name: r.firstName });
    toast('Код принят — ждём подтверждения родителя');
  });
  const [reset] = useAction(async () => {
    await api.resetDemo();
    toast('Демо-данные сброшены');
  });

  return (
    <Page>
      <Hero tag="Moby · МТБанк" title="Семейный кошелёк" text="Детям — деньги, родителям — спокойствие. Одно решение для всей семьи." />

      {view.kind === 'list' && (
        <Section title="Войти как">
          <Load q={q}>
            {(personas) => (
              <Card flush>
                {personas.map((p) => (
                  <Row key={p.memberId} icon={p.role === 'parent' ? 'family' : 'user'} title={p.title} subtitle={p.subtitle} onClick={() => !signing && signIn(p)} chevron />
                ))}
              </Card>
            )}
          </Load>
        </Section>
      )}

      {view.kind === 'no-access' && (
        <Section title={`Привет, ${view.persona.title}`}>
          <Locked title="Вход пока закрыт" text={STATUS_TEXT[view.status] ?? 'Нужен одноразовый код от родителя.'} />
          <Button variant="ghost" block onClick={() => setView({ kind: 'list' })}>
            Назад
          </Button>
        </Section>
      )}

      {view.kind === 'waiting' && (
        <Section title={`Код принят, ${view.name}`}>
          <Locked title="Ждём подтверждения родителя" text="Родитель увидит запрос в профиле ребёнка. После подтверждения доступ в Moby откроется." />
          <Button variant="ghost" block onClick={() => setView({ kind: 'list' })}>
            К входу
          </Button>
        </Section>
      )}

      {view.kind !== 'waiting' && (
        <Section title="Подключиться к родителю по коду">
          <Field
            label="Одноразовый код"
            value={code}
            onChange={setCode}
            inputMode="numeric"
            hint="Шесть цифр. Код действует до первого ввода, после чего доступ подтверждает родитель."
          />
          <Button block disabled={code.trim().length !== 6 || redeeming} onClick={() => redeem()}>
            Подключиться
          </Button>
        </Section>
      )}

      <DemoNote>
        Прототип: данные хранятся только в этом браузере. Откройте две вкладки — в одной войдите родителем, в другой ребёнком: изменения видны сразу.{' '}
        <button className="ui-btn ui-btn--ghost ui-btn--small" onClick={() => reset()}>
          Сбросить демо
        </button>
      </DemoNote>
    </Page>
  );
}
