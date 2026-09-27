import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Treasury } from '@/api/treasury';
import { ReviewStore, type ReviewBackend } from '@/review-store';
import { localReviewBackend } from '@/review-store/local';
const stores = new WeakMap<Treasury, { store: ReviewStore; ready: Promise<void> }>();
export function registerReviewBackend(t: Treasury, backend: ReviewBackend) {
  const store = new ReviewStore(backend);
  stores.set(t, { store, ready: store.load() });
}
export function useReviewStore(t: Treasury) {
  let entry = stores.get(t);
  if (!entry) {
    const store = new ReviewStore(localReviewBackend(t.profile, t.storage.kind));
    entry = { store, ready: store.load() };
    stores.set(t, entry);
  }
  const { store, ready } = entry;
  useSyncExternalStore(store.subscribe, store.getVersion);
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void ready
      .then(() => {
        if (live) setLoaded(true);
      })
      .catch((e) => {
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [ready]);
  return { store, loaded, error };
}

/** Demo resets explicitly discard ephemeral reviews; database Undo never recreates them. */
export async function discardDemoReviews(t: Treasury) {
  const entry = stores.get(t);
  if (entry) {
    await entry.ready;
    for (const review of entry.store.entries())
      if (['open', 'awaiting_upload'].includes(review.state))
        await entry.store.finish(review.ref, 'discarded');
  } else sessionStorage.removeItem(`pt-v3-reviews:${encodeURIComponent(t.profile)}`);
}
