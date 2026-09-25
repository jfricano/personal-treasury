import { useEffect, useState } from 'react';
import { useApp, type Route } from '@/app/context';
import { useConfirm } from '@/components/ui';
import { HOUSEHOLD } from './persona';
import type { SessionDatabaseStorage } from './sessionStorage';
import { DemoTour, tourSeen } from './Tour';

const TRY: { text: string; route: Route; loanId?: string }[] = [
  { text: 'Mark this month’s remaining transfers Done to complete it.', route: { page: 'monthly' } },
  { text: 'Change an allocation and watch the month move to Review.', route: { page: 'monthly' } },
  {
    text: 'Record a payment on debt H-01, then undo it with ⌘Z / Ctrl-Z.',
    route: { page: 'debts' },
    loanId: 'H-01',
  },
  { text: 'Overpay debt H-05 and see who owes whom reverse.', route: { page: 'debts' }, loanId: 'H-05' },
  {
    text: 'Duplicate the active budget, change a line, activate it, then refresh the month.',
    route: { page: 'budget' },
  },
  {
    text: 'Download the sample workbook, start blank, and import it with a full preview.',
    route: { page: 'import' },
  },
];

export function DemoBanner({
  storage,
  sampleBytes,
  blankBytes,
}: {
  storage: SessionDatabaseStorage;
  sampleBytes: () => Promise<Uint8Array>;
  blankBytes: () => Promise<Uint8Array>;
}) {
  const { treasury, navigate, run } = useApp();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touring, setTouring] = useState(false);

  // First visit in this browser: start the tour once.
  useEffect(() => {
    if (!tourSeen()) setTouring(true);
  }, []);

  const replace = async (question: string, label: string, bytes: () => Promise<Uint8Array>, done: string) => {
    if (!(await confirm.ask(question, { confirmLabel: label }))) return;
    setBusy(true);
    try {
      const data = await bytes();
      if (run(() => treasury.replaceDatabase(data, label, { undoLabel: label }), done) !== undefined)
        navigate({ page: 'dashboard' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="demo-banner" aria-label="Demo">
      <div className="demo-row">
        <span className="demo-tag">Demo</span>
        <p>
          <strong>{HOUSEHOLD.name}</strong> is a made-up family. Everything you do stays in this browser tab
          and is gone when you close it. Nothing is sent anywhere.
        </p>
        <div className="demo-actions">
          <button className="btn small primary" onClick={() => setTouring(true)}>
            Take the tour
          </button>
          <button className="btn small" aria-expanded={open} onClick={() => setOpen(!open)}>
            What to try {open ? '▴' : '▾'}
          </button>
          <button
            className="btn small"
            disabled={busy}
            onClick={() =>
              replace(
                'Replace everything in this tab with the Harper household sample data? You can undo this.',
                'Reset to sample data',
                sampleBytes,
                'Sample data restored',
              )
            }
          >
            Reset sample data
          </button>
          <button
            className="btn small"
            disabled={busy}
            onClick={() =>
              replace(
                'Start with an empty database, as on a first launch? You can undo this, or reset to the sample data at any time.',
                'Start blank',
                blankBytes,
                'Started with a clean slate',
              )
            }
          >
            Start blank
          </button>
        </div>
      </div>
      {open && (
        <ol className="demo-try">
          {TRY.map((item) => (
            <li key={item.text}>
              <a
                href={`#/${item.route.page}`}
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  navigate({
                    ...item.route,
                    monthId: item.route.page === 'monthly' ? treasury.currentMonthId() : undefined,
                    debtId: item.loanId ? treasury.repos.getDebtByLoanId(item.loanId)?.id : undefined,
                  });
                }}
              >
                {item.text}
              </a>
            </li>
          ))}
        </ol>
      )}
      {storage.memoryOnly && (
        <p className="demo-note">
          This session has outgrown the tab’s storage, so changes now last only until you reload.
        </p>
      )}
      <p className="demo-narrow">On a phone, swipe wide tables sideways; the first column stays in view.</p>
      {confirm.element}
      {touring && <DemoTour onClose={() => setTouring(false)} />}
    </section>
  );
}
