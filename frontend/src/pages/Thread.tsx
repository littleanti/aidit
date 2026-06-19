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
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, getCommunities, getComments, getContext, getPost } from '../api/rest';
import type { Comment, Community, Post } from '../api/types';
import { useAuthStore } from '../stores/authStore';
import { usePostIntentStore } from '../stores/postIntentStore';
import { useThreadStore } from '../stores/threadStore';
import { useThreadStream } from '../stream/useThreadStream';
import { runPrimaryReply } from '../engine/contextEngine';
import { retryAiBubble } from '../engine/retryAiBubble';
import Avatar from '../components/Avatar';
import ChatBubble from '../components/ChatBubble';
import Composer from '../components/Composer';
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from '../components/states';
import SafeMarkdown from '../lib/SafeMarkdown';

/** Compact relative time in Korean (방금 / N분 / N시간 / N일 / N주, else date). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60) return '방금';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}일`;
  return new Date(then).toLocaleDateString('ko-KR', {
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

export default function Thread() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();

  // VR-3: bookmark toggle is presentation-only (visual state). It is NOT
  // backend-wired — there is no bookmark API/DTO; this is a local UI flag only.
  const [bookmarked, setBookmarked] = useState(false);

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
          getPost(postId),
          getComments(postId),
        ]);
        if (cancelled) return;

        setPost(loadedPost);
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
              : '스레드를 불러오지 못했습니다.',
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
  }, [postId, reset, setInitial, reloadKey]);

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
      showAiToast('1차 AI 답변에는 Gemini 키가 필요합니다 — 로그인에서 키를 등록하세요.');
      return;
    }

    void runPrimaryReply({
      postId,
      communityPersonaPrompt: community?.personaPrompt ?? '',
      apiKey,
    }).then((res) => {
      if (!res.ok && res.errorMessage) showAiToast(res.errorMessage);
    });
  }, [postId, post, loading, myUserId, community, consumeFirstAiReply]);

  // ----- FE-12: retry a FAILED AI bubble in place -----
  const handleRetry = useCallback(
    (comment: Comment) => {
      if (!postId) return;
      // Only AI bubbles are retryable here; human retry is the Composer's job.
      if (comment.authorId !== null) return;
      if (!comment.clientId) {
        showAiToast('재시도할 수 없습니다 — 식별자가 없습니다.');
        return;
      }
      const apiKey = useAuthStore.getState().googleApiKey;
      if (!apiKey) {
        showAiToast('재시도에는 Gemini 키가 필요합니다 — 로그인에서 키를 등록하세요.');
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
    return <EmptyState title="잘못된 주소입니다." />;
  }
  if (loading) {
    return <LoadingState label="스레드 불러오는 중…" />;
  }
  if (error) {
    return <ErrorState message={error} onRetry={retryLoad} />;
  }
  if (!post) {
    return <EmptyState title="글을 찾을 수 없습니다." />;
  }

  const personaName = community?.name ?? 'AI 페르소나';
  const personaIcon = community?.personaIcon ?? null;
  const authorName = post.author?.username ?? '익명';
  const hasComments = bubbles.length > 0;

  // Offline / reconnect strip (WIREFRAME §8). Show whenever the browser is
  // offline OR the SSE stream is not live ('open'). Hide once both are healthy.
  const degraded = !online || status !== 'open';
  const bannerLabel = !online
    ? '오프라인 — 재연결 중…'
    : status === 'reconnecting'
      ? '연결이 끊겼습니다 — 다시 연결 중…'
      : '실시간 연결 중…';

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
            aria-label="뒤로"
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
          {/* bookmark: LOCAL visual toggle only — NOT backend-wired. */}
          <button
            type="button"
            onClick={() => setBookmarked((b) => !b)}
            aria-pressed={bookmarked}
            aria-label={bookmarked ? '북마크 해제' : '북마크'}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[2px] text-lg text-term-dim hover:bg-term-hover ${
              bookmarked ? 'opacity-100' : 'opacity-40'
            }`}
          >
            🔖
          </button>
          {/* menu: visual placeholder — no handler yet. */}
          <button
            type="button"
            aria-label="메뉴"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[2px] text-lg text-term-dim hover:bg-term-hover"
          >
            ⋯
          </button>
        </div>
      </header>

      <OfflineBanner show={degraded} label={bannerLabel} />

      {/* scrolling region: pinned original post + chat list */}
      <div className="flex-1 overflow-y-auto">
        {/* PINNED original post (FR-5.1) */}
        <article className="relative mx-3 my-3 rounded-[2px] border border-term-border bg-term-card px-4 py-3">
          {/* corner tag */}
          <span
            aria-hidden
            className="absolute -top-1 left-[13px] bg-term-tag px-1 text-[9px] tracking-wider text-term-amber"
          >
            ★ 원본 게시글
          </span>
          <h2 className="mt-1 text-base font-bold leading-snug text-term-title glow">
            {post.title}
          </h2>
          {post.body && (
            <div className="mt-2 break-words text-sm leading-relaxed text-term-dim">
              <SafeMarkdown text={post.body} />
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 text-xs text-term-faint">
            <Avatar kind="user" seed={authorName} size="sm" />
            <span>
              u/{authorName} · {relativeTime(post.createdAt)}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <span>▲{post.score}</span>
              <span>💬{post.commentCount}</span>
            </span>
          </div>
        </article>

        {/* divider */}
        <div className="flex items-center gap-2 px-4 py-3 text-xs text-term-faint tracking-wider">
          <span className="h-px flex-1 bg-term-border" />
          <span>대화</span>
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
            title="첫 댓글을 남겨보세요"
            hint="@AI 로 질문해보세요"
            className="py-10"
          />
        )}
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
            title="다음 @AI 호출 시 먼저 요약이 실행됩니다. 요약은 호출한 분의 Gemini 키로 생성됩니다(비용 발생)."
          >
            <span aria-hidden>🟣</span>
            <span>{summaryNeeded ? '다음 @AI 호출 시 요약됩니다' : '곧 대화가 요약됩니다'}</span>
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
      <Composer postId={postId} communityPersonaPrompt={community?.personaPrompt ?? ''} />
    </div>
  );
}
