import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';

export type Param = SqlValue;

/**
 * Synchronous SQLite access. The implementation embeds SQLite (sql.js/WASM)
 * in-process so multi-statement transactions are truly atomic; the database
 * file itself is persisted by a `DatabaseStorage` (see docs/decisions/0001).
 */
export interface SqlDriver {
  run(sql: string, params?: Param[]): void;
  all<T = Record<string, unknown>>(sql: string, params?: Param[]): T[];
  get<T = Record<string, unknown>>(sql: string, params?: Param[]): T | undefined;
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
  /** Serialize the whole database as a standard SQLite file. */
  export(): Uint8Array;
  /** Replace the live database with the given SQLite file bytes. */
  replace(bytes: Uint8Array): void;
  readonly inTransaction: boolean;
}

let sqlPromise: Promise<SqlJsStatic> | null = null;

export function loadSqlJs(locateFile?: (file: string) => string): Promise<SqlJsStatic> {
  if (!sqlPromise) sqlPromise = initSqlJs(locateFile ? { locateFile } : undefined);
  return sqlPromise;
}

export class SqlJsDriver implements SqlDriver {
  private db: Database;
  private depth = 0;

  constructor(
    private readonly SQL: SqlJsStatic,
    bytes?: Uint8Array | null,
  ) {
    this.db = new SQL.Database(bytes ?? undefined);
    this.configure();
  }

  private configure() {
    this.db.run('PRAGMA foreign_keys = ON;');
  }

  get inTransaction() {
    return this.depth > 0;
  }

  run(sql: string, params: Param[] = []) {
    this.db.run(sql, params);
  }

  all<T>(sql: string, params: Param[] = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  get<T>(sql: string, params: Param[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  /** Nested calls join the outer transaction via savepoints. */
  transaction<T>(fn: () => T): T {
    const name = `sp${this.depth}`;
    if (this.depth === 0) this.db.run('BEGIN IMMEDIATE');
    else this.db.run(`SAVEPOINT ${name}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      if (this.depth === 0) this.db.run('COMMIT');
      else this.db.run(`RELEASE ${name}`);
      return result;
    } catch (err) {
      this.depth--;
      if (this.depth === 0) this.db.run('ROLLBACK');
      else {
        this.db.run(`ROLLBACK TO ${name}`);
        this.db.run(`RELEASE ${name}`);
      }
      throw err;
    }
  }

  export(): Uint8Array {
    if (this.depth > 0) throw new Error('Cannot export during a transaction');
    const bytes = this.db.export();
    // sql.js re-opens the database on export, which resets pragmas.
    this.configure();
    return bytes;
  }

  replace(bytes: Uint8Array) {
    if (this.depth > 0) throw new Error('Cannot replace during a transaction');
    this.db.close();
    this.db = new this.SQL.Database(bytes);
    this.configure();
  }
}
