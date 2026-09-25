import { describe, expect, it } from 'vitest';
import { computePayroll, type PayrollDeduction } from '@/domain/payroll';
import { computeBudget, diffMonthAgainstBudget, type BudgetLine } from '@/domain/budget';
import { MissingTaxRulesError, estimateTax, progressiveTax } from '@/domain/tax/estimate';
import { parseRules, type TaxRuleSet } from '@/domain/tax/rules';
import { CURRENT_PLAN, DEDUCTIONS, LINES, TAX_RULES } from '@/demo/persona';

const ded = (
  label: string,
  amount: string | null,
  flags: [boolean, boolean, boolean],
  extra: Partial<PayrollDeduction> = {},
): PayrollDeduction => ({
  id: label,
  label,
  position: 0,
  timing: 'pretax',
  method: 'fixed',
  monthlyAmount: amount,
  rate: null,
  monthlyExclusion: null,
  reducesFederalIncome: flags[0],
  reducesCaIncome: flags[1],
  reducesFicaWages: flags[2],
  ...extra,
});

/** The Harper household's current plan (src/demo/persona.ts); expected values are worked by hand. */
export const harpers = {
  grossMonthly: CURRENT_PLAN.grossMonthly,
  deductions: DEDUCTIONS.map((d, i) =>
    ded(d.label, d.monthlyAmount ?? null, [d.reducesFederalIncome, d.reducesCaIncome, d.reducesFicaWages], {
      position: i,
      timing: d.timing,
      method: d.method,
      rate: d.rate ?? null,
      monthlyExclusion: d.monthlyExclusion ?? null,
    }),
  ),
  withholdings: CURRENT_PLAN.withholdings,
};

const rs = (jurisdiction: TaxRuleSet['jurisdiction'], taxYear = 2026): TaxRuleSet => ({
  id: `${jurisdiction}${taxYear}`,
  taxYear,
  jurisdiction,
  filingStatus: 'single',
  ratesFromYear: TAX_RULES[jurisdiction].ratesFromYear,
  provisional: TAX_RULES[jurisdiction].ratesFromYear !== taxYear,
  rules: parseRules(jurisdiction, TAX_RULES[jurisdiction].rules),
  sourceNote: null,
});
export const rules2026: TaxRuleSet[] = [rs('federal'), rs('california'), rs('fica')];

describe('payroll (T1, T2)', () => {
  const p = computePayroll(harpers);
  it('computes the 401(k) as 5% of gross with no exclusion', () => {
    expect(p.deductions.find((d) => d.label.startsWith('401(k)'))!.amount).toBe('325');
  });
  it('reproduces take-home pay exactly from actual withholding', () => {
    expect(p.pretaxTotal).toBe('563');
    expect(p.posttaxTotal).toBe('12');
    expect(p.withholdingTotal).toBe('1234.04');
    expect(p.takeHome).toBe('4690.96');
  });
  it('reduces each wage base only by the deductions flagged for it', () => {
    expect(p.wages.federal).toBe('5937');
    expect(p.wages.california).toBe('5937');
    expect(p.wages.fica).toBe('6262');
  });
});

describe('tax estimate (T3–T7)', () => {
  const e = estimateTax(computePayroll(harpers), 2026, rules2026);
  const c = (k: string) => e.components.find((x) => x.component === k)!;
  it('converts bracket increments into cumulative rates', () => {
    expect(rules2026[0].rules).toMatchObject({
      brackets: [
        { rate: '0.1' },
        { rate: '0.12' },
        { rate: '0.22' },
        { rate: '0.24' },
        { rate: '0.32' },
        { rate: '0.35' },
        { rate: '0.37' },
      ],
    });
  });
  it('federal: taxable 55,144 → $6,844', () => {
    expect(e.federal.taxable).toBe('55144');
    expect(e.federal.tax).toBe('6843.68');
    expect(c('federal').liabilityRounded).toBe('6844');
  });
  it('California: taxable 65,538 → $2,474 after the $153 credit', () => {
    expect(e.california.taxable).toBe('65538');
    expect(c('california').liabilityRounded).toBe('2474');
  });
  it('employment: FICA wages 75,144 → $5,749 combined', () => {
    expect(e.annualWages.fica).toBe('75144');
    expect(c('social_security').liability).toBe('4658.928');
    expect(c('medicare').liability).toBe('1089.588');
    expect(e.employment.liabilityRounded).toBe('5749');
  });
  it('totals $15,067 liability vs $14,808.48 withheld → $258.52 projected underpayment', () => {
    expect(e.total).toEqual({ liabilityRounded: '15067', withheld: '14808.48', difference: '258.52' });
    expect(c('federal').difference).toBe('124');
    expect(c('california').difference).toBe('134');
    expect(e.employment.difference).toBe('0.52');
  });
  it('reports that California uses 2025 rates for 2026', () => {
    expect(e.provenance.find((p) => p.jurisdiction === 'california')).toMatchObject({
      taxYear: 2026,
      ratesFromYear: 2025,
      provisional: true,
    });
  });
});

