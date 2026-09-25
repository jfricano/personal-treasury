import { describe, expect, it } from 'vitest';
import { AccountResolver, codeNeedsReview } from '@/domain/accounts';
import type { Account } from '@/domain/types';

const acct = (id: string, code: string, description: string | null = null): Account => ({
  id,
  code,
  displayName: null,
  description,
  color: null,
  sortOrder: 0,
  active: true,
  needsReview: false,
});

describe('AT8 aliases and unknown codes', () => {
  const r = new AccountResolver(
    [
      acct('1', 'SPLG'),
      acct('2', 'GIFT'),
      acct('3', 'PETC', 'Flexible savings for pets, medical, dental, auto maintenance'),
    ],
    [
      { alias: 'SPLURGE', accountId: '1', originalText: 'Splurge' },
      { alias: 'GIFTS', accountId: '2', originalText: 'Gifts' },
    ],
  );
  it('resolves Splurge variants to SPLG', () => {
    for (const t of ['Splurge', 'splurge', ' SPLURGE ']) {
      const res = r.resolve(t);
      expect(res.code).toBe('SPLG');
      expect(res.aliasApplied?.originalText).toBe('Splurge');
      expect(res.original).toBe(t);
    }
  });
  it('resolves Gifts to GIFT and lowercase canonical codes directly', () => {
    expect(r.resolve('Gifts').code).toBe('GIFT');
    expect(r.resolve('petc').accountId).toBe('3');
  });
  it('keeps ??? distinct and flags it for review', () => {
    const res = r.resolve('???');
    expect(res.accountId).toBeNull();
    expect(res.code).toBe('???');
    expect(codeNeedsReview('???')).toBe(true);
    expect(codeNeedsReview('PETC')).toBe(false);
  });
});
