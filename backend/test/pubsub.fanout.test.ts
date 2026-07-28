// NFR-4 / TRD §15.2 — pub/sub adapter: cross-instance fan-out.
//
// The architectural claim under test is "two app instances share one realtime
// bus". Docker/Redis is not available in CI here, so instead of skipping the
// proof we run a MINIMAL RESP broker inside the test process (node:net) and
// attach TWO RedisPubSub instances to it — one standing in for app instance A
// (the writer) and one for app instance B (where the SSE client is attached).
//
// This exercises the real wire path: RESP command encoding, SUBSCRIBE bookkeeping,
// the `message` push shape, and JSON (de)serialization of ThreadEvent. What it
// does NOT cover is a real Redis server's behavior — that verification belongs to
// the deployment environment and is called out as outstanding in TRD §15.2.
//
// The contrast test matters just as much: InMemoryPubSub must NOT deliver across
// instances. If someone "simplifies" the adapter away, that test fails and
// explains why the adapter exists.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import net from "node:net";

import {
  InMemoryPubSub,
  RedisPubSub,
  RespParser,
  channelFor,
  createPubSub,
  encodeCommand,
  parseRedisUrl,
  type PubSub,
} from "../src/realtime/pubsub.js";
import {
  EVENT_COMMENT_CREATED,
  type CommentCreatedEvent,
} from "../src/realtime/events.js";

// ---------------------------------------------------------------------------
// Minimal in-process RESP broker: SUBSCRIBE / UNSUBSCRIBE / PUBLISH / AUTH.
// ---------------------------------------------------------------------------

interface Broker {
  port: number;
  close(): Promise<void>;
  /** Number of currently connected client sockets. */
  connectionCount(): number;
}

