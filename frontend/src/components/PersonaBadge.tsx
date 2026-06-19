// FE-5: reusable persona badge.
// Renders a community's persona icon (emoji / short token) + its name.
// L12: personaIcon is nullable — fall back to the robot glyph.

interface PersonaBadgeProps {
  /** persona icon (emoji or short string). null/undefined -> default robot. */
  personaIcon?: string | null;
  /** persona / community display name. */
  name: string;
  /** visual size. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE: Record<NonNullable<PersonaBadgeProps['size']>, string> = {
  sm: 'h-7 w-7 text-base',
  md: 'h-9 w-9 text-xl',
  lg: 'h-12 w-12 text-2xl',
};

// Robot glyph fallback for AI/community persona (phosphor stroke line-art).
const RobotGlyph = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-1/2 w-1/2"
    aria-hidden
  >
    <rect x="5" y="8" width="14" height="11" rx="1" />
    <path d="M12 8V4M9 4h6" />
    <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export default function PersonaBadge({
  personaIcon,
  name,
  size = 'md',
  className = '',
}: PersonaBadgeProps) {
  const icon = personaIcon && personaIcon.trim() ? personaIcon : null;
  return (
    <div className={`flex items-center gap-2 font-mono ${className}`}>
      <span
        className={`flex shrink-0 items-center justify-center rounded-[3px] border border-term-border bg-term-card text-term-title ${SIZE[size]}`}
        aria-hidden
      >
        {icon ?? <RobotGlyph />}
      </span>
      <span className="truncate font-semibold text-term-bright">{name}</span>
    </div>
  );
}
