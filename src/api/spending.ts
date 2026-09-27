import { z } from 'zod';
import type { Treasury } from './treasury';
import {
  buildReport,
  exactAmount,
  safeText,
  type Connection,
  type InstitutionAccount,
  type Report,
  type Review,
  type ReviewBudget,
  type Rule,
} from '@/domain/spending';

const text = z.string().transform(safeText);
const AccountSchema = z.object({
  id: z.string().min(1),
  connectionId: z.string().min(1),
  providerRef: text,
  displayName: text.pipe(z.string().trim().min(1)),
  mask: z.string().regex(/^\d{0,4}$/),
  kind: z.enum([
    'checking',
    'savings',
    'credit_card',
    'brokerage',
    'retirement',
    'loan',
    'other_asset',
    'other_liability',
  ]),
  inReview: z.boolean(),
  inSnapshot: z.boolean(),
  confirmed: z.boolean(),
  treasuryAccountId: z.string().nullable(),
  shared: z.boolean(),
  active: z.boolean(),
  csvProfile: z
    .object({
      date: text,
      description: text,
      amount: text.optional(),
      debit: text.optional(),
      credit: text.optional(),
      outflowPositive: z.boolean(),
    })
    .nullable(),
});
const money = z.string().transform(exactAmount);
const RuleSchema = z.object({
  id: z.string().min(1),
  position: z.number().int(),
  enabled: z.boolean(),
  createdAt: z.string(),
  pattern: text.pipe(z.string().trim().min(1)),
  match: z.enum(['contains', 'starts_with', 'equals']),
  accountId: z.string().optional(),
  merchant: text.optional(),
  direction: z.enum(['any', 'inflow', 'outflow']),
  min: money.optional(),
  max: money.optional(),
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('budget'), lineKey: z.string().min(1) }),
    z.object({ kind: z.literal('income'), incomeKind: z.enum(['take_home', 'other']) }),
    z.object({ kind: z.literal('transfer'), counterparty: z.string().min(1) }),
    z.object({ kind: z.literal('unbudgeted') }),
    z.object({
      kind: z.literal('excluded'),
      reason: z.enum(['reimbursable', 'not_household', 'duplicate_at_source', 'adjustment', 'other']),
      note: text.optional(),
    }),
  ]),
});
type Table = 'connections' | 'institution_accounts' | 'categorization_rules';
export class SpendingService {
  constructor(private readonly t: Treasury) {}
  private list<T>(table: Table): T[] {
    return this.t.db
      .all<{ data: string }>(`SELECT data FROM ${table} ORDER BY rowid`)
      .map((r) => JSON.parse(r.data) as T);
  }
  connections() {
    return this.list<Connection>('connections');
  }
  accounts() {
    return this.list<InstitutionAccount>('institution_accounts');
  }
  rules() {
    return this.list<Rule>('categorization_rules').sort(
      (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt),
    );
  }
  addConnection(displayName: string, provider: Connection['provider'] = 'file'): string {
    const name = safeText(displayName.trim());
    if (!name) throw new Error('Name the connection');
    if (provider !== 'file')
      throw new Error('Provider connections must be created by the desktop linking flow.');
    const id = crypto.randomUUID();
    this.t.mutate('Add connection', () => {
      const c: Connection = {
        id,
        provider,
        displayName: name,
        status: 'ready',
        credentialRef: null,
        providerRef: null,
        lastSuccessAt: null,
        lastError: null,
        consentExpiresAt: null,
      };
      this.t.db.run('INSERT INTO connections(id,data) VALUES(?,?)', [id, JSON.stringify(c)]);
      this.t.repos.audit('create', 'connection', id, null, c);
    });
    return id;
  }
  saveProviderConnection(input: Connection) {
    const c: Connection = {
      id: input.id,
      provider: 'plaid',
      displayName: safeText(input.displayName),
      status: input.status,
      credentialRef: input.credentialRef,
      providerRef: input.providerRef,
      lastSuccessAt: input.lastSuccessAt,
      lastError: input.lastError,
      consentExpiresAt: input.consentExpiresAt,
    };
    this.t.mutate('Save provider connection', () => {
      this.t.db.run(
        'INSERT INTO connections(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
        [c.id, JSON.stringify(c)],
      );
      this.t.repos.audit('update', 'connection', c.id, null, c);
    });
  }
  saveAccount(input: InstitutionAccount) {
    const a = AccountSchema.parse(input);
    this.t.mutate('Save connected account', () => {
      this.t.db.run(
        'INSERT INTO institution_accounts(id,connection_id,treasury_account_id,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET connection_id=excluded.connection_id,treasury_account_id=excluded.treasury_account_id,data=excluded.data',
        [a.id, a.connectionId, a.treasuryAccountId, JSON.stringify(a)],
      );
      this.t.repos.audit('update', 'institution_account', a.id, null, a);
    });
  }
  removeConnection(id: string) {
    this.t.mutate('Remove connection', () => {
      const c = this.connections().find((c) => c.id === id);
      if (!c) throw new Error('Connection not found');
      for (const a of this.accounts().filter((a) => a.connectionId === id)) {
        this.t.db.run('UPDATE institution_accounts SET data=? WHERE id=?', [
          JSON.stringify({ ...a, active: false }),
          a.id,
        ]);
      }
      this.t.db.run('UPDATE connections SET data=? WHERE id=?', [
        JSON.stringify({ ...c, status: 'removed', credentialRef: null }),
        id,
      ]);
      this.t.repos.audit('delete', 'connection', id, null, null);
    });
  }
  saveRule(input: Rule) {
    const r = RuleSchema.parse(input);
    this.t.mutate('Save categorization rule', () => {
      this.t.db.run(
        'INSERT INTO categorization_rules(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
        [r.id, JSON.stringify(r)],
      );
      this.t.repos.audit('update', 'categorization_rule', r.id, null, r);
    });
  }
  deleteRule(id: string) {
    this.t.mutate('Delete categorization rule', () => {
      this.t.db.run('DELETE FROM categorization_rules WHERE id=?', [id]);
      this.t.repos.audit('delete', 'categorization_rule', id, null, null);
    });
  }
  setRole(lineKey: string, role: 'spending' | 'set_aside') {
    if (!['spending', 'set_aside'].includes(role)) throw new Error('Invalid line role');
    this.t.mutate('Change spending line role', () => {
      this.t.db.run(
        'INSERT INTO spending_line_settings(line_key,role) VALUES(?,?) ON CONFLICT(line_key) DO UPDATE SET role=excluded.role',
        [lineKey, role],
      );
      this.t.repos.audit('update', 'spending_line_settings', lineKey, null, { role });
    });
  }
  budget(versionId: string): ReviewBudget | null {
    if (!versionId) return null;
    const v = this.t.budget.versionView(versionId);
    if (!v.budget || v.version.detailLevel !== 'full') return null;
    const categories = this.t.budget.categories();
    const roles = new Map(
      this.t.db
        .all<{ line_key: string; role: 'spending' | 'set_aside' }>('SELECT * FROM spending_line_settings')
        .map((r) => [r.line_key, r.role]),
    );
    return {
      id: v.version.id,
      label: v.version.label,
      takeHome: v.budget.takeHome,
      lines: v.budget.lines.map((l) => {
        const key = v.lines.find((x) => x.id === l.id)!.lineKey;
        return {
          lineKey: key,
          label: l.label,
          category: categories.find((c) => c.id === l.categoryId)?.name ?? '',
          fundingAccountId: l.fundingAccountId,
          fundingAccount: l.fundingAccountId ? this.t.codeOf(l.fundingAccountId) : '',
          role: roles.get(key) ?? 'spending',
          planned: l.amount,
        };
      }),
    };
  }
  defaultVersion(month: string): string {
    const cycle = this.t.db.get<{ budget_version_id: string | null }>(
      'SELECT budget_version_id FROM monthly_cycles WHERE month=?',
      [month],
    );
    if (cycle?.budget_version_id && this.budget(cycle.budget_version_id)) return cycle.budget_version_id;
    return (
      this.t.budget.repos
        .listVersions()
        .filter(
          (v) =>
            v.detailLevel === 'full' &&
            v.effectiveFrom &&
            v.effectiveFrom <= month &&
            (!v.effectiveTo || v.effectiveTo >= month),
        )
        .sort((a, b) => (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? ''))[0]?.id ?? ''
    );
  }
  reports(): Report[] {
    return this.t.db
      .all<{ month: string; data: string; budget_version_id: string | null }>(
        'SELECT * FROM spending_reports ORDER BY month DESC',
      )
      .map((r) => {
        const header = JSON.parse(r.data);
        const rows = (table: string) =>
          this.t.db
            .all<{ data: string }>(`SELECT data FROM ${table} WHERE month=? ORDER BY position`, [r.month])
            .map((x) => JSON.parse(x.data));
        return {
          ...header,
          budgetVersionId: r.budget_version_id,
          lines: rows('spending_report_lines'),
          flows: rows('spending_report_flows'),
          sources: rows('spending_report_sources'),
          balances: rows('balance_snapshots'),
        } as Report;
      });
  }
  clear(review: Review): Report {
    const budget = this.budget(review.budgetVersionId);
    if (!budget) throw new Error('Choose a full-detail budget');
    const report = buildReport(review, this.accounts(), budget);
    this.t.mutate(`Clear spending report ${review.month}`, () => {
      this.t.db.run('DELETE FROM spending_reports WHERE month=?', [review.month]);
      const { lines, flows, sources, balances, ...header } = report;
      this.t.db.run('INSERT INTO spending_reports(month,budget_version_id,data) VALUES(?,?,?)', [
        report.month,
        report.budgetVersionId,
        JSON.stringify(header),
      ]);
      for (const [table, rows] of [
        ['spending_report_lines', lines],
        ['spending_report_flows', flows],
        ['spending_report_sources', sources],
        ['balance_snapshots', balances],
      ] as const)
        rows.forEach((row, i) =>
          this.t.db.run(`INSERT INTO ${table}(month,position,data) VALUES(?,?,?)`, [
            report.month,
            i,
            JSON.stringify(row),
          ]),
        );
      this.t.repos.audit('create', 'spending_report', report.month, null, { month: report.month });
    });
    return report;
  }
  deleteReport(month: string) {
    this.t.mutate(`Delete spending report ${month}`, () => {
      this.t.db.run('DELETE FROM spending_reports WHERE month=?', [month]);
      this.t.repos.audit('delete', 'spending_report', month, null, null);
    });
  }
  setReportNote(month: string, note: string, lineKey?: string) {
    this.t.mutate('Edit report note', () => {
      if (lineKey) {
        const rows = this.t.db.all<{ position: number; data: string }>(
          'SELECT position,data FROM spending_report_lines WHERE month=?',
          [month],
        );
        const row = rows.find((r) => JSON.parse(r.data).lineKey === lineKey);
        if (!row) throw new Error('Report line not found');
        this.t.db.run('UPDATE spending_report_lines SET data=? WHERE month=? AND position=?', [
          JSON.stringify({ ...JSON.parse(row.data), note: safeText(note) }),
          month,
          row.position,
        ]);
      } else {
        const row = this.t.db.get<{ data: string }>('SELECT data FROM spending_reports WHERE month=?', [
          month,
        ]);
        if (!row) throw new Error('Report not found');
        this.t.db.run('UPDATE spending_reports SET data=? WHERE month=?', [
          JSON.stringify({ ...JSON.parse(row.data), note: safeText(note) }),
          month,
        ]);
      }
      this.t.repos.audit('update', 'spending_report', month, null, {
        note: safeText(note),
        lineKey: lineKey ?? null,
      });
    });
  }
}
