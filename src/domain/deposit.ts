/** Демо-ставка и расчёт процентов по накопительному счёту. */
import { add, minor, sub, ZERO, type Money } from './money';
import type { Account, Goal } from './types';

/** Ставка прототипа: 10% годовых. В боевом продукте приходит из тарифов банка. */
export const DEPOSIT_ANNUAL_RATE_PCT = 10;

/** Проценты за месяц от полного остатка (простые, без капитализации внутри месяца). */
export function monthlyInterest(balance: Money): Money {
  return minor(Math.round((balance.minor * DEPOSIT_ANNUAL_RATE_PCT) / 100 / 12));
}

/** Сколько денег закреплено за копилками. */
export function goalsReserved(goals: Goal[]): Money {
  return goals.reduce((sum, g) => add(sum, g.balance), ZERO);
}

/** Весь остаток накопительного счёта (включая суммы в копилках). */
export function savingsTotal(deposit: Account | null): Money {
  return deposit?.balance ?? ZERO;
}

/** Свободно на накопительном счёте: остаток минус закреплённое за копилками. */
export function savingsAvailable(deposit: Account | null, goals: Goal[]): Money {
  return deposit ? sub(deposit.balance, goalsReserved(goals)) : ZERO;
}
