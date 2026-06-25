// FE (M2): Thread page — the full chat-room comment thread (FR-5.1/5.2/5.4).
//
// Route '/p/:postId'. On mount:
//   1. load the post (rest.getPost) + its community (for the persona header),
//   2. load the initial comment snapshot (rest.getComments) into threadStore,
//   3. subscribe via useThreadStream(postId) for live events + Last-Event-ID
//      replay.
// reset() the store on postId change / unmount so a fresh thread never shows
// stale bubbles.
//
// Layout (WIREFRAME §6): community + persona header, the ORIGINAL POST pinned
// at the top, a "─ 대화 ─" divider, then the chat list (threadStore.bubbles via
// ChatBubble), with the Composer fixed at the bottom. Mobile-first full-screen.
//
// L1: nothing here ever touches an API key. AI authorship is signalled purely
// by authorId === null.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { addBookmark, ApiError, deletePost, getCommunities, getComments, getContext, getPost, removeBookmark, upvotePost, removeUpvote } from '../api/rest';
import type { Comment, Community, Post } from '../api/types';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';
import { usePostIntentStore } from '../stores/postIntentStore';
import { useAiLengthStore } from '../stores/aiLengthStore';
import { DEFAULT_AI_LENGTH } from '../engine/length';
import { useThreadStore } from '../stores/threadStore';
import { useThreadStream } from '../stream/useThreadStream';
import { runPrimaryReply } from '../engine/contextEngine';
import { retryAiBubble } from '../engine/retryAiBubble';
import { urlToInlineData } from '../lib/imageInline';
import { assetUrl } from '../config/api';
import Avatar from '../components/Avatar';
import ShellPrompt from '../components/ShellPrompt';
import ChatBubble from '../components/ChatBubble';
import Composer from '../components/Composer';
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from '../components/states';
import SafeMarkdown from '../lib/SafeMarkdown';
import { useT } from '../i18n/useT';
import { tn } from '../i18n/tn';
import { useLangStore } from '../stores/langStore';

/** Compact relative time (방금/just now, Nm/Nh/Nd/Nw, else locale date). */
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
  // Use Intl with the current UI locale for the full date fallback.
  const locale = useLangStore.getState().lang === 'en' ? 'en-US' : 'ko-KR';
  return new Date(then).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

// FR-7.4 / WIREFRAME §7: imminent-summary threshold. The hard summary trigger
// is 128_000 (A-2); we warn the user once the active segment's tokenSum is
// within the warning band [120_000, 128_000] so they know the NEXT @AI call
// will run a summary first (and pay for it with their own key).
const SUMMARY_WARN_FLOOR = 120_000;
const SUMMARY_HARD_THRESHOLD = 128_000;

// Minimum per-scroll delta (px) to count as a deliberate direction change. Below
// this we treat the movement as jitter and keep whatever chip is already showing.
const SCROLL_DIR_DEADZONE = 2;

