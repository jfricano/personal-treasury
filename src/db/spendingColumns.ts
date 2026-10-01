import type { Param, SqlDriver } from './driver';

type Column = { path: string; sql: string; kind?: 'boolean'; nullable?: boolean };
const text = (...paths: string[]): Column[] => paths.map((path) => ({ path, sql: 'TEXT' }));
const integer = (...paths: string[]): Column[] => paths.map((path) => ({ path, sql: 'INTEGER' }));
const boolean = (...paths: string[]): Column[] =>
  paths.map((path) => ({ path, sql: 'INTEGER', kind: 'boolean' }));
const nullable = (...paths: string[]): Column[] => text(...paths).map((c) => ({ ...c, nullable: true }));
export const spendingColumns = {
  connections: [
    ...text('id', 'provider', 'displayName', 'status'),
    ...nullable('credentialRef', 'providerRef', 'lastSuccessAt', 'lastError', 'consentExpiresAt'),
  ],
  institution_accounts: [
    ...text('id', 'connectionId', 'providerRef', 'displayName', 'mask', 'kind'),
    ...nullable('treasuryAccountId'),
    ...boolean('inReview', 'inSnapshot', 'confirmed', 'shared', 'active'),
    ...text(
      'csvProfile.date',
      'csvProfile.description',
      'csvProfile.amount',
      'csvProfile.debit',
      'csvProfile.credit',
    ),
    ...boolean('csvProfile.outflowPositive'),
  ],
  categorization_rules: [
    ...text(
      'id',
      'createdAt',
      'pattern',
      'match',
      'accountId',
      'merchant',
      'direction',
      'min',
      'max',
      'action.kind',
      'action.lineKey',
      'action.incomeKind',
      'action.counterparty',
      'action.reason',
      'action.note',
    ),
    ...integer('position'),
    ...boolean('enabled'),
  ],
  spending_reports: [
    ...text(
      'month',
      'budgetLabel',
      'clearedAt',
      'timeZone',
      'appVersion',
      'inflows',
      'outflows',
      'note',
      'unbudgeted.actual',
      'income.planned',
      'income.takeHome',
      'income.other',
    ),
    ...nullable('budgetVersionId'),
    ...integer('settleDays', 'pairingDays', 'count', 'unbudgeted.count', 'income.count'),
  ],
  spending_report_lines: [
    ...text('lineKey', 'label', 'category', 'fundingAccount', 'role', 'planned', 'actual', 'note'),
    ...nullable('fundingAccountId'),
    ...integer('count'),
  ],
  spending_report_flows: [...text('kind', 'total'), ...integer('count')],
  spending_report_sources: [
    ...text('accountId', 'label', 'kind', 'source', 'status', 'waiver', 'inflows', 'outflows', 'tailSum'),
    ...integer('count', 'tailCount'),
    ...boolean('historyConfirmed'),
  ],
  balance_snapshots: [
    ...text(
      'accountId',
      'label',
      'kind',
      'asOf',
      'capturedAt',
      'source',
      'details.statementBalance',
      'details.minimumPayment',
      'details.apr',
      'details.dueDate',
      'details.originalPrincipal',
      'details.source',
    ),
    ...nullable('value'),
    ...boolean('estimate', 'unavailable'),
  ],
} satisfies Record<string, Column[]>;
export type SpendingTable = keyof typeof spendingColumns;
export const columnName = (path: string) =>
  path.replaceAll('.', '_').replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
function get(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (v, key) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined),
      value,
    );
}
export function columnValues(table: SpendingTable, value: unknown): Record<string, Param> {
  return Object.fromEntries(
    spendingColumns[table].map((c: Column) => {
      const v = get(value, c.path);
      return [
        columnName(c.path),
        v === undefined || v === null ? null : c.kind === 'boolean' ? (v ? 1 : 0) : (v as Param),
      ];
    }),
  );
}
export function fromColumns<T>(table: SpendingTable, row: Record<string, Param>): T {
  const value: Record<string, unknown> = {};
  for (const c of spendingColumns[table] as Column[]) {
    const v = row[columnName(c.path)];
    if (v === undefined || (v === null && !c.nullable)) continue;
    const parts = c.path.split('.');
    let target = value;
    for (const part of parts.slice(0, -1)) target = (target[part] ??= {}) as Record<string, unknown>;
    target[parts.at(-1)!] = c.kind === 'boolean' ? !!v : v;
  }
  if (table === 'institution_accounts') value.csvProfile ??= null;
  return value as T;
}
export function saveColumns(
  db: SqlDriver,
  table: SpendingTable,
  value: unknown,
  keys: string[],
  extra: Record<string, Param> = {},
) {
  const row = { ...columnValues(table, value), ...extra },
    cols = Object.keys(row);
  db.run(
    `INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')}) ON CONFLICT(${keys.join(',')}) DO UPDATE SET ${cols
      .filter((c) => !keys.includes(c))
      .map((c) => `${c}=excluded.${c}`)
      .join(',')}`,
    Object.values(row),
  );
}
/** Schema 5 upgrades the already-published schema-4 preview without changing its aggregate values. */
export function normalizeSpendingColumns(db: SqlDriver) {
  for (const [key, value] of [
    ['household_time_zone', Intl.DateTimeFormat().resolvedOptions().timeZone],
    ['review_settle_days', '3'],
    ['review_pairing_days', '5'],
  ])
    db.run('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)', [key, value]);
  for (const [table, fields] of Object.entries(spendingColumns)) {
    const existing = new Set(db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));
    for (const c of fields as Column[]) {
      const name = columnName(c.path);
      if (!existing.has(name))
        db.exec(
          `ALTER TABLE ${table} ADD COLUMN ${name} ${c.sql}${c.kind === 'boolean' ? ` CHECK(${name} IN(0,1))` : ''}`,
        );
    }
    for (const row of db.all<Record<string, Param>>(`SELECT rowid AS internal_rowid,* FROM ${table}`)) {
      const value = JSON.parse(String(row.data));
      // The report's FK may have become null since the original JSON header was written.
      if (table === 'spending_reports') value.budgetVersionId = row.budget_version_id;
      const converted = columnValues(table as SpendingTable, value),
        cols = Object.keys(converted);
      db.run(`UPDATE ${table} SET ${cols.map((c) => `${c}=?`).join(',')} WHERE rowid=?`, [
        ...Object.values(converted),
        row.internal_rowid,
      ]);
      if (table === 'spending_report_sources')
        for (const [position, period] of (value.periods ?? []).entries())
          db.run(
            'INSERT INTO spending_source_periods(month,source_position,position,start_date,end_date) VALUES(?,?,?,?,?)',
            [row.month, row.position, position, period.start, period.end],
          );
    }
    db.exec(`ALTER TABLE ${table} DROP COLUMN data`);
    if (table === 'institution_accounts')
      db.exec(
        'CREATE UNIQUE INDEX idx_institution_provider_ref ON institution_accounts(connection_id,provider_ref)',
      );
  }
}
