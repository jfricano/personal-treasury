import type { SqlDriver } from './driver';

/**
 * Versioned, forward-only migrations. Each migration runs inside a transaction
 * and bumps `PRAGMA user_version`. Money columns are TEXT holding normalized
 * decimal strings; the repository layer validates them before writing.
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE import_runs (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  recognizer_version TEXT NOT NULL,
  mode TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  committed INTEGER NOT NULL DEFAULT 0,
  counts_json TEXT,
  controls_json TEXT,
  report_json TEXT
);
CREATE INDEX idx_import_runs_hash ON import_runs(content_hash);

CREATE TABLE import_warnings (
  id TEXT PRIMARY KEY,
  import_run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','high','fatal')),
  code TEXT NOT NULL,
  sheet TEXT,
  cell TEXT,
  message TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_import_warnings_run ON import_warnings(import_run_id);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT,
  description TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  needs_review INTEGER NOT NULL DEFAULT 0,
  source_import_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE account_aliases (
  alias TEXT PRIMARY KEY COLLATE NOCASE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  original_text TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE allocation_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  expected_cash TEXT NOT NULL,
  effective_from TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  flagged_out_of_balance INTEGER NOT NULL DEFAULT 0,
  source_workbook TEXT, source_sheet TEXT, source_range TEXT, source_import_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_one_active_profile ON allocation_profiles(active) WHERE active = 1;

CREATE TABLE allocation_profile_lines (
  profile_id TEXT NOT NULL REFERENCES allocation_profiles(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount TEXT NOT NULL,
  PRIMARY KEY (profile_id, account_id)
);

CREATE TABLE monthly_cycles (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL UNIQUE CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  expected_cash TEXT NOT NULL,
  notes TEXT,
  closed_at TEXT,
  close_override_note TEXT,
  source_workbook TEXT, source_sheet TEXT, source_range TEXT, source_import_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE monthly_allocations (
  monthly_cycle_id TEXT NOT NULL REFERENCES monthly_cycles(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  budget_amount TEXT NOT NULL,
  transfer_state TEXT NOT NULL CHECK (transfer_state IN ('pending','done','not_required')),
  notes TEXT,
  source_range TEXT,
  PRIMARY KEY (monthly_cycle_id, account_id)
);

CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  monthly_cycle_id TEXT NOT NULL REFERENCES monthly_cycles(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  entry_date TEXT,
  loan_id TEXT,
  description TEXT,
  notes TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('user','normalized_workbook','legacy_matrix')),
  draft_reason TEXT,
  source_workbook TEXT, source_sheet TEXT, source_range TEXT, import_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_journal_month_date ON journal_entries(monthly_cycle_id, entry_date);
CREATE INDEX idx_journal_loan ON journal_entries(loan_id);

CREATE TABLE journal_postings (
  id TEXT PRIMARY KEY,
  journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount TEXT NOT NULL,
  position INTEGER NOT NULL,
  original_code TEXT
);
CREATE INDEX idx_postings_entry ON journal_postings(journal_entry_id);
CREATE INDEX idx_postings_account ON journal_postings(account_id);

CREATE TABLE debts (
  id TEXT PRIMARY KEY,
  loan_id TEXT NOT NULL UNIQUE,
  opened_date TEXT NOT NULL,
  description TEXT,
  origin_debtor_account_id TEXT NOT NULL REFERENCES accounts(id),
  origin_creditor_account_id TEXT NOT NULL REFERENCES accounts(id),
  terms TEXT,
  source_workbook TEXT, source_sheet TEXT, source_range TEXT, import_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE debt_events (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  event_date TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  change_amount TEXT NOT NULL,
  description TEXT,
  notes TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  source_debtor TEXT,
  source_creditor TEXT,
  source_workbook TEXT, source_sheet TEXT, source_range TEXT, import_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (debt_id, sequence)
);
CREATE INDEX idx_debt_events_order ON debt_events(debt_id, event_date, sequence);
CREATE INDEX idx_debt_events_journal ON debt_events(journal_entry_id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  note TEXT
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
`,
  },
  {
    version: 2,
    name: 'reject month numbers outside 01-12',
    // v1's GLOB check accepted 13-19. SQLite cannot alter a CHECK in place, so
    // enforce the tighter rule with triggers instead of rebuilding the table.
    sql: `
CREATE TRIGGER trg_monthly_cycles_month_insert BEFORE INSERT ON monthly_cycles
WHEN substr(NEW.month, 6, 2) NOT BETWEEN '01' AND '12'
BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: month must be YYYY-MM with MM 01-12'); END;
CREATE TRIGGER trg_monthly_cycles_month_update BEFORE UPDATE OF month ON monthly_cycles
WHEN substr(NEW.month, 6, 2) NOT BETWEEN '01' AND '12'
BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: month must be YYYY-MM with MM 01-12'); END;
`,
  },
  {
    version: 3,
    name: 'budget versions, payroll, tax rules, treasury linkage',
    sql: `
-- Purpose of spending (what money is for). Funding comes from budget_lines.funding_account_id.
CREATE TABLE budget_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT,
  sort_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE budget_versions (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','archived')),
  detail_level TEXT NOT NULL CHECK (detail_level IN ('full','summary')),
  effective_from TEXT CHECK (effective_from IS NULL OR effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  effective_to TEXT CHECK (effective_to IS NULL OR effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  copied_from_version_id TEXT REFERENCES budget_versions(id) ON DELETE SET NULL,
  locked_at TEXT,
  gross_monthly TEXT,
  tax_year INTEGER,
  filing_status TEXT NOT NULL DEFAULT 'single',
  notes TEXT,
  source_workbook TEXT, source_sheet TEXT, source_range TEXT, import_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_one_active_budget ON budget_versions(status) WHERE status = 'active';

CREATE TABLE payroll_deductions (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  timing TEXT NOT NULL CHECK (timing IN ('pretax','posttax')),
  method TEXT NOT NULL CHECK (method IN ('fixed','rate_of_gross_less_exclusion')),
  monthly_amount TEXT,
  rate TEXT,
  monthly_exclusion TEXT,
  reduces_federal_income INTEGER NOT NULL,
  reduces_ca_income INTEGER NOT NULL,
  reduces_fica_wages INTEGER NOT NULL,
  notes TEXT,
  source_range TEXT
);
CREATE INDEX idx_payroll_deductions_version ON payroll_deductions(version_id, position);

CREATE TABLE payroll_withholdings (
  version_id TEXT NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  component TEXT NOT NULL CHECK (component IN ('federal','california','social_security','medicare')),
  monthly_amount TEXT NOT NULL,
  source_range TEXT,
  PRIMARY KEY (version_id, component)
);

CREATE TABLE budget_lines (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES budget_categories(id),
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('amount','residual')),
  monthly_amount TEXT,
  funding_account_id TEXT NOT NULL REFERENCES accounts(id),
  gross_amount TEXT,
  notes TEXT,
  source_sheet TEXT, source_range TEXT,
  CHECK ((kind = 'residual' AND monthly_amount IS NULL) OR (kind = 'amount' AND monthly_amount IS NOT NULL))
);
CREATE INDEX idx_budget_lines_version ON budget_lines(version_id, position);
CREATE INDEX idx_budget_lines_account ON budget_lines(funding_account_id);

-- Archival versions known only at summary level (Budget History columns).
CREATE TABLE budget_summary_rows (
  version_id TEXT NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  monthly_amount TEXT,
  source_range TEXT,
  PRIMARY KEY (version_id, position)
);

-- Tax rules per tax year and jurisdiction, editable in the app.
CREATE TABLE tax_rule_sets (
  id TEXT PRIMARY KEY,
  tax_year INTEGER NOT NULL,
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('federal','california','fica')),
  filing_status TEXT NOT NULL DEFAULT 'single',
  rates_from_year INTEGER NOT NULL,
  provisional INTEGER NOT NULL DEFAULT 0,
  rules_json TEXT NOT NULL,
  source_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tax_year, jurisdiction, filing_status)
);

ALTER TABLE monthly_cycles ADD COLUMN budget_version_id TEXT REFERENCES budget_versions(id);
ALTER TABLE monthly_cycles ADD COLUMN expected_cash_origin TEXT CHECK (expected_cash_origin IN ('budget','manual','import','template'));
ALTER TABLE monthly_allocations ADD COLUMN planned_amount TEXT;
ALTER TABLE monthly_allocations ADD COLUMN allocation_origin TEXT CHECK (allocation_origin IN ('budget','manual_override','import','template'));
UPDATE monthly_cycles SET expected_cash_origin = CASE WHEN source_import_run_id IS NOT NULL THEN 'import' ELSE 'template' END;
UPDATE monthly_allocations SET allocation_origin = CASE
  WHEN (SELECT source_import_run_id FROM monthly_cycles m WHERE m.id = monthly_cycle_id) IS NOT NULL THEN 'import' ELSE 'template' END;
CREATE INDEX idx_monthly_cycles_budget ON monthly_cycles(budget_version_id);
`,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function currentVersion(db: SqlDriver): number {
  return db.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;
}

export function migrate(db: SqlDriver): { from: number; to: number } {
  const from = currentVersion(db);
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${from} is newer than this application supports (${SCHEMA_VERSION}). Update the application.`,
    );
  }
  for (const m of MIGRATIONS) {
    if (m.version <= from) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return { from, to: SCHEMA_VERSION };
}
