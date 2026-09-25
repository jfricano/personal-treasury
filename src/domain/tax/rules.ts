import { z } from 'zod';
import { cmp, isMoney, normalize, sum } from '../money';

/** Tax rules are data, versioned by tax year and jurisdiction, and editable in the app. */
export type Jurisdiction = 'federal' | 'california' | 'fica';
export const JURISDICTIONS: Jurisdiction[] = ['federal', 'california', 'fica'];
export const JURISDICTION_LABEL: Record<Jurisdiction, string> = {
  federal: 'Federal income tax',
  california: 'California income tax',
  fica: 'Social Security and Medicare',
};

const money = z.string().refine(isMoney, 'Enter a decimal number');
const rate = money.refine((v) => cmp(v, '0') >= 0 && cmp(v, '1') <= 0, 'Rates are decimals between 0 and 1');

/** Progressive brackets: `rate` applies to income above `threshold` (cumulative rate, not an increment). */
export const BracketsSchema = z
  .array(z.object({ threshold: money, rate }))
  .min(1, 'At least one bracket is required')
  .refine((b) => cmp(b[0].threshold, '0') === 0, 'The first bracket must start at 0')
  .refine(
    (b) => b.every((x, i) => i === 0 || cmp(x.threshold, b[i - 1].threshold) > 0),
    'Thresholds must increase',
  );

export const FederalRulesSchema = z.object({
  brackets: BracketsSchema,
  standardDeduction: money,
  credits: z.array(z.object({ label: z.string().min(1), amount: money })).default([]),
});

export const CaliforniaRulesSchema = z.object({
  brackets: BracketsSchema,
  standardDeduction: money,
  exemptionCredit: money,
  mentalHealthServicesThreshold: money.default('1000000'),
  mentalHealthServicesRate: rate.default('0.01'),
});

export const FicaRulesSchema = z.object({
  socialSecurityRate: rate,
  socialSecurityWageBase: money,
  medicareRate: rate,
  additionalMedicareRate: rate,
  additionalMedicareThreshold: money,
});

export type FederalRules = z.infer<typeof FederalRulesSchema>;
export type CaliforniaRules = z.infer<typeof CaliforniaRulesSchema>;
export type FicaRules = z.infer<typeof FicaRulesSchema>;
export type Bracket = { threshold: string; rate: string };

export interface TaxRuleSet<R = unknown> {
  id: string;
  taxYear: number;
  jurisdiction: Jurisdiction;
  filingStatus: string;
  /** The year the figures were actually published for (e.g. 2025 California values used for 2026). */
  ratesFromYear: number;
  provisional: boolean;
  rules: R;
  sourceNote: string | null;
}

export const RULE_SCHEMAS = {
  federal: FederalRulesSchema,
  california: CaliforniaRulesSchema,
  fica: FicaRulesSchema,
} as const;

export function parseRules(jurisdiction: Jurisdiction, value: unknown) {
  const r = RULE_SCHEMAS[jurisdiction].safeParse(value);
  if (!r.success) throw new Error(`${JURISDICTION_LABEL[jurisdiction]} rules: ${r.error.issues[0]?.message}`);
  return r.data;
}

/**
 * Convert the workbook's SUMPRODUCT form (thresholds with *incremental* rates,
 * e.g. {0.1, 0.02, 0.1, …}) into cumulative bracket rates (10%, 12%, 22%, …).
 */
export function bracketsFromIncrements(thresholds: string[], increments: string[]): Bracket[] {
  return thresholds.map((threshold, k) => ({
    threshold: normalize(threshold),
    rate: sum(increments.slice(0, k + 1)),
  }));
}
