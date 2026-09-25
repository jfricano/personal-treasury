import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Treasury } from '@/api/treasury';

export type Page =
  'dashboard' | 'monthly' | 'budget' | 'debts' | 'history' | 'accounts' | 'import' | 'settings';

export interface Route {
  page: Page;
  /** Month id for dashboard/monthly. */
  monthId?: string | null;
  /** Debt id to open in the drawer. */
  debtId?: string | null;
  /** Account filter for debts or journal. */
  account?: string | null;
  role?: 'to' | 'by' | null;
  /** Budget version id, or the tax-rules tab. */
  version?: string | null;
  tab?: 'versions' | 'tax' | null;
}

const PAGES: Page[] = [
  'dashboard',
  'monthly',
  'budget',
  'debts',
  'history',
  'accounts',
  'import',
  'settings',
];

function parseHash(): Route {
  const [path, query] = window.location.hash.replace(/^#\/?/, '').split('?');
  const page = (PAGES.includes(path as Page) ? path : 'dashboard') as Page;
  const q = new URLSearchParams(query ?? '');
  return {
    page,
    monthId: q.get('month'),
    debtId: q.get('debt'),
    account: q.get('account'),
    role: (q.get('role') as Route['role']) ?? null,
    version: q.get('version'),
    tab: (q.get('tab') as Route['tab']) ?? null,
  };
}

function toHash(r: Route): string {
  const q = new URLSearchParams();
  if (r.monthId) q.set('month', r.monthId);
  if (r.debtId) q.set('debt', r.debtId);
  if (r.account) q.set('account', r.account);
  if (r.role) q.set('role', r.role);
  if (r.version) q.set('version', r.version);
  if (r.tab) q.set('tab', r.tab);
  const s = q.toString();
  return `#/${r.page}${s ? `?${s}` : ''}`;
}

/**
 * Optional additions from a special build. The public demo supplies them; the
 * desktop app passes none, so none of this code ships in it.
 */
export interface AppExtras {
  /** Shown above every page. */
  banner?: ReactNode;
  /** A ready-made workbook offered on Import and export. */
  sampleWorkbook?: { fileName: string; build: () => Promise<Uint8Array> };
}

interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

interface AppCtx {
  treasury: Treasury;
  route: Route;
  navigate: (r: Route) => void;
  toasts: Toast[];
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  /**
   * Run an API call, surfacing errors as toasts. Returns undefined only on
   * failure; a successful call that returns nothing yields `true`, so callers
   * can close dialogs with `run(...) !== undefined`.
   */
  run: <T>(fn: () => T, success?: string) => T | undefined;
  switchProfile: (name: string) => void;
  extras: AppExtras;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({
  treasury,
  children,
  switchProfile,
  extras = {},
}: {
  treasury: Treasury;
  children: ReactNode;
  switchProfile: (name: string) => void;
  extras?: AppExtras;
}) {
  const [route, setRoute] = useState<Route>(parseHash);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((r: Route) => {
    const h = toHash(r);
    if (window.location.hash !== h) window.location.hash = h;
    else setRoute(r);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (text: string, kind: Toast['kind'] = 'info') => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-1), { id, kind, text }]);
      if (kind !== 'error') setTimeout(() => dismissToast(id), 2500);
    },
    [dismissToast],
  );

  const run = useCallback(
    <T,>(fn: () => T, success?: string): T | undefined => {
      try {
        const r = fn();
        if (success) toast(success, 'success');
        return (r === undefined ? true : r) as T;
      } catch (err) {
        toast((err as Error).message, 'error');
        return undefined;
      }
    },
    [toast],
  );

  return (
    <Ctx.Provider
      value={{ treasury, route, navigate, toasts, toast, dismissToast, run, switchProfile, extras }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

/** Re-render whenever the treasury changes; returns the change counter. */
export function useTreasuryVersion(): number {
  const { treasury } = useApp();
  return useSyncExternalStore(
    (cb) => treasury.subscribe(cb),
    () => treasury.version,
  );
}

/** Convenience: treasury plus a version that invalidates memoized reads. */
export function useTreasury() {
  const app = useApp();
  const version = useTreasuryVersion();
  return { ...app, t: app.treasury, version };
}
