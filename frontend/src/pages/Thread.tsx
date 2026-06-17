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

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, getCommunities, getComments, getPost } from '../api/rest';
import type { Community, Post } from '../api/types';
import { useThreadStore } from '../stores/threadStore';
import { useThreadStream, type StreamStatus } from '../stream/useThreadStream';
import ChatBubble from '../components/ChatBubble';
import Composer from '../components/Composer';
import PersonaBadge from '../components/PersonaBadge';

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

/** Small offline / reconnecting banner driven by the SSE stream status. */
function StreamBanner({ status }: { status: StreamStatus }) {
  if (status === 'open') return null;
  const label =
    status === 'reconnecting'
      ? '연결이 끊겼습니다 — 다시 연결 중…'
      : '실시간 연결 중…';
  return (
    <div className="bg-amber-50 px-3 py-1 text-center text-xs text-amber-700">
      {label}
    </div>
  );
}

export default function Thread() {
  const { postId } = useParams<{ postId: string }>();

  const [post, setPost] = useState<Post | null>(null);
  const [community, setCommunity] = useState<Community | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bubbles = useThreadStore((s) => s.bubbles);
  const setInitial = useThreadStore((s) => s.setInitial);
  const reset = useThreadStore((s) => s.reset);

  // SSE live stream (also drives initial replay via Last-Event-ID / afterSeq).
  const { status } = useThreadStream(postId);

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
  }, [postId, reset, setInitial]);

  // Auto-scroll the chat list to the newest bubble as it grows.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [bubbles.length]);

  if (!postId) {
    return <p className="text-sm text-slate-500">잘못된 주소입니다.</p>;
  }
  if (loading) {
    return <p className="text-sm text-slate-500">불러오는 중…</p>;
  }
  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!post) {
    return <p className="text-sm text-slate-500">글을 찾을 수 없습니다.</p>;
  }

  const personaName = community?.name ?? 'AI 페르소나';
  const personaIcon = community?.personaIcon ?? null;
  const authorName = post.author?.username ?? '익명';
  const hasComments = bubbles.length > 0;

  // Full-screen chat column. The page lives inside AppLayout's <main>; we make
  // this region fill the viewport below the app bar (h-12) and bottom tab bar.
  return (
    <div className="-mx-4 -mt-4 -mb-20 flex h-[calc(100dvh-3rem)] flex-col desktop:mx-0 desktop:mt-0 desktop:mb-0 desktop:h-[calc(100dvh-3rem)]">
      {/* persona / community header */}
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <PersonaBadge personaIcon={personaIcon} name={personaName} size="sm" />
      </header>

      <StreamBanner status={status} />

      {/* scrolling region: pinned original post + chat list */}
      <div className="flex-1 overflow-y-auto">
        {/* PINNED original post (FR-5.1) */}
        <article className="border-b border-slate-200 bg-slate-50 px-4 py-3">
          <h1 className="text-base font-bold leading-snug text-slate-900">
            {post.title}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            u/{authorName} · ▲{post.score} · {relativeTime(post.createdAt)}
          </p>
          {post.body && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
              {post.body}
            </p>
          )}
        </article>

        {/* divider */}
        <div className="flex items-center gap-2 px-4 py-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          <span>대화</span>
          <span className="h-px flex-1 bg-slate-200" />
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
              />
            ))}
            <div ref={bottomRef} />
          </div>
        ) : (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            <p className="font-medium text-slate-600">첫 댓글을 남겨보세요</p>
            <p className="mt-1 text-slate-400">@AI 로 질문해보세요</p>
          </div>
        )}
      </div>

      {/* Composer fixed at the bottom */}
      <Composer postId={postId} />
    </div>
  );
}
