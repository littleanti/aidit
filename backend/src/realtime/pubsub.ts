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

import net from "node:net";

import { config } from "../config.js";
import type { ThreadEvent } from "./events.js";

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
// Redis implementation — minimal RESP over node:net (no new dependency).
//
// Two sockets are required: a Redis connection in SUBSCRIBE mode refuses
// PUBLISH, so we keep a dedicated subscriber socket and a separate publisher
// socket. Both reconnect with exponential backoff, and the subscriber
// re-SUBSCRIBEs every currently-active channel after a reconnect (otherwise a
// blip would silently orphan every live SSE stream on this instance).
// ---------------------------------------------------------------------------

export interface RedisTarget {
  host: string;
  port: number;
  password?: string;
}

/** Parse redis://[:password@]host:port (also accepts rediss:// hosts). */
export function parseRedisUrl(url: string): RedisTarget | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "redis:" && u.protocol !== "rediss:") return null;
    const host = u.hostname || "127.0.0.1";
    const port = u.port === "" ? 6379 : Number(u.port);
    if (!Number.isInteger(port) || port <= 0) return null;
    const password = u.password !== "" ? decodeURIComponent(u.password) : undefined;
    return { host, port, ...(password !== undefined ? { password } : {}) };
  } catch {
    return null;
  }
}

/** Encode a RESP array command: *N\r\n$len\r\narg\r\n... */
export function encodeCommand(args: string[]): string {
  let out = `*${args.length}\r\n`;
  for (const arg of args) {
    out += `$${Buffer.byteLength(arg, "utf8")}\r\n${arg}\r\n`;
  }
  return out;
}

/**
 * Incremental RESP reader. Feed bytes, pull complete replies.
 *
 * Only the subset Redis pub/sub actually returns is handled: simple strings
 * (+), errors (-), integers (:), bulk strings ($) and arrays (*). Nested arrays
 * work too, which is what `subscribe` confirmations and `message` pushes are.
 */
export class RespParser {
  private buf: Buffer = Buffer.alloc(0);

  feed(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
  }

  /** Pull the next complete reply, or undefined if more bytes are needed. */
  next(): unknown | undefined {
    const parsed = this.parseAt(0);
    if (!parsed) return undefined;
    this.buf = this.buf.subarray(parsed.end);
    return parsed.value;
  }

  private parseAt(offset: number): { value: unknown; end: number } | undefined {
    if (offset >= this.buf.length) return undefined;
    const type = String.fromCharCode(this.buf[offset]!);
    const lineEnd = this.buf.indexOf("\r\n", offset);
    if (lineEnd === -1) return undefined;
    const line = this.buf.toString("utf8", offset + 1, lineEnd);
    const afterLine = lineEnd + 2;

    switch (type) {
      case "+":
        return { value: line, end: afterLine };
      case "-":
        return { value: new Error(line), end: afterLine };
      case ":":
        return { value: Number(line), end: afterLine };
      case "$": {
        const len = Number(line);
        if (len === -1) return { value: null, end: afterLine };
        const end = afterLine + len + 2;
        if (this.buf.length < end) return undefined;
        return {
          value: this.buf.toString("utf8", afterLine, afterLine + len),
          end,
        };
      }
      case "*": {
        const count = Number(line);
        if (count === -1) return { value: null, end: afterLine };
        const items: unknown[] = [];
        let cursor = afterLine;
        for (let i = 0; i < count; i += 1) {
          const item = this.parseAt(cursor);
          if (!item) return undefined;
          items.push(item.value);
          cursor = item.end;
        }
        return { value: items, end: cursor };
      }
      default:
        // Unknown type byte — skip the line rather than wedging the stream.
        return { value: null, end: afterLine };
    }
  }
}

const RECONNECT_BASE_MS = 200;
const RECONNECT_MAX_MS = 5_000;

/** One managed Redis socket with backoff reconnect + a pending write queue. */
class RedisConnection {
  private socket: net.Socket | null = null;
  private ready = false;
  private closed = false;
  private attempt = 0;
  private pending: string[] = [];
  private readonly parser = new RespParser();

  constructor(
    private readonly target: RedisTarget,
    private readonly onReply: (reply: unknown) => void,
    private readonly onReady: () => void,
    private readonly onError: (err: Error) => void,
  ) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const socket = net.createConnection({
      host: this.target.host,
      port: this.target.port,
    });
    socket.setNoDelay(true);
    this.socket = socket;

    socket.on("connect", () => {
      this.ready = true;
      this.attempt = 0;
      if (this.target.password !== undefined) {
        socket.write(encodeCommand(["AUTH", this.target.password]));
      }
      const queued = this.pending;
      this.pending = [];
      for (const cmd of queued) socket.write(cmd);
      this.onReady();
    });

    socket.on("data", (chunk: Buffer) => {
      this.parser.feed(chunk);
      for (;;) {
        const reply = this.parser.next();
        if (reply === undefined) break;
        this.onReply(reply);
      }
    });

    socket.on("error", (err: Error) => {
      this.onError(err);
    });

    socket.on("close", () => {
      this.ready = false;
      this.socket = null;
      if (this.closed) return;
      this.attempt += 1;
      const delay = Math.min(
        RECONNECT_MAX_MS,
        RECONNECT_BASE_MS * 2 ** (this.attempt - 1),
      );
      const timer = setTimeout(() => this.connect(), delay);
      if (typeof timer.unref === "function") timer.unref();
    });
  }

  send(command: string): void {
    if (this.closed) return;
    if (this.ready && this.socket) {
      this.socket.write(command);
      return;
    }
    // Not connected yet (or reconnecting): queue and flush on 'connect'.
    this.pending.push(command);
  }

  close(): void {
    this.closed = true;
    this.pending = [];
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}

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