async function startBroker(): Promise<Broker> {
  // channel -> set of subscriber sockets
  const channels = new Map<string, Set<net.Socket>>();
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    const parser = new RespParser();

    socket.on("data", (chunk: Buffer) => {
      parser.feed(chunk);
      for (;;) {
        const reply = parser.next();
        if (reply === undefined) break;
        if (!Array.isArray(reply)) continue;
        const parts = reply.map((p) => String(p));
        const cmd = (parts[0] ?? "").toUpperCase();

        if (cmd === "AUTH") {
          socket.write("+OK\r\n");
          continue;
        }

        if (cmd === "SUBSCRIBE") {
          let count = 0;
          for (const channel of parts.slice(1)) {
            let subs = channels.get(channel);
            if (!subs) {
              subs = new Set();
              channels.set(channel, subs);
            }
            subs.add(socket);
            count += 1;
            // Real Redis confirms with ['subscribe', channel, <count>] where the
            // third element is an INTEGER, so hand-build the frame.
            socket.write(
              `*3\r\n$9\r\nsubscribe\r\n$${Buffer.byteLength(channel)}\r\n${channel}\r\n:${count}\r\n`,
            );
          }
          continue;
        }

        if (cmd === "UNSUBSCRIBE") {
          for (const channel of parts.slice(1)) {
            channels.get(channel)?.delete(socket);
          }
          socket.write(":0\r\n");
          continue;
        }

        if (cmd === "PUBLISH") {
          const channel = parts[1] ?? "";
          const payload = parts[2] ?? "";
          const subs = channels.get(channel);
          const receivers = subs ? subs.size : 0;
          if (subs) {
            const frame = encodeCommand(["message", channel, payload]);
            for (const sub of subs) {
              if (!sub.destroyed) sub.write(frame);
            }
          }
          socket.write(`:${receivers}\r\n`);
          continue;
        }

        // Unknown command: answer +OK so the client never wedges.
        socket.write("+OK\r\n");
      }
    });

    const drop = () => {
      sockets.delete(socket);
      for (const subs of channels.values()) subs.delete(socket);
    };
    socket.on("close", drop);
    socket.on("error", drop);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("broker failed to bind a TCP port");
  }

  return {
    port: address.port,
    connectionCount: () => sockets.size,
    async close() {
      for (const socket of [...sockets]) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Poll until `predicate` holds or the timeout elapses (no arbitrary sleeps). */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function makeEvent(id: string, seq: number): CommentCreatedEvent {
  return {
    type: EVENT_COMMENT_CREATED,
    data: {
      comment: {
        id,
        postId: "post-1",
        authorId: "user-1",
        authorUsername: "tester",
        type: "HUMAN",
        status: "COMPLETE",
        body: "hello from instance A",
        tokenCount: 5,
        segmentId: "seg-0",
        replyToId: null,
        clientId: null,
        seq,
        createdAt: new Date(0).toISOString(),
      },
    },
  };
}

// ---------------------------------------------------------------------------

describe("PubSub adapter — unit pieces", () => {
  it("parseRedisUrl accepts redis:// with default and explicit port", () => {
    expect(parseRedisUrl("redis://127.0.0.1:6380")).toEqual({
      host: "127.0.0.1",
      port: 6380,
    });
    expect(parseRedisUrl("redis://cache.internal")).toEqual({
      host: "cache.internal",
      port: 6379,
    });
    expect(parseRedisUrl("redis://:s3cr3t@cache:6379")).toEqual({
      host: "cache",
      port: 6379,
      password: "s3cr3t",
    });
  });

  it("parseRedisUrl rejects non-redis URLs", () => {
    expect(parseRedisUrl("http://example.com")).toBeNull();
    expect(parseRedisUrl("not a url")).toBeNull();
  });

  it("encodeCommand emits a RESP array with byte lengths", () => {
    expect(encodeCommand(["PING"])).toBe("*1\r\n$4\r\nPING\r\n");
    // Multi-byte: '한' is 3 bytes in UTF-8, so the length prefix must be 3.
    expect(encodeCommand(["한"])).toBe("*1\r\n$3\r\n한\r\n");
  });

  it("RespParser decodes across split chunks", () => {
    const parser = new RespParser();
    const frame = encodeCommand(["message", "aidit:post:p1", '{"a":1}']);
    const mid = Math.floor(frame.length / 2);
    parser.feed(Buffer.from(frame.slice(0, mid), "utf8"));
    expect(parser.next()).toBeUndefined(); // incomplete
    parser.feed(Buffer.from(frame.slice(mid), "utf8"));
    expect(parser.next()).toEqual(["message", "aidit:post:p1", '{"a":1}']);
  });

  it("createPubSub falls back to in-memory without/with a bad REDIS_URL", () => {
    const noop = () => {};
    expect(createPubSub(null, noop)).toBeInstanceOf(InMemoryPubSub);
    expect(createPubSub("postgres://nope", noop)).toBeInstanceOf(InMemoryPubSub);
  });

  it("channelFor namespaces the post id", () => {
    expect(channelFor("abc")).toBe("aidit:post:abc");
  });
});

describe("InMemoryPubSub — process-local (WHY the adapter exists)", () => {
  it("delivers within one instance", () => {
    const bus = new InMemoryPubSub();
    const received: string[] = [];
    bus.subscribe("post-1", (e) => {
      if (e.type === EVENT_COMMENT_CREATED) received.push(e.data.comment.id);
    });
    bus.publish("post-1", makeEvent("c1", 1));
    expect(received).toEqual(["c1"]);
  });

  it("does NOT deliver across two instances (the limitation Redis removes)", () => {
    const instanceA = new InMemoryPubSub();
    const instanceB = new InMemoryPubSub();
    const receivedOnB: string[] = [];
    instanceB.subscribe("post-1", (e) => {
      if (e.type === EVENT_COMMENT_CREATED) receivedOnB.push(e.data.comment.id);
    });

    instanceA.publish("post-1", makeEvent("c1", 1));

    expect(receivedOnB).toEqual([]);
  });

  it("unsubscribe stops delivery", () => {
    const bus = new InMemoryPubSub();
    const received: string[] = [];
    const off = bus.subscribe("post-1", () => received.push("x"));
    bus.publish("post-1", makeEvent("c1", 1));
    off();
    bus.publish("post-1", makeEvent("c2", 2));
    expect(received).toEqual(["x"]);
  });
});

describe("RedisPubSub — cross-instance fan-out over a real socket", () => {
  let broker: Broker;
  const buses: PubSub[] = [];

  beforeEach(async () => {
    broker = await startBroker();
  });

  afterEach(async () => {
    for (const bus of buses.splice(0)) bus.close();
    await broker.close();
  });

  function attach(): PubSub {
    const bus = new RedisPubSub({ host: "127.0.0.1", port: broker.port });
    buses.push(bus);
    return bus;
  }

  it("an event published on instance A reaches a subscriber on instance B", async () => {
    const instanceA = attach();
    const instanceB = attach();

    const receivedOnB: CommentCreatedEvent[] = [];
    instanceB.subscribe("post-1", (e) => {
      if (e.type === EVENT_COMMENT_CREATED) receivedOnB.push(e);
    });

    // Wait until B's SUBSCRIBE has actually reached the broker (4 sockets: each
    // instance opens a subscriber + a publisher connection).
    await waitFor(() => broker.connectionCount() === 4);

    instanceA.publish("post-1", makeEvent("c-remote", 7));

    await waitFor(() => receivedOnB.length === 1);
    expect(receivedOnB[0]!.data.comment.id).toBe("c-remote");
    expect(receivedOnB[0]!.data.comment.seq).toBe(7);
    expect(receivedOnB[0]!.data.comment.body).toBe("hello from instance A");
  });

  it("scopes delivery per post — a subscriber to another post gets nothing", async () => {
    const instanceA = attach();
    const instanceB = attach();

    const onPost1: string[] = [];
    const onPost2: string[] = [];
    instanceB.subscribe("post-1", (e) => {
      if (e.type === EVENT_COMMENT_CREATED) onPost1.push(e.data.comment.id);
    });
    instanceB.subscribe("post-2", (e) => {
      if (e.type === EVENT_COMMENT_CREATED) onPost2.push(e.data.comment.id);
    });
    await waitFor(() => broker.connectionCount() === 4);

    instanceA.publish("post-1", makeEvent("only-1", 1));

    await waitFor(() => onPost1.length === 1);
    expect(onPost1).toEqual(["only-1"]);
    expect(onPost2).toEqual([]);
  });

  it("a publisher's own local subscribers also receive the event (via the bus)", async () => {
    const instance = attach();
    const received: string[] = [];
    instance.subscribe("post-1", (e) => {
      if (e.type === EVENT_COMMENT_CREATED) received.push(e.data.comment.id);
    });
    await waitFor(() => broker.connectionCount() === 2);

    instance.publish("post-1", makeEvent("c-local", 1));

    await waitFor(() => received.length === 1);
    expect(received).toEqual(["c-local"]);
  });

  it("unsubscribing on B stops cross-instance delivery", async () => {
    const instanceA = attach();
    const instanceB = attach();

    const received: string[] = [];
    const off = instanceB.subscribe("post-1", (e) => {
      if (e.type === EVENT_COMMENT_CREATED) received.push(e.data.comment.id);
    });
    await waitFor(() => broker.connectionCount() === 4);

    instanceA.publish("post-1", makeEvent("first", 1));
    await waitFor(() => received.length === 1);

    off();
    // Give the UNSUBSCRIBE time to land, then publish again.
    await new Promise((r) => setTimeout(r, 100));
    instanceA.publish("post-1", makeEvent("second", 2));
    await new Promise((r) => setTimeout(r, 150));

    expect(received).toEqual(["first"]);
  });

  it("publishes issued before the socket is ready are queued, not dropped", async () => {
    const instanceB = attach();
    const received: string[] = [];
    instanceB.subscribe("post-1", (e) => {
      if (e.type === EVENT_COMMENT_CREATED) received.push(e.data.comment.id);
    });
    await waitFor(() => broker.connectionCount() === 2);

    // Fresh instance: publish IMMEDIATELY after construction, before its
    // publisher socket has connected.
    const instanceA = attach();
    instanceA.publish("post-1", makeEvent("queued", 3));

    await waitFor(() => received.length === 1);
    expect(received).toEqual(["queued"]);
  });
});
