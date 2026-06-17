// FE-8 / L4: threadStore SSE-replay dedupe contract.
//
// 'seq' is the single source of truth for ordering + dedupe. On a duplicated
// SSE event (replay), the store must NOT create a second bubble whether the
// duplicate matches by id, by seq, or by clientId (optimistic reconciliation).
import { describe, it, expect, beforeEach } from 'vitest';
import { useThreadStore } from './threadStore';
import type { Comment } from '../api/types';

function makeComment(over: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    postId: 'p1',
    authorId: 'u1',
    authorUsername: 'alice',
    type: 'HUMAN',
    status: 'COMPLETE',
    body: 'hi',
    tokenCount: 1,
    segmentId: 's0',
    replyToId: null,
    clientId: null,
    seq: 1,
    createdAt: '2026-06-17T00:00:00.000Z',
    ...over,
  };
}

describe('threadStore — SSE replay dedupe (L4)', () => {
  beforeEach(() => {
    useThreadStore.getState().reset();
  });

  it('does not duplicate on replay of the same id', () => {
    const c = makeComment({ id: 'x', seq: 5 });
    const { upsertComment } = useThreadStore.getState();
    upsertComment(c);
    upsertComment(c); // exact replay
    expect(useThreadStore.getState().bubbles).toHaveLength(1);
  });

  it('does not duplicate when the same seq arrives with a different id', () => {
    const { upsertComment } = useThreadStore.getState();
    upsertComment(makeComment({ id: 'a', seq: 7 }));
    // a re-send carrying the same monotonic seq must replace, not append.
    upsertComment(makeComment({ id: 'b', seq: 7 }));
    const bubbles = useThreadStore.getState().bubbles;
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].seq).toBe(7);
  });

  it('reconciles an optimistic bubble (clientId) with the server version', () => {
    const { addOptimistic, upsertComment } = useThreadStore.getState();
    // optimistic local bubble: temp negative seq + clientId.
    addOptimistic(makeComment({ id: 'temp', seq: -1, clientId: 'ck-1' }));
    expect(useThreadStore.getState().bubbles).toHaveLength(1);
    // server version arrives via SSE with the same clientId + real seq.
    upsertComment(makeComment({ id: 'real', seq: 9, clientId: 'ck-1' }));
    const bubbles = useThreadStore.getState().bubbles;
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].id).toBe('real');
    expect(bubbles[0].seq).toBe(9);
  });

  it('addOptimistic ignores a second insert of the same clientId', () => {
    const { addOptimistic } = useThreadStore.getState();
    addOptimistic(makeComment({ id: 't1', seq: -1, clientId: 'dup' }));
    addOptimistic(makeComment({ id: 't2', seq: -2, clientId: 'dup' }));
    expect(useThreadStore.getState().bubbles).toHaveLength(1);
  });

  it('keeps bubbles sorted ascending by seq', () => {
    const { upsertComment } = useThreadStore.getState();
    upsertComment(makeComment({ id: 'a', seq: 3 }));
    upsertComment(makeComment({ id: 'b', seq: 1 }));
    upsertComment(makeComment({ id: 'c', seq: 2 }));
    expect(useThreadStore.getState().bubbles.map((b) => b.seq)).toEqual([1, 2, 3]);
  });
});
