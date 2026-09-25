import { describe, expect, it } from 'vitest';
import { loadSqlJs } from '@/db/driver';
import { MemoryStorage } from '@/db/storage';
import { Treasury } from '@/api/treasury';
import { buildDatabaseFromBackup, createBackup, readBackup } from '@/export/backup';
import { exportWorkbook } from '@/export/workbook';
import { analyzeWorkbook } from '@/import/analyze';
import * as XLSX from 'xlsx';
import { syntheticWorkbook } from '../fixtures/workbooks';
import { debtControls, freshTreasury, importInto, sampleTreasury, tableCounts } from './helpers';

// Workflows on the fictional Harper household (src/demo/persona.ts). Starting controls:
// 4 non-zero debts, $785 outstanding, $300 largest (H-01 and H-05).

const id = (t: Treasury, code: string) => t.repos.getAccountByCode(code)!.id;
const alloc = (t: Treasury, monthId: string, code: string) =>
  t.repos.listAllocations(monthId).find((a) => a.accountId === id(t, code))!;

describe('AT10 incremental debt controls', async () => {
  const t = await sampleTreasury();
  const d = t.repos.getDebtByLoanId('H-01')!;

  it('a $300 payment on H-01 pays it off and brings controls to 3 / $485', () => {
    const preview = t.previewPayment(d.id, '300', '2026-09-24');
    expect(preview.change).toBe('-300');
    expect(preview.after.status).toBe('PAID');
    t.recordPayment(d.id, { eventDate: '2026-09-24', payment: '300' });
    expect(debtControls(t)).toMatchObject({ count: 3, total: '485', largest: '300' });
  });
  it('undo restores 4 / $785', () => {
    expect(t.undo()).toMatch(/Payment on H-01/);
    expect(debtControls(t)).toMatchObject({ count: 4, total: '785' });
  });
  it('deleting the event also restores the controls', () => {
    const ev = t.recordPayment(d.id, { eventDate: '2026-09-24', payment: '300' });
    expect(ev.changeAmount).toBe('-300');
    expect(debtControls(t).count).toBe(3);
    t.deleteEvent(ev.id);
    expect(debtControls(t)).toMatchObject({ count: 4, total: '785' });
  });
  it('a new $250 HH→LTS debt gives 5 / $1,035, and removing it restores the source', () => {
    const debt = t.createDebt({
      loanId: 'TEST-1',
      openedDate: '2026-09-20',
      description: 'test',
      debtorAccountId: id(t, 'HH'),
      creditorAccountId: id(t, 'LTS'),
      openingChange: '250',
    });
    expect(debtControls(t)).toMatchObject({ count: 5, total: '1035' });
    expect(() =>
      t.createDebt({
        loanId: 'TEST-1',
        openedDate: '2026-09-20',
        debtorAccountId: id(t, 'HH'),
        creditorAccountId: id(t, 'LTS'),
        openingChange: '1',
      }),
    ).toThrow(/already exists/);
    t.deleteDebt(debt.id);
    expect(debtControls(t)).toMatchObject({ count: 4, total: '785', largest: '300' });
  });
  it('an overpayment reverses direction', () => {
    const h5 = t.repos.getDebtByLoanId('H-05')!;
    const before = t.debtBoard().positions.find((p) => p.debt.loanId === 'H-05')!;
    expect([t.codeOf(before.owedByAccountId), t.codeOf(before.owedToAccountId)]).toEqual(['TRV', 'LTS']);
    const pv = t.previewPayment(h5.id, '400');
    expect(pv.directionChanges).toBe(true);
    t.recordPayment(h5.id, { eventDate: '2026-09-24', payment: '400' });
    const after = t.debtBoard().positions.find((p) => p.debt.loanId === 'H-05')!;
    expect(after.currentBalance).toBe('-100');
    expect([t.codeOf(after.owedByAccountId), t.codeOf(after.owedToAccountId), after.displayBalance]).toEqual([
      'LTS',
      'TRV',
      '100',
    ]);
    t.undo();
  });
});

describe('imported history is protected', async () => {
  it('requires confirmation to delete imported debt events', async () => {
    const t = await freshTreasury();
    await importInto(t, syntheticWorkbook(), 'synthetic.xlsx');
    const d = t.repos.getDebtByLoanId('A-1')!;
    const ev = t.repos.listEvents(d.id)[0];
    expect(() => t.deleteEvent(ev.id)).toThrow(/Confirm/);
    expect(() => t.deleteDebt(d.id)).toThrow(/Confirm/);
  });
});

