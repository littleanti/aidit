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
// Usernames/communities are shown verbatim (never translated). The cursor span
// is decorative (aria-hidden); the line text is fine for screen readers.

interface ShellPromptProps {
  command: string;
  className?: string;
}

export default function ShellPrompt({ command, className }: ShellPromptProps) {
  const user = useAuthStore((s) => s.username) ?? 'guest';

  return (
    <div className={`text-xs text-term-faint ${className ?? ''}`}>
      aidit@{user}:~$ {command}{' '}
      <span aria-hidden className="term-cursor" />
    </div>
  );
}
