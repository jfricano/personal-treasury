import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatMoneyInput, formatUSD, parseMoneyInput, spokenUSD, type Money } from '@/domain/money';
import {
  DEBT_STATUS_LABEL,
  MONTH_STATUS_LABEL,
  type Account,
  type DebtStatus,
  type MonthStatus,
} from '@/domain/types';
import { useApp } from '@/app/context';

export function Amount({
  value,
  parens,
  signed,
  redNegative,
  label,
}: {
  value: Money;
  parens?: boolean;
  signed?: boolean;
  redNegative?: boolean;
  label?: string;
}) {
  const text = formatUSD(value, { parens, signed });
  const negative = text.startsWith('-') || text.startsWith('(');
  return (
    <span
      className={`num${redNegative && negative ? ' neg' : ''}`}
      aria-label={`${label ? `${label}: ` : ''}${spokenUSD(value)}`}
    >
      {text}
    </span>
  );
}

export function MonthStatusBadge({ status, closed }: { status: MonthStatus; closed?: boolean }) {
  const cls = status === 'REVIEW' ? 'review' : status === 'COMPLETE' ? 'complete' : 'ready';
  return (
    <span className="btn-row" style={{ gap: 4 }}>
      <span className={`badge ${cls}`}>
        {status === 'REVIEW' ? '⚠ ' : status === 'COMPLETE' ? '✓ ' : '→ '}
        {MONTH_STATUS_LABEL[status]}
      </span>
      {closed && <span className="badge closed">Closed</span>}
    </span>
  );
}

export function DebtStatusBadge({ status, review }: { status: DebtStatus; review?: boolean }) {
  return (
    <span className="btn-row" style={{ gap: 4 }}>
      <span className={`badge ${status === 'PAID' ? 'neutral' : status === 'CREDIT' ? 'ready' : 'neutral'}`}>
        {DEBT_STATUS_LABEL[status]}
      </span>
      {review && (
        <span className="badge warn" title="Notes mention cancellation; balance still counts">
          Review note
        </span>
      )}
    </span>
  );
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      restore.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      restore.current?.focus?.();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={wide ? 'wide-dialog' : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <>
          <header>{title}</header>
          <div className="body">{children}</div>
          {footer && <footer>{footer}</footer>}
        </>
      )}
    </dialog>
  );
}

/** Promise-based confirmation dialog. */
export function useConfirm() {
  const [state, setState] = useState<{
    text: ReactNode;
    danger?: boolean;
    confirmLabel?: string;
    resolve: (v: boolean) => void;
  } | null>(null);
  const ask = (text: ReactNode, opts: { danger?: boolean; confirmLabel?: string } = {}) =>
    new Promise<boolean>((resolve) => setState({ text, ...opts, resolve }));
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  const element = (
    <Dialog
      open={!!state}
      title="Please confirm"
      onClose={() => close(false)}
      footer={
        <>
          <button className="btn" onClick={() => close(false)}>
            Cancel
          </button>
          <button
            className={`btn ${state?.danger ? 'danger' : 'primary'}`}
            onClick={() => close(true)}
            autoFocus
          >
            {state?.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <div>{state?.text}</div>
    </Dialog>
  );
  return { ask, element };
}

/** Text input that commits on blur or Enter and reverts on Escape; shows unsaved state. */
export function CommitInput({
  value,
  onCommit,
  money,
  className = 'cell',
  ariaLabel,
  disabled,
  placeholder,
  multiline,
}: {
  value: string;
  onCommit: (v: string) => void;
  money?: boolean;
  className?: string;
  ariaLabel: string;
  disabled?: boolean;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // The visible editable value always retains full precision. Focus must not
  // replace the DOM value after the browser has selected text for replacement.
  const shown = draft ?? (money && value !== '' ? formatMoneyInput(value) : value);
  const invalid = money && draft !== null && draft.trim() !== '' && parseMoneyInput(draft) === null;
  const commit = () => {
    if (draft === null) return;
    if (money) {
      const m = parseMoneyInput(draft === '' ? '0' : draft);
      if (m === null) return;
      if (m !== value) onCommit(m);
    } else if (draft !== value) onCommit(draft);
    setDraft(null);
  };
  const props = {
    className: `${className}${money ? ' num' : ''}${draft !== null && draft !== value ? ' dirty' : ''}${invalid ? ' invalid' : ''}`,
    'aria-label': ariaLabel,
    disabled,
    placeholder,
    value: shown,
    onBlur: commit,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
        // Blurring commits exactly once (via onBlur).
        e.preventDefault();
        (e.target as HTMLElement).blur();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        setDraft(null);
        setTimeout(() => (e.target as HTMLElement).blur());
      }
    },
  };
  return multiline ? <textarea rows={2} {...props} /> : <input {...props} />;
}

/**
 * Account picker that accepts typed names (and legacy workbook identifiers). Emits the resolved
 * account id, or null while the text does not match an account.
 */
export function AccountField({
  value,
  onChange,
  ariaLabel,
  accounts,
  className = 'box',
  id,
  onKeyDown,
  inputRef,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  ariaLabel: string;
  accounts: Account[];
  className?: string;
  id?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const { treasury } = useApp();
  const listId = useId();
  const account = accounts.find((a) => a.id === value);
  const name = account?.displayName || account?.code || '';
  const [text, setText] = useState(name);
  const [lastValue, setLastValue] = useState(value);
  const [lastName, setLastName] = useState(name);
  if (value !== lastValue || name !== lastName) {
    setLastValue(value);
    setLastName(name);
    setText(name);
  }
  const unresolved = text.trim() !== '' && !value;
  return (
    <>
      <input
        id={id}
        ref={inputRef}
        className={`${className}${unresolved ? ' invalid' : ''}`}
        aria-label={ariaLabel}
        list={listId}
        value={text}
        autoComplete="off"
        spellCheck={false}
        style={{ width: '100%', minWidth: 64 }}
        onChange={(e) => {
          setText(e.target.value);
          const r = treasury.resolver().resolve(e.target.value);
          const next = e.target.value.trim() && r.accountId ? r.accountId : null;
          setLastValue(next);
          onChange(next);
        }}
        onKeyDown={onKeyDown}
      />
      <datalist id={listId}>
        {accounts
          .filter((a) => a.active)
          .map((a) => (
            <option key={a.id} value={a.displayName || a.code} />
          ))}
      </datalist>
    </>
  );
}

export function Field({
  label,
  children,
  wide,
  error,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  error?: string | null;
}) {
  return (
    <label className={`field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      {children}
      {error && <span className="err">{error}</span>}
    </label>
  );
}

export function Panel({
  title,
  actions,
  children,
  id,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="panel" id={id} aria-label={typeof title === 'string' ? title : undefined}>
      <header>
        {title}
        <span className="spacer" />
        {actions}
      </header>
      <div className="body">{children}</div>
    </section>
  );
}

export const todayIso = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
