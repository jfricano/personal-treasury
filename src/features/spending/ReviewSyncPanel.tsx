import { useState, useSyncExternalStore } from 'react';
import { Panel, useConfirm } from '@/components/ui';
import type { V3Session } from '@/security/client';
import type { ReviewStore } from '@/review-store';
import type { ConflictChoice } from '@/security/reviewSync';
export function ReviewSyncPanel({ session, store }: { session: V3Session; store: ReviewStore }) {
  const status = useSyncExternalStore(session.subscribe, session.getReviewStatus);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const confirm = useConfirm();
  const perform = async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const resolve = async (ref: string, choice: ConflictChoice) => {
    if (
      choice !== 'both' &&
      !(await confirm.ask(
        `Use the ${choice === 'device' ? 'device' : 'cloud'} copy? The other copy and its classifications will be replaced.`,
        { danger: true, confirmLabel: 'Use this copy' },
      ))
    )
      return;
    await perform(async () => {
      await store.flush().catch(() => undefined);
      await session.resolveReviewConflict(ref, choice);
    });
  };
  return (
    <Panel title="Review sync">
      <p role="status">{status.message}</p>
      {error && <p role="alert">{error}</p>}
      <button
        className="btn"
        disabled={busy || session.offline}
        onClick={() => void perform(() => store.flush())}
      >
        Sync reviews now
      </button>
      {status.conflicts.map((c) => (
        <div className="notice" key={c.ref}>
          <h3>{c.month}: two review copies</h3>
          <p>
            Device: {c.deviceCount} transactions. Cloud: {c.cloudCount} transactions. Classifications may
            differ even when the counts match.
          </p>
          <div className="btn-row">
            <button className="btn" disabled={busy} onClick={() => void resolve(c.ref, 'device')}>
              Keep device copy
            </button>
            <button className="btn" disabled={busy} onClick={() => void resolve(c.ref, 'cloud')}>
              Use cloud copy
            </button>
            <button
              className="btn primary"
              disabled={busy || !c.canKeepBoth}
              onClick={() => void resolve(c.ref, 'both')}
            >
              Keep both copies
            </button>
          </div>
          {!c.canKeepBoth && (
            <p>Keeping both requires a device copy and a free slot among the three open reviews.</p>
          )}
        </div>
      ))}
      {confirm.element}
    </Panel>
  );
}
