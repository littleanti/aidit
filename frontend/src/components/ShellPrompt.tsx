import { useAuthStore } from '../stores/authStore';

// Reusable terminal prompt line rendered at the top of every primary screen:
//   aidit@<user>:~$ <command> <blinking cursor>
//
// - <user> is the logged-in username from authStore, falling back to 'guest'.
// - <command> is a screen-specific shell command passed by the caller.
//
// Presentational only: NO router/i18n imports here. Shell commands are
// terminal idiom and are NOT translated (identical in KO/EN); callers pass the
// final command string, interpolating any user-generated args themselves.
// Usernames/communities are shown verbatim (never translated). The ENTIRE
// prompt line is decorative (aria-hidden on the root): the real input field on
// each screen stays the accessible source of truth, so screen readers are not
// told about the cosmetic, live-updating shell echo. No aria-live anywhere.

interface ShellPromptProps {
  command: string;
  className?: string;
}

export default function ShellPrompt({ command, className }: ShellPromptProps) {
  const user = useAuthStore((s) => s.username) ?? 'guest';

  return (
    <div aria-hidden className={`text-xs text-term-faint ${className ?? ''}`}>
      aidit@{user}:~$ {command}{' '}
      <span className="term-cursor" />
    </div>
  );
}
