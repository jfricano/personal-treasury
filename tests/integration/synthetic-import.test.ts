import { describe, expect, it } from 'vitest';
import { analyzeWorkbook } from '@/import/analyze';
import { syntheticWorkbook } from '../fixtures/workbooks';
import { freshTreasury, importInto } from './helpers';

describe('synthetic workbook import', async () => {
  const t = await freshTreasury();
  const { plan } = await importInto(t, syntheticWorkbook(), 'synthetic.xlsx');
  const code = (id: string) => t.codeOf(id);
  const debt = (id: string) => t.debtBoard().positions.find((p) => p.debt.loanId === id)!;

  it('AT8 resolves Splurge variants and Petc. through aliases; ??? stays distinct', () => {
    const d7 = debt('7');
    expect(code(d7.debt.originCreditorAccountId)).toBe('SPLG');
    expect(d7.events.map((e) => e.sourceCreditor)).toEqual(['Splurge', ' SPLURGE ']);
    expect(debt('B-2').events.map((e) => e.sourceDebtor)).toEqual(['???', 'Petc.']);
    expect(t.accounts().map((a) => a.code)).not.toContain('PETC.');
    expect(t.accounts().find((a) => a.code === '???')!.needsReview).toBe(true);
    expect(plan.warnings.some((w) => w.code === 'unknown_code')).toBe(true);
    expect(plan.warnings.some((w) => w.code === 'conflicting_party' && w.message.includes('PETC'))).toBe(
      true,
    );
  });

  it('AT6 inherits origin metadata for payment rows that only have Loan ID, date and change', () => {
    const p = debt('A-1');
    expect(p.debt).toMatchObject({ description: 'Vet bill', openedDate: '2026-01-05', terms: '3 months' });
    expect([code(p.debt.originDebtorAccountId), code(p.debt.originCreditorAccountId)]).toEqual([
      'HH',
      'PETC',
    ]);
    expect(p.events).toHaveLength(3);
    expect(p.events[1].description).toBeNull();
  });

  it('AT7 keeps a canceled non-zero debt, highlights it, and does not force zero', () => {
    const p = debt('A-1');
    expect(p.currentBalance).toBe('200');
    expect(p.reviewNote).toBe(true);
    expect(p.displayNotes).toBe('canceled');
    expect(t.debtBoard().summary.included.map((x) => x.debt.loanId)).toContain('A-1');
    expect(plan.warnings.some((w) => w.code === 'blank_change' && w.cell === 'G7')).toBe(true);
  });

  it('reverses direction on an overpaid imported debt', () => {
    const p = debt('7');
    expect(p.currentBalance).toBe('-30');
    expect([code(p.owedByAccountId), code(p.owedToAccountId)]).toEqual(['SPLG', 'ENT']);
  });

  it('AT3 legacy multi-posting and unbalanced rows are preserved without a plug', () => {
    const v = t.monthView(t.repos.getMonthByKey('2026-01')!.id);
    expect(v.entries).toHaveLength(2);
    expect(v.entries[0].entry.postings).toHaveLength(3);
    expect(v.entries[0].result.balanced).toBe(true);
    expect(v.entries[1].result.difference).toBe('-10');
    expect(v.result.status).toBe('REVIEW');
    expect(
      plan.controls.find((c) => c.group === 'Month 2026-01' && c.name === 'Journal difference')!.pass,
    ).toBe(true);
    const lts = v.result.lines.find((l) => code(l.accountId) === 'LTS')!;
    expect(lts.storedState).toBe('pending');
    expect(plan.warnings.some((w) => w.code === 'ambiguous_confirmation' && w.cell === 'E11')).toBe(true);
    expect(plan.warnings.some((w) => w.code === 'memo_rows' && w.message.includes('Z-9'))).toBe(true);
  });

  it('imports normalized months, keeps invalid rows as flagged drafts, and preserves unknown confirmations', () => {
    const v = t.monthView(t.repos.getMonthByKey('2026-02')!.id);
    expect(v.entries).toHaveLength(2);
    expect(v.entries[0].simple).toEqual({
      fromAccountId: v.entries[0].entry.postings[0].accountId,
      toAccountId: v.entries[0].entry.postings[1].accountId,
      amount: '75',
    });
    expect(v.entries[1].entry.draftReason).toBe('Incomplete');
    expect(v.result.status).toBe('REVIEW');
    const petc = v.result.lines.find((l) => code(l.accountId) === 'PETC')!;
    expect(petc.notes).toContain('maybe');
    expect(petc.storedState).toBe('pending');
  });

  it('rejects a non-workbook file with a fatal error', async () => {
    const p = await analyzeWorkbook(new TextEncoder().encode('not a workbook'), 'junk.xlsx');
    expect(p.fatal).toBe(true);
    await expect(t.commitImport(p, 'replace')).rejects.toThrow(/fatal/);
  });
});
