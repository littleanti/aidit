// FE-5: reusable persona badge.
// Renders a community's persona icon (emoji / short token) + its name.
// L12: personaIcon is nullable — fall back to a default emoji.

interface PersonaBadgeProps {
  /** persona icon (emoji or short string). null/undefined -> default. */
  personaIcon?: string | null;
  /** persona / community display name. */
  name: string;
  /** visual size. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const DEFAULT_ICON = '🤖';

const SIZE: Record<NonNullable<PersonaBadgeProps['size']>, string> = {
  sm: 'h-7 w-7 text-base',
  md: 'h-9 w-9 text-xl',
  lg: 'h-12 w-12 text-2xl',
};

export default function PersonaBadge({
  personaIcon,
  name,
  size = 'md',
  className = '',
}: PersonaBadgeProps) {
  const icon = personaIcon && personaIcon.trim() ? personaIcon : DEFAULT_ICON;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-brand/10 ${SIZE[size]}`}
        aria-hidden
      >
        {icon}
      </span>
      <span className="truncate font-semibold text-slate-800">{name}</span>
    </div>
  );
}