describe('monthly workflow and AT13 closed-month protection', async () => {
  const t = await sampleTreasury();

  it('creates a month from the budget, adds a transfer, completes and closes it', () => {
    expect(t.proposedNextMonth()).toBe('2026-10');
    const mId = t.createMonth({ month: '2026-10', source: 'budget' });
    let v = t.monthView(mId);
    expect(v.result.status).toBe('READY_TO_TRANSFER');
    expect(v.result.totals.budget).toBe('4690.96');

    t.addTransfer(mId, {
      entryDate: '2026-10-03',
      loanId: 'H-01',
      description: 'Brakes payment',
      fromAccountId: id(t, 'PETC'),
      toAccountId: id(t, 'LTS'),
      amount: '100',
    });
    v = t.monthView(mId);
    const petc = v.result.lines.find((l) => t.codeOf(l.accountId) === 'PETC')!;
    expect(petc.transfersOut).toBe('100');
    expect(v.entries[0].debtSuggestion).toMatchObject({ loanId: 'H-01', change: '-100' });

    // Record the suggested debt payment once; a second attempt is refused.
    t.recordEntryOnDebt(v.entries[0].entry.id);
    expect(t.debtBoard().positions.find((p) => p.debt.loanId === 'H-01')!.currentBalance).toBe('200');
    expect(() => t.recordEntryOnDebt(v.entries[0].entry.id)).toThrow();

    // Allocation change → Review → fix.
    t.setAllocation(mId, id(t, 'HH'), { budgetAmount: '3200' });
    expect(t.monthView(mId).result.status).toBe('REVIEW');
    expect(() => t.closeMonth(mId)).toThrow(/needs review/);
    t.setAllocation(mId, id(t, 'HH'), { budgetAmount: '3137' });

    for (const l of t.monthView(mId).result.lines.filter((x) => x.required))
      t.setTransferState(mId, l.accountId, 'done');
    expect(t.monthView(mId).result.status).toBe('COMPLETE');

    t.closeMonth(mId);
    expect(() =>
      t.addTransfer(mId, {
        description: 'x',
        fromAccountId: id(t, 'HH'),
        toAccountId: id(t, 'LTS'),
        amount: '1',
      }),
    ).toThrow(/closed/);
    expect(() => t.setAllocation(mId, id(t, 'HH'), { budgetAmount: '1' })).toThrow(/closed/);
    t.reopenMonth(mId);
    t.setAllocation(mId, id(t, 'HH'), { budgetAmount: '3000' });
    expect(t.monthView(mId).result.status).toBe('REVIEW');
    t.closeMonth(mId, 'Deliberate test override');
    expect(t.repos.getMonth(mId)!.closeOverrideNote).toBe('Deliberate test override');
  });

  it('a transfer that overdraws an account puts the month in Review', () => {
    const sep = t.repos.getMonthByKey('2026-09')!.id;
    t.addTransfer(sep, {
      description: 'Too much',
      fromAccountId: id(t, 'GIFT'),
      toAccountId: id(t, 'ENT'),
      amount: '75',
    });
    const r = t.monthView(sep).result;
    expect(r.status).toBe('REVIEW');
    expect(r.lines.find((l) => t.codeOf(l.accountId) === 'GIFT')).toMatchObject({
      finalTransfer: '-15',
      negative: true,
    });
    t.undo();
    expect(t.monthView(sep).result.status).toBe('READY_TO_TRANSFER');
  });

  it('rejects invalid transfers at the API boundary', () => {
    const mId = t.createMonth({
      month: '2026-11',
      source: 'duplicate',
      duplicateFromMonthId: t.repos.getMonthByKey('2026-09')!.id,
    });
    const base = { description: 'x', fromAccountId: id(t, 'HH'), toAccountId: id(t, 'PETC'), amount: '5' };
    expect(() => t.addTransfer(mId, { ...base, fromAccountId: '' })).toThrow(/From account/);
    expect(() => t.addTransfer(mId, { ...base, toAccountId: '' })).toThrow(/To account/);
    expect(() => t.addTransfer(mId, { ...base, toAccountId: base.fromAccountId })).toThrow(/differ/);
    expect(() => t.addTransfer(mId, { ...base, amount: '0' })).toThrow(/greater than zero/);
    expect(() => t.addTransfer(mId, { ...base, amount: '-5' })).toThrow(/greater than zero/);
    expect(t.monthView(mId).entries).toHaveLength(0);
  });
});

