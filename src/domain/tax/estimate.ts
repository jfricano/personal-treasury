import { type Money, ZERO, Dec, dec, max, normalize, sub, sum } from '../money';
import type { PayrollResult, WithholdingComponent } from '../payroll';
import type { Bracket, CaliforniaRules, FederalRules, FicaRules, Jurisdiction, TaxRuleSet } from './rules';

/**
 * Separate estimate of annual liability, compared with actual withholding.
 * Nothing here feeds take-home pay, the budget or the treasury.
 */

export function progressiveTax(taxable: Money, brackets: Bracket[]): Money {
  let tax = dec(ZERO);
  const t = dec(taxable);
  brackets.forEach((b, i) => {
    const lo = dec(b.threshold);
    if (t.lte(lo)) return;
    const hi = brackets[i + 1] ? Dec.min(t, dec(brackets[i + 1].threshold)) : t;
    tax = tax.plus(hi.minus(lo).times(dec(b.rate)));
  });
  return normalize(tax);
}

/** Round half up to whole dollars (the workbook's ROUND(x, 0) for positive amounts). */
export const wholeDollars = (m: Money): Money => normalize(dec(m).toDecimalPlaces(0, Dec.ROUND_HALF_UP));

export interface TaxComponent {
  component: WithholdingComponent;
  label: string;
  base: Money;
  liability: Money;
  liabilityRounded: Money;
  withheld: Money;
  /** liabilityRounded − withheld: positive = projected underpayment, negative = overpayment. */
  difference: Money;
}

export interface TaxEstimate {
  taxYear: number;
  annualWages: { gross: Money; federal: Money; california: Money; fica: Money };
  federal: { taxable: Money; standardDeduction: Money; tax: Money; credits: Money };
  california: {
    taxable: Money;
    standardDeduction: Money;
    bracketTax: Money;
    exemptionCredit: Money;
    mentalHealthTax: Money;
    tax: Money;
  };
  components: TaxComponent[];
  /** Social Security + Medicare rounded together, as the workbook does. */
  employment: { liabilityRounded: Money; withheld: Money; difference: Money };
  total: { liabilityRounded: Money; withheld: Money; difference: Money };
  provenance: {
    jurisdiction: Jurisdiction;
    taxYear: number;
    ratesFromYear: number;
    provisional: boolean;
    sourceNote: string | null;
  }[];
}

export class MissingTaxRulesError extends Error {
  constructor(
    readonly taxYear: number,
    readonly missing: Jurisdiction[],
  ) {
    super(`No ${missing.join(', ')} tax rules for ${taxYear}. Add or copy a rule set for that year.`);
  }
}

export function estimateTax(payroll: PayrollResult, taxYear: number, ruleSets: TaxRuleSet[]): TaxEstimate {
  const find = <R>(j: Jurisdiction) =>
    ruleSets.find((r) => r.taxYear === taxYear && r.jurisdiction === j) as TaxRuleSet<R> | undefined;
  const fed = find<FederalRules>('federal');
  const ca = find<CaliforniaRules>('california');
  const fica = find<FicaRules>('fica');
  const missing = (['federal', 'california', 'fica'] as Jurisdiction[]).filter((j) => !find(j));
  // Never fall back to another year silently.
  if (missing.length) throw new MissingTaxRulesError(taxYear, missing);

  const annual = (m: Money) => normalize(dec(m).times(12));
  const wages = {
    gross: annual(payroll.gross),
    federal: annual(payroll.wages.federal),
    california: annual(payroll.wages.california),
    fica: annual(payroll.wages.fica),
  };

  const fedTaxable = max(sub(wages.federal, fed!.rules.standardDeduction), ZERO);
  const fedCredits = sum(fed!.rules.credits.map((c) => c.amount));
  const fedTax = max(sub(progressiveTax(fedTaxable, fed!.rules.brackets), fedCredits), ZERO);

  const caTaxable = max(sub(wages.california, ca!.rules.standardDeduction), ZERO);
  const caBracket = progressiveTax(caTaxable, ca!.rules.brackets);
  const mhs = normalize(
    dec(max(sub(caTaxable, ca!.rules.mentalHealthServicesThreshold), ZERO)).times(
      dec(ca!.rules.mentalHealthServicesRate),
    ),
  );
  const caTax = normalize(dec(max(sub(caBracket, ca!.rules.exemptionCredit), ZERO)).plus(dec(mhs)));

  const f = fica!.rules;
  const ss = normalize(
    Dec.min(dec(wages.fica), dec(f.socialSecurityWageBase)).times(dec(f.socialSecurityRate)),
  );
  const medicare = normalize(
    dec(wages.fica)
      .times(dec(f.medicareRate))
      .plus(
        dec(max(sub(wages.fica, f.additionalMedicareThreshold), ZERO)).times(dec(f.additionalMedicareRate)),
      ),
  );

  const withheld = (c: WithholdingComponent) => annual(payroll.withholdings[c]);
  const comp = (
    component: WithholdingComponent,
    label: string,
    base: Money,
    liability: Money,
  ): TaxComponent => {
    const liabilityRounded = wholeDollars(liability);
    return {
      component,
      label,
      base,
      liability,
      liabilityRounded,
      withheld: withheld(component),
      difference: sub(liabilityRounded, withheld(component)),
    };
  };
  const components = [
    comp('federal', 'Federal income tax', fedTaxable, fedTax),
    comp('california', 'California income tax', caTaxable, caTax),
    comp('social_security', 'Social Security', wages.fica, ss),
    comp('medicare', 'Medicare', wages.fica, medicare),
  ];

  const employmentRounded = wholeDollars(sum([ss, medicare]));
  const employmentWithheld = sum([withheld('social_security'), withheld('medicare')]);
  const totalRounded = sum([
    components[0].liabilityRounded,
    components[1].liabilityRounded,
    employmentRounded,
  ]);
  const totalWithheld = sum(components.map((c) => c.withheld));

  return {
    taxYear,
    annualWages: wages,
    federal: {
      taxable: fedTaxable,
      standardDeduction: normalize(fed!.rules.standardDeduction),
      tax: fedTax,
      credits: fedCredits,
    },
    california: {
      taxable: caTaxable,
      standardDeduction: normalize(ca!.rules.standardDeduction),
      bracketTax: caBracket,
      exemptionCredit: normalize(ca!.rules.exemptionCredit),
      mentalHealthTax: mhs,
      tax: caTax,
    },
    components,
    employment: {
      liabilityRounded: employmentRounded,
      withheld: employmentWithheld,
      difference: sub(employmentRounded, employmentWithheld),
    },
    total: {
      liabilityRounded: totalRounded,
      withheld: totalWithheld,
      difference: sub(totalRounded, totalWithheld),
    },
    provenance: [fed!, ca!, fica!].map((r) => ({
      jurisdiction: r.jurisdiction,
      taxYear: r.taxYear,
      ratesFromYear: r.ratesFromYear,
      provisional: r.provisional,
      sourceNote: r.sourceNote,
    })),
  };
}
