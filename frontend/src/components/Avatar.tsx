// VR-2: reusable square avatar tile.
// Renders a deterministic phosphor-tinted avatar for users / self, or a robot
// glyph for AI. Tailwind purge safe: colors are picked from a static class
// array (no dynamic strings).

interface AvatarProps {
  /** which kind of avatar to render. */
  kind: 'user' | 'me' | 'ai';
  /** seed (e.g. username) for deterministic color/initial. null/undefined -> neutral. */
  seed?: string | null;
  /** visual size. sm = h-7 w-7, md (default) = h-8 w-8. */
  size?: 'sm' | 'md';
  className?: string;
}

// Static palette — full class strings only (Tailwind purge safety).
// Green-phosphor CRT tiles: shared term-card surface + term-border, varied by
// glyph tint so seeded users still read as distinct on the monochrome console.
const PALETTE = [
  'bg-term-card border border-term-border text-term-title',
  'bg-term-card border border-term-border text-term-bright',
  'bg-term-card border border-term-border text-term-dim',
  'bg-term-hover border border-term-bright text-term-title',
  'bg-term-hover border border-term-border text-term-bright',
  'bg-term-card border border-term-bright text-term-dim',
];

const SIZE: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-7 w-7 text-[13px]',
  md: 'h-8 w-8 text-sm',
};

// Neutral phosphor tile for seedless avatars.
const NEUTRAL = 'bg-term-card border border-term-border text-term-faint';

/** Hash seed -> palette index (sum of char codes % 6). No seed -> neutral. */
function colorFor(seed?: string | null): string {
  if (!seed || !seed.trim()) return NEUTRAL;
  let sum = 0;
  for (let i = 0; i < seed.length; i += 1) sum += seed.charCodeAt(i);
  return PALETTE[sum % PALETTE.length];
}

// Person silhouette glyph for user/me avatars (phosphor stroke line-art).
const PersonGlyph = () => (
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
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20v-1c0-3.31 3.13-5.5 7-5.5s7 2.19 7 5.5v1" />
  </svg>
);

// Robot glyph for AI avatars (phosphor stroke line-art, matches Composer).
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

export default function Avatar({
  kind,
  seed,
  size = 'md',
  className = '',
}: AvatarProps) {
  const isAi = kind === 'ai';
  const colorClass = isAi
    ? 'bg-term-card border border-term-bright text-term-title'
    : colorFor(seed);
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-[3px] font-mono ${colorClass} ${SIZE[size]} ${className}`}
      aria-hidden
    >
      {isAi ? <RobotGlyph /> : <PersonGlyph />}
    </span>
  );
}
