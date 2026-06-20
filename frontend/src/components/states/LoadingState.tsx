// FE-14: reusable loading state. Mobile-first, centered spinner + optional label.
//
// Used by Home/Community/Thread (and anywhere a fetch is in flight) so loading
// UX is consistent across the app. Defaults to a lightweight spinner; pass
// `variant="skeleton"` to render shimmering card placeholders for list views.

import { useT } from '../../i18n/useT';

interface LoadingStateProps {
  /** Optional label shown under the spinner. */
  label?: string;
  /** 'spinner' (default) centered spinner, or 'skeleton' list placeholders. */
  variant?: 'spinner' | 'skeleton';
  /** Number of skeleton rows when variant === 'skeleton'. */
  rows?: number;
  className?: string;
}

export default function LoadingState({
  label,
  variant = 'spinner',
  rows = 4,
  className = '',
}: LoadingStateProps) {
  const { t } = useT();
  const resolvedLabel = label ?? t('states.loading');
  if (variant === 'skeleton') {
    return (
      <div
        className={`space-y-2 ${className}`}
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-[2px] border border-term-border px-3 py-3"
          >
            <div className="h-4 w-2/3 rounded-[2px] bg-term-card" />
            <div className="mt-2 h-3 w-full rounded-[2px] bg-term-hover" />
            <div className="mt-1 h-3 w-1/3 rounded-[2px] bg-term-hover" />
          </div>
        ))}
        <span className="sr-only">{resolvedLabel}</span>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 py-16 text-center ${className}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span
        aria-hidden
        className="h-6 w-6 animate-spin rounded-full border-2 border-term-border border-t-term-bright"
      />
      <p className="text-sm text-term-faint">{resolvedLabel}</p>
    </div>
  );
}
