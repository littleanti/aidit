// FE-14: reusable error state with a retry affordance. Mobile-first.
//
// Two layouts:
//   variant="block" (default) — centered full-region error for whole-page
//     fetch failures (Thread, Community detail).
//   variant="banner" — compact inline strip for list views that may already
//     show stale data above/below it (Home, Community search).
//
// `onRetry` renders a retry button when provided.

import { useT } from '../../i18n/useT';

interface ErrorStateProps {
  /** Human-readable message (already localized by the caller). */
  message: string;
  /** Optional retry handler — renders a retry button when present. */
  onRetry?: () => void;
  variant?: 'block' | 'banner';
  className?: string;
}

export default function ErrorState({
  message,
  onRetry,
  variant = 'block',
  className = '',
}: ErrorStateProps) {
  const { t } = useT();
  if (variant === 'banner') {
    return (
      <div
        role="alert"
        className={`flex items-center gap-2 rounded-[2px] border border-term-border bg-term-info px-4 py-3 text-sm text-term-danger ${className}`}
      >
        <span className="min-w-0 flex-1">{message}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 font-semibold underline"
          >
            {t('states.retry')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={`flex flex-col items-center gap-3 py-16 text-center ${className}`}
    >
      <span aria-hidden className="text-3xl">
        ⚠️
      </span>
      <p className="text-sm text-term-danger">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-[44px] items-center rounded-[2px] border border-term-border px-4 text-sm font-semibold text-term-dim transition hover:border-term-bright hover:text-term-bright"
        >
          {t('states.retry')}
        </button>
      )}
    </div>
  );
}
