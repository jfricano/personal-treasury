import * as XLSX from 'xlsx';
import { fromSourceNumber, isMoney, normalize, type Money } from '@/domain/money';

export type CellValue = string | number | boolean | null;

/** Thin read-only view over a SheetJS worksheet with 0-based row/column access. */
export class Grid {
  readonly rows: number;
  readonly cols: number;
  constructor(
    readonly name: string,
    private readonly ws: XLSX.WorkSheet,
  ) {
    const ref = ws['!ref'];
    if (!ref) {
      this.rows = 0;
      this.cols = 0;
    } else {
      const r = XLSX.utils.decode_range(ref);
      this.rows = r.e.r + 1;
      this.cols = r.e.c + 1;
    }
  }

  cell(r: number, c: number): XLSX.CellObject | undefined {
    return this.ws[XLSX.utils.encode_cell({ r, c })];
  }

  /** Raw value; empty strings (e.g. formulas returning "") are treated as blank. */
  v(r: number, c: number): CellValue {
    const cell = this.cell(r, c);
    if (!cell || cell.v === undefined || cell.v === null) return null;
    if (cell.t === 'e') return null;
    if (typeof cell.v === 'string' && cell.v.trim() === '') return null;
    if (cell.v instanceof Date) return cell.v.toISOString();
    return cell.v as CellValue;
  }

  text(r: number, c: number): string | null {
    const v = this.v(r, c);
    if (v === null) return null;
    return typeof v === 'string' ? v : String(v);
  }

  /** Lower-cased trimmed text for label matching. */
  label(r: number, c: number): string {
    const t = this.text(r, c);
    return t ? t.trim().toLowerCase() : '';
  }

  isFormula(r: number, c: number): boolean {
    return !!this.cell(r, c)?.f;
  }

  rowIsBlank(r: number, fromCol = 0, toCol = this.cols - 1): boolean {
    for (let c = fromCol; c <= toCol; c++) if (this.v(r, c) !== null) return false;
    return true;
  }

  /** Find the first cell whose label matches. */
  find(pred: (label: string) => boolean, startRow = 0): { r: number; c: number } | null {
    for (let r = startRow; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) if (pred(this.label(r, c))) return { r, c };
    }
    return null;
  }

  /** Find a header row containing every label (case-insensitive). Returns column map. */
  findHeader(labels: string[], startRow = 0): { row: number; cols: Map<string, number> } | null {
    const want = labels.map((l) => l.toLowerCase());
    for (let r = startRow; r < this.rows; r++) {
      const cols = new Map<string, number>();
      for (let c = 0; c < this.cols; c++) {
        const l = this.label(r, c);
        if (want.includes(l) && !cols.has(l)) cols.set(l, c);
      }
      if (want.every((w) => cols.has(w))) return { row: r, cols };
    }
    return null;
  }
}

export const ref = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
export const rowRef = (r: number) => `${r + 1}`;
export const rangeRef = (r1: number, c1: number, r2: number, c2: number) => `${ref(r1, c1)}:${ref(r2, c2)}`;

/** Money from a cell value; null for blank; throws never — returns 'invalid' for junk. */
export function cellMoney(v: CellValue): Money | null | 'invalid' {
  if (v === null) return null;
  if (typeof v === 'number') return fromSourceNumber(v);
  if (typeof v === 'string') {
    const t = v.trim().replace(/[$,]/g, '');
    if (t === '') return null;
    return isMoney(t) ? normalize(t) : 'invalid';
  }
  return 'invalid';
}

/** Excel serial (or ISO/US date text) to ISO yyyy-mm-dd. */
export function cellDate(v: CellValue, date1904 = false): string | null | 'invalid' {
  if (v === null) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return 'invalid';
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const d = new Date(epoch + Math.floor(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === 'string') {
    const t = v.trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
    if (m) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
  }
  return 'invalid';
}

export function isoToSerial(iso: string): number {
  const [y, m, d] = iso.split('-').map((s) => Number.parseInt(s, 10));
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

export const MONTH_SHEET = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
