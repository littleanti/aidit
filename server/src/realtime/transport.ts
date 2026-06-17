// WP RT-1 — SSE transport helpers.
//
// Owns the low-level mechanics of turning a Fastify reply into a long-lived
// EventSource-compatible stream: headers, a heartbeat to defeat idle proxies,
// and connection cleanup. Knows nothing about events/pubsub — the stream
// endpoint (stream.ts) composes these with the pubsub layer.

import type { FastifyReply, FastifyRequest } from "fastify";

import { serializeEvent, type ThreadEvent } from "./events.js";

// Heartbeat interval. A comment frame (": ping\n\n") is a no-op for clients but
// keeps the connection (and intermediary proxies) from idling out.
const HEARTBEAT_MS = 15_000;

// A single attached SSE connection. The endpoint uses `send` to push events
// and `close` to tear down (also invoked automatically when the socket drops).
export interface SseConnection {
  readonly id: number;
  send(event: ThreadEvent): void;
  /** Write a raw comment/keepalive frame. */
  ping(): void;
  close(): void;
}

// Process-wide registry of live connections, keyed by a monotonic id. Useful
// for diagnostics and bounded shutdown.
const connections = new Map<number, SseConnection>();
let nextConnectionId = 0;

export function connectionCount(): number {
  return connections.size;
}

// Attach a Fastify reply as an SSE stream. Sets EventSource-compatible headers,
// starts a heartbeat, registers the connection, and wires cleanup on socket
// close. The returned handle is also stored in the registry until it closes.
export function attachSseStream(
  request: FastifyRequest,
  reply: FastifyReply,
): SseConnection {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable proxy buffering (nginx) so frames flush immediately.
    "X-Accel-Buffering": "no",
  });
  // Prompt clients to wait before reconnecting and flush headers right away.
  reply.raw.write(`retry: 3000\n\n`);

  const id = nextConnectionId++;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const connection: SseConnection = {
    id,
    send(event: ThreadEvent) {
      if (closed) return;
      reply.raw.write(serializeEvent(event));
    },
    ping() {
      if (closed) return;
      reply.raw.write(`: ping\n\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      connections.delete(id);
      reply.raw.end();
    },
  };

  heartbeat = setInterval(() => connection.ping(), HEARTBEAT_MS);
  // Don't let the heartbeat timer keep the event loop alive on shutdown.
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  connections.set(id, connection);

  // Tear down when the client disconnects.
  request.raw.on("close", () => connection.close());

  return connection;
}
