import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApp, type Page } from '@/app/context';

interface Step {
  title: string;
  body: ReactNode;
  /** Page the step lives on; the tour navigates there first. */
  page?: Page;
  /** Element to highlight. Without one (or if it isn't on screen), the card is centered. */
  target?: string;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to the Harpers’ treasury',
    body: (
      <>
        Personal Treasury runs a household’s money as account buckets: plan each paycheck, move money between
        buckets, reconcile every month to the cent, and track what the buckets owe each other. This tour takes
        about a minute.
      </>
    ),
  },
  {
    title: 'This month at a glance',
    page: 'dashboard',
    target: '[aria-label="Summary"]',
    body: (
      <>
        Expected cash from the budget, whether the allocations tie out, how many transfers are done, and what
        the buckets owe each other. Each figure opens the entries behind it.
      </>
    ),
  },
  {
    title: 'Where each dollar goes',
    page: 'monthly',
    target: 'section[aria-label="Account transfer summary"]',
    body: (
      <>
        Each account’s final transfer is its budget allocation, plus transfers in, minus transfers out. After
        you move the money at your bank, mark it <b>Done</b>.
      </>
    ),
  },
  {
    title: 'Moves between buckets',
    page: 'monthly',
    target: 'section[aria-label="Transfer journal"]',
    body: (
      <>
        Record a transfer in one row and press Enter. A Loan ID ties a transfer to a debt, so a repayment
        updates the debt ledger with one click.
      </>
    ),
  },
  {
    title: 'Nothing hides',
    page: 'monthly',
    target: 'section[aria-label="Reconciliation"]',
    body: (
      <>
        Every check is named. If the allocations don’t tie, the journal doesn’t balance, or an account would
        go negative, the month shows <b>Review</b> and says why.
      </>
    ),
  },
  {
    title: 'What the buckets owe each other',
    page: 'debts',
    target: 'section[aria-label="Debt detail"]',
    body: (
      <>
        Each Loan ID is a history of events, and balances are always recalculated. Overpay a loan and who owes
        whom reverses, as H-03 shows. A “canceled” note flags a debt for review but never erases it.
      </>
    ),
  },
  {
    title: 'Budgets drive each month',
    page: 'budget',
    target: 'section[aria-label="Budget history"]',
    body: (
      <>
        A budget version turns gross pay into take-home pay, estimates tax, and funds each account. Versions
        lock once a month uses them, so history never changes.
      </>
    ),
  },
  {
    title: 'Your turn',
    target: 'section[aria-label="Demo"]',
    body: (
      <>
        Try the exercises under <b>What to try</b>. Reset the sample data or start blank at any time, and undo
        anything with ⌘Z / Ctrl-Z. Your changes stay in this browser tab.
      </>
    ),
  },
];

const SEEN_KEY = 'pt.demo.tourSeen';

/** Whether this browser has finished or skipped the tour. A convenience only; failures mean "not seen". */
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* the tour may simply show again next visit */
  }
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const GAP = 12;
const PAD = 6;

export function DemoTour({ onClose }: { onClose: () => void }) {
  const { route, navigate } = useApp();
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Box | null>(null);
  // null while measuring: the card is laid out invisibly at its floating width first.
  const [layout, setLayout] = useState<
    { kind: 'center' } | { kind: 'sheet' } | { kind: 'float'; top: number; left: number } | null
  >(null);
  const target = useRef<Element | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  const close = useCallback(
    (finished: boolean) => {
      markSeen();
      onClose();
      if (finished) navigate({ page: 'dashboard' });
    },
    [navigate, onClose],
  );

  // Keep the app behind the tour out of reach of keyboard and screen readers.
  useEffect(() => {
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    return () => root?.removeAttribute('inert');
  }, []);

  const measure = useCallback(() => {
    const el = target.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!el) {
      setSpot(null);
      setLayout({ kind: 'center' });
      return;
    }
    const c = card.current?.getBoundingClientRect();
    const cw = c?.width ?? 380;
    const ch = c?.height ?? 200;
    const r = el.getBoundingClientRect();
    // Highlight only the visible part of tall targets.
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, vh);
    const box = {
      top: top - PAD,
      left: r.left - PAD,
      width: r.width + PAD * 2,
      height: bottom - top + PAD * 2,
    };
    setSpot(box);
    if (vw < 640) {
      setLayout({ kind: 'sheet' });
      return;
    }
    const below = vh - (box.top + box.height);
    const cardTop =
      below >= ch + GAP * 2
        ? box.top + box.height + GAP
        : box.top >= ch + GAP * 2
          ? box.top - ch - GAP
          : vh - ch - GAP * 2;
    setLayout({ kind: 'float', top: cardTop, left: Math.min(Math.max(box.left, GAP), vw - cw - GAP) });
  }, []);

  // Go to the step's page, wait for its target to render, then bring it into view.
  useEffect(() => {
    if (step.page && route.page !== step.page) navigate({ page: step.page });
    let frame = 0;
    let tries = 0;
    let settleUntil = 0;
    let observer: ResizeObserver | null = null;
    // Pages can still be laying out after the target appears; follow it briefly.
    const settle = () => {
      measure();
      if (performance.now() < settleUntil) frame = requestAnimationFrame(settle);
    };
    const find = () => {
      const el = step.target ? document.querySelector(step.target) : null;
      if (el || !step.target || tries++ > 60) {
        target.current = el;
        el?.scrollIntoView({ block: window.innerWidth < 640 ? 'start' : 'center', behavior: 'auto' });
        if (el) {
          observer = new ResizeObserver(() => measure());
          observer.observe(el);
        }
        settleUntil = performance.now() + 500;
        settle();
        return;
      }
      frame = requestAnimationFrame(find);
    };
    target.current = null;
    setLayout(null);
    frame = requestAnimationFrame(find);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [index, measure, navigate, route.page, step.page, step.target]);

  useLayoutEffect(() => {
    primary.current?.focus({ preventScroll: true });
  }, [index]);

  useEffect(() => {
    const onChange = () => measure();
    window.addEventListener('resize', onChange);
    document.addEventListener('scroll', onChange, true);
    return () => {
      window.removeEventListener('resize', onChange);
      document.removeEventListener('scroll', onChange, true);
    };
  }, [measure]);

  const next = useCallback(() => (last ? close(true) : setIndex((i) => i + 1)), [last, close]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [back, close, next]);

  return createPortal(
    <div className="tour">
      <div className={`tour-backdrop${spot ? '' : ' dim'}`} />
      {spot && <div className="tour-spot" style={spot} />}
      <div
        ref={card}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={
          layout?.kind === 'float'
            ? { top: layout.top, left: layout.left }
            : layout
              ? undefined
              : { top: 0, left: 0, visibility: 'hidden' }
        }
        data-placement={layout?.kind ?? 'float'}
      >
        <div className="tour-count">
          {index + 1} of {STEPS.length}
        </div>
        <h3 id="tour-title">{step.title}</h3>
        <p id="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button className="btn link small" onClick={() => close(false)}>
            {last ? 'Close' : 'Skip tour'}
          </button>
          <span className="spacer" />
          {index > 0 && (
            <button className="btn small" onClick={back}>
              Back
            </button>
          )}
          <button ref={primary} className="btn small primary" onClick={next}>
            {last ? 'Start exploring' : index === 0 ? 'Show me' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
