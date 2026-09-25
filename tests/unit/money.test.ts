import { describe, expect, it } from 'vitest';
import {
  add,
  formatMoneyInput,
  formatUSD,
  fromSourceNumber,
  isEffectivelyZero,
  normalize,
  parseMoneyInput,
  sum,
  toCents,
} from '@/domain/money';

describe('AT1 decimal arithmetic', () => {
  it('imports values with more than two decimals and rounds only for display', () => {
    const v = fromSourceNumber(2345.678901234567);
    expect(v).toBe('2345.678901234567');
    expect(toCents(v)).toBe('2345.68');
    expect(formatUSD(v)).toBe('$2,345.68');
  });

  it('sums decimal strings without binary floating-point artifacts', () => {
    expect(add('0.1', '0.2')).toBe('0.3');
    expect(sum(['2345.678901234567', '180', '300', '0.1', '125.3333333333333'])).toBe('2951.1122345679003');
    expect(sum(['-12.333333333333336', '12', '-7'])).toBe('-7.333333333333336');
  });

  it('treats differences below $0.01 as reconciled and at/above as unresolved', () => {
    expect(isEffectivelyZero('0.0099999')).toBe(true);
    expect(isEffectivelyZero('-0.0099999')).toBe(true);
    expect(isEffectivelyZero('0.01')).toBe(false);
    expect(isEffectivelyZero('-0.01')).toBe(false);
  });

  it('normalizes strings canonically', () => {
    expect(normalize('1.500')).toBe('1.5');
    expect(normalize('-0')).toBe('0');
    expect(fromSourceNumber(1e-7)).toBe('0.0000001');
  });

  it('formats negatives and parses user input', () => {
    expect(formatUSD('-1234', { parens: true })).toBe('($1,234.00)');
    expect(formatUSD('-0.004')).toBe('$0.00');
    expect(formatMoneyInput('2345.678901234567')).toBe('2,345.678901234567');
    expect(formatMoneyInput('-1234')).toBe('-1,234.00');
    expect(formatMoneyInput('0.1')).toBe('0.10');
    expect(parseMoneyInput('$1,234.50')).toBe('1234.5');
    expect(parseMoneyInput('(12)')).toBe('-12');
    expect(parseMoneyInput('12abc')).toBeNull();
    expect(parseMoneyInput('')).toBeNull();
  });
});
