/**
 * Оформление пакета родителем: условия → ребёнок → карта → согласия → готово.
 * Возрастная группа вычисляется из даты рождения и сразу показывает, что войдёт в пакет.
 */
import { useState } from 'react';
import { api } from '@/api';
import { useAction } from '@/app/data';
import { navigate } from '@/app/router';
import {
  AGE_GROUPS,
  ageAt,
  ageGroupOf,
  CAPABILITY_LIST,
  capabilityAccess,
  defaultLevels,
  PACKAGE,
  productsFor,
  type CardForm,
  type ConsentType,
} from '@/domain';
import { Button, Card, Checkbox, DemoNote, Field, Row, Screen, Section, Segmented } from '@/ui/kit';

type Step = 'about' | 'child' | 'card' | 'consents' | 'done';
const STEPS: Step[] = ['about', 'child', 'card', 'consents', 'done'];

const CONSENTS: { type: ConsentType; text: string; required: boolean }[] = [
  { type: 'package-offer', text: 'Принимаю условия семейного пакета', required: true },
  { type: 'child-card', text: 'Согласен на выпуск карты на имя ребёнка как его законный представитель', required: true },
  { type: 'child-pd', text: 'Согласен на обработку персональных данных ребёнка для обслуживания', required: true },
];

export function Enroll() {
  const [step, setStep] = useState<Step>('about');
  const [child, setChild] = useState({ firstName: '', lastName: '', birthDate: '' });
  const [cardForm, setCardForm] = useState<CardForm>('digital');
  const [consents, setConsents] = useState<ConsentType[]>([]);
  const [childId, setChildId] = useState<string | null>(null);
  const now = new Date();
  const group = child.birthDate ? ageGroupOf(child.birthDate, now) : null;
  const age = child.birthDate ? ageAt(child.birthDate, now) : null;

  const [submit, busy] = useAction(async () => {
    const r = await api.enroll({ child, cardForm, consents });
    setChildId(r.childId);
    setStep('done');
  });

  const idx = STEPS.indexOf(step);
  const title = step === 'done' ? 'Готово' : `Семейный пакет · ${idx + 1} из 4`;

  return (
    <Screen title={title} back={step === 'done' ? false : '/'}>
      {step === 'about' && (
        <>
          <Card>
            <div className="ui-stack">
              <div className="t-heading">{PACKAGE.title}</div>
              <div className="t-body">{PACKAGE.tagline}</div>
              <ul className="t-body" style={{ margin: 0, paddingLeft: 20 }}>
                {PACKAGE.terms.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </Card>
          <DemoNote>Условия — допущения прототипа, не тарифы банка.</DemoNote>
          <Button block onClick={() => setStep('child')}>
            Оформить
          </Button>
        </>
      )}

      {step === 'child' && (
        <Section title="Ребёнок">
          <Field label="Имя" value={child.firstName} onChange={(v) => setChild({ ...child, firstName: v })} />
          <Field label="Фамилия" value={child.lastName} onChange={(v) => setChild({ ...child, lastName: v })} />
          <Field label="Дата рождения" type="date" value={child.birthDate} onChange={(v) => setChild({ ...child, birthDate: v })} />
          {child.birthDate && !group && <div className="t-body negative">Пакет оформляется для детей от 7 до 17 лет</div>}
          {group && (
            <Card>
              <div className="ui-stack ui-stack--tight">
                <div className="t-heading">
                  {age} лет · пакет {AGE_GROUPS[group].label}
                </div>
                <div className="t-caption muted">Что будет доступно сразу (настройки можно поменять):</div>
                <ul className="t-body" style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                  {CAPABILITY_LIST.filter((c) => capabilityAccess({ ageGroup: group, levels: defaultLevels(group) }, c.id).kind !== 'denied').map((c) => (
                    <li key={c.id}>
                      {c.title}
                      {capabilityAccess({ ageGroup: group, levels: defaultLevels(group) }, c.id).kind === 'approval' ? ' — с вашим подтверждением' : ''}
                    </li>
                  ))}
                </ul>
                <div className="t-caption muted">Продукты: {productsFor(group).map((p) => p.title).join(', ')}</div>
              </div>
            </Card>
          )}
          <Button block disabled={!child.firstName.trim() || !group} onClick={() => setStep('card')}>
            Далее
          </Button>
        </Section>
      )}

      {step === 'card' && (
        <Section title="Карта">
          <Segmented
            label="Тип карты"
            value={cardForm}
            onChange={setCardForm}
            options={[
              { value: 'digital', label: 'Цифровая' },
              { value: 'physical', label: 'Пластиковая' },
            ]}
          />
          <p className="t-body muted" style={{ margin: 0 }}>
            {cardForm === 'digital' ? 'Работает сразу: оплата телефоном и в интернете.' : 'Цифровая работает сразу, пластик привезём позже (сроки — допущение).'}
          </p>
          <Button block onClick={() => setStep('consents')}>
            Далее
          </Button>
        </Section>
      )}

      {step === 'consents' && (
        <Section title="Согласия">
          {CONSENTS.map((c) => (
            <Checkbox key={c.type} checked={consents.includes(c.type)} onChange={(v) => setConsents(v ? [...consents, c.type] : consents.filter((x) => x !== c.type))}>
              {c.text}
            </Checkbox>
          ))}
          <DemoNote>Тексты согласий и их состав — требуют юридической проверки (ГК РБ, закон о защите персональных данных).</DemoNote>
          <Button block disabled={busy || CONSENTS.some((c) => c.required && !consents.includes(c.type))} onClick={() => submit()}>
            Выпустить карту
          </Button>
        </Section>
      )}

      {step === 'done' && childId && (
        <>
          <Card>
            <div className="ui-stack">
              <div className="t-heading">Карта для {child.firstName} выпущена</div>
              <div className="t-body muted">Осталось открыть ребёнку вход в Moby и проверить ограничения.</div>
            </div>
          </Card>
          <Card flush>
            <Row icon="key" title="Открыть доступ в Moby" subtitle="Выдать код для входа" to={`/child/${childId}`} chevron />
            <Row icon="shield" title="Проверить права" subtitle="Платежи, накопления, категории" to={`/child/${childId}/permissions`} chevron />
            <Row icon="topup" title="Настроить карманные" to={`/child/${childId}/topup`} chevron />
          </Card>
          <Button block variant="secondary" onClick={() => navigate('/', { replace: true })}>
            На главную
          </Button>
        </>
      )}
    </Screen>
  );
}
