// FE-14: reusable offline / reconnecting top strip (WIREFRAME §8).
//
// Renders a thin sticky banner across the top of a region while the connection
// is degraded. Driven purely by props so it stays presentational — the Thread
// page maps SSE stream status + window online/offline into the two inputs:
//   show  — whether to render at all (not "open")
//   label — the message shown while degraded
//
// Returns null when `show` is false so the live state is visually clean.

import { useT } from '../../i18n/useT';

interface OfflineBannerProps {
  /** Whether the degraded banner should be visible. */
  show: boolean;
  /** Message to display while degraded. */
  label?: string;
  className?: string;
}

export default function OfflineBanner({
  show,
  label,
  className = '',
}: OfflineBannerProps) {
  const { t } = useT();
  const resolvedLabel = label ?? t('states.offline');
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-1.5 rounded-[2px] border border-term-amber bg-term-info px-3 py-1 text-center text-xs font-medium text-term-amber ${className}`}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-term-amber"
      />
      <span>{resolvedLabel}</span>
    </div>
  );
}
