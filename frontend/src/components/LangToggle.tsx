import { useLangStore, type Lang } from '../stores/langStore';

// i18n: [ KO | EN ] segmented language control in the terminal/amber bracket
// aesthetic. Active = text-term-amber; inactive = text-term-dim with a
// hover:text-term-bright, matching AppLayout's header button styling.
//
// State-based (option a): toggling just flips langStore — no route/URL change.
// Selecting the already-active language is a no-op.

interface LangToggleProps {
  /** 'header' (compact, app-bar) or 'setting' (roomier, in a settings panel). */
  variant?: 'header' | 'setting';
}

const OPTIONS: ReadonlyArray<{ value: Lang; label: string }> = [
  { value: 'ko', label: 'KO' },
  { value: 'en', label: 'EN' },
];

export default function LangToggle({ variant = 'header' }: LangToggleProps) {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);

  const gap = variant === 'setting' ? 'gap-1.5 text-sm' : 'gap-1 text-sm';

  return (
    <div
      className={`flex select-none items-center ${gap} text-term-dim`}
      role="group"
      aria-label="Language"
    >
      <span aria-hidden className="text-term-dim">
        [
      </span>
      {OPTIONS.map((opt, i) => {
        const active = lang === opt.value;
        return (
          <span key={opt.value} className="flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden className="text-term-dim">
                |
              </span>
            )}
            <button
              type="button"
              onClick={() => setLang(opt.value)}
              aria-pressed={active}
              className={
                active
                  ? 'font-medium text-term-amber transition'
                  : 'text-term-dim transition hover:text-term-bright'
              }
            >
              {opt.label}
            </button>
          </span>
        );
      })}
      <span aria-hidden className="text-term-dim">
        ]
      </span>
    </div>
  );
}
