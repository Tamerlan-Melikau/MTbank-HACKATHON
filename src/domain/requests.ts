import type { AgeGroup } from './age';
import { CAPABILITIES } from './capabilities';
import { byn, formatMoney } from './money';
import { PRODUCTS } from './products';
import type { AccessRequestPayload, Limits } from './types';

/** Лимиты по умолчанию при выпуске пакета (допущения). */
export function presetLimits(group: AgeGroup): Limits {
  return group === 'junior'
    ? { daily: byn(30), monthly: byn(100), approvalFrom: byn(15) }
    : { daily: byn(150), monthly: byn(500), approvalFrom: null };
}

/** Короткое описание запроса для списков и уведомлений. */
export function describePayload(p: AccessRequestPayload): string {
  switch (p.type) {
    case 'capability':
      return CAPABILITIES[p.capabilityId].title;
    case 'limit':
      return `Лимит: ${formatMoney(p.amount)}`;
    case 'money':
      return `Деньги: ${formatMoney(p.amount)}`;
    case 'moby-access':
      return 'Доступ в Moby';
    case 'product':
      return PRODUCTS.find((x) => x.id === p.productId)?.title ?? 'Продукт';
    case 'purchase':
      return 'Подтверждение покупки';
    case 'transfer':
      return `Перевод: ${formatMoney(p.amount)} — ${p.recipient}`;
    case 'goal_withdraw':
      return `Вывод из копилки: ${formatMoney(p.amount)}`;
    case 'goal_close':
      return 'Закрыть копилку';
    case 'deposit_close':
      return 'Закрыть счёт «МТБелки»';
    case 'deposit_topup':
      return `Пополнить «МТБелки»: ${formatMoney(p.amount)}`;
    case 'deposit_withdraw':
      return `Со счёта «МТБелки»: ${formatMoney(p.amount)}`;
    case 'deposit_transfer':
      return `Перевод со счёта «МТБелки»: ${formatMoney(p.amount)} — ${p.recipient}`;
  }
}