describe('accounts', async () => {
  const t = await sampleTreasury();
  it('refuses to delete referenced accounts and allows archiving', () => {
    expect(() => t.deleteAccount(id(t, 'HH'))).toThrow(/Archive/);
    t.updateAccount(id(t, 'GIFT'), { active: false });
    expect(t.repos.getAccountByCode('GIFT')!.active).toBe(false);
    const a = t.createAccount({ code: 'new1' });
    expect(a.code).toBe('NEW1');
    t.deleteAccount(a.id);
    t.addAlias('Biscuit', id(t, 'PETC'));
    expect(() => t.createAccount({ code: 'biscuit' })).toThrow(/alias/);
  });
});

describe('budget → treasury synchronization', async () => {
  const t = await sampleTreasury();
  const active = t.budget.activeVersion()!;
  const postings = () => tableCounts(t).journal_postings;
  const postingsBefore = postings();
  const oct = t.createMonth({ month: '2026-10', source: 'budget' });

  it('T16 creates a month from the active plan: take-home, funding by account, version recorded, no postings', () => {
    expect(t.repos.getMonth(oct)!).toMatchObject({
      expectedCash: '4690.96',
      budgetVersionId: active.id,
      expectedCashOrigin: 'budget',
    });
    expect(t.monthView(oct).result.status).toBe('READY_TO_TRANSFER');
    expect(alloc(t, oct, 'PETC')).toMatchObject({
      budgetAmount: '180',
      plannedAmount: '180',
      origin: 'budget',
    });
    expect(alloc(t, oct, 'ENT').budgetAmount).toBe('538.96');
    expect(postings()).toBe(postingsBefore);
    expect(t.budget.repos.getVersion(active.id)!.lockedAt).not.toBeNull();
    expect(t.budgetDiff(oct)!.hasChanges).toBe(false);
  });

  it('T17 a locked version refuses edits', () => {
    const line = t.budget.repos.listLines(active.id)[0];
    expect(() => t.budget.updateLine(line.id, { ...line, monthlyAmount: '1' })).toThrow(/locked/);
    expect(() => t.budget.setGross(active.id, '1')).toThrow(/locked/);
  });

  it('treats a manual allocation as an override and never writes it back to the budget', () => {
    t.setAllocation(oct, id(t, 'HH'), { budgetAmount: '3200' });
    expect(alloc(t, oct, 'HH')).toMatchObject({ budgetAmount: '3200', origin: 'manual_override' });
    expect(
      t.budget.compute(active.id).budget.byFundingAccount.find((f) => f.accountId === id(t, 'HH'))!.amount,
    ).toBe('3137');
    t.setTransferState(oct, id(t, 'TRV'), 'done');
  });

  it('shows differences after a new version is activated, and refreshes only on request', () => {
    const draft = t.budget.duplicateVersion(active.id, 'Fall plan');
    const trip = t.budget.repos.listLines(draft).find((l) => l.label === 'Summer trip fund')!;
    t.budget.updateLine(trip.id, { ...trip, monthlyAmount: '200' });
    t.budget.activate(draft, '2026-10');
    expect(t.budget.repos.getVersion(active.id)).toMatchObject({
      status: 'archived',
      effectiveTo: '2026-09',
    });

    // Nothing changed silently.
    expect(alloc(t, oct, 'TRV').budgetAmount).toBe('125');
    const diff = t.budgetDiff(oct)!;
    expect(diff.hasChanges).toBe(true);
    expect(diff.rows.find((r) => r.accountId === id(t, 'TRV'))).toMatchObject({
      current: '125',
      proposed: '200',
      resetsDone: true,
    });
    expect(diff.rows.find((r) => r.accountId === id(t, 'HH'))).toMatchObject({
      overridden: true,
      after: '3200',
    });

    t.refreshMonthFromBudget(oct);
    expect(alloc(t, oct, 'TRV')).toMatchObject({
      budgetAmount: '200',
      transferState: 'pending',
      origin: 'budget',
    });
    expect(alloc(t, oct, 'HH')).toMatchObject({ budgetAmount: '3200', origin: 'manual_override' });
    expect(t.repos.getMonth(oct)!.budgetVersionId).toBe(draft);
    expect(postings()).toBe(postingsBefore);

    t.refreshMonthFromBudget(oct, { resetOverrides: true });
    expect(alloc(t, oct, 'HH').origin).toBe('budget');
    expect(t.monthView(oct).result.checks.allocation).toBe(true);
  });

  it('closed months keep their snapshot', () => {
    const aug = t.repos.getMonthByKey('2026-08')!.id;
    const snapshot = JSON.stringify(t.repos.listAllocations(aug));
    expect(() => t.refreshMonthFromBudget(aug)).toThrow(/closed/);
    expect(JSON.stringify(t.repos.listAllocations(aug))).toBe(snapshot);
  });

  it('refuses to activate invalid budgets and to delete used versions', () => {
    const draft = t.budget.duplicateVersion(t.budget.activeVersion()!.id, 'bad');
    const rent = t.budget.repos.listLines(draft).find((l) => l.label === 'Rent')!;
    t.budget.updateLine(rent.id, { ...rent, monthlyAmount: '99999' });
    expect(() => t.budget.activate(draft, '2026-11')).toThrow(/exceed take-home/);
    expect(() => t.budget.deleteVersion(t.budget.activeVersion()!.id)).toThrow(/Only drafts/);
    t.budget.deleteVersion(draft);
  });
});

