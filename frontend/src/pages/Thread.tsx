import { useParams } from 'react-router-dom';

// STUB — the full Thread (chat-room comment thread + SSE) is built in M2.
export default function Thread() {
  const { postId } = useParams<{ postId: string }>();
  return (
    <div className="text-slate-500">
      스레드 (M2에서 구현) — postId: {postId}
    </div>
  );
}
