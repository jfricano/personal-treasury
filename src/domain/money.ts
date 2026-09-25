import Decimal from 'decimal.js';

/**
 * All monetary arithmetic goes through this module. Values are carried as
 * normalized decimal strings (`Money`) and computed with decimal.js. JavaScript
 * `number` is only accepted at the workbook boundary (`fromSourceNumber`), where
 * Excel has already stored the value as an IEEE double.
 */
export const Dec = Decimal.clone({
  precision: 60,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -60,
  toExpPos: 60,
});
export type Dec = InstanceType<typeof Dec>;

/** Normalized decimal string, e.g. "2345.678901234567", "-100", "0". */
export type Money = string;

export const ZERO: Money = '0';
export const TOLERANCE = new Dec('0.01');

type MoneyLike = Money | Dec;

export function dec(v: MoneyLike): Dec {
  return v instanceof Dec ? v : new Dec(v);
}

/** Canonical string form: no exponent, no trailing zeros, no negative zero. */
export function normalize(v: MoneyLike): Money {
  const d = dec(v);
  if (d.isZero()) return ZERO;
  return d.toFixed();
}

export function isMoney(s: unknown): s is Money {
  if (typeof s !== 'string' || s.trim() === '') return false;
  try {
    const d = new Dec(s);
    return d.isFinite();
  } catch {
    return false;
  }
}

/**
 * Convert a numeric workbook cell to Money using the shortest round-trip
 * representation of the stored double. This preserves source precision such as
 * 2345.678901234567 without introducing float noise.
 */
export function fromSourceNumber(n: number): Money {
  if (!Number.isFinite(n)) throw new Error(`Non-finite source number: ${n}`);
  return normalize(new Dec(String(n)));
}

export const add = (a: MoneyLike, b: MoneyLike): Money => normalize(dec(a).plus(dec(b)));
export const sub = (a: MoneyLike, b: MoneyLike): Money => normalize(dec(a).minus(dec(b)));
export const neg = (a: MoneyLike): Money => normalize(dec(a).neg());
export const abs = (a: MoneyLike): Money => normalize(dec(a).abs());

export function sum(values: Iterable<MoneyLike>): Money {
  let total = new Dec(0);
  for (const v of values) total = total.plus(dec(v));
  return normalize(total);
}

export const cmp = (a: MoneyLike, b: MoneyLike): number => dec(a).comparedTo(dec(b));
export const max = (a: MoneyLike, b: MoneyLike): Money => (cmp(a, b) >= 0 ? normalize(a) : normalize(b));

/** |v| < 0.01 — reconciled / effectively zero. */
export const isEffectivelyZero = (v: MoneyLike): boolean => dec(v).abs().lessThan(TOLERANCE);
/** v >= 0.01 */
export const isPositive = (v: MoneyLike): boolean => dec(v).greaterThanOrEqualTo(TOLERANCE);
/** v <= -0.01 */
export const isNegative = (v: MoneyLike): boolean => dec(v).lessThanOrEqualTo(TOLERANCE.neg());
/** Strictly greater than zero (used for ordinary-transfer amounts). */
export const isStrictlyPositive = (v: MoneyLike): boolean => dec(v).greaterThan(0);

/** Round half-up to cents, as a string with exactly two decimals. */
export function toCents(v: MoneyLike): string {
  const s = dec(v).toFixed(2, Dec.ROUND_HALF_UP);
  return s === '-0.00' ? '0.00' : s;
}

export interface FormatOptions {
  /** Show negatives as ($1.00) instead of -$1.00. */
  parens?: boolean;
  /** Omit the dollar sign. */
  plain?: boolean;
  /** Show a leading + for positive values. */
  signed?: boolean;
}

export function formatUSD(v: MoneyLike, opts: FormatOptions = {}): string {
  const cents = toCents(v);
  const negative = cents.startsWith('-');
  const [intPart, frac] = (negative ? cents.slice(1) : cents).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `${opts.plain ? '' : '$'}${grouped}.${frac}`;
  if (negative) return opts.parens ? `(${body})` : `-${body}`;
  if (opts.signed && cents !== '0.00') return `+${body}`;
  return body;
}

/** Screen-reader friendly amount, e.g. "negative 12 dollars and 50 cents". */
export function spokenUSD(v: MoneyLike): string {
  const cents = toCents(v);
  const negative = cents.startsWith('-');
  const [d, c] = (negative ? cents.slice(1) : cents).split('.');
  return `${negative ? 'negative ' : ''}${d} dollars and ${Number.parseInt(c, 10)} cents`;
}

/**
 * Parse user-typed currency ("$1,234.50", "1234.5", "(12)"). Returns null for
 * anything that is not an unambiguous decimal amount.
 */
export function parseMoneyInput(text: string): Money | null {
  let t = text.trim().replace(/[$,\s]/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = normalize(new Dec(t));
  return negative ? neg(n) : n;
}
