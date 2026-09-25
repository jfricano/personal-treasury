import { useEffect, useRef } from 'react';
import type { Treasury } from '@/api/treasury';
import { AppProvider, useApp, useTreasuryVersion, type AppExtras, type Page } from './context';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { MonthlyPage } from '@/features/monthly/MonthlyPage';
import { BudgetPage } from '@/features/budget/BudgetPage';
import { DebtsPage } from '@/features/debts/DebtsPage';
import { HistoryPage } from '@/features/history/HistoryPage';
import { AccountsPage } from '@/features/accounts/AccountsPage';
import { ImportExportPage } from '@/features/importExport/ImportExportPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

const NAV: { page: Page; label: string }[] = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'monthly', label: 'Monthly reconciliation' },
  { page: 'budget', label: 'Budget and tax' },
  { page: 'debts', label: 'Interaccount debts' },
  { page: 'history', label: 'History' },
  { page: 'accounts', label: 'Accounts' },
  { page: 'import', label: 'Import and export' },
  { page: 'settings', label: 'Settings' },
];

function Shell() {
  const { route, navigate, treasury, toasts, dismissToast, toast, extras } = useApp();
  const navRef = useRef<HTMLElement>(null);
  useTreasuryVersion();

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || window.matchMedia('(min-width: 761px)').matches) return;
    nav.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [route.page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const editing = target.closest('input, textarea, select, [contenteditable]');
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !editing) {
        e.preventDefault();
        const label = treasury.undo();
        toast(label ? `Undid: ${label}` : 'Nothing to undo', label ? 'success' : 'info');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [treasury, toast]);

  const page = (() => {
    switch (route.page) {
      case 'monthly':
        return <MonthlyPage />;
      case 'budget':
        return <BudgetPage />;
      case 'debts':
        return <DebtsPage />;
      case 'history':
        return <HistoryPage />;
      case 'accounts':
        return <AccountsPage />;
      case 'import':
        return <ImportExportPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <Dashboard />;
    }
  })();

  return (
    <div className="shell">
      <aside className="rail">
        <h1>Personal Treasury</h1>
        <nav aria-label="Main" ref={navRef}>
          {NAV.map((n) => (
            <a
              key={n.page}
              href={`#/${n.page}`}
              aria-current={route.page === n.page ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate({
                  page: n.page,
                  monthId: n.page === 'monthly' || n.page === 'dashboard' ? route.monthId : null,
                });
              }}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <span className="nav-hint" aria-hidden="true">
          Swipe for more sections ↔
        </span>
        <div className="foot">
          <button
            disabled={!treasury.undoLabel}
            title="Command-Z"
            onClick={() => {
              const l = treasury.undo();
              if (l) toast(`Undid: ${l}`, 'success');
            }}
          >
            ↶ Undo{treasury.undoLabel ? `: ${treasury.undoLabel}` : ''}
          </button>
          <span className="saving" role="status">
            {treasury.storage.kind === 'session' ? 'Demo data' : `Profile “${treasury.profile}”`} ·{' '}
            {treasury.saveState === 'saving'
              ? 'Saving…'
              : treasury.saveState === 'error'
                ? `Save failed: ${treasury.lastSaveError}`
                : treasury.storage.kind === 'session'
                  ? 'Kept in this tab'
                  : 'Saved locally'}
          </span>
          <span>Offline · no telemetry</span>
        </div>
      </aside>
      <main>
        {extras.banner}
        {page}
      </main>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span>{t.text}</span>
            <button aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function App({
  treasury,
  switchProfile,
  extras,
}: {
  treasury: Treasury;
  switchProfile: (name: string) => void;
  /** Supplied only by the public demo build. */
  extras?: AppExtras;
}) {
  return (
    <AppProvider treasury={treasury} switchProfile={switchProfile} extras={extras}>
      <Shell />
    </AppProvider>
  );
}
