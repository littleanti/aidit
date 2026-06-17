// FE-14: reusable offline / reconnecting top strip (WIREFRAME §8).
//
// Renders a thin sticky banner across the top of a region while the connection
// is degraded. Driven purely by props so it stays presentational — the Thread
// page maps SSE stream status + window online/offline into the two inputs:
//   show  — whether to render at all (not "open")
//   label — the message (e.g. "오프라인 — 재연결 중…")
//
// Returns null when `show` is false so the live state is visually clean.

interface OfflineBannerProps {
  /** Whether the degraded banner should be visible. */
  show: boolean;
  /** Message to display while degraded. */
  label?: string;
  className?: string;
}

export default function OfflineBanner({
  show,
  label = '오프라인 — 재연결 중…',
  className = '',
}: OfflineBannerProps) {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-1.5 bg-amber-50 px-3 py-1 text-center text-xs font-medium text-amber-700 ${className}`}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"
      />
      <span>{label}</span>
    </div>
  );
}