describe('tax rules are editable per year', async () => {
  const t = await sampleTreasury();
  it('copies a year as provisional, edits brackets, and reflects it in the estimate', () => {
    t.budget.copyTaxYear(2026, 2027);
    const ca = t.budget.repos.getRuleSet(2027, 'california')!;
    expect(ca).toMatchObject({ provisional: true, ratesFromYear: 2025 });
    const rules = ca.rules as Record<string, unknown>;
    t.budget.saveRuleSet({
      taxYear: 2027,
      jurisdiction: 'california',
      ratesFromYear: 2027,
      provisional: false,
      rules: { ...rules, standardDeduction: '6000' },
    });
    // Locked versions keep their tax year editable: it never changes treasury amounts.
    const v = t.budget.activeVersion()!;
    t.budget.updateVersionInfo(v.id, { taxYear: 2027 });
    const est = t.budget.versionView(v.id).tax!;
    expect(est.california.standardDeduction).toBe('6000');
    expect(est.provenance.find((p) => p.jurisdiction === 'california')).toMatchObject({
      taxYear: 2027,
      ratesFromYear: 2027,
      provisional: false,
    });
    expect(t.budget.versionView(v.id).payroll!.takeHome).toBe('4690.96');
    expect(() =>
      t.budget.saveRuleSet({
        taxYear: 2027,
        jurisdiction: 'fica',
        ratesFromYear: 2027,
        provisional: false,
        rules: { socialSecurityRate: '6.2' },
      }),
    ).toThrow();
    t.budget.updateVersionInfo(v.id, { taxYear: 2030 });
    expect(t.budget.versionView(v.id).taxError).toMatch(/No federal, california, fica tax rules for 2030/);
  });
});

describe('AT14 backup and restore', async () => {
  const t = await sampleTreasury();
  t.addTransfer(t.repos.getMonthByKey('2026-09')!.id, {
    description: 'x',
    fromAccountId: id(t, 'HH'),
    toAccountId: id(t, 'PETC'),
    amount: '12.345',
  });

  it('restores into a fresh database with identical counts, IDs, money strings, statuses and debt controls', async () => {
    const json = JSON.stringify(createBackup(t.db));
    expect(readBackup(json).summary.counts.debt_events).toBe(11);
    const bytes = buildDatabaseFromBackup(await loadSqlJs(), readBackup(json).backup);
    const storage = new MemoryStorage();
    await storage.save('restored', bytes);
    const r = await Treasury.open({ SQL: await loadSqlJs(), storage, profile: 'restored' });

    const dump = (x: Treasury) => ({
      accounts: x.accounts(),
      aliases: x.aliases(),
      months: x.monthSummaries(),
      entries: x.repos.listAllEntries(),
      events: x.repos.listAllEvents(),
      debts: x.repos.listDebts(),
      versions: x.budget.versions(),
      view: x.budget.versionView(x.budget.activeVersion()!.id),
      rules: x.budget.ruleSets(),
    });
    expect(dump(r)).toEqual(dump(t));
    expect(debtControls(r)).toEqual(debtControls(t));
    expect(
      r.repos
        .listAllEntries()
        .flatMap((e) => e.postings)
        .some((p) => p.amount === '12.345'),
    ).toBe(true);
  });

  it('fails clearly on unknown future schema versions without partial restore', () => {
    const b = createBackup(t.db);
    expect(() => readBackup(JSON.stringify({ ...b, schemaVersion: 99 }))).toThrow(
      /newer than this application/,
    );
    expect(() => readBackup('{"format":"other"}')).toThrow(/not a Personal Treasury backup/);
  });
});

