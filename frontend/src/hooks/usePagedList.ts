import { useCallback, useEffect, useRef, useState } from 'react';

// Reusable keyset-pagination hook, generalized from the Home feed pattern.
//
// Encapsulates: items state, the opaque server cursor, loading/done/error
// flags, an IntersectionObserver sentinel ref, and a loadMore() that appends.
// It resets and refetches whenever `resetKey` changes (e.g. a tab switch), and
// cancels stale appends via a monotonic request counter so a fast tab switch
// never lets an old in-flight page clobber the new tab's data.
//
// The fetcher is given the current cursor (undefined on the first page) and
// must resolve to one page: { items, nextCursor }. nextCursor === null means
// end-of-list. Callers pass an `enabled` flag so an inactive tab fetches lazily
// (nothing loads until it becomes active).

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type PageFetcher<T> = (cursor?: string) => Promise<Page<T>>;

interface UsePagedListOptions<T> {
  /** Fetches one page given the previous page's cursor (undefined = first page). */
  fetcher: PageFetcher<T>;
  /** Changing this resets items/cursor and refetches the first page. */
  resetKey: string;
  /** When false, the hook stays idle (lazy tabs). Default true. */
  enabled?: boolean;
  /** Localized fallback message used when a thrown error has no message. */
  errorFallback: string;
}

export interface UsePagedListResult<T> {
  items: T[];
  loading: boolean;
  error: string | null;
  /** True once the server returns a null nextCursor (no more pages). */
  done: boolean;
  /** True after the first page settles (so callers can show empty vs. skeleton). */
  initialized: boolean;
  /** Attach to the infinite-scroll sentinel element. */
  sentinelRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Manually (re)load the first page — used as the error retry handler. */
  reload: () => void;
}

export function usePagedList<T>({
  fetcher,
  resetKey,
  enabled = true,
  errorFallback,
}: UsePagedListOptions<T>): UsePagedListResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Monotonic request id: any settled response whose id is stale is dropped.
  const reqRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Keep the latest fetcher/fallback in refs so loadPage stays stable across
  // renders (a new inline fetcher each render must not retrigger the reset
  // effect). Only `resetKey` and `enabled` drive resets.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const fallbackRef = useRef(errorFallback);
  fallbackRef.current = errorFallback;

  const loadPage = useCallback(async (cursor?: string) => {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const { items: pageItems, nextCursor: serverCursor } =
        await fetcherRef.current(cursor);
      if (reqRef.current !== reqId) return; // superseded by a newer request
      setItems((prev) => (cursor ? [...prev, ...pageItems] : pageItems));
      setNextCursor(serverCursor);
      setDone(serverCursor == null);
    } catch (err) {
      if (reqRef.current !== reqId) return;
      const message =
        err instanceof Error && err.message ? err.message : fallbackRef.current;
      setError(message);
    } finally {
      if (reqRef.current === reqId) {
        setLoading(false);
        setInitialized(true);
      }
    }
  }, []);

  // Reset + load the first page whenever the key changes (or the tab enables).
  useEffect(() => {
    // Invalidate any in-flight request so its append is dropped.
    reqRef.current++;
    setItems([]);
    setNextCursor(null);
    setDone(false);
    setError(null);
    setInitialized(false);
    if (!enabled) {
      setLoading(false);
      return;
    }
    void loadPage();
  }, [resetKey, enabled, loadPage]);

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!enabled || !el || done || loading || !nextCursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadPage(nextCursor);
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, items, done, loading, nextCursor, loadPage]);

  const reload = useCallback(() => {
    void loadPage();
  }, [loadPage]);

  return {
    items,
    loading,
    error,
    done,
    initialized,
    sentinelRef,
    reload,
  };
}
