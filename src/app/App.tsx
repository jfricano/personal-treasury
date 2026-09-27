import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { SpendingPage } from '@/features/spending/SpendingPage';
import { ConnectionsPage } from '@/features/connections/ConnectionsPage';
import type { CloudSyncSession } from '@/sync/session';

function SyncNotice({ session }: { session: CloudSyncSession }) {
  const { navigate } = useApp();
  const status = useSyncExternalStore(session.subscribe, session.getStatus);
  if (status.phase !== 'conflict' && status.phase !== 'offline' && status.phase !== 'error') return null;
  return (
    <div className={`sync-notice ${status.phase}`} role="alert">
      <span>{status.message} Local changes are still saved on this device.</span>
      <button className="btn small" onClick={() => navigate({ page: 'settings' })}>
        Open sync settings
      </button>
    </div>
  );
}

const NAV_GROUPS: { label: string; links: { page: Page; label: string }[] }[] = [
  { label: '', links: [{ page: 'dashboard', label: 'Dashboard' }] },
  {
    label: 'Budgeting',
    links: [
      { page: 'budget', label: 'Budget and Tax' },
      { page: 'analysis', label: 'Budget Analysis' },
      { page: 'history', label: 'Budget History' },
    ],
  },
  {
    label: 'Treasury',
    links: [
      { page: 'monthly', label: 'Monthly Reconciliation' },
      { page: 'debts', label: 'Interaccount Debts' },
      { page: 'accounts', label: 'Accounts' },
      { page: 'connections', label: 'Connected Accounts' },
    ],
  },
  {
    label: '',
    links: [
      { page: 'import', label: 'Import and Export' },
      { page: 'settings', label: 'Settings' },
    ],
  },
];

function Shell({ onLogout }: { onLogout?: () => void }) {
  const { route, navigate, treasury, toasts, dismissToast, toast, extras, syncSession } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const currentLabel =
    NAV_GROUPS.flatMap((g) => g.links).find((n) => n.page === route.page)?.label ?? 'Dashboard';
  useTreasuryVersion();
  useEffect(() => {
    document.title = `${currentLabel} · Personal Treasury`;
    setMenuOpen(false);
    const heading = document.querySelector<HTMLElement>('main h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [route.page, currentLabel]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
        menuRef.current?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);

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
      case 'analysis':
        return <SpendingPage />;
      case 'connections':
        return <ConnectionsPage />;
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
        <div className="rail-title">
          <div className="product-name">Personal Treasury</div>
          {onLogout && (
            <button className="mobile-logout" type="button" onClick={onLogout}>
              Sign out
            </button>
          )}
        </div>
        <button
          ref={menuRef}
          className="mobile-menu"
          aria-expanded={menuOpen}
          aria-controls="main-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          Menu · {currentLabel}
        </button>
        <nav id="main-navigation" aria-label="Main" className={menuOpen ? 'is-open' : ''}>
          {NAV_GROUPS.map((group, index) => (
            <div key={index} className="nav-group">
              {group.label && <span className="nav-section">{group.label}</span>}
              {group.links.map((n) => (
                <a
                  key={n.page}
                  href={`#/${n.page}`}
                  aria-current={route.page === n.page ? 'page' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    setMenuOpen(false);
                    navigate({
                      page: n.page,
                      monthId: n.page === 'monthly' || n.page === 'dashboard' ? route.monthId : null,
                    });
                  }}
                >
                  {n.label}
                </a>
              ))}
            </div>
          ))}
          {onLogout && (
            <button className="nav-logout" type="button" onClick={onLogout}>
              Sign out
            </button>
          )}
        </nav>
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
          <span>{syncSession ? 'Cloud sync connected · no telemetry' : 'Offline · no telemetry'}</span>
        </div>
      </aside>
      <main>
        {extras.banner}
        {syncSession && <SyncNotice session={syncSession} />}
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
  syncSession,
  onLogout,
}: {
  treasury: Treasury;
  switchProfile: (name: string) => void;
  /** Supplied only by the public demo build. */
  extras?: AppExtras;
  syncSession?: CloudSyncSession | null;
  /** Supplied only by the private web build. */
  onLogout?: () => void;
}) {
  return (
    <AppProvider
      treasury={treasury}
      switchProfile={switchProfile}
      extras={extras}
      initialSyncSession={syncSession}
    >
      <Shell onLogout={onLogout} />
    </AppProvider>
  );
}
