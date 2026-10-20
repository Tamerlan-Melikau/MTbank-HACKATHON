/**
 * Категории торговых точек (упрощённо, вместо MCC-кодов).
 * hardBlocked — запрещены для любого ребёнка всегда, родитель НЕ может их разрешить
 * (азартные игры, 18+, алкоголь, табак). Это требование безопасности из ТЗ и,
 * вероятно, закона — ТРЕБУЕТ ЮРИДИЧЕСКОЙ ПРОВЕРКИ перечня.
 */
export type CategoryId =
  | 'food'
  | 'cafe'
  | 'transport'
  | 'education'
  | 'books'
  | 'entertainment'
  | 'games'
  | 'sport'
  | 'health'
  | 'clothes'
  | 'electronics'
  | 'subscriptions'
  | 'gambling'
  | 'adult'
  | 'alcohol'
  | 'tobacco';

export interface Category {
  id: CategoryId;
  title: string;
  hardBlocked: boolean;
  /** Семейная категория: участвует в кешбэке у партнёров (допущение). */
  family: boolean;
}

export const CATEGORIES: Record<CategoryId, Category> = {
  food: { id: 'food', title: 'Продукты', hardBlocked: false, family: true },
  cafe: { id: 'cafe', title: 'Кафе и фастфуд', hardBlocked: false, family: false },
  transport: { id: 'transport', title: 'Транспорт', hardBlocked: false, family: false },
  education: { id: 'education', title: 'Образование', hardBlocked: false, family: true },
  books: { id: 'books', title: 'Книги и канцтовары', hardBlocked: false, family: true },
  entertainment: { id: 'entertainment', title: 'Развлечения', hardBlocked: false, family: true },
  games: { id: 'games', title: 'Видеоигры и внутриигровые покупки', hardBlocked: false, family: false },
  sport: { id: 'sport', title: 'Спорт', hardBlocked: false, family: true },
  health: { id: 'health', title: 'Медицина', hardBlocked: false, family: true },
  clothes: { id: 'clothes', title: 'Одежда', hardBlocked: false, family: true },
  electronics: { id: 'electronics', title: 'Электроника', hardBlocked: false, family: false },
  subscriptions: { id: 'subscriptions', title: 'Подписки', hardBlocked: false, family: false },
  gambling: { id: 'gambling', title: 'Азартные игры и ставки', hardBlocked: true, family: false },
  adult: { id: 'adult', title: 'Товары и услуги 18+', hardBlocked: true, family: false },
  alcohol: { id: 'alcohol', title: 'Алкоголь', hardBlocked: true, family: false },
  tobacco: { id: 'tobacco', title: 'Табак', hardBlocked: true, family: false },
};

export const CATEGORY_LIST = Object.values(CATEGORIES);
export const PARENT_CONTROLLABLE_CATEGORIES = CATEGORY_LIST.filter((c) => !c.hardBlocked);
