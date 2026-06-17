import { useEffect, useState } from 'react';
import { useThreadStore } from '../stores/threadStore';
import type { Comment } from '../api/types';

// RT-7 / FE-10: SSE consumer for a single post's chat-room thread.
//
// Opens an EventSource to /api/posts/:id/stream and feeds the threadStore.
// On initial open we pass ?afterSeq=<largest seq currently in store> so the
// server can replay only the bubbles we are missing (snapshot/catch-up). After
// that, the browser handles reconnection automatically via the Last-Event-ID
// header (each SSE message sets `id: <seq>`), so we do not manage retries here.
//
// SSE event contract (RT-5, TRD §7):
//   event "comment.created"  data: { comment: <Comment> }
//   event "comment.updated"  data: { id, body, status }
//   event "segment.opened"   data: { segmentIndex, summaryCommentId }
//
// Dedupe by seq is handled inside threadStore.upsertComment.

export type StreamStatus = 'connecting' | 'open' | 'reconnecting';

interface CommentCreatedData {
  comment: Comment;
}
interface CommentUpdatedData {
  id: string;
  body?: string;
  status?: Comment['status'];
}
interface SegmentOpenedData {
  segmentIndex: number;
  summaryCommentId?: string | null;
}

export interface UseThreadStream {
  status: StreamStatus;
}

function parseEvent<T>(ev: MessageEvent): T | null {
  try {
    return JSON.parse(ev.data) as T;
  } catch {
    return null;
  }
}

export function useThreadStream(postId: string | undefined): UseThreadStream {
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    if (!postId) return;

    // Largest seq currently known → resume point for snapshot replay. Optimistic
    // bubbles carry negative temp seqs, so Math.max stays >= 0 from the server's
    // perspective (0 means "send everything").
    const bubbles = useThreadStore.getState().bubbles;
    const afterSeq = bubbles.reduce((max, b) => (b.seq > max ? b.seq : max), 0);

    const url =
      `/api/posts/${postId}/stream` + (afterSeq > 0 ? `?afterSeq=${afterSeq}` : '');
    const es = new EventSource(url);

    const onCreated = (ev: MessageEvent) => {
      const data = parseEvent<CommentCreatedData>(ev);
      if (data?.comment) useThreadStore.getState().upsertComment(data.comment);
    };

    const onUpdated = (ev: MessageEvent) => {
      const data = parseEvent<CommentUpdatedData>(ev);
      if (data?.id) {
        useThreadStore.getState().updateComment(data.id, {
          body: data.body,
          status: data.status,
        });
      }
    };

    const onSegmentOpened = (ev: MessageEvent) => {
      const data = parseEvent<SegmentOpenedData>(ev);
      if (data && typeof data.segmentIndex === 'number') {
        useThreadStore.getState().setActiveSegmentIndex(data.segmentIndex);
      }
    };

    es.addEventListener('comment.created', onCreated as EventListener);
    es.addEventListener('comment.updated', onUpdated as EventListener);
    es.addEventListener('segment.opened', onSegmentOpened as EventListener);

    es.onopen = () => setStatus('open');
    es.onerror = () => {
      // EventSource auto-reconnects unless CLOSED; reflect that in the banner state.
      setStatus(es.readyState === EventSource.CLOSED ? 'connecting' : 'reconnecting');
    };

    return () => {
      es.removeEventListener('comment.created', onCreated as EventListener);
      es.removeEventListener('comment.updated', onUpdated as EventListener);
      es.removeEventListener('segment.opened', onSegmentOpened as EventListener);
      es.close();
    };
  }, [postId]);

  return { status };
}
