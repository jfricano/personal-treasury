import { describe, expect, it } from 'vitest';
import { loadSqlJs } from '@/db/driver';
import { MemoryStorage } from '@/db/storage';
import { Treasury } from '@/api/treasury';
import { buildBlankDatabase, buildSampleDatabase, seedHarpers, seedMonths } from '@/demo/seed';
import { SAMPLE_TODAY as TODAY, debtControls, sampleTreasury } from './helpers';

const byCode = (t: Treasury, rows: { accountId: string }[], pick: (r: never) => string) =>
  Object.fromEntries(rows.map((r) => [t.codeOf(r.accountId), pick(r as never)]));

describe('Harper household sample data', async () => {
  const t = await sampleTreasury();

  it('has eight accounts, two budget versions and four months relative to today', () => {
    expect(t.accounts().map((a) => a.code)).toEqual([
      'HH',
      'PETC',
      'LTS',
      'TRV',
      'KIDS',
      'CLTH',
      'GIFT',
      'ENT',
    ]);
    expect(t.repos.getAccountByCode('PETC')!.description).toMatch(/flexible, as-needed actual savings/);
    const versions = t.budget.versions().map((v) => ({
      label: v.version.label,
      status: v.version.status,
      from: v.version.effectiveFrom,
      to: v.version.effectiveTo,
      takeHome: v.takeHome,
      locked: !!v.version.lockedAt,
    }));
    expect(versions).toEqual(
      expect.arrayContaining([
        {
          label: 'Spring plan',
          status: 'archived',
          from: '2026-06',
          to: '2026-07',
          takeHome: '4566.26',
          locked: true,
        },
        {
          label: 'After the raise',
          status: 'active',
          from: '2026-08',
          to: null,
          takeHome: '4690.96',
          locked: true,
        },
      ]),
    );
    expect(t.monthSummaries().map((m) => [m.month, m.status, !!m.closedAt])).toEqual([
      ['2026-06', 'COMPLETE', true],
      ['2026-07', 'COMPLETE', true],
      ['2026-08', 'COMPLETE', true],
      ['2026-09', 'READY_TO_TRANSFER', false],
    ]);
  });

  it('funds the current month from the active budget and applies its transfers', () => {
    const v = t.monthView(t.repos.getMonthByKey('2026-09')!.id);
    expect(v.cycle.expectedCash).toBe('4690.96');
    expect(byCode(t, v.result.lines, (l: { budgetAmount: string }) => l.budgetAmount)).toEqual({
      HH: '3137',
      PETC: '180',
      LTS: '300',
      TRV: '125',
      KIDS: '260',
      CLTH: '90',
      GIFT: '60',
      ENT: '538.96',
    });
    expect(byCode(t, v.result.lines, (l: { finalTransfer: string }) => l.finalTransfer)).toEqual({
      HH: '3137',
      PETC: '80',
      LTS: '500',
      TRV: '25',
      KIDS: '285',
      CLTH: '90',
      GIFT: '60',
      ENT: '513.96',
    });
    expect(v.result.journalDifference).toBe('0');
    expect(v.result.finalTransferDifference).toBe('0');
    expect(v.entries).toHaveLength(3);
  });

  it('shows each debt rule: roll-forward, paid-off exclusion, reversal and cancel notes', () => {
    expect(debtControls(t)).toEqual({ count: 4, total: '785', largest: '300', netSum: '0' });
    expect(t.debtBoard().summary.largestLoanIds.sort()).toEqual(['H-01', 'H-05']);
    const pos = (loan: string) => t.debtBoard().positions.find((p) => p.debt.loanId === loan)!;

    // H-01: $600 opened, three $100 payments recorded from monthly transfers.
    expect(pos('H-01').events.map((e) => [e.priorBalance, e.changeAmount, e.remainingBalance])).toEqual([
      ['0', '600', '600'],
      ['600', '-100', '500'],
      ['500', '-100', '400'],
      ['400', '-100', '300'],
    ]);
    expect(
      pos('H-01')
        .events.slice(1)
        .every((e) => e.journalEntryId),
    ).toBe(true);

    expect(pos('H-02').status).toBe('PAID');
    expect(t.debtBoard().summary.included.map((p) => p.debt.loanId)).not.toContain('H-02');

    const h3 = pos('H-03');
    expect([h3.status, h3.reversed, h3.currentBalance, h3.displayBalance]).toEqual([
      'CREDIT',
      true,
      '-35',
      '35',
    ]);
    expect([t.codeOf(h3.owedByAccountId), t.codeOf(h3.owedToAccountId)]).toEqual(['ENT', 'KIDS']);

    const h4 = pos('H-04');
    expect([h4.status, h4.reviewNote, h4.displayBalance]).toEqual(['OPEN', true, '150']);
    expect(t.debtBoard().summary.included.map((p) => p.debt.loanId)).toContain('H-04');

    const net = Object.fromEntries(
      t.debtBoard().summary.byAccount.map((a) => [t.codeOf(a.accountId), a.net]),
    );
    expect(net).toMatchObject({ LTS: '600', HH: '150', PETC: '-300', TRV: '-300', KIDS: '-115', ENT: '-35' });
  });

  it('computes payroll and a labelled tax estimate for the active plan', () => {
    const view = t.budget.versionView(t.budget.activeVersion()!.id);
    expect(view.payroll!.takeHome).toBe('4690.96');
    expect(view.payroll!.wages).toEqual({ federal: '5937', california: '5937', fica: '6262' });
    expect(view.budget!.issues).toEqual([]);
    const c = (k: string) => view.tax!.components.find((x) => x.component === k)!;
    expect(c('federal')).toMatchObject({ liabilityRounded: '6844', difference: '124' });
    expect(c('california')).toMatchObject({ liabilityRounded: '2474', difference: '134' });
    expect(view.tax!.employment.liabilityRounded).toBe('5749');
    expect(view.tax!.provenance.find((p) => p.jurisdiction === 'california')).toMatchObject({
      taxYear: 2026,
      ratesFromYear: 2025,
      provisional: true,
    });
  });

  it('starts the audit trail at the sample-data load', () => {
    expect(t.auditLog().map((a) => a.action)).toEqual(['seed']);
  });
});

