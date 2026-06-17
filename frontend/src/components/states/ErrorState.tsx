// FE-14: reusable error state with a retry affordance. Mobile-first.
//
// Two layouts:
//   variant="block" (default) — centered full-region error for whole-page
//     fetch failures (Thread, Community detail).
//   variant="banner" — compact inline strip for list views that may already
//     show stale data above/below it (Home, Community search).
//
// `onRetry` renders a 다시 시도 button when provided.

interface ErrorStateProps {
  /** Human-readable message (already localized by the caller). */
  message: string;
  /** Optional retry handler — renders a 다시 시도 button when present. */
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
  if (variant === 'banner') {
    return (
      <div
        role="alert"
        className={`flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ${className}`}
      >
        <span className="min-w-0 flex-1">{message}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 font-semibold underline"
          >
            다시 시도
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
      <p className="text-sm text-red-600">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-brand hover:text-brand"
        >
          다시 시도
        </button>
      )}
    </div>
  );
}
