import type { AgeGroup } from './age';

/**
 * Каталог возможностей ребёнка — единая точка, где закреплено «что можно в каком возрасте».
 * UI не решает сам, что показывать: он спрашивает policy.ts, а policy — этот каталог
 * и настройки родителя. Добавляя функцию, сначала добавьте её сюда.
 *
 * Для каждой возрастной группы задано:
 *  - ceiling: максимум, который родитель может разрешить ('none' — недоступно в этом возрасте);
 *  - default: значение при выпуске пакета.
 * Уровни: 'off' < 'approval' (каждое действие подтверждает родитель) < 'on'.
 *
 * Личный вход ребёнка в Moby — не возможность, а отдельный жизненный цикл
 * с согласием родителя: см. MobyAccess в types.ts.
 */
export type CapabilityId =
  | 'card.pay.offline'
  | 'card.pay.online'
  | 'card.cash'
  | 'transfer.p2p'
  | 'savings.goal'
  | 'savings.deposit'
  | 'products.request'
  | 'partners.offers'
  | 'points.spend';

export type Level = 'off' | 'approval' | 'on';
export type Ceiling = Level | 'none';

export interface CapabilityDef {
  id: CapabilityId;
  title: string;
  /** Описание для родителя («вы»). */
  parentHint: string;
  /** Описание для ребёнка («ты»). */
  childHint: string;
  group: 'access' | 'payments' | 'savings' | 'extras';
  rules: Record<AgeGroup, { ceiling: Ceiling; default: Level }>;
  /** Место, где нужна юридическая проверка. Показывается в документации/жюри. */
  legalNote?: string;
}

export const LEVEL_ORDER: Record<Level, number> = { off: 0, approval: 1, on: 2 };

export const CAPABILITIES: Record<CapabilityId, CapabilityDef> = {
  'card.pay.offline': {
    id: 'card.pay.offline',
    title: 'Оплата в магазинах',
    parentHint: 'Оплата картой или телефоном на кассе',
    childHint: 'Платить картой на кассе',
    group: 'payments',
    rules: { junior: { ceiling: 'on', default: 'on' }, teen: { ceiling: 'on', default: 'on' } },
  },
  'card.pay.online': {
    id: 'card.pay.online',
    title: 'Покупки в интернете',
    parentHint: 'Оплата на сайтах и в приложениях',
    childHint: 'Покупать в интернете',
    group: 'payments',
    rules: { junior: { ceiling: 'approval', default: 'approval' }, teen: { ceiling: 'on', default: 'approval' } },
    legalNote: 'Для 7–13 лет онлайн-покупки ограничены подтверждением родителя: рамки «мелких бытовых сделок».',
  },
  'card.cash': {
    id: 'card.cash',
    title: 'Снятие наличных',
    parentHint: 'Снятие в банкоматах',
    childHint: 'Снимать наличные',
    group: 'payments',
    rules: { junior: { ceiling: 'off', default: 'off' }, teen: { ceiling: 'on', default: 'off' } },
  },
  'transfer.p2p': {
    id: 'transfer.p2p',
    title: 'Переводы друзьям',
    parentHint: 'Переводы по номеру телефона',
    childHint: 'Переводить друзьям',
    group: 'payments',
    rules: { junior: { ceiling: 'approval', default: 'approval' }, teen: { ceiling: 'on', default: 'on' } },
  },
  'savings.goal': {
    id: 'savings.goal',
    title: 'Копилка с целью',
    parentHint: 'Ребёнок откладывает на цель внутри своего счёта',
    childHint: 'Копить на мечту',
    group: 'savings',
    rules: { junior: { ceiling: 'on', default: 'on' }, teen: { ceiling: 'on', default: 'on' } },
  },
  'savings.deposit': {
    id: 'savings.deposit',
    title: 'МТБелки',
    parentHint: 'Долгосрочный вклад «МТБелки» на имя ребёнка',
    childHint: 'Свой вклад «МТБелки»',
    group: 'savings',
    rules: { junior: { ceiling: 'none', default: 'off' }, teen: { ceiling: 'approval', default: 'off' } },
    legalNote: 'С 14 лет — вклад на своё имя (ГК РБ, ст. 25). До 14 — вклад оформляет родитель на имя ребёнка вне детского доступа.',
  },
  'products.request': {
    id: 'products.request',
    title: 'Запросы новых продуктов',
    parentHint: 'Ребёнок может попросить вас оформить продукт',
    childHint: 'Просить новые продукты',
    group: 'extras',
    rules: { junior: { ceiling: 'on', default: 'on' }, teen: { ceiling: 'on', default: 'on' } },
  },
  'partners.offers': {
    id: 'partners.offers',
    title: 'Предложения партнёров',
    parentHint: 'Скидки и акции партнёров в приложении ребёнка',
    childHint: 'Скидки от партнёров',
    group: 'extras',
    rules: { junior: { ceiling: 'on', default: 'off' }, teen: { ceiling: 'on', default: 'on' } },
    legalNote: 'Таргетированная реклама детям и профилирование по данным ребёнка — проверить на соответствие закону о защите ПД и о рекламе.',
  },
  'points.spend': {
    id: 'points.spend',
    title: 'Трата Маничек',
    parentHint: 'Ребёнок сам обменивает свои Манички на награды',
    childHint: 'Менять Манички на награды',
    group: 'extras',
    rules: { junior: { ceiling: 'approval', default: 'approval' }, teen: { ceiling: 'on', default: 'on' } },
    // UI обмена Маничек ещё не реализован — возможность заложена в модель прав.
  },
};

export const CAPABILITY_LIST = Object.values(CAPABILITIES);

export function defaultLevels(group: AgeGroup): Record<CapabilityId, Level> {
  const out = {} as Record<CapabilityId, Level>;
  for (const c of CAPABILITY_LIST) out[c.id] = c.rules[group].default;
  return out;
}

/** Обрезает уровень по потолку возрастной группы. */
export function clampLevel(level: Level, ceiling: Ceiling): Level {
  if (ceiling === 'none') return 'off';
  return LEVEL_ORDER[level] > LEVEL_ORDER[ceiling] ? ceiling : level;
}