describe('sample data dates', () => {
  it('crosses a year boundary and marks every tax table provisional in a later year', async () => {
    const t = await sampleTreasury(new Date(2027, 0, 15));
    expect(seedMonths(new Date(2027, 0, 15))).toEqual({
      m3: '2026-10',
      m2: '2026-11',
      m1: '2026-12',
      m0: '2027-01',
    });
    expect(t.monthSummaries().map((m) => m.month)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(t.budget.ruleSets().every((r) => r.taxYear === 2027 && r.provisional)).toBe(true);
    expect(t.budget.versionView(t.budget.activeVersion()!.id).taxError).toBeNull();
  });

  it('never dates current-month entries after today', async () => {
    const t = await sampleTreasury(new Date(2026, 2, 1));
    const v = t.monthView(t.repos.getMonthByKey('2026-03')!.id);
    expect(v.entries.map((e) => e.entry.entryDate)).toEqual(['2026-03-01', '2026-03-01', '2026-03-01']);
    expect(debtControls(t)).toMatchObject({ count: 4, total: '785' });
  });

  it('refuses to load into a database that already has data', async () => {
    const t = await sampleTreasury();
    expect(() => seedHarpers(t, TODAY)).toThrow(/empty database/);
  });
});

describe('demo reset and clean slate', async () => {
  const SQL = await loadSqlJs();
  const sample = await buildSampleDatabase(SQL, TODAY);
  const blank = await buildBlankDatabase(SQL);

  it('resets to the sample and starts blank, and each can be undone', async () => {
    const storage = new MemoryStorage();
    await storage.save('demo', sample);
    const t = await Treasury.open({ SQL, storage, profile: 'demo' });
    const debt = t.repos.getDebtByLoanId('H-01')!;
    t.recordPayment(debt.id, { eventDate: '2026-09-24', payment: '300' });
    expect(debtControls(t)).toMatchObject({ count: 3, total: '485' });

    t.replaceDatabase(blank, 'Started blank', { undoLabel: 'Start blank' });
    expect(t.isEmpty()).toBe(true);
    expect(t.budget.ruleSets()).toEqual([]);
    expect(t.undoLabel).toBe('Start blank');

    t.replaceDatabase(sample, 'Reset to sample data', { undoLabel: 'Reset to sample data' });
    expect(debtControls(t)).toMatchObject({ count: 4, total: '785' });

    expect(t.undo()).toBe('Reset to sample data');
    expect(t.isEmpty()).toBe(true);
    expect(t.undo()).toBe('Start blank');
    expect(debtControls(t)).toMatchObject({ count: 3, total: '485' });

    await t.flush();
    const reopened = await Treasury.open({ SQL, storage, profile: 'demo' });
    expect(debtControls(reopened)).toMatchObject({ count: 3, total: '485' });
  });
});
