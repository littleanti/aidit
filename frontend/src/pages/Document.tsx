import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { getDocument, ApiError } from '../api/rest';
import type { DocumentDetail } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import PageHeaderBar from '../components/PageHeaderBar';
import ShellPrompt from '../components/ShellPrompt';
import Avatar from '../components/Avatar';
import SafeMarkdown from '../lib/SafeMarkdown';
import { stripLeadingTitle } from '../engine/documentEngine';
import { useT } from '../i18n/useT';
import { tn } from '../i18n/tn';
import { useLangStore } from '../stores/langStore';

// FR-13.6 / WIREFRAME §13.2 — the condensed-document screen (/d/:documentId).
//
// Read-only view of a document that a participant condensed out of a thread. The
// markdown goes through the SAME SafeMarkdown chokepoint as chat bubbles (XC-3),
// so no new sanitization path is introduced. The provenance line at the bottom
// (segment index + turns covered) lets a reader judge whether the document is
// stale relative to the ongoing discussion (FR-13.4).

/** Compact relative time — mirrors Thread.tsx's helper (same units/idiom). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60) return tn('thread.justNow');
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}${tn('thread.minuteUnit')}`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}${tn('thread.hourUnit')}`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}${tn('thread.dayUnit')}`;
  const locale = useLangStore.getState().lang === 'en' ? 'en-US' : 'ko-KR';
  return new Date(then).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

export default function DocumentPage() {
  const { t } = useT();
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();

  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!documentId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    (async () => {
      try {
        const res = await getDocument(documentId);
        if (cancelled) return;
        setDoc(res.document);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(
            err instanceof ApiError ? err.message : t('document.loadError'),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, reloadKey, t]);

  if (loading) {
    return <LoadingState label={t('document.loading')} />;
  }
  if (notFound) {
    return (
      <EmptyState
        title={t('document.notFoundTitle')}
        hint={t('document.notFoundHint')}
        action={
          <Link
            to="/"
            className="inline-flex min-h-[44px] items-center rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-5 text-sm font-bold text-term-bright shadow-glow-cta transition hover:border-term-bright"
          >
            {t('document.notFoundAction')}
          </Link>
        }
        className="py-10"
      />
    );
  }
  if (error) {
    return <ErrorState message={error} onRetry={retry} />;
  }
  if (!doc) {
    return <EmptyState title={t('document.notFoundTitle')} />;
  }

  const authorName = doc.authorUsername ?? t('document.anonymous');

  return (
    <div className="space-y-4 font-mono">
      <PageHeaderBar>
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t('document.backAria')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px] text-term-dim transition hover:bg-term-hover hover:text-term-bright"
        >
          ‹
        </button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-term-title glow">
          {t('document.title')}
        </h1>
      </PageHeaderBar>
      <ShellPrompt command={`cat /d/${doc.id.slice(0, 8)}`} className="mb-3" />

      <article className="relative rounded-[2px] border border-term-border bg-term-card px-4 py-4">
        <span
          aria-hidden
          className="absolute -top-1 left-[13px] bg-term-tag px-1 text-[9px] tracking-wider text-term-amber"
        >
          {t('document.tag')}
        </span>

        <h2 className="mt-1.5 text-lg font-bold leading-snug text-term-title glow">
          {doc.title}
        </h2>

        <Link
          to={`/c/${doc.communitySlug}`}
          className="mt-2 flex w-fit max-w-full items-center gap-1.5 text-xs text-term-dim transition hover:text-term-bright"
        >
          {doc.communityPersonaIcon && (
            <span aria-hidden className="text-sm leading-none">
              {doc.communityPersonaIcon}
            </span>
          )}
          <span className="font-medium text-term-bright">{doc.communityName}</span>
          <span className="text-term-faint">·</span>
          <span className="truncate">r/{doc.communitySlug}</span>
        </Link>

        <p className="mt-2 flex items-center gap-2 text-xs text-term-faint">
          <Avatar kind="user" seed={authorName} size="sm" />
          <span>
            {t('document.meta', {
              author: authorName,
              time: relativeTime(doc.createdAt),
            })}
          </span>
        </p>

        <div className="my-3 border-t border-term-border" />

        {/* XC-3: same sanitized markdown path as chat bubbles. Wide tables and
            code blocks scroll INSIDE the card rather than the page. */}
        <SafeMarkdown
          text={stripLeadingTitle(doc.body)}
          className="prose-chat break-words text-sm leading-relaxed text-term-dim"
        />

        <div className="my-3 border-t border-term-border" />

        <Link
          to={`/p/${doc.postId}`}
          className="flex min-h-[44px] items-center justify-center rounded-[2px] border border-term-border px-4 text-sm font-semibold text-term-dim transition hover:border-term-bright hover:text-term-bright"
        >
          {t('document.viewThread')}
        </Link>
      </article>

      {/* FR-13.4: provenance — how far into the thread this document reaches. */}
      <p className="px-1 text-[11px] text-term-faint">
        {t('document.provenance', {
          segment: String(doc.segmentIndex),
          turns: String(doc.sourceSeq),
        })}
      </p>
    </div>
  );
}