describe('AT15 Excel export round trip', async () => {
  const t = await sampleTreasury();
  const sep = t.repos.getMonthByKey('2026-09')!.id;
  t.addAdvancedEntry(sep, {
    description: 'split',
    postings: [
      { accountId: id(t, 'HH'), amount: '-100' },
      { accountId: id(t, 'PETC'), amount: '60' },
      { accountId: id(t, 'LTS'), amount: '40' },
    ],
  });
  const bytes = exportWorkbook(t);
  const t2 = await freshTreasury();
  const { plan } = await importInto(t2, bytes, 'export.xlsx');

  it('re-imports with every control passing and no fatal problems', () => {
    expect(plan.fatal).toBe(false);
    expect(plan.controls.filter((c) => !c.pass)).toEqual([]);
  });

  it('matches accounts, allocations, postings, debts, events and controls', () => {
    const acc = (x: Treasury) =>
      x.accounts().map((a) => ({ code: a.code, d: a.description, active: a.active, review: a.needsReview }));
    expect(acc(t2)).toEqual(acc(t));
    const months = (x: Treasury) =>
      x.monthSummaries().map((m) => {
        const v = x.monthView(m.id);
        return {
          month: m.month,
          status: m.status,
          expected: m.expectedCash,
          closed: !!m.closedAt,
          alloc: x.repos
            .listAllocations(m.id)
            .map((a) => [x.codeOf(a.accountId), a.budgetAmount, a.transferState]),
          // Two-leg transfers are exported From-then-To, so compare their legs as a set;
          // multi-posting entries keep their exact source order.
          postings: v.entries.map((e) => {
            const legs = e.entry.postings.map((p) => [x.codeOf(p.accountId), p.amount]);
            return e.simple ? legs.sort((a, b) => a[0].localeCompare(b[0])) : legs;
          }),
          loanIds: v.entries.map((e) => e.entry.loanId),
        };
      });
    expect(months(t2)).toEqual(months(t));
    const debts = (x: Treasury) =>
      x.debtBoard().positions.map((p) => ({
        loan: p.debt.loanId,
        desc: p.debt.description,
        opened: p.debt.openedDate,
        terms: p.debt.terms,
        by: x.codeOf(p.debt.originDebtorAccountId),
        to: x.codeOf(p.debt.originCreditorAccountId),
        events: p.events.map((e) => [e.eventDate, e.changeAmount, e.description, e.notes]),
      }));
    expect(debts(t2)).toEqual(debts(t));
    expect(debtControls(t2)).toEqual(debtControls(t));
  });

  it('keeps hyphenated Loan IDs as text and writes no formula errors', () => {
    const wb = XLSX.read(bytes, { type: 'array', cellFormula: true });
    const ledger = wb.Sheets['Account Ledger'];
    const ids = Object.keys(ledger)
      .filter((k) => /^A\d+$/.test(k) && Number(k.slice(1)) > 4)
      .map((k) => ledger[k]);
    expect(ids.find((c) => c.v === 'H-01')!.t).toBe('s');
    for (const n of wb.SheetNames)
      for (const [k, c] of Object.entries(wb.Sheets[n]))
        if (!k.startsWith('!')) expect((c as XLSX.CellObject).t, `${n}!${k}`).not.toBe('e');
    // No legacy allocation template in a budget-driven household, so no Monthly Template sheet.
    expect(wb.SheetNames.slice(0, 2)).toEqual(['Overview', 'Account Ledger']);
    expect(wb.SheetNames).toEqual(expect.arrayContaining(['2026-06', '2026-07', '2026-08', '2026-09']));
    expect(wb.SheetNames).toContain('Interco Debt Summary');
  });

  it('analyzing the export does not mutate the source database', async () => {
    const before = t.debtBoard().summary.totalOutstanding;
    await analyzeWorkbook(bytes, 'export.xlsx');
    expect(t.debtBoard().summary.totalOutstanding).toBe(before);
  });
});
