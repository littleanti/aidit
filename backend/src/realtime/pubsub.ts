// WP RT-2 — pub/sub adapter for thread events (NFR-4 horizontal scale).
//
// Decouples write paths (publish.ts) from SSE connections (transport.ts). TWO
// implementations sit behind ONE interface:
//
//   InMemoryPubSub  — process-local. Correct for a single instance; events do
//                     NOT reach subscribers attached to another process.
//   RedisPubSub     — cross-instance fan-out over Redis pub/sub, channel
//                     `aidit:post:<postId>`. Selected when REDIS_URL is set.
//
// The interface is deliberately SYNCHRONOUS (subscribe/publish return
// immediately) so the two existing callers stay untouched when the backend
// changes. Connection setup is lazy and non-blocking: a publish issued before
// the socket is ready is queued and flushed on connect.
//
// DURABILITY NOTE (by design): Redis pub/sub is not a queue. Events published
// while an instance is disconnected are LOST for live subscribers. That is
// acceptable because the DB — not the bus — is the source of truth: a client
// reconnects with `Last-Event-ID` and the SSE endpoint replays the missing
// bubbles from the DB snapshot (TRD §7). The bus is an accelerator, not a log.

import { config } from "../config.js";
import {
  RedisConnection,
  encodeCommand,
  parseRedisUrl,
  type RedisTarget,
} from "../redis/resp.js";
import type { ThreadEvent } from "./events.js";

// RESP primitives (encodeCommand / RespParser / RedisConnection / parseRedisUrl)
// live in ../redis/resp.ts because the rate-limit store (§15.3) needs the same
// codec. Re-exported here so existing importers/tests keep one entry point.
export {
  RespParser,
  encodeCommand,
  parseRedisUrl,
  type RedisTarget,
} from "../redis/resp.js";

export type ThreadEventHandler = (event: ThreadEvent) => void;

export interface PubSub {
  /** Subscribe a handler to a post's event stream. Returns an unsubscribe fn. */
  subscribe(postId: string, handler: ThreadEventHandler): () => void;
  /** Fan out an event to every subscriber of a post (local + remote). */
  publish(postId: string, event: ThreadEvent): void;
  /** Release any transport resources. Used by tests; a no-op in-memory. */
  close(): void;
}

/** Redis channel for a post. Namespaced so one Redis can host several apps. */
export function channelFor(postId: string): string {
  return `aidit:post:${postId}`;
}

// ---------------------------------------------------------------------------
// Local handler registry — shared by both implementations.
// ---------------------------------------------------------------------------

class LocalHandlers {
  private readonly channels = new Map<string, Set<ThreadEventHandler>>();

  /** Returns true when this is the FIRST handler for the post (=> SUBSCRIBE). */
  add(postId: string, handler: ThreadEventHandler): boolean {
    let handlers = this.channels.get(postId);
    const first = handlers === undefined;
    if (!handlers) {
      handlers = new Set();
      this.channels.set(postId, handlers);
    }
    handlers.add(handler);
    return first;
  }

