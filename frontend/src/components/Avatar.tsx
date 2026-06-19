// VR-2: reusable circular avatar.
// Renders a deterministic colored avatar for users / self, or a gradient AI glyph.
// Tailwind purge safe: colors are picked from a static class array (no dynamic strings).

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
const PALETTE = [
  'bg-violet-500',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-indigo-500',
];

const SIZE: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-7 w-7 text-[13px]',
  md: 'h-8 w-8 text-sm',
};

/** Hash seed -> palette index (sum of char codes % 6). No seed -> neutral slate. */
function colorFor(seed?: string | null): string {
  if (!seed || !seed.trim()) return 'bg-slate-400';
  let sum = 0;
  for (let i = 0; i < seed.length; i += 1) sum += seed.charCodeAt(i);
  return PALETTE[sum % PALETTE.length];
}

// White person silhouette glyph for user/me avatars.
const PersonGlyph = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-1/2 w-1/2" aria-hidden>
    <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.69-8 6v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-3.31-3.58-6-8-6Z" />
  </svg>
);

// White robot glyph for AI avatars.
const RobotGlyph = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-1/2 w-1/2" aria-hidden>
    <path d="M12 2a1 1 0 0 1 1 1v1h3a3 3 0 0 1 3 3v2a2 2 0 0 1 0 4v2a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-2a2 2 0 0 1 0-4V7a3 3 0 0 1 3-3h3V3a1 1 0 0 1 1-1ZM9 11a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 9 11Zm6 0a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 15 11Z" />
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
    ? 'bg-brand-gradient'
    : colorFor(seed);
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full text-white ${colorClass} ${SIZE[size]} ${className}`}
      aria-hidden
    >
      {isAi ? <RobotGlyph /> : <PersonGlyph />}
    </span>
  );
}
