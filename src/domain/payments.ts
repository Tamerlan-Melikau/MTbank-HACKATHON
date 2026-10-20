/**
 * Авторизация операций по детской карте/счёту. Чистая функция: на вход — состояние,
 * на выход — решение. Порядок проверок важен и покрыт тестами.
 */
import type { CapabilityId } from './capabilities';
import { CATEGORIES, type CategoryId } from './categories';
import { add, gt, type Money } from './money';
import { capabilityAccess } from './policy';
import type { Account, Card, Channel, ChildSettings } from './types';

export type DeclineCode =
  | 'CARD_BLOCKED'
  | 'CARD_LOST'
  | 'CATEGORY_FORBIDDEN'
  | 'CATEGORY_BLOCKED_BY_PARENT'
  | 'CHANNEL_OFF'
  | 'CHANNEL_NOT_FOR_AGE'
  | 'INSUFFICIENT_FUNDS'
  | 'LIMIT_PER_TX'
  | 'LIMIT_DAILY'
  | 'LIMIT_MONTHLY';

export type ApprovalCode = 'CHANNEL_APPROVAL' | 'ABOVE_THRESHOLD';

export type PaymentDecision =
  | { outcome: 'approve' }
  | { outcome: 'decline'; code: DeclineCode; /** ребёнок может попросить родителя */ requestable: boolean }
  | { outcome: 'needs_approval'; code: ApprovalCode };

export interface PaymentOp {
  amount: Money; // положительная сумма списания
  channel: Exclude<Channel, 'internal'>;
  category: CategoryId | null;
}

export interface PaymentContext {
  settings: ChildSettings;
  account: Account;
  card: Card | null; // null для p2p без карты
  spentToday: Money;
  spentMonth: Money;
}

export const CHANNEL_CAPABILITY: Record<PaymentOp['channel'], CapabilityId> = {
  offline: 'card.pay.offline',
  online: 'card.pay.online',
  atm: 'card.cash',
  p2p: 'transfer.p2p',
};

export function authorizePayment(op: PaymentOp, ctx: PaymentContext): PaymentDecision {
  const { settings, account, card } = ctx;

  // 1. Карта
  if (card) {
    if (card.status === 'lost') return { outcome: 'decline', code: 'CARD_LOST', requestable: false };
    if (card.status === 'blocked') return { outcome: 'decline', code: 'CARD_BLOCKED', requestable: false };
  }

  // 2. Всегда запрещённые категории — никакой родитель не разрешит
  if (op.category && CATEGORIES[op.category].hardBlocked) {
    return { outcome: 'decline', code: 'CATEGORY_FORBIDDEN', requestable: false };
  }

  // 3. Канал (касса / интернет / банкомат / перевод) по правам ребёнка
  const access = capabilityAccess(settings, CHANNEL_CAPABILITY[op.channel]);
  if (access.kind === 'denied') {
    return access.reason === 'age'
      ? { outcome: 'decline', code: 'CHANNEL_NOT_FOR_AGE', requestable: false }
      : { outcome: 'decline', code: 'CHANNEL_OFF', requestable: true };
  }

  // 4. Категории, запрещённые родителем
  if (op.category && settings.blockedCategories.includes(op.category)) {
    return { outcome: 'decline', code: 'CATEGORY_BLOCKED_BY_PARENT', requestable: true };
  }

  // 5. Деньги
  if (gt(op.amount, account.balance)) return { outcome: 'decline', code: 'INSUFFICIENT_FUNDS', requestable: true };

  // 6. Лимиты
  const { limits } = settings;
  if (settings.ageGroup !== 'junior' && limits.perTransaction && gt(op.amount, limits.perTransaction)) {
    return { outcome: 'decline', code: 'LIMIT_PER_TX', requestable: true };
  }
  if (limits.daily && gt(add(ctx.spentToday, op.amount), limits.daily)) {
    return { outcome: 'decline', code: 'LIMIT_DAILY', requestable: true };
  }
  if (limits.monthly && gt(add(ctx.spentMonth, op.amount), limits.monthly)) {
    return { outcome: 'decline', code: 'LIMIT_MONTHLY', requestable: true };
  }

  // 7. Нужно ли подтверждение родителя
  if (access.kind === 'approval') return { outcome: 'needs_approval', code: 'CHANNEL_APPROVAL' };
  if (limits.approvalFrom && !gt(limits.approvalFrom, op.amount)) {
    return { outcome: 'needs_approval', code: 'ABOVE_THRESHOLD' };
  }
  return { outcome: 'approve' };
}

/** Тексты причин: родителю на «вы», ребёнку на «ты». */
export const REASON_TEXT: Record<DeclineCode | ApprovalCode, { parent: string; child: string }> = {
  CARD_BLOCKED: { parent: 'Карта заблокирована', child: 'Карта заблокирована. Попроси родителя её разблокировать' },
  CARD_LOST: { parent: 'Карта отмечена как утерянная', child: 'Карта отмечена как утерянная' },
  CATEGORY_FORBIDDEN: { parent: 'Категория запрещена для детей всегда', child: 'Такие покупки детям недоступны' },
  CATEGORY_BLOCKED_BY_PARENT: { parent: 'Категория запрещена вами', child: 'Родитель запретил эту категорию' },
  CHANNEL_OFF: { parent: 'Способ оплаты выключен вами', child: 'Этот способ оплаты пока выключен' },
  CHANNEL_NOT_FOR_AGE: { parent: 'Недоступно в этом возрасте', child: 'Станет доступно, когда подрастёшь' },
  INSUFFICIENT_FUNDS: { parent: 'Недостаточно средств', child: 'Не хватает денег на карте' },
  LIMIT_PER_TX: { parent: 'Превышен лимит на одну покупку', child: 'Покупка больше твоего лимита' },
  LIMIT_DAILY: { parent: 'Превышен дневной лимит', child: 'Лимит на сегодня закончился' },
  LIMIT_MONTHLY: { parent: 'Превышен месячный лимит', child: 'Лимит на месяц закончился' },
  CHANNEL_APPROVAL: { parent: 'Нужно ваше подтверждение', child: 'Ждём подтверждения родителя' },
  ABOVE_THRESHOLD: { parent: 'Сумма выше порога подтверждения', child: 'Ждём подтверждения родителя' },
};
