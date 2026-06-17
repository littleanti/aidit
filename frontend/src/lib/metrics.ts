// ============================================================================
// WP XC-10 — client metrics instrumentation.
//
// §8 KPIs that the KEY-BLIND server cannot observe (Gemini success rate, @AI
// counts) are emitted from the browser here. This module is intentionally TINY
// and NON-BLOCKING:
//   * track()       — best-effort: console.debug + optional fire-and-forget POST
//                     to the server metrics sink (if one exists). NEVER throws,
//                     NEVER blocks the UI, NEVER awaited by callers.
//   * recordVisit() — fire-and-forget POST /api/metrics/visit (x-user-id only),
//                     feeding author D1-retention (BE-13). NEVER throws.
//
// L1 (key-blind): NO API key is ever read, included, or logged here. The only
// identifier that crosses the wire is the persisted User.id (x-user-id), exactly
// like every other Aidit REST call.
// ============================================================================

import { postMetricsVisit } from '../api/rest';

/** Best-effort, non-blocking telemetry sink for a single named event.
 *
 * Always logs to console.debug for local observability, then fire-and-forgets a
 * POST to the server's metrics ingestion endpoint IF one is available. Any
 * failure (network, 404 when no sink exists, serialization) is swallowed: this
 * function NEVER throws and NEVER blocks the calling flow. Callers MUST NOT pass
 * an API key in `props` — props are JSON-serialized onto the wire.
 */
export function track(event: string, props?: Record<string, unknown>): void {
  try {
    // Local observability — cheap and always on (debug level stays out of the way).
    // eslint-disable-next-line no-console
    console.debug('[metrics]', event, props ?? {});
  } catch {
    // console can theoretically throw in exotic environments; never propagate.
  }

  // Optional server sink. We POST best-effort and ignore the outcome entirely.
  // The endpoint is OPTIONAL: if the server has no /metrics/events route the
  // POST simply 404s and we discard it. This keeps XC-10 additive and decoupled.
  try {
    if (typeof fetch !== 'function') return;
    void fetch('/api/metrics/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // keepalive lets the beacon survive a page transition (e.g. logout/unload).
      keepalive: true,
      body: JSON.stringify({ event, props: props ?? {}, ts: Date.now() }),
    }).catch(() => {
      // best-effort: swallow network / HTTP failures.
    });
  } catch {
    // never let telemetry break a user flow.
  }
}

/** Record an authed app-open / login for the given user (author D1 retention,
 *  BE-13). Fire-and-forget POST /api/metrics/visit carrying ONLY x-user-id; the
 *  server upserts an idempotent daily VisitEvent. NEVER throws, NEVER blocks. */
export function recordVisit(userId: string): void {
  if (!userId) return;
  try {
    // Fire-and-forget: postMetricsVisit sends ONLY x-user-id (L1, no key). We
    // never await it and swallow any rejection so a failed ping is invisible.
    void postMetricsVisit(userId).catch(() => {
      // best-effort: a failed visit ping must never surface to the user.
    });
  } catch {
    // never let telemetry break the app-open flow.
  }
}