describe('tax rules edge cases (T10–T15)', () => {
  const fed = rules2026[0].rules as { brackets: { threshold: string; rate: string }[] };
  it('T10 federal bracket edges', () => {
    expect(progressiveTax('12400', fed.brackets)).toBe('1240');
    expect(progressiveTax('12401', fed.brackets)).toBe('1240.12');
    expect(progressiveTax('0', fed.brackets)).toBe('0');
  });
  it('T11 Social Security wage base and Additional Medicare', () => {
    const p = computePayroll({ grossMonthly: '20833.333333333333', deductions: [], withholdings: {} });
    const e = estimateTax(
      { ...p, gross: p.gross, wages: { ...p.wages, fica: String(250000 / 12) } },
      2026,
      rules2026,
    );
    const ss = e.components.find((x) => x.component === 'social_security')!;
    const med = e.components.find((x) => x.component === 'medicare')!;
    expect(ss.liabilityRounded).toBe('11439');
    expect(med.liabilityRounded).toBe('4075');
  });
  it('T12 deduction flags: 457(b) spares FICA wages; Section 125 reduces all three', () => {
    const base = { grossMonthly: '10000', withholdings: {} };
    const a = computePayroll({ ...base, deductions: [ded('457(b)', '1000', [true, true, false])] });
    expect(a.wages).toEqual({ federal: '9000', california: '9000', fica: '10000' });
    const b = computePayroll({ ...base, deductions: [ded('Health', '1000', [true, true, true])] });
    expect(b.wages).toEqual({ federal: '9000', california: '9000', fica: '9000' });
  });
  it('T13 the California exemption credit never makes tax negative', () => {
    const e = estimateTax(
      computePayroll({ grossMonthly: '1000', deductions: [], withholdings: {} }),
      2026,
      rules2026,
    );
    expect(e.california.tax).toBe('0');
  });
  it('T14 a missing tax year is an error, never a silent fallback; years give different results', () => {
    expect(() => estimateTax(computePayroll(harpers), 2027, rules2026)).toThrow(MissingTaxRulesError);
    const alt = rules2026.map((r) =>
      r.jurisdiction === 'federal'
        ? { ...r, taxYear: 2027, rules: { ...(r.rules as object), standardDeduction: '20000' } }
        : { ...r, taxYear: 2027 },
    );
    const a = estimateTax(computePayroll(harpers), 2026, rules2026);
    const b = estimateTax(computePayroll(harpers), 2027, alt);
    expect(a.federal.tax).not.toBe(b.federal.tax);
  });
  it('T15 the estimate never changes take-home pay', () => {
    const p = computePayroll(harpers);
    estimateTax(p, 2026, rules2026);
    expect(p.takeHome).toBe('4690.96');
  });
  it('rejects malformed rules', () => {
    expect(() =>
      parseRules('federal', { brackets: [{ threshold: '10', rate: '0.1' }], standardDeduction: '1' }),
    ).toThrow(/start at 0/);
    expect(() => parseRules('fica', { socialSecurityRate: '6.2' })).toThrow();
  });
});

describe('budget (T8, T9) and month diff', () => {
  const L = (
    id: string,
    cat: string,
    amount: string | null,
    acct: string,
    kind: BudgetLine['kind'] = 'amount',
  ): BudgetLine => ({
    id,
    categoryId: cat,
    label: id,
    position: 0,
    kind,
    monthlyAmount: amount,
    fundingAccountId: acct,
  });
  const lines = LINES.map((l) => {
    const amount = CURRENT_PLAN.amounts[l.key];
    return L(l.key, l.category, amount, l.funding, amount === null ? 'residual' : 'amount');
  });
  const b = computeBudget('4690.96', lines);
  it('funds each treasury account, with the remainder going to ENT', () => {
    const f = Object.fromEntries(b.byFundingAccount.map((x) => [x.accountId, x.amount]));
    expect(f).toEqual({
      HH: '3137',
      CLTH: '90',
      KIDS: '260',
      PETC: '180',
      LTS: '300',
      TRV: '125',
      GIFT: '60',
      ENT: '538.96',
    });
    expect(b.totalAllocated).toBe('4690.96');
    expect(b.unallocated).toBe('0');
    expect(b.issues).toEqual([]);
  });
  it('flags over-allocation and unmapped lines', () => {
    const bad = computeBudget('100', [
      L('a', 'x', '150', 'HH'),
      { ...L('r', 'x', null, 'ENT', 'residual') },
      { ...L('u', 'x', '1', 'HH'), fundingAccountId: null },
    ]);
    expect(bad.issues.join(' ')).toMatch(/exceed take-home/);
    expect(bad.issues.join(' ')).toMatch(/no funding account/);
  });
  it('diffs a month against the budget, keeping overrides and resetting changed Done lines', () => {
    const d = diffMonthAgainstBudget(
      '4500',
      [
        {
          accountId: 'HH',
          budgetAmount: '3000',
          plannedAmount: '3000',
          origin: 'budget',
          transferState: 'done',
        },
        {
          accountId: 'LTS',
          budgetAmount: '400',
          plannedAmount: '300',
          origin: 'manual_override',
          transferState: 'pending',
        },
      ],
      b,
    );
    const hh = d.rows.find((r) => r.accountId === 'HH')!;
    const lts = d.rows.find((r) => r.accountId === 'LTS')!;
    expect(hh).toMatchObject({ changed: true, resetsDone: true });
    expect(lts).toMatchObject({ overridden: true, after: '400' });
    expect(d.expectedCash).toEqual({ current: '4500', proposed: '4690.96', changed: true });
    expect(
      diffMonthAgainstBudget('4500', [], b, { resetOverrides: true }).rows.find((r) => r.accountId === 'ENT')!
        .after,
    ).toBe('538.96');
  });
});
