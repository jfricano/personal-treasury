import type { SqlJsStatic } from 'sql.js';
import { Treasury } from '@/api/treasury';
import { MemoryStorage } from '@/db/storage';
import { CATEGORIES } from '@/import/budget/analyzeBudget';
import type { Jurisdiction } from '@/domain/tax/rules';
import {
  ACCOUNTS,
  CURRENT_PLAN,
  DEDUCTIONS,
  EARLIER_PLAN,
  EXTRA_CATEGORIES,
  HOUSEHOLD,
  LINES,
  TAX_RULES,
  type PersonaVersion,
} from './persona';

const pad = (n: number) => String(n).padStart(2, '0');

export const monthKeyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
}

/** Month keys the seed uses, oldest first: three closed months and the current one. */
export function seedMonths(today: Date) {
  const current = monthKeyOf(today);
  return { m3: addMonths(current, -3), m2: addMonths(current, -2), m1: addMonths(current, -1), m0: current };
}

/**
 * Populate an empty treasury with the Harper household (see persona.ts).
 * Everything goes through the public service API, so the sample data passes
 * the same validation, lifecycle rules and audit as data a person enters.
 * Dates are relative to `today`, so the demo never looks stale.
 */
export function seedHarpers(t: Treasury, today: Date = new Date()) {
  if (!t.isEmpty()) throw new Error('The sample data can only be loaded into an empty database.');
  const { m3, m2, m1, m0 } = seedMonths(today);
  const year = today.getFullYear();
  // Current-month entries never get a date after today.
  const on = (month: string, day: number) =>
    `${month}-${pad(month === m0 ? Math.min(day, today.getDate()) : day)}`;

  // Accounts
  const acct: Record<string, string> = {};
  for (const a of ACCOUNTS) acct[a.code] = t.createAccount(a).id;

  // Budget categories: the standard set plus two of the family's own.
  const categoryId: Record<string, string> = {};
  for (const line of LINES) {
    if (categoryId[line.category]) continue;
    const std = CATEGORIES.find((c) => c.name === line.category);
    const extra = EXTRA_CATEGORIES.find((c) => c.name === line.category);
    categoryId[line.category] = t.budget.addCategory(
      line.category,
      std?.description ?? extra?.description ?? null,
    );
  }

  // Tax rules for the current year; figures from another year are marked provisional.
  for (const [jurisdiction, r] of Object.entries(TAX_RULES) as [
    Jurisdiction,
    (typeof TAX_RULES)[Jurisdiction],
  ][]) {
    t.budget.saveRuleSet({
      taxYear: year,
      jurisdiction,
      ratesFromYear: r.ratesFromYear,
      provisional: r.ratesFromYear !== year,
      rules: r.rules,
      sourceNote:
        r.ratesFromYear === year
          ? `Published ${r.ratesFromYear} figures (demo sample).`
          : `Uses ${r.ratesFromYear} published figures for ${year} (demo sample).`,
    });
  }

  const setPayroll = (versionId: string, p: PersonaVersion) => {
    t.budget.updateVersionInfo(versionId, { notes: p.notes, taxYear: year });
    t.budget.setGross(versionId, p.grossMonthly);
    for (const [component, amount] of Object.entries(p.withholdings))
      t.budget.setWithholding(versionId, component as keyof PersonaVersion['withholdings'], amount);
  };

  // Earlier plan: drives the two oldest months.
  const v1 = t.budget.createDraft(EARLIER_PLAN.label);
  setPayroll(v1, EARLIER_PLAN);
  for (const d of DEDUCTIONS) t.budget.addDeduction(v1, d);
  for (const line of LINES) {
    const amount = EARLIER_PLAN.amounts[line.key];
    t.budget.addLine(v1, {
      categoryId: categoryId[line.category],
      label: line.label,
      kind: amount === null ? 'residual' : 'amount',
      monthlyAmount: amount,
      fundingAccountId: acct[line.funding],
    });
  }
  t.budget.activate(v1, m3);

  const transfer = (
    monthId: string,
    date: string,
    from: string,
    to: string,
    amount: string,
    description: string,
    extra: { loanId?: string; notes?: string } = {},
  ) => {
    const e = t.addTransfer(monthId, {
      entryDate: date,
      description,
      fromAccountId: acct[from],
      toAccountId: acct[to],
      amount,
      ...extra,
    });
    // A transfer that names a Loan ID is also recorded once on that debt.
    if (extra.loanId) t.recordEntryOnDebt(e.entry.id);
  };
  const debt = (
    loanId: string,
    openedDate: string,
    debtor: string,
    creditor: string,
    amount: string,
    description: string,
    extra: { terms?: string; notes?: string } = {},
  ) =>
    t.createDebt({
      loanId,
      openedDate,
      description,
      debtorAccountId: acct[debtor],
      creditorAccountId: acct[creditor],
      openingChange: amount,
      ...extra,
    });
  const markDone = (monthId: string, codes?: string[]) => {
    for (const l of t.monthView(monthId).result.lines)
      if (l.required && (!codes || codes.includes(t.codeOf(l.accountId))))
        t.setTransferState(monthId, l.accountId, 'done');
  };

  // Three months ago: the car needed brakes, so PETC borrowed from savings.
  const month3 = t.createMonth({ month: m3, source: 'budget' });
  debt('H-01', on(m3, 9), 'PETC', 'LTS', '600', 'New brakes and tires', {
    terms: '$100 a month from PETC',
  });
  transfer(month3, on(m3, 18), 'ENT', 'PETC', '45', 'Extra vet visit for Biscuit');
  markDone(month3);
  t.closeMonth(month3);

  // Two months ago: the first brake payment, and two small loans between buckets.
  const month2 = t.createMonth({ month: m2, source: 'budget' });
  transfer(month2, on(m2, 5), 'PETC', 'LTS', '100', 'Brakes payment', { loanId: 'H-01' });
  transfer(month2, on(m2, 20), 'ENT', 'GIFT', '40', 'Holiday gift top-up');
  debt('H-02', on(m2, 14), 'ENT', 'TRV', '180', 'Concert tickets', { terms: 'Repay next month' });
  debt('H-03', on(m2, 22), 'KIDS', 'ENT', '85', 'Soccer cleats and uniform', { terms: 'Repay next month' });
  markDone(month2);
  t.closeMonth(month2);

  // Last month: Sam's raise takes effect through a new budget version.
  const v2 = t.budget.duplicateVersion(v1, CURRENT_PLAN.label);
  setPayroll(v2, CURRENT_PLAN);
  for (const line of t.budget.versionView(v2).lines) {
    const key = LINES.find((l) => l.label === line.label)!.key;
    const amount = CURRENT_PLAN.amounts[key];
    if (amount !== null && amount !== EARLIER_PLAN.amounts[key]) {
      t.budget.updateLine(line.id, {
        categoryId: line.categoryId,
        label: line.label,
        kind: line.kind,
        monthlyAmount: amount,
        fundingAccountId: line.fundingAccountId,
      });
    }
  }
  t.budget.activate(v2, m1);

  const month1 = t.createMonth({ month: m1, source: 'budget' });
  transfer(month1, on(m1, 5), 'PETC', 'LTS', '100', 'Brakes payment', { loanId: 'H-01' });
  transfer(month1, on(m1, 6), 'ENT', 'TRV', '180', 'Concert tickets repaid', { loanId: 'H-02' });
  // Paid back $120 on an $85 loan: the balance crosses zero and the direction reverses.
  transfer(month1, on(m1, 8), 'KIDS', 'ENT', '120', 'Cleats repaid (overpaid by $35)', { loanId: 'H-03' });
  debt('H-04', on(m1, 12), 'KIDS', 'HH', '150', 'School trip deposit', {
    notes: 'Trip canceled; waiting on the refund before settling.',
  });
  debt('H-05', on(m1, 16), 'TRV', 'LTS', '400', 'Holiday flights', { terms: '$100 a month' });
  markDone(month1);
  t.closeMonth(month1);

  // This month: in progress, some transfers still to make.
  const month0 = t.createMonth({ month: m0, source: 'budget' });
  transfer(month0, on(m0, 1), 'PETC', 'LTS', '100', 'Brakes payment', { loanId: 'H-01' });
  transfer(month0, on(m0, 2), 'TRV', 'LTS', '100', 'Flights payment', { loanId: 'H-05' });
  transfer(month0, on(m0, 3), 'ENT', 'KIDS', '25', 'School book fair');
  markDone(month0, ['HH', 'LTS', 'KIDS']);

  // Start the audit trail at the point the sample data was loaded.
  t.db.run('DELETE FROM audit_log');
  t.repos.audit('seed', 'database', null, null, null, `Loaded sample data: ${HOUSEHOLD.name}`);
}

/** Build the sample database in memory and return it as SQLite file bytes. */
export async function buildSampleDatabase(SQL: SqlJsStatic, today: Date = new Date()): Promise<Uint8Array> {
  const t = await Treasury.open({ SQL, storage: new MemoryStorage(), profile: 'sample' });
  seedHarpers(t, today);
  await t.flush();
  return t.db.export();
}

/** A freshly migrated empty database, identical to a first launch of the desktop app. */
export async function buildBlankDatabase(SQL: SqlJsStatic): Promise<Uint8Array> {
  const t = await Treasury.open({ SQL, storage: new MemoryStorage(), profile: 'blank' });
  return t.db.export();
}
