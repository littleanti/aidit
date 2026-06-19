import { Link, useNavigate } from 'react-router-dom';
import type { PostListItem } from '../api/types';

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
  const diffWk = Math.floor(diffDay / 7);
  if (diffWk < 5) return `${diffWk}주`;
  return new Date(then).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

interface PostCardProps {
  post: PostListItem;
}

export default function PostCard({ post }: PostCardProps) {
  const navigate = useNavigate();

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/p/${post.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`/p/${post.id}`);
        }
      }}
      className="relative cursor-pointer rounded-[2px] border border-term-border bg-term-card px-4 py-3 transition hover:border-term-bright hover:bg-term-hover"
    >
      {/* POST corner tag */}
      <span
        aria-hidden
        className="absolute -top-1 left-[13px] bg-term-tag px-1 text-[9px] uppercase tracking-wider text-term-faint"
      >
        POST
      </span>

      {/* community + persona line — links to the community; stops propagation
          so it doesn't also trigger the card's post navigation. */}
      <Link
        to={`/c/${post.communitySlug}`}
        onClick={(e) => e.stopPropagation()}
        className="flex min-h-[20px] w-fit max-w-full items-center gap-1.5 text-xs text-term-dim transition hover:text-term-bright"
      >
        {post.communityPersonaIcon && (
          <span aria-hidden className="text-sm leading-none">
            {post.communityPersonaIcon}
          </span>
        )}
        <span className="font-medium text-term-bright">{post.communityName}</span>
        <span className="text-term-faint">·</span>
        <span className="truncate">r/{post.communitySlug}</span>
      </Link>

      {/* title — XC-3: user-authored, intentionally rendered as PLAIN text
          (titles stay single-line, no markdown). React auto-escapes the
          interpolation, so no raw user HTML is ever injected here. */}
      <h2 className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug text-term-title [text-shadow:0_0_6px_rgba(125,255,160,0.45)]">
        {post.title}
      </h2>

      {/* meta line */}
      <div className="mt-2 flex items-center gap-3 text-xs text-term-dim">
        <span className="inline-flex items-center gap-0.5" aria-label="점수">
          <span aria-hidden>▲</span>
          {post.score}
        </span>
        <span className="inline-flex items-center gap-0.5" aria-label="댓글 수">
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3 2.5V11.5H2.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" />
          </svg>
          {post.commentCount}
        </span>
        <span aria-hidden className="text-term-faint">
          ·
        </span>
        <time dateTime={post.createdAt}>{relativeTime(post.createdAt)}</time>
      </div>
    </article>
  );
}
