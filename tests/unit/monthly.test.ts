import { describe, expect, it } from 'vitest';
import { asSimpleTransfer, computeMonth, transferPostings, validateTransfer } from '@/domain/monthly';
import type { AllocationLine, JournalEntry, Posting } from '@/domain/types';

let n = 0;
const id = () => `id${++n}`;

function entry(postings: [string, string][], extra: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: id(),
    entryDate: '2026-11-05',
    loanId: null,
    description: 'test',
    notes: null,
    sourceKind: 'user',
    draftReason: null,
    postings: postings.map(([accountId, amount], i): Posting => ({
      id: id(),
      accountId,
      amount,
      position: i,
    })),
    ...extra,
  };
}
const alloc = (
  accountId: string,
  budgetAmount: string,
  transferState: AllocationLine['transferState'] = 'pending',
): AllocationLine => ({ accountId, budgetAmount, transferState, notes: null });

describe('AT2 ordinary transfer', () => {
  const allocations = [alloc('HH', '1000'), alloc('PETC', '200')];
  const postings = transferPostings({ fromAccountId: 'HH', toAccountId: 'PETC', amount: '75' }, id);
  const e = entry([]);
  e.postings = postings;
  const r = computeMonth({ expectedCash: '1200', allocations, entries: [e] });

  it('creates one entry with HH -75 and PETC +75', () => {
    expect(postings.map((p) => [p.accountId, p.amount])).toEqual([
      ['HH', '-75'],
      ['PETC', '75'],
    ]);
    expect(asSimpleTransfer(e)).toEqual({ fromAccountId: 'HH', toAccountId: 'PETC', amount: '75' });
  });
  it('updates HH out and final', () => {
    const hh = r.lines.find((l) => l.accountId === 'HH')!;
    expect(hh.transfersOut).toBe('75');
    expect(hh.finalTransfer).toBe('925');
  });
  it('updates PETC in and final', () => {
    const p = r.lines.find((l) => l.accountId === 'PETC')!;
    expect(p.transfersIn).toBe('75');
    expect(p.finalTransfer).toBe('275');
  });
  it('keeps the entry and journal balanced', () => {
    expect(r.entryResults[0].balanced).toBe(true);
    expect(r.journalDifference).toBe('0');
    expect(r.status).toBe('READY_TO_TRANSFER');
  });
  it('rejects invalid transfers', () => {
    expect(validateTransfer({ fromAccountId: null, toAccountId: 'PETC', amount: '5' })).toContain(
      'missing_from',
    );
    expect(validateTransfer({ fromAccountId: 'HH', toAccountId: '', amount: '5' })).toContain('missing_to');
    expect(validateTransfer({ fromAccountId: 'HH', toAccountId: 'HH', amount: '5' })).toContain(
      'same_account',
    );
    expect(validateTransfer({ fromAccountId: 'HH', toAccountId: 'PETC', amount: '0' })).toContain(
      'amount_not_positive',
    );
    expect(validateTransfer({ fromAccountId: 'HH', toAccountId: 'PETC', amount: '-5' })).toContain(
      'amount_not_positive',
    );
    expect(() => transferPostings({ fromAccountId: 'HH', toAccountId: 'HH', amount: '5' }, id)).toThrow();
  });
});

describe('AT3 multi-posting entries', () => {
  it('accepts a balanced three-posting entry and updates each account', () => {
    const e = entry(
      [
        ['A', '-100'],
        ['B', '60'],
        ['C', '40'],
      ],
      { sourceKind: 'legacy_matrix' },
    );
    const r = computeMonth({
      expectedCash: '300',
      allocations: [alloc('A', '100'), alloc('B', '100'), alloc('C', '100')],
      entries: [e],
    });
    expect(r.entryResults[0]).toMatchObject({ valid: true, balanced: true });
    expect(r.lines.map((l) => l.finalTransfer)).toEqual(['0', '160', '140']);
    expect(e.postings).toHaveLength(3);
    expect(asSimpleTransfer(e)).toBeNull();
  });
  it('preserves an unbalanced entry, shows a $10 imbalance, and adds no plug', () => {
    const e = entry(
      [
        ['A', '-100'],
        ['B', '90'],
      ],
      { sourceKind: 'legacy_matrix' },
    );
    const r = computeMonth({
      expectedCash: '200',
      allocations: [alloc('A', '100'), alloc('B', '100')],
      entries: [e],
    });
    expect(e.postings).toHaveLength(2);
    expect(r.entryResults[0].difference).toBe('-10');
    expect(r.journalDifference).toBe('-10');
    expect(r.status).toBe('REVIEW');
    expect(r.issues.some((i) => i.code === 'invalid_entry' && i.message.includes('-$10.00'))).toBe(true);
  });
});

describe('AT4 monthly status', () => {
  const base = () => ({
    expectedCash: '1200',
    allocations: [alloc('HH', '1000'), alloc('PETC', '200'), alloc('LTS', '0')],
    entries: [
      entry([
        ['HH', '-75'],
        ['PETC', '75'],
      ]),
    ],
  });
  it('is Ready to transfer with pending required transfers', () => {
    expect(computeMonth(base()).status).toBe('READY_TO_TRANSFER');
  });
  it('is Complete once every non-zero transfer is Done; zero lines need no mark', () => {
    const b = base();
    b.allocations[0].transferState = 'done';
    b.allocations[1].transferState = 'done';
    const r = computeMonth(b);
    expect(r.status).toBe('COMPLETE');
    expect(r.lines.find((l) => l.accountId === 'LTS')!.effectiveState).toBe('not_required');
  });
  const reviewCases: [string, (b: ReturnType<typeof base>) => void, string][] = [
    [
      'allocation difference',
      (b) => {
        b.allocations[0].budgetAmount = '1000.01';
      },
      'allocation_difference',
    ],
    [
      'journal difference',
      (b) => {
        b.entries.push(
          entry([
            ['HH', '-5'],
            ['PETC', '4.99'],
          ]),
        );
      },
      'journal_difference',
    ],
    [
      'final transfer difference',
      (b) => {
        b.entries.push(entry([['HH', '-5']]));
      },
      'final_transfer_difference',
    ],
    [
      'invalid entry',
      (b) => {
        b.entries.push(
          entry(
            [
              ['HH', '-5'],
              ['PETC', '5'],
            ],
            { draftReason: 'Incomplete' },
          ),
        );
      },
      'invalid_entry',
    ],
    [
      'negative final transfer',
      (b) => {
        b.entries.push(
          entry([
            ['LTS', '-10'],
            ['HH', '10'],
          ]),
        );
      },
      'negative_transfer',
    ],
  ];
  for (const [name, mutate, code] of reviewCases) {
    it(`is Review with a specific reason for ${name}`, () => {
      const b = base();
      mutate(b);
      const r = computeMonth(b);
      expect(r.status).toBe('REVIEW');
      expect(r.issues.map((i) => i.code)).toContain(code);
    });
  }
  it('passes exactly below the tolerance', () => {
    const b = base();
    b.allocations[0].budgetAmount = '1000.009';
    b.expectedCash = '1200';
    expect(computeMonth(b).checks.allocation).toBe(true);
  });
});
