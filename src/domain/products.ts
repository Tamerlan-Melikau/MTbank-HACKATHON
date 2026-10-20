/**
 * Витрина продуктов пакета. Условия — ДОПУЩЕНИЯ для прототипа, не тарифы МТБанка.
 */
import type { AgeGroup } from './age';
import { byn, minor, type Money } from './money';
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
  /** Возрастные группы, которые могут сами попросить продукт. По умолчанию — все forGroups. */
  requestableBy?: AgeGroup[];
  legalNote?: string;
}

export const PACKAGE = {
  id: 'family-start' as const,
  title: 'Семейный пакет',
  tagline: 'Карта ребёнку, родительский контроль и уроки о деньгах',
  terms: [
    'Обслуживание пакета: 5 BYN в месяц (допущение)',
    'Для многодетных семей (3 и более детей в пакете) — бесплатно',
    'Кешбэк баллами 1% в семейных категориях у партнёров (допущение)',
    'Баллы копятся отдельно у ребёнка и у родителя',
  ],
};

/** Стоимость обслуживания пакета (допущение прототипа). */
export const PACKAGE_PRICING = { monthly: byn(5), freeMonths: 0 };

export function packageDiscountPercent(children: number): number {
  return children >= 3 ? 100 : 0;
}

export function packageMonthlyPrice(children: number): Money {
  return minor(Math.round((PACKAGE_PRICING.monthly.minor * (100 - packageDiscountPercent(children))) / 100));
}

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
    forGroups: ['junior', 'teen'],
    capability: 'savings.deposit',
    issuedBy: 'parent',
    requestableBy: ['teen'],
    legalNote: 'До 14 лет накопительный счёт открывает родитель на имя ребёнка; с 14 лет — сам ребёнок с согласия родителя.',
  },
];

export function productsFor(group: AgeGroup): ProductDef[] {
  return PRODUCTS.filter((p) => p.forGroups.includes(group));
}
