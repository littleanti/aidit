import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import {
  useUserPersonaStore,
  isFilledSlot,
} from '../stores/userPersonaStore';
import { EmptyState } from '../components/states';
import { useT } from '../i18n/useT';
import LangToggle from '../components/LangToggle';
import ShellPrompt from '../components/ShellPrompt';
import PageHeaderBar from '../components/PageHeaderBar';

// FE: ⚙️ 설정 — moved out of /me into its own /me/settings page.
// L1: googleApiKey is LOCAL ONLY. It is shown MASKED here and never logged,
// never sent to the server. Key changes go through authStore.updateKey.
// Behavior of the API Key / Language / Logout controls is IDENTICAL to the
// previous in-profile versions.

/** Show only that a key is set + its last 4 chars; never reveal the full key. */
function maskKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 4) return '••••';
  return `••••••••${trimmed.slice(-4)}`;
}

export default function Settings() {
  const { t } = useT();
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.userId);
  const googleApiKey = useAuthStore((s) => s.googleApiKey);
  const updateKey = useAuthStore((s) => s.updateKey);
  const logout = useAuthStore((s) => s.logout);

  // ---- key editing (local only) ----
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');

  // ---- my AI personas (FR-12, local only) ----
  const personas = useUserPersonaStore((s) => s.personas);
  const setPersona = useUserPersonaStore((s) => s.setPersona);
  const clearPersona = useUserPersonaStore((s) => s.clearPersona);
  // per-slot drafts, initialized from the persisted slots on mount.
  const [personaDrafts, setPersonaDrafts] = useState(() =>
    personas.map((p) => ({ ...p })),
  );

  function updatePersonaDraft(
    index: number,
    patch: Partial<{ name: string; prompt: string }>,
  ) {
    setPersonaDrafts((drafts) =>
      drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  }

  function savePersonaSlot(index: number) {
    const draft = personaDrafts[index];
    setPersona(index, draft);
    // reflect the trimmed saved value back into the draft.
    updatePersonaDraft(index, {
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
    });
  }

  function clearPersonaSlot(index: number) {
    clearPersona(index);
    updatePersonaDraft(index, { name: '', prompt: '' });
  }

  // ---- not logged in ----
  if (!userId) {
    return (
      <div className="mx-auto max-w-md py-8 font-mono">
        <EmptyState
          title={t('profile.loginRequired')}
          hint={t('profile.loginHint')}
          action={
            <Link
              to="/login"
              className="inline-flex min-h-[44px] items-center rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-5 text-sm font-bold text-term-bright shadow-glow-cta transition hover:border-term-bright"
            >
              {t('profile.loginBtn')}
            </Link>
          }
        />
      </div>
    );
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function startEditKey() {
    setKeyDraft('');
    setEditingKey(true);
  }

  function saveKey() {
    const next = keyDraft.trim();
    if (!next) return;
    updateKey(next);
    setKeyDraft('');
    setEditingKey(false);
  }

  function removeKey() {
    updateKey('');
    setKeyDraft('');
    setEditingKey(false);
  }

  function cancelEditKey() {
    setKeyDraft('');
    setEditingKey(false);
  }

  return (
    <div className="mx-auto max-w-2xl pb-6 font-mono">
      {/* fixed top bar: title + back link to /me */}
      <PageHeaderBar>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-term-title glow">
          {t('profile.settingsTitle')}
        </h1>
        <Link
          to="/me"
          className="inline-flex h-8 shrink-0 items-center rounded-[2px] border border-term-border px-3 text-sm font-semibold text-term-dim transition hover:border-term-bright hover:text-term-bright"
        >
          {t('profile.settingsBack')}
        </Link>
      </PageHeaderBar>

      {/* terminal prompt line, directly under the fixed bar. mt-4 = unified
          16px gap between the bar and the ShellPrompt (same as other pages);
          the section list keeps its own space-y-8 rhythm in the wrapper below. */}
      <ShellPrompt command="cat ~/.config" className="mt-4 mb-3" />

      <div className="space-y-8">
      {/* API Key */}
      <section className="relative rounded-[2px] border border-term-border bg-term-card p-4 shadow-term-glow">
        <span className="absolute -top-2 left-3 select-none bg-term-tag px-1.5 text-[11px] font-bold uppercase tracking-wider text-term-faint">
          API KEY
        </span>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-term-bright">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
          >
            <circle cx="8" cy="8" r="4" />
            <path d="M11 11l8 8M16 16l2-2M19 19l2-2" />
          </svg>
          {t('profile.apiKeyHeading')}
        </h2>

        {!editingKey ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 truncate text-sm text-term-dim">
              {googleApiKey ? maskKey(googleApiKey) : t('profile.keyNotSet')}
            </span>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={startEditKey}
                className="inline-flex min-h-[44px] items-center rounded-[2px] border border-term-border px-4 text-sm font-semibold text-term-bright transition hover:border-term-bright hover:bg-term-hover"
              >
                {t('profile.keyChangeBtn')}
              </button>
              {googleApiKey && (
                <button
                  type="button"
                  onClick={removeKey}
                  className="inline-flex min-h-[44px] items-center rounded-[2px] border border-term-danger px-4 text-sm font-semibold text-term-danger transition hover:border-red-500 hover:bg-term-hover"
                >
                  {t('profile.keyRemoveBtn')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <input
              type="password"
              autoComplete="off"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="AIza..."
              className="w-full rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-sm text-term-bright outline-none placeholder:text-term-dim focus:border-term-bright focus:ring-1 focus:ring-term-bright"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveKey}
                disabled={!keyDraft.trim()}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-4 text-sm font-bold text-term-bright shadow-glow-cta transition hover:border-term-bright disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('profile.keySaveBtn')}
              </button>
              <button
                type="button"
                onClick={cancelEditKey}
                className="inline-flex min-h-[44px] items-center justify-center rounded-[2px] border border-term-border px-4 text-sm font-semibold text-term-bright transition hover:border-term-bright hover:bg-term-hover"
              >
                {t('profile.keyCancelBtn')}
              </button>
            </div>
          </div>
        )}

        <p className="mt-3 rounded-[2px] bg-term-info px-3 py-2 text-xs leading-relaxed text-term-amber">
          {t('profile.keyStorageNote')}
        </p>
      </section>

      {/* My AI personas (FR-12) — local only, applied per-send in the Composer */}
      <section className="relative rounded-[2px] border border-term-border bg-term-card p-4 shadow-term-glow">
        <span className="absolute -top-2 left-3 select-none bg-term-tag px-1.5 text-[11px] font-bold uppercase tracking-wider text-term-faint">
          PERSONA
        </span>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-term-bright">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
          >
            <rect x="5" y="8" width="14" height="11" rx="1" />
            <path d="M12 8V4M9 4h6" />
            <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
            <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
          </svg>
          {t('profile.myPersonaHeading')}
        </h2>

        <p className="mt-2 rounded-[2px] border border-term-border bg-term-info px-3 py-2 text-xs leading-relaxed text-term-dim">
          {t('profile.myPersonaHint')}
        </p>

        <div className="mt-3 space-y-4">
          {personaDrafts.map((draft, i) => {
            const saved = personas[i];
            const dirty =
              draft.name.trim() !== saved.name ||
              draft.prompt.trim() !== saved.prompt;
            return (
              <div
                key={i}
                className="rounded-[2px] border border-term-border p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-term-faint">
                    {t('profile.myPersonaSlotLabel', { n: i + 1 })}
                  </span>
                  {!isFilledSlot(saved) && (
                    <span className="text-[11px] text-term-dim">
                      {t('profile.myPersonaEmptyBadge')}
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) =>
                    updatePersonaDraft(i, { name: e.target.value })
                  }
                  placeholder={t('profile.myPersonaNamePlaceholder')}
                  className="mt-2 w-full rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-sm text-term-bright outline-none placeholder:text-term-dim focus:border-term-bright focus:ring-1 focus:ring-term-bright"
                />
                <textarea
                  value={draft.prompt}
                  onChange={(e) =>
                    updatePersonaDraft(i, { prompt: e.target.value })
                  }
                  rows={4}
                  placeholder={t('profile.myPersonaPromptPlaceholder')}
                  className="mt-2 w-full resize-y rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-sm leading-relaxed text-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => savePersonaSlot(i)}
                    disabled={!dirty}
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-4 text-sm font-bold text-term-bright shadow-glow-cta transition hover:border-term-bright disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t('profile.myPersonaSaveBtn')}
                  </button>
                  {isFilledSlot(saved) && (
                    <button
                      type="button"
                      onClick={() => clearPersonaSlot(i)}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-[2px] border border-term-danger px-4 text-sm font-semibold text-term-danger transition hover:border-red-500 hover:bg-term-hover"
                    >
                      {t('profile.myPersonaClearBtn')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 rounded-[2px] bg-term-info px-3 py-2 text-xs leading-relaxed text-term-amber">
          {t('profile.myPersonaStorageNote')}
        </p>
      </section>

      {/* Language setting (LangToggle variant="setting") */}
      <section className="rounded-[2px] border border-term-border bg-term-card p-4 shadow-term-glow">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-term-bright">
            {t('profile.languageSettingLabel')}
          </span>
          <LangToggle variant="setting" />
        </div>
      </section>

      {/* Logout */}
      <section className="rounded-[2px] border border-term-border bg-term-card p-4 shadow-term-glow">
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[2px] border border-term-danger px-4 text-sm font-semibold text-term-danger transition hover:bg-term-hover"
        >
          {t('profile.logoutBtn')}
        </button>
      </section>
      </div>
    </div>
  );
}
