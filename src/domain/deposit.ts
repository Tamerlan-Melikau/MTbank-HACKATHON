/** Демо-ставка и расчёт процентов по накопительному счёту. */
import { add, minor, sub, ZERO, type Money } from './money';
import type { Account, Goal } from './types';

/** Ставка прототипа: 10% годовых. В боевом продукте приходит из тарифов банка. */
export const DEPOSIT_ANNUAL_RATE_PCT = 10;

/** Проценты за месяц по заданной годовой ставке (простые, без капитализации). */
export function monthlyInterestAt(balance: Money, annualPercent: number): Money {
  return minor(Math.round((balance.minor * annualPercent) / 100 / 12));
}

/** Проценты банка за месяц от полного остатка. */
export function monthlyInterest(balance: Money): Money {
  return monthlyInterestAt(balance, DEPOSIT_ANNUAL_RATE_PCT);
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
