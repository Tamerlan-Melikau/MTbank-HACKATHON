/**
 * Вход. В демо — выбор персонажа; в бою здесь будет вход Moby (телефон + код/биометрия).
 * Ребёнок без доступа видит «попроси родителя» — путь «доступ запрещён → запросить».
 */
import { useState } from 'react';
import { api, ApiError, type Persona } from '@/api';
import { useAction, useQuery } from '@/app/data';
import { toast } from '@/app/toast';
import { Button, Card, DemoNote, Field, Locked, Page, Row, Section } from '@/ui/kit';
import { Load } from '../shared';

type View = { kind: 'list' } | { kind: 'code' } | { kind: 'no-access'; persona: Persona; status: string };

const STATUS_TEXT: Record<string, string> = {
  none: 'Родитель ещё не открыл тебе вход в Moby.',
  invited: 'Родитель выдал код. Введи его, чтобы продолжить.',
  pending_confirm: 'Код принят. Ждём, когда родитель подтвердит вход в своём приложении.',
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
  const [ask, asking] = useAction(async (childId: string) => {
    await api.requestMobyAccess(childId);
    toast('Запрос отправлен родителю');
  });
  const [redeem, redeeming] = useAction(async () => {
    const r = await api.redeemInvite(code);
    toast(`${r.firstName}, код принят. Ждём подтверждения родителя`);
    setCode('');
    setView({ kind: 'list' });
  });
  const [reset] = useAction(async () => {
    await api.resetDemo();
    toast('Демо-данные сброшены');
  });

  return (
    <Page>
      <div style={{ paddingTop: 'calc(24px + env(safe-area-inset-top))' }} className="ui-stack">
        <h1 className="t-title" style={{ margin: 0 }}>Семейный кошелёк</h1>
        <p className="t-body muted" style={{ margin: 0 }}>Детско-семейный банкинг в Moby</p>
      </div>

      {view.kind === 'list' && (
        <>
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
          <Button variant="secondary" block icon="key" onClick={() => setView({ kind: 'code' })}>
            Войти по коду от родителя
          </Button>
          <DemoNote>
            Прототип: данные хранятся только в этом браузере. Откройте две вкладки — в одной войдите родителем, в другой ребёнком: изменения видны сразу.{' '}
            <button className="ui-btn ui-btn--ghost ui-btn--small" onClick={() => reset()}>
              Сбросить демо
            </button>
          </DemoNote>
        </>
      )}

      {view.kind === 'code' && (
        <Section title="Код от родителя">
          <Field label="Шесть цифр" value={code} onChange={setCode} inputMode="numeric" autoFocus hint="Код показан у родителя в разделе ребёнка" />
          <Button block disabled={code.trim().length !== 6 || redeeming} onClick={() => redeem()}>
            Продолжить
          </Button>
          <Button variant="ghost" block onClick={() => setView({ kind: 'list' })}>
            Назад
          </Button>
        </Section>
      )}

      {view.kind === 'no-access' && (
        <Section title={`Привет, ${view.persona.title}`}>
          <Locked
            title="Вход пока закрыт"
            text={STATUS_TEXT[view.status] ?? 'Нужно разрешение родителя.'}
            action={view.status === 'none' || view.status === 'suspended' ? { label: 'Попросить родителя', onClick: () => ask(view.persona.memberId), disabled: asking } : undefined}
          />
          {view.status === 'invited' && (
            <Button block onClick={() => setView({ kind: 'code' })}>
              Ввести код
            </Button>
          )}
          <Button variant="ghost" block onClick={() => setView({ kind: 'list' })}>
            Назад
          </Button>
        </Section>
      )}
    </Page>
  );
}
