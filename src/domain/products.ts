/**
 * Витрина продуктов пакета. Условия — ДОПУЩЕНИЯ для прототипа, не тарифы МТБанка.
 */
import type { AgeGroup } from './age';
import type { CapabilityId } from './capabilities';

export interface ProductDef {
  id: string;
  title: string;
  kind: 'card' | 'savings' | 'insurance' | 'subscription' | 'content';
  short: string;
  /** Условия как допущения, показываем с пометкой. */
  terms: string[];
  forGroups: AgeGroup[];
  /** Какая возможность ребёнка нужна, чтобы пользоваться продуктом сам. */
  capability: CapabilityId | null;
  /** Кто оформляет: ребёнок может только запросить. */
  issuedBy: 'parent';
  legalNote?: string;
}

export const PACKAGE = {
  id: 'family-start' as const,
  title: 'Семейный пакет',
  tagline: 'Карта ребёнку, родительский контроль и уроки о деньгах',
  terms: [
    'Обслуживание пакета: 0 BYN первые 6 месяцев, далее 3 BYN в месяц (допущение)',
    'До 3 детских карт в пакете',
    'Кешбэк баллами 1% в семейных категориях у партнёров (допущение)',
    'Баллы копятся отдельно у ребёнка и у родителя',
  ],
};

export const PRODUCTS: ProductDef[] = [
  {
    id: 'kid-card',
    title: 'Детская карта',
    kind: 'card',
    short: 'Физическая или цифровая карта на имя ребёнка',
    terms: ['Выпуск и обслуживание — в рамках пакета (допущение)', 'Цифровая карта — сразу, пластик — доставка'],
    forGroups: ['junior', 'teen'],
    capability: 'card.pay.offline',
    issuedBy: 'parent',
    legalNote: 'Карта к счёту родителя для 7–13 или к счёту ребёнка для 14–17 — схему согласовать с юристами банка.',
  },
  {
    id: 'goal',
    title: 'Копилка с целью',
    kind: 'savings',
    short: 'Откладывай на мечту и смотри прогресс',
    terms: ['Без процентов, деньги доступны в любой момент'],
    forGroups: ['junior', 'teen'],
    capability: 'savings.goal',
    issuedBy: 'parent',
  },
  {
    id: 'teen-deposit',
    title: 'Накопительный счёт',
    kind: 'savings',
    short: 'Долгосрочные накопления с процентом',
    terms: ['Ставка — по тарифам банка на дату открытия (не указываем)'],
    forGroups: ['teen'],
    capability: 'savings.deposit',
    issuedBy: 'parent',
    legalNote: 'Самостоятельное распоряжение вкладом с 14 лет — проверить условия договора.',
  },
  {
    id: 'kid-insurance',
    title: 'Страхование ребёнка',
    kind: 'insurance',
    short: 'Несчастный случай, спорт, поездки',
    terms: ['Через страхового партнёра; стоимость — допущение для экономики'],
    forGroups: ['junior', 'teen'],
    capability: null,
    issuedBy: 'parent',
  },
  {
    id: 'edu-subscription',
    title: 'Подписка на обучение',
    kind: 'subscription',
    short: 'Курсы финграмотности и программирования у партнёров',
    terms: ['Партнёры и цены — допущение'],
    forGroups: ['junior', 'teen'],
    capability: 'partners.offers',
    issuedBy: 'parent',
  },
];

export function productsFor(group: AgeGroup): ProductDef[] {
  return PRODUCTS.filter((p) => p.forGroups.includes(group));
}
