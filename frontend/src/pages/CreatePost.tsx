import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getCommunities, postPost, ApiError } from '../api/rest';
import type { Community } from '../api/types';
import { useAuthStore } from '../stores/authStore';
import { usePostIntentStore } from '../stores/postIntentStore';

// FE-7: write a post (register-first, FR-4.2).
// Flow: resolve target community -> POST /posts -> navigate immediately to the
// thread (/p/:postId). The "게시 후 AI 1차 답변 받기" toggle (default ON) is
// recorded in postIntentStore keyed by the new postId so the Thread (M3) can
// consume it and auto-fire the first AI reply.

export default function CreatePost() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const userId = useAuthStore((s) => s.userId);
  const setFirstAiReply = usePostIntentStore((s) => s.setFirstAiReply);

  const [communities, setCommunities] = useState<Community[]>([]);
  const [communitiesLoading, setCommunitiesLoading] = useState(false);
  const [selectedCommunityId, setSelectedCommunityId] = useState('');

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [firstAi, setFirstAi] = useState(true); // default ON

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Login is required to post.
  useEffect(() => {
    if (!userId) navigate('/login', { replace: true });
  }, [userId, navigate]);

  // Load communities so we can resolve the target. When a slug is in the route
  // we still load to map slug -> id; otherwise the user picks from a selector.
  useEffect(() => {
    let cancelled = false;
    setCommunitiesLoading(true);
    getCommunities()
      .then((list) => {
        if (cancelled) return;
        setCommunities(list);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError ? e.message : '커뮤니티를 불러오지 못했습니다.',
        );
      })
      .finally(() => {
        if (!cancelled) setCommunitiesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Community implied by the route slug, if any.
  const slugCommunity = useMemo(
    () => (slug ? communities.find((c) => c.slug === slug) ?? null : null),
    [slug, communities],
  );

  // Once communities load, lock the selection to the route slug when present.
  useEffect(() => {
    if (slugCommunity) setSelectedCommunityId(slugCommunity.id);
  }, [slugCommunity]);

  // Effective target community id.
  const communityId = slug ? slugCommunity?.id ?? '' : selectedCommunityId;

  const slugNotFound = Boolean(slug) && !communitiesLoading && !slugCommunity;

  const canSubmit =
    !submitting &&
    !!userId &&
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    communityId.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !userId) return;
    setSubmitting(true);
    setError(null);
    try {
      const post = await postPost(
        { communityId, title: title.trim(), body: body.trim() },
        userId,
      );
      // Record the AI-first-reply intent for the Thread to consume (M3).
      setFirstAiReply(post.id, firstAi);
      // Register-first: jump straight to the thread.
      navigate(`/p/${post.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : '글 작성에 실패했습니다.',
      );
      setSubmitting(false);
    }
  }

  if (!userId) return null; // redirecting to /login

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 font-mono">
      <h1 className="text-lg font-semibold text-term-title glow">글 작성</h1>

      {/* Community target */}
      {slug ? (
        <div className="text-sm text-term-dim">
          커뮤니티:{' '}
          <span className="font-medium text-term-title">
            {slugCommunity ? slugCommunity.name : slug}
          </span>
        </div>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-term-dim">커뮤니티</span>
          <select
            value={selectedCommunityId}
            onChange={(e) => setSelectedCommunityId(e.target.value)}
            disabled={communitiesLoading || submitting}
            className="bg-term-input border border-term-border rounded-[2px] px-3 py-2.5 text-sm text-term-bright outline-none focus:border-term-bright focus:ring-1 focus:ring-term-bright"
          >
            <option value="" disabled>
              {communitiesLoading ? '불러오는 중…' : '커뮤니티 선택'}
            </option>
            {communities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Title */}
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-term-dim">제목</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목을 입력하세요"
          maxLength={300}
          disabled={submitting}
          className="bg-term-input border border-term-border rounded-[2px] px-3 py-2.5 text-sm text-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright"
        />
      </label>

      {/* Body */}
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-term-dim">내용</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="내용을 입력하세요"
          rows={8}
          disabled={submitting}
          className="resize-y bg-term-input border border-term-border rounded-[2px] px-3 py-2.5 text-sm text-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright"
        />
      </label>

      {/* AI first-reply toggle (default ON) */}
      <label className="flex items-center gap-2 text-sm text-term-dim">
        <input
          type="checkbox"
          checked={firstAi}
          onChange={(e) => setFirstAi(e.target.checked)}
          disabled={submitting}
          className="h-4 w-4 rounded-[2px] accent-[#3fa564]"
        />
        <span>게시 후 AI 1차 답변 받기</span>
      </label>

      {slugNotFound && (
        <p className="text-sm text-term-danger">
          커뮤니티 "{slug}"를 찾을 수 없습니다.
        </p>
      )}
      {error && <p className="text-sm text-term-danger">{error}</p>}

      <button
        type="submit"
        disabled={!canSubmit}
        className="min-h-[44px] rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-4 py-2.5 text-sm font-bold text-term-title glow-lg shadow-glow-cta transition disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? '[ 게시 중… ]' : '[ 게시하기 ]'}
      </button>
    </form>
  );
}
