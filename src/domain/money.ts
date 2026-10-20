/**
 * Деньги храним в целых минорных единицах (копейках), чтобы не ловить ошибки float.
 * 1 938,22 BYN === { minor: 193822, currency: 'BYN' }.
 */
export type Currency = 'BYN';

export interface Money {
  readonly minor: number;
  readonly currency: Currency;
}

export const byn = (rubles: number): Money => ({ minor: Math.round(rubles * 100), currency: 'BYN' });
export const minor = (value: number): Money => ({ minor: Math.trunc(value), currency: 'BYN' });
export const ZERO: Money = { minor: 0, currency: 'BYN' };

export const add = (a: Money, b: Money): Money => minor(a.minor + b.minor);
export const sub = (a: Money, b: Money): Money => minor(a.minor - b.minor);
export const gt = (a: Money, b: Money) => a.minor > b.minor;
export const gte = (a: Money, b: Money) => a.minor >= b.minor;
export const isPositive = (a: Money) => a.minor > 0;

const NBSP = ' ';
export const MINUS = '−';

/** «1 938,22 BYN». Неразрывные пробелы, чтобы сумма не переносилась. */
export function formatMoney(m: Money, opts: { sign?: 'auto' | 'always' | 'never'; hideFraction?: boolean } = {}): string {
  const sign = opts.sign ?? 'auto';
  const abs = Math.abs(m.minor);
  const rub = Math.floor(abs / 100);
  const kop = abs % 100;
  const int = String(rub).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const body = opts.hideFraction && kop === 0 ? int : `${int},${String(kop).padStart(2, '0')}`;
  let prefix = '';
  if (m.minor < 0 && sign !== 'never') prefix = MINUS;
  else if (m.minor > 0 && sign === 'always') prefix = '+';
  return `${prefix}${body}${NBSP}${m.currency}`;
}

/** Разбор пользовательского ввода «12,5» / «12.50» / «1 200». null — если не число. */
export function parseMoney(input: string): Money | null {
  const s = input.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  return byn(Number(s));
}
