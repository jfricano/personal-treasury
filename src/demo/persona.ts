import { PETC_DESCRIPTION } from '@/domain/accounts';
import { bracketsFromIncrements } from '@/domain/tax/rules';

/**
 * The Harper household: a fictional family used by the public demo and the
 * public test suite. Every name and amount here is invented. It is small on
 * purpose: enough to show each rule the app enforces, not a full household.
 *
 * Sam Harper earns one paycheck; Riley (9) and Biscuit (a beagle) spend it.
 */
export const HOUSEHOLD = {
  name: 'The Harper household',
  blurb: 'Sam, Riley (9) and Biscuit the beagle. One paycheck, eight treasury accounts.',
};

export const ACCOUNTS: { code: string; displayName: string; description: string }[] = [
  { code: 'HH', displayName: 'Household', description: 'Rent, utilities, groceries, insurance and fuel.' },
  { code: 'PETC', displayName: 'Pets etc.', description: PETC_DESCRIPTION },
  { code: 'LTS', displayName: 'Long-term savings', description: 'Emergency fund and long-range goals.' },
  { code: 'TRV', displayName: 'Travel', description: 'Trips and the summer vacation fund.' },
  { code: 'KIDS', displayName: 'Kids', description: 'After-school care, activities and school costs.' },
  { code: 'CLTH', displayName: 'Clothing', description: 'Clothes and shoes for everyone.' },
  { code: 'GIFT', displayName: 'Gifts and holidays', description: 'Birthdays, holidays and celebrations.' },
  {
    code: 'ENT',
    displayName: 'Entertainment',
    description: 'Fun money. Receives whatever is left of take-home pay.',
  },
];

export interface PersonaDeduction {
  label: string;
  timing: 'pretax' | 'posttax';
  method: 'fixed' | 'rate_of_gross_less_exclusion';
  monthlyAmount?: string;
  rate?: string;
  monthlyExclusion?: string;
  reducesFederalIncome: boolean;
  reducesCaIncome: boolean;
  reducesFicaWages: boolean;
  notes?: string;
}

export const DEDUCTIONS: PersonaDeduction[] = [
  {
    label: '401(k), 5% of gross',
    timing: 'pretax',
    method: 'rate_of_gross_less_exclusion',
    rate: '0.05',
    monthlyExclusion: '0',
    // Retirement deferrals reduce income tax wages but not Social Security and Medicare wages.
    reducesFederalIncome: true,
    reducesCaIncome: true,
    reducesFicaWages: false,
  },
  {
    label: 'Medical premium',
    timing: 'pretax',
    method: 'fixed',
    monthlyAmount: '210',
    reducesFederalIncome: true,
    reducesCaIncome: true,
    reducesFicaWages: true,
  },
  {
    label: 'Dental and vision',
    timing: 'pretax',
    method: 'fixed',
    monthlyAmount: '28',
    reducesFederalIncome: true,
    reducesCaIncome: true,
    reducesFicaWages: true,
  },
  {
    label: 'Supplemental life insurance',
    timing: 'posttax',
    method: 'fixed',
    monthlyAmount: '12',
    reducesFederalIncome: false,
    reducesCaIncome: false,
    reducesFicaWages: false,
  },
];

export interface PersonaVersion {
  label: string;
  notes: string;
  grossMonthly: string;
  /** Actual monthly withholding from the pay stub (hard inputs, never estimated). */
  withholdings: { federal: string; california: string; social_security: string; medicare: string };
  /** Monthly amount per line key; `null` marks the remainder line. */
  amounts: Record<string, string | null>;
}