export default function Thread() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const { t } = useT();

  // VR-3: bookmark toggle — persisted via POST/DELETE /posts/:id/bookmark.
  // Initialised from loadedPost.bookmarked (server-computed via x-user-id).
  const [bookmarked, setBookmarked] = useState(false);

  // Upvote toggle — persisted via POST/DELETE /posts/:id/upvote.
  // Initialised from loadedPost.voted (server-computed via x-user-id).
  const [voted, setVoted] = useState(false);
  const [postScore, setPostScore] = useState(0);

  const openLogin = useUiStore((s) => s.openLogin);

  const [post, setPost] = useState<Post | null>(null);
  const [community, setCommunity] = useState<Community | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bubbles = useThreadStore((s) => s.bubbles);
  const activeSegmentIndex = useThreadStore((s) => s.activeSegmentIndex);
  const setInitial = useThreadStore((s) => s.setInitial);
  const reset = useThreadStore((s) => s.reset);

  const myUserId = useAuthStore((s) => s.userId);
  const consumeFirstAiReply = usePostIntentStore((s) => s.consumeFirstAiReply);
  const consumeFirstAiLength = usePostIntentStore((s) => s.consumeFirstAiLength);

  // Thread-scoped @AI length (for the shell-prompt hint only). Default 'normal'.
  const aiLength = useAiLengthStore((s) => (postId ? s.byPost[postId] : undefined) ?? DEFAULT_AI_LENGTH);

  // Live shell-prompt routing: mirror only the Composer's wantsAI boolean (the
  // live comment TEXT is intentionally NOT mirrored — surfacing it would force a
  // thread-wide re-render on every keystroke; only the boolean is surfaced).
  const [wantsAI, setWantsAI] = useState(false);

  // Author-only owner menu (edit/delete), now in the original-post card meta row
  // instead of the nav header. Overflow [⋯] trigger opens a popover; delete is a
  // 2-step confirm INSIDE the menu. Mirrors the Composer AI-menu dismiss pattern.
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ownerMenuRef = useRef<HTMLDivElement>(null);
  // Close the owner menu on outside click or Escape; reset the confirm step too.
  useEffect(() => {
    if (!ownerMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (ownerMenuRef.current && !ownerMenuRef.current.contains(e.target as Node)) {
        setOwnerMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOwnerMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ownerMenuOpen]);
  // Whenever the menu closes, drop the in-menu delete confirm step.
  useEffect(() => {
    if (!ownerMenuOpen) setConfirmingDelete(false);
  }, [ownerMenuOpen]);

  // transient toast for AI-side failures surfaced from the engine.
  const [aiToast, setAiToast] = useState<string | null>(null);
  function showAiToast(msg: string) {
    setAiToast(msg);
    window.setTimeout(() => setAiToast(null), 3000);
  }

  // SSE live stream (also drives initial replay via Last-Event-ID / afterSeq).
  const { status } = useThreadStream(postId);

  // Browser-level connectivity (WIREFRAME §8). Combined with the SSE status this
  // drives the offline / reconnecting top strip.
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // reload nonce: bump to re-run the load effect (used by the error retry button).
  const [reloadKey, setReloadKey] = useState(0);
  const retryLoad = useCallback(() => setReloadKey((k) => k + 1), []);

  // FR-7.4 imminent-summary badge: source the active segment's tokenSum from
  // GET /posts/:id/context (the same L5 128K basis the engine uses). We fetch
  // on load and re-fetch whenever the bubble count changes (a new bubble may
  // have pushed the active segment closer to the threshold). This is a cheap,
  // event-driven refresh — no background polling timer.
  const [activeTokenSum, setActiveTokenSum] = useState<number | null>(null);
  // server-confirmed summaryNeeded (tokenSum already > hard threshold).
  const [summaryNeeded, setSummaryNeeded] = useState(false);

  // Load post + community + initial comment snapshot.
  useEffect(() => {
    if (!postId) return;
    let cancelled = false;

    // Clear any previous thread's bubbles before loading the new one.
    reset();
    setPost(null);
    setCommunity(null);
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [loadedPost, comments] = await Promise.all([
          getPost(postId, myUserId ?? undefined),
          getComments(postId),
        ]);
        if (cancelled) return;

        setPost(loadedPost);
        setBookmarked(Boolean(loadedPost.bookmarked));
        setVoted(Boolean(loadedPost.voted));
        setPostScore(loadedPost.score);
        setInitial(comments);

        // Resolve the community for the persona header. Prefer the joined
        // relation; otherwise look it up so the persona badge can render.
        if (loadedPost.community) {
          setCommunity(loadedPost.community);
        } else {
          try {
            const matches = await getCommunities();
            if (!cancelled) {
              setCommunity(
                matches.find((c) => c.id === loadedPost.communityId) ?? null,
              );
            }
          } catch {
            // persona header is non-critical; fall back to a default badge.
            if (!cancelled) setCommunity(null);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : t('thread.loadError'),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      reset();
    };
  }, [postId, reset, setInitial, reloadKey, myUserId]);

  // ----- AI-5: primary reply trigger (FR-4.3) -----
  // Fire EXACTLY ONCE per mount, when arriving at a just-created post with the
  // "1차 AI 답변 받기" toggle ON AND the current user is the author AND no AI
  // reply exists yet. consumeFirstAiReply clears the one-shot flag so a refresh
  // never re-triggers. If no key, surface the key prompt instead.
  const primaryFiredRef = useRef(false);
  useEffect(() => {
    if (!postId || !post || loading) return;
    if (primaryFiredRef.current) return;

    // Only the author drives the primary reply (it uses the author's key).
    if (!myUserId || post.authorId !== myUserId) return;

    // One-shot intent set by CreatePost; reading it also clears it.
    const wantsPrimary = consumeFirstAiReply(postId);
    // Length handoff from CreatePost (one-shot consume; default 'normal').
    const length = consumeFirstAiLength(postId);
    if (!wantsPrimary) return;

    // From here on we are committed to a single attempt this mount.
    primaryFiredRef.current = true;

    // If an AI reply already exists (e.g. returning to the thread), skip.
    const aiExists = useThreadStore
      .getState()
      .bubbles.some((b) => b.authorId === null && b.type === 'AI_REPLY');
    if (aiExists) return;

    const apiKey = useAuthStore.getState().googleApiKey;
    if (!apiKey) {
      showAiToast(t('thread.primaryAiNoKey'));
      return;
    }

    // When the post carries an attached image, fetch it and ride it along the
    // 1차 reply as inline bytes (multimodal). Best-effort: on any fetch/encode
    // failure we fall back to a text-only reply rather than blocking it.
    const postImageUrl = post.imageUrl;
    void (async () => {
      const image = postImageUrl
        ? (await urlToInlineData(postImageUrl)) ?? undefined
        : undefined;
      const res = await runPrimaryReply({
        postId,
        communityPersonaPrompt: community?.personaPrompt ?? '',
        apiKey,
        image,
        length,
      });
      if (!res.ok && res.errorMessage) showAiToast(res.errorMessage);
    })();
  }, [postId, post, loading, myUserId, community, consumeFirstAiReply, consumeFirstAiLength]);

  // ----- FE-12: retry a FAILED AI bubble in place -----
  const handleRetry = useCallback(
    (comment: Comment) => {
      if (!postId) return;
      // Only AI bubbles are retryable here; human retry is the Composer's job.
      if (comment.authorId !== null) return;
      if (!comment.clientId) {
        showAiToast(t('thread.retryNoClientId'));
        return;
      }
      const apiKey = useAuthStore.getState().googleApiKey;
      if (!apiKey) {
        showAiToast(t('thread.retryNoKey'));
        return;
      }
      void retryAiBubble({
        postId,
        aiCommentId: comment.id,
        clientId: comment.clientId,
        communityPersonaPrompt: community?.personaPrompt ?? '',
        apiKey,
      }).then((res) => {
        if (!res.ok && res.errorMessage) showAiToast(res.errorMessage);
      });
    },
    [postId, community],
  );

  // Auto-scroll the chat list to the newest bubble as it grows.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [bubbles.length]);

  // FE: jump-to-top / jump-to-bottom for long threads (WIREFRAME §6). A single
  // square corner chip floats at the scroll region's bottom-right and follows
  // the scroll DIRECTION (Option A — direction-only, no velocity threshold):
  // scrolling DOWN shows the ↓ (jump-to-bottom) chip, scrolling UP shows the ↑
  // (jump-to-top) chip. There's only ever one chip in the slot at a time —
  // direction alone decides which one, regardless of distance to either end.
  // It fades out ~1s after scrolling stops, so a thread
  // the reader has settled on stays fully unobscured. Honour prefers-reduced-
  // motion (the CRT-cursor policy) by downgrading smooth → auto.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeChip, setActiveChip] = useState<'none' | 'top' | 'bottom'>('none');
  const scrollIdleTimer = useRef<number | null>(null);
  // Last observed scrollTop — used to derive the per-scroll direction delta.
  const lastScrollTop = useRef(0);
  // Set while a programmatic jumpTo animation is in flight, so the resulting
  // scroll events don't re-trigger the chip (self-trigger guard).
  const isProgrammatic = useRef(false);
  // On scroll: derive direction from the scrollTop delta, swap to the matching
  // chip for that direction, then arm a 1s idle timer to fade out.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || isProgrammatic.current) return;
    const { scrollTop } = el;
    const dY = scrollTop - lastScrollTop.current;
    lastScrollTop.current = scrollTop;
    if (dY < -SCROLL_DIR_DEADZONE) setActiveChip('top');
    else if (dY > SCROLL_DIR_DEADZONE) setActiveChip('bottom');
    // Otherwise (jitter below the deadzone) keep whatever chip is currently showing.
    if (scrollIdleTimer.current) window.clearTimeout(scrollIdleTimer.current);
    scrollIdleTimer.current = window.setTimeout(() => setActiveChip('none'), 1000);
  }, []);
  const jumpTo = useCallback((edge: 'top' | 'bottom') => {
    const el = scrollRef.current;
    if (!el) return;
    // Block our own scroll events from re-arming the chip, and hide it instantly.
    isProgrammatic.current = true;
    setActiveChip('none');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({
      top: edge === 'top' ? 0 : el.scrollHeight,
      behavior: reduce ? 'auto' : 'smooth',
    });
    window.setTimeout(() => {
      isProgrammatic.current = false;
      lastScrollTop.current = el.scrollTop;
    }, reduce ? 0 : 700);
  }, []);
  // Drop the idle timer on unmount.
  useEffect(
    () => () => {
      if (scrollIdleTimer.current) window.clearTimeout(scrollIdleTimer.current);
    },
    [],
  );

  // FR-7.4: refresh the active segment's tokenSum from GET /context. Triggered
  // on load, whenever the bubble count changes (a new comment may push the
  // active segment toward 128K), and whenever activeSegmentIndex changes (a
  // segment.opened reset the count to the fresh summary baseline).
  useEffect(() => {
    if (!postId || loading) return;
    let cancelled = false;
    void getContext(postId)
      .then((ctx) => {
        if (cancelled) return;
        setActiveTokenSum(ctx.tokenSum);
        setSummaryNeeded(ctx.summaryNeeded);
      })
      .catch(() => {
        // non-critical UX hint; leave the previous estimate in place.
      });
    return () => {
      cancelled = true;
    };
  }, [postId, loading, bubbles.length, activeSegmentIndex]);

  if (!postId) {
    return <EmptyState title={t('thread.invalidAddress')} />;
  }
  if (loading) {
    return <LoadingState label={t('thread.loading')} />;
  }
  if (error) {
    return <ErrorState message={error} onRetry={retryLoad} />;
  }
  if (!post) {
    return <EmptyState title={t('thread.postNotFound')} />;
  }

  const personaName = community?.name ?? t('thread.aiPersonaFallback');
  const personaIcon = community?.personaIcon ?? null;
  const authorName = post.author?.username ?? t('thread.anonymous');
  const hasComments = bubbles.length > 0;

  // Offline / reconnect strip (WIREFRAME §8). Show whenever the browser is
  // offline OR the SSE stream is not live ('open'). Hide once both are healthy.
  const degraded = !online || status !== 'open';
  const bannerLabel = !online
    ? t('thread.offlineBanner')
    : status === 'reconnecting'
      ? t('thread.reconnectingBanner')
      : t('thread.connectingBanner');

  // FR-7.4: show the imminent-summary badge when the active segment is in the
  // warning band [120K, 128K), OR the server already reports summaryNeeded
  // (tokenSum has crossed 128K and the next @AI call will summarize first).
  const showSummaryBadge =
    summaryNeeded ||
    (activeTokenSum !== null &&
      activeTokenSum >= SUMMARY_WARN_FLOOR &&
      activeTokenSum <= SUMMARY_HARD_THRESHOLD);

  // Full-screen chat column. The page lives inside AppLayout's <main>; we make
  // this region fill the viewport below the app bar (h-12) and bottom tab bar.
  return (
    <div className="-mx-4 -mt-4 -mb-20 flex h-[calc(100dvh-3rem)] flex-col pb-[calc(3.5rem+var(--safe-bottom,0px))] tablet:pb-0 desktop:mx-0 desktop:mt-0 desktop:mb-0 desktop:h-[calc(100dvh-6rem)]">
      {/* VR-3: post-detail header. The persona is no longer shown here; it
          lives in the original-post card / menu instead. */}
      <header className="flex items-center gap-2 border-b border-term-border bg-term-screen px-2 py-2">
        {/* left group (flex-1 mirrors the right group so the title stays centered) */}
        <div className="flex flex-1 items-center justify-start">
          {/* back: returns to the previous route */}
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label={t('thread.backAria')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[2px] text-term-dim hover:bg-term-hover"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
              aria-hidden
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>
        <h1 className="min-w-0 truncate px-1 text-center text-base font-semibold text-term-title glow">
          {post.title}
        </h1>
        {/* right group */}
        <div className="flex flex-1 items-center justify-end gap-1">
          {/* bookmark: backend-wired (persisted via /posts/:id/bookmark). */}
          <button
            type="button"
            onClick={async () => {
              if (!myUserId) { openLogin(); return; }
              const next = !bookmarked;
              setBookmarked(next);
              try {
                await (next
                  ? addBookmark(postId, myUserId)
                  : removeBookmark(postId, myUserId));
              } catch {
                setBookmarked(!next);
                showAiToast(t('thread.bookmarkError'));
              }
            }}
            aria-pressed={bookmarked}
            aria-label={bookmarked ? t('thread.bookmarkRemoveAria') : t('thread.bookmarkAddAria')}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[2px] text-lg text-term-dim hover:bg-term-hover ${
              bookmarked ? 'opacity-100' : 'opacity-40'
            }`}
          >
            🔖
          </button>
          {/* edit/delete moved OUT of the header (2026-06-26): owner actions now
              live in the original-post card meta row as a [⋯] overflow menu. */}
        </div>
      </header>

      <OfflineBanner show={degraded} label={bannerLabel} />

      {/* scrolling region: pinned original post + chat list */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        {/* Live shell prompt reflects the Composer's wantsAI boolean ONLY (toggle
            ON or an @AI mention); the live comment TEXT is intentionally NOT
            mirrored — it would force a thread-wide re-render per keystroke. */}
        <ShellPrompt
          command={
            wantsAI
              ? `ai --ask /p/${postId.slice(0, 8)}${
                  aiLength !== 'normal' ? ` --len=${aiLength}` : ''
                }`
              : `tail -f /p/${postId.slice(0, 8)}`
          }
          className="mb-3 px-4 pt-3"
        />
        {/* PINNED original post (FR-5.1) */}
        <article className="relative mx-3 my-3 rounded-[2px] border border-term-border bg-term-card px-4 py-3">
          {/* corner tag */}
          <span
            aria-hidden
            className="absolute -top-1 left-[13px] bg-term-tag px-1 text-[9px] tracking-wider text-term-amber"
          >
            {t('thread.originalPostTag')}
          </span>
          {/* category (community) link — taps through to the community page.
              Mirrors PostCard's community line; omitted until community resolves. */}
          {community && (
            <Link
              to={`/c/${community.slug}`}
              className="flex w-fit max-w-full items-center gap-1.5 text-xs text-term-dim transition hover:text-term-bright"
            >
              {community.personaIcon && (
                <span aria-hidden className="text-sm leading-none">
                  {community.personaIcon}
                </span>
              )}
              <span className="font-medium text-term-bright">{community.name}</span>
              <span className="text-term-faint">·</span>
              <span className="truncate">r/{community.slug}</span>
            </Link>
          )}
          <h2 className="mt-1.5 text-base font-bold leading-snug text-term-title glow">
            {post.title}
          </h2>
          {post.body && (
            <div className="mt-2 break-words text-sm leading-relaxed text-term-dim">
              <SafeMarkdown text={post.body} />
            </div>
          )}
          {post.imageUrl && (
            <img
              src={assetUrl(post.imageUrl)}
              alt={t('thread.attachedImage')}
              className="mt-2 max-w-full rounded-[2px] border border-term-border"
              loading="lazy"
            />
          )}
          <div className="mt-3 flex items-center gap-2 text-xs text-term-faint">
            <Avatar kind="user" seed={authorName} size="sm" />
            <span>
              u/{authorName} · {relativeTime(post.createdAt)}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                aria-label={voted ? t('thread.upvoteRemoveAria') : t('thread.upvoteAddAria')}
                aria-pressed={voted}
                onClick={async () => {
                  if (!myUserId) { openLogin(); return; }
                  const next = !voted;
                  setVoted(next);
                  setPostScore((s) => s + (next ? 1 : -1));
                  try {
                    const res = await (next
                      ? upvotePost(postId, myUserId)
                      : removeUpvote(postId, myUserId));
                    setPostScore(res.score);
                  } catch {
                    setVoted(!next);
                    setPostScore((s) => s + (next ? -1 : 1));
                    showAiToast(t('thread.upvoteError'));
                  }
                }}
                className={`flex items-center gap-0.5 rounded-[2px] transition hover:text-term-amber ${
                  voted ? 'text-term-amber' : ''
                }`}
              >
                ▲{postScore}
              </button>
              <span>💬{post.commentCount}</span>
              {/* owner-only overflow menu (edit/delete) — moved here from the
                  nav header (2026-06-26). [⋯] trigger opens a popover; delete is
                  a 2-step confirm inside the menu. */}
              {myUserId && post.authorId === myUserId && (
                <div ref={ownerMenuRef} className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={ownerMenuOpen}
                    aria-label={t('thread.moreActionsAria')}
                    title={t('thread.moreActionsAria')}
                    onClick={() => setOwnerMenuOpen((v) => !v)}
                    className={`flex h-7 w-7 items-center justify-center rounded-[2px] text-base leading-none transition hover:bg-term-hover hover:text-term-bright ${
                      ownerMenuOpen ? 'text-term-bright' : 'text-term-dim'
                    }`}
                  >
                    ⋯
                  </button>
                  {ownerMenuOpen && (
                    <div
                      role="menu"
                      aria-label={t('thread.ownerMenuAria')}
                      className="absolute right-0 top-full z-30 mt-1 flex w-36 flex-col rounded-[2px] border border-term-border bg-term-card py-1 shadow-glow-soft"
                    >
                      {confirmingDelete ? (
                        <>
                          <span className="px-3 py-1 text-xs text-term-danger">
                            {t('thread.deleteConfirm')}
                          </span>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={deleting}
                            onClick={async () => {
                              setDeleting(true);
                              try {
                                await deletePost(post.id, myUserId);
                                const slug = community?.slug;
                                navigate(slug ? `/c/${slug}` : '/');
                              } catch {
                                setDeleting(false);
                                setOwnerMenuOpen(false);
                                showAiToast(t('thread.deleteFailed'));
                              }
                            }}
                            className="flex min-h-[44px] items-center gap-2 px-3 text-xs text-term-danger transition hover:bg-term-hover disabled:opacity-50"
                          >
                            ⌫ {t('thread.deleteConfirmYes')}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={deleting}
                            onClick={() => setConfirmingDelete(false)}
                            className="flex min-h-[44px] items-center gap-2 px-3 text-xs text-term-dim transition hover:bg-term-hover hover:text-term-bright disabled:opacity-50"
                          >
                            {t('thread.deleteCancel')}
                          </button>
                        </>
                      ) : (
                        <>
                          <Link
                            to="/create-post"
                            state={{ editPostId: post.id }}
                            role="menuitem"
                            onClick={() => setOwnerMenuOpen(false)}
                            className="flex min-h-[44px] items-center gap-2 px-3 text-xs text-term-dim transition hover:bg-term-hover hover:text-term-bright"
                          >
                            ✎ {t('thread.editLabel')}
                          </Link>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => setConfirmingDelete(true)}
                            className="flex min-h-[44px] items-center gap-2 px-3 text-xs text-term-danger transition hover:bg-term-hover"
                          >
                            ⌫ {t('thread.deleteLabel')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </span>
          </div>
        </article>

        {/* divider */}
        <div className="flex items-center gap-2 px-4 py-3 text-xs text-term-faint tracking-wider">
          <span className="h-px flex-1 bg-term-border" />
          <span>{t('thread.divider')}</span>
          <span className="h-px flex-1 bg-term-border" />
        </div>

        {/* chat list */}
        {hasComments ? (
          <div className="flex flex-col gap-1 px-2 pb-4">
            {bubbles.map((c) => (
              <ChatBubble
                key={c.id}
                comment={c}
                personaName={personaName}
                personaIcon={personaIcon}
                onRetry={handleRetry}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        ) : (
          <EmptyState
            title={t('thread.emptyTitle')}
            hint={t('thread.emptyHint')}
            className="py-10"
          />
        )}

        {/* Option A jump chip (WIREFRAME §6) — a single square button that sticks
            to the scroll region's bottom-right and follows the scroll DIRECTION:
            ↓ while scrolling down, ↑ while scrolling up (single slot, no
            velocity). The wrapper is sticky + h-0 so it adds no trailing scroll
            space; the inner box is anchored to its bottom edge. The chip fades in
            only when a direction is active and is non-interactive
            (pointer-events-none + tabIndex -1) while hidden, so idle threads stay
            fully unobscured. Label/icon/onClick swap with activeChip. */}
        <div className="pointer-events-none sticky bottom-3 z-20 h-0">
          <div className="absolute bottom-0 right-3">
            <button
              type="button"
              onClick={() => jumpTo(activeChip === 'top' ? 'top' : 'bottom')}
              aria-label={t(activeChip === 'top' ? 'thread.jumpTopAria' : 'thread.jumpBottomAria')}
              title={t(activeChip === 'top' ? 'thread.jumpTopAria' : 'thread.jumpBottomAria')}
              aria-hidden={activeChip === 'none'}
              tabIndex={activeChip === 'none' ? -1 : 0}
              className={`grid h-10 w-10 place-items-center rounded-[2px] border border-term-border bg-term-card/85 text-term-dim backdrop-blur transition hover:border-term-bright hover:text-term-bright hover:shadow-glow-soft active:scale-95 ${
                activeChip !== 'none' ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" aria-hidden>
                <path d={activeChip === 'top' ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* AI-side failure toast (engine errors; human bubbles are untouched) */}
      {aiToast && (
        <div
          role="alert"
          className="mx-3 mb-1 rounded-[2px] border border-term-danger bg-term-bg px-3 py-2 text-sm text-term-danger"
        >
          {aiToast}
        </div>
      )}

      {/* FR-7.4 imminent-summary badge: warns that the NEXT @AI call will run
          a 128K summary first, on the caller's own key (cost transparency). */}
      {showSummaryBadge && (
        <div className="px-3 pb-1">
          <div
            className="group relative inline-flex items-center gap-1.5 rounded-[2px] border border-term-border bg-term-info px-3 py-1 text-xs font-medium text-term-title"
            title={t('thread.summaryBadgeTooltip')}
          >
            <span aria-hidden>🟣</span>
            <span>{summaryNeeded ? t('thread.summaryNeededBadge') : t('thread.summarySoonBadge')}</span>
            <span
              aria-hidden
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-[2px] bg-term-hover text-[10px] text-term-title"
            >
              ?
            </span>
          </div>
        </div>
      )}

      {/* Composer fixed at the bottom */}
      <Composer
        postId={postId}
        communityPersonaPrompt={community?.personaPrompt ?? ''}
        onWantsAIChange={setWantsAI}
      />
    </div>
  );
}
