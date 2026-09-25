import { type Money, ZERO, dec, max, normalize, sub, sum } from './money';

export type DeductionTiming = 'pretax' | 'posttax';
export type DeductionMethod = 'fixed' | 'rate_of_gross_less_exclusion';
export type WithholdingComponent = 'federal' | 'california' | 'social_security' | 'medicare';

export const WITHHOLDING_COMPONENTS: WithholdingComponent[] = [
  'federal',
  'california',
  'social_security',
  'medicare',
];
export const WITHHOLDING_LABEL: Record<WithholdingComponent, string> = {
  federal: 'Federal income tax',
  california: 'California income tax',
  social_security: 'Social Security',
  medicare: 'Medicare',
};

/**
 * A payroll deduction as entered by the user. `monthlyAmount` is the positive
 * amount taken from pay; a negative amount (such as an employer benefit credit)
 * offsets other deductions. The flags record which wage bases it reduces.
 */
export interface PayrollDeduction {
  id: string;
  label: string;
  position: number;
  timing: DeductionTiming;
  method: DeductionMethod;
  monthlyAmount: Money | null;
  rate: Money | null;
  monthlyExclusion: Money | null;
  reducesFederalIncome: boolean;
  reducesCaIncome: boolean;
  reducesFicaWages: boolean;
  notes?: string | null;
}

export interface PayrollInput {
  grossMonthly: Money;
  deductions: PayrollDeduction[];
  /** Actual withholding from the pay stub: hard inputs, never estimates. */
  withholdings: Partial<Record<WithholdingComponent, Money>>;
}

export interface ResolvedDeduction extends PayrollDeduction {
  amount: Money;
}

export interface PayrollResult {
  gross: Money;
  deductions: ResolvedDeduction[];
  pretaxTotal: Money;
  posttaxTotal: Money;
  withholdings: Record<WithholdingComponent, Money>;
  withholdingTotal: Money;
  takeHome: Money;
  /** Monthly wage bases after the deductions flagged to reduce them. */
  wages: { federal: Money; california: Money; fica: Money };
}

/** Fixed amount, or rate × (gross − exclusion) floored at zero (e.g. 5% × (gross − 1000)). */
export function deductionAmount(d: PayrollDeduction, gross: Money): Money {
  if (d.method === 'fixed') return normalize(d.monthlyAmount ?? ZERO);
  const base = max(sub(gross, d.monthlyExclusion ?? ZERO), ZERO);
  return normalize(dec(base).times(dec(d.rate ?? ZERO)));
}

export function computePayroll(input: PayrollInput): PayrollResult {
  const gross = normalize(input.grossMonthly);
  const deductions = [...input.deductions]
    .sort((a, b) => a.position - b.position)
    .map((d) => ({ ...d, amount: deductionAmount(d, gross) }));
  const withholdings = Object.fromEntries(
    WITHHOLDING_COMPONENTS.map((c) => [c, normalize(input.withholdings[c] ?? ZERO)]),
  ) as Record<WithholdingComponent, Money>;
  const pretaxTotal = sum(deductions.filter((d) => d.timing === 'pretax').map((d) => d.amount));
  const posttaxTotal = sum(deductions.filter((d) => d.timing === 'posttax').map((d) => d.amount));
  const withholdingTotal = sum(Object.values(withholdings));
  const reduce = (flag: (d: PayrollDeduction) => boolean) =>
    sub(gross, sum(deductions.filter((d) => d.timing === 'pretax' && flag(d)).map((d) => d.amount)));
  return {
    gross,
    deductions,
    pretaxTotal,
    posttaxTotal,
    withholdings,
    withholdingTotal,
    takeHome: sub(sub(sub(gross, pretaxTotal), posttaxTotal), withholdingTotal),
    wages: {
      federal: reduce((d) => d.reducesFederalIncome),
      california: reduce((d) => d.reducesCaIncome),
      fica: reduce((d) => d.reducesFicaWages),
    },
  };
}
