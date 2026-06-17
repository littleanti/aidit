// WP RT-2 — in-memory pub/sub for thread events.
//
// Decouples write paths (publish.ts) from SSE connections (transport.ts). The
// in-memory implementation is process-local; a Redis-backed implementation can
// drop in later behind the same interface (L10) without touching callers.

import type { ThreadEvent } from "./events.js";

export type ThreadEventHandler = (event: ThreadEvent) => void;

export interface PubSub {
  /** Subscribe a handler to a post's event stream. Returns an unsubscribe fn. */
  subscribe(postId: string, handler: ThreadEventHandler): () => void;
  /** Fan out an event to every subscriber of a post. */
  publish(postId: string, event: ThreadEvent): void;
}

class InMemoryPubSub implements PubSub {
  // postId -> set of subscriber handlers.
  private readonly channels = new Map<string, Set<ThreadEventHandler>>();

  subscribe(postId: string, handler: ThreadEventHandler): () => void {
    let handlers = this.channels.get(postId);
    if (!handlers) {
      handlers = new Set();
      this.channels.set(postId, handlers);
    }
    handlers.add(handler);

    return () => {
      const current = this.channels.get(postId);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.channels.delete(postId);
      }
    };
  }

  publish(postId: string, event: ThreadEvent): void {
    const handlers = this.channels.get(postId);
    if (!handlers || handlers.size === 0) return;
    // Snapshot to tolerate handlers that unsubscribe during iteration.
    for (const handler of [...handlers]) {
      handler(event);
    }
  }
}

// Process-wide singleton. Swap the constructor here for a Redis impl later.
export const pubsub: PubSub = new InMemoryPubSub();
