// FE-14: reusable empty state. Mobile-first centered block with an optional
// icon, a title, an optional hint line, and an optional call-to-action.
//
// The CTA is rendered via `action` (a node) so callers can drop in a
// react-router <Link> or a <button> without this component owning routing.

import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** Primary line (e.g. "아직 인기글이 없어요."). */
  title: string;
  /** Optional secondary hint line. */
  hint?: string;
  /** Optional decorative glyph above the title. */
  icon?: ReactNode;
  /** Optional call-to-action node (Link/button). */
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({
  title,
  hint,
  icon,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center gap-3 py-16 text-center ${className}`}
    >
      {icon && (
        <span aria-hidden className="text-3xl">
          {icon}
        </span>
      )}
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="-mt-1 text-sm text-slate-400">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