  /** Returns true when the LAST handler for the post went away (=> UNSUBSCRIBE). */
  remove(postId: string, handler: ThreadEventHandler): boolean {
    const handlers = this.channels.get(postId);
    if (!handlers) return false;
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.channels.delete(postId);
      return true;
    }
    return false;
  }

  dispatch(postId: string, event: ThreadEvent): void {
    const handlers = this.channels.get(postId);
    if (!handlers || handlers.size === 0) return;
    // Snapshot to tolerate handlers that unsubscribe during iteration.
    for (const handler of [...handlers]) {
      handler(event);
    }
  }

  postIds(): string[] {
    return [...this.channels.keys()];
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation (default, single instance).
// ---------------------------------------------------------------------------

export class InMemoryPubSub implements PubSub {
  private readonly local = new LocalHandlers();

  subscribe(postId: string, handler: ThreadEventHandler): () => void {
    this.local.add(postId, handler);
    return () => {
      this.local.remove(postId, handler);
    };
  }

  publish(postId: string, event: ThreadEvent): void {
    this.local.dispatch(postId, event);
  }

  close(): void {
    // nothing to release
  }
}

// ---------------------------------------------------------------------------
// Redis implementation.
//
// Two sockets are required: a Redis connection in SUBSCRIBE mode refuses
// PUBLISH, so we keep a dedicated subscriber socket and a separate publisher
// socket. Both reconnect with exponential backoff (RedisConnection), and the
// subscriber re-SUBSCRIBEs every currently-active channel after a reconnect —
// otherwise a blip would silently orphan every live SSE stream on this instance.
// ---------------------------------------------------------------------------

export class RedisPubSub implements PubSub {
  private readonly local = new LocalHandlers();
  private readonly subscriber: RedisConnection;
  private readonly publisher: RedisConnection;

  constructor(
    target: RedisTarget,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.subscriber = new RedisConnection(
      target,
      (reply) => this.handleSubscriberReply(reply),
      () => this.resubscribeAll(),
      (err) => this.log(`[pubsub] subscriber socket error: ${err.message}`),
    );
    this.publisher = new RedisConnection(
      target,
      () => {
        // PUBLISH replies are receiver counts; nothing to do with them.
      },
      () => {},
      (err) => this.log(`[pubsub] publisher socket error: ${err.message}`),
    );
  }

  /** Re-SUBSCRIBE every locally-active post after a (re)connect. */
  private resubscribeAll(): void {
    const ids = this.local.postIds();
    if (ids.length === 0) return;
    this.subscriber.send(
      encodeCommand(["SUBSCRIBE", ...ids.map((id) => channelFor(id))]),
    );
  }

  private handleSubscriberReply(reply: unknown): void {
    // A pub/sub push is ['message', channel, payload].
    if (!Array.isArray(reply) || reply.length < 3) return;
    if (reply[0] !== "message") return;
    const channel = reply[1];
    const payload = reply[2];
    if (typeof channel !== "string" || typeof payload !== "string") return;

    const prefix = channelFor("");
    if (!channel.startsWith(prefix)) return;
    const postId = channel.slice(prefix.length);

    let event: ThreadEvent;
    try {
      event = JSON.parse(payload) as ThreadEvent;
    } catch {
      this.log(`[pubsub] dropped malformed payload on ${channel}`);
      return;
    }
    this.local.dispatch(postId, event);
  }

  subscribe(postId: string, handler: ThreadEventHandler): () => void {
    const first = this.local.add(postId, handler);
    if (first) {
      this.subscriber.send(encodeCommand(["SUBSCRIBE", channelFor(postId)]));
    }
    return () => {
      const last = this.local.remove(postId, handler);
      if (last) {
        this.subscriber.send(encodeCommand(["UNSUBSCRIBE", channelFor(postId)]));
      }
    };
  }

  publish(postId: string, event: ThreadEvent): void {
    // Remote fan-out ONLY: subscribers on THIS instance also receive the event
    // via the Redis round trip, so local and remote clients see identical
    // ordering and nobody gets a duplicate from a local shortcut.
    this.publisher.send(
      encodeCommand(["PUBLISH", channelFor(postId), JSON.stringify(event)]),
    );
  }

  close(): void {
    this.subscriber.close();
    this.publisher.close();
  }
}

// ---------------------------------------------------------------------------
// Selection — REDIS_URL decides. Callers import `pubsub` and never branch.
// ---------------------------------------------------------------------------

export function createPubSub(
  redisUrl: string | null = config.redisUrl,
  log: (msg: string) => void = (msg) => console.log(msg),
): PubSub {
  if (!redisUrl) {
    log(
      "[pubsub] REDIS_URL not set — using in-memory pub/sub (single instance only).",
    );
    return new InMemoryPubSub();
  }
  const target = parseRedisUrl(redisUrl);
  if (!target) {
    log(
      "[pubsub] REDIS_URL is not a valid redis:// URL — falling back to in-memory pub/sub.",
    );
    return new InMemoryPubSub();
  }
  log(
    `[pubsub] using Redis pub/sub at ${target.host}:${target.port} (multi-instance fan-out).`,
  );
  return new RedisPubSub(target, log);
}

// Process-wide singleton. The implementation is chosen once at startup.
export const pubsub: PubSub = createPubSub();