/** Budget lines: purpose (category) and the treasury account that funds them are separate. */
export const LINES: { key: string; category: string; label: string; funding: string }[] = [
  { key: 'rent', category: 'Housing and utilities', label: 'Rent', funding: 'HH' },
  { key: 'utilities', category: 'Housing and utilities', label: 'Utilities', funding: 'HH' },
  { key: 'internet', category: 'Housing and utilities', label: 'Internet and phone', funding: 'HH' },
  { key: 'groceries', category: 'Household and personal', label: 'Groceries', funding: 'HH' },
  { key: 'supplies', category: 'Household and personal', label: 'Household supplies', funding: 'HH' },
  { key: 'clothing', category: 'Household and personal', label: 'Clothing', funding: 'CLTH' },
  { key: 'carInsurance', category: 'Transportation', label: 'Car insurance', funding: 'HH' },
  { key: 'fuel', category: 'Transportation', label: 'Fuel and parking', funding: 'HH' },
  { key: 'streaming', category: 'Lifestyle', label: 'Streaming and apps', funding: 'HH' },
  { key: 'afterSchool', category: 'Kids', label: 'After-school program', funding: 'KIDS' },
  { key: 'activities', category: 'Kids', label: 'Soccer and activities', funding: 'KIDS' },
  { key: 'biscuit', category: 'Pets etc.', label: 'Biscuit: food and vet', funding: 'PETC' },
  { key: 'copays', category: 'Pets etc.', label: 'Medical and dental copays', funding: 'PETC' },
  { key: 'carMaintenance', category: 'Pets etc.', label: 'Car maintenance', funding: 'PETC' },
  { key: 'emergency', category: 'Long-term savings', label: 'Emergency fund', funding: 'LTS' },
  { key: 'summerTrip', category: 'Travel', label: 'Summer trip fund', funding: 'TRV' },
  { key: 'gifts', category: 'Gifts and holidays', label: 'Birthdays and holidays', funding: 'GIFT' },
  { key: 'fun', category: 'Discretionary', label: 'Everything else', funding: 'ENT' },
];

export const EXTRA_CATEGORIES: { name: string; description: string | null }[] = [
  { name: 'Kids', description: 'School, care and activities' },
  { name: 'Gifts and holidays', description: null },
];

const earlierAmounts: Record<string, string | null> = {
  rent: '1850',
  utilities: '170',
  internet: '110',
  groceries: '640',
  supplies: '60',
  clothing: '80',
  carInsurance: '115',
  fuel: '140',
  streaming: '32',
  afterSchool: '220',
  activities: '40',
  biscuit: '70',
  copays: '60',
  carMaintenance: '50',
  emergency: '250',
  summerTrip: '100',
  gifts: '60',
  fun: null,
};

/**
 * Take-home: 6300 − 315 (401k) − 210 − 28 − 12 − 520 − 185 − 375.84 − 87.90 = 4566.26.
 * Funding: HH 3117, CLTH 80, KIDS 260, PETC 180, LTS 250, TRV 100, GIFT 60, ENT 519.26 (remainder).
 */
export const EARLIER_PLAN: PersonaVersion = {
  label: 'Spring plan',
  notes: 'Before the raise.',
  grossMonthly: '6300',
  withholdings: { federal: '520', california: '185', social_security: '375.84', medicare: '87.9' },
  amounts: earlierAmounts,
};

/**
 * Take-home: 6500 − 325 (401k) − 210 − 28 − 12 − 560 − 195 − 388.24 − 90.80 = 4690.96.
 * Funding: HH 3137, CLTH 90, KIDS 260, PETC 180, LTS 300, TRV 125, GIFT 60, ENT 538.96 (remainder).
 */
export const CURRENT_PLAN: PersonaVersion = {
  label: 'After the raise',
  notes: 'Sam’s raise: more to savings and travel.',
  grossMonthly: '6500',
  withholdings: { federal: '560', california: '195', social_security: '388.24', medicare: '90.8' },
  amounts: { ...earlierAmounts, groceries: '660', clothing: '90', emergency: '300', summerTrip: '125' },
};

/**
 * Published figures. Federal and FICA are the 2026 tables; California uses its
 * 2025 tables (the latest published when this was written), so the demo marks
 * them provisional. The app models single filers only, and the demo says so.
 */
export const TAX_RULES = {
  federal: {
    ratesFromYear: 2026,
    rules: {
      brackets: bracketsFromIncrements(
        ['0', '12400', '50400', '105700', '201775', '256225', '640600'],
        ['0.1', '0.02', '0.1', '0.02', '0.08', '0.03', '0.02'],
      ),
      standardDeduction: '16100',
      credits: [],
    },
  },
  california: {
    ratesFromYear: 2025,
    rules: {
      brackets: bracketsFromIncrements(
        ['0', '11079', '26264', '41452', '57542', '72724', '371479', '445771', '742953'],
        ['0.01', '0.01', '0.02', '0.02', '0.02', '0.013', '0.01', '0.01', '0.01'],
      ),
      standardDeduction: '5706',
      exemptionCredit: '153',
    },
  },
  fica: {
    ratesFromYear: 2026,
    rules: {
      socialSecurityRate: '0.062',
      socialSecurityWageBase: '184500',
      medicareRate: '0.0145',
      additionalMedicareRate: '0.009',
      additionalMedicareThreshold: '200000',
    },
  },
} as const;
