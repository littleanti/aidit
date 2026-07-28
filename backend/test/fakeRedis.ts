// A minimal in-process Redis stand-in for tests (RESP over a real TCP socket).
//
// Docker is not available in this environment, so instead of skipping the
// multi-instance proofs we run a tiny broker inside the test process. Because it
// speaks real RESP over a real socket, the code under test exercises its actual
// wire path: command encoding, reply parsing, pipelining, and reply↔command
// ordering. What it does NOT prove is a real Redis server's behavior — that
// check belongs to the deployment environment (TRD §15.2/§15.3).
//
// Supported: AUTH, SUBSCRIBE/UNSUBSCRIBE/PUBLISH (pub/sub bus) and
// INCR/PEXPIRE/PTTL/DEL (the rate-limit store's atomic fixed window).

import net from "node:net";

import { RespParser, encodeCommand } from "../src/redis/resp.js";

export interface FakeRedis {
  port: number;
  /** Number of currently connected client sockets. */
  connectionCount(): number;
  /** Commands received, in order — lets a test assert the command sequence. */
  commandLog(): string[][];
  close(): Promise<void>;
}

export async function startFakeRedis(): Promise<FakeRedis> {
  const channels = new Map<string, Set<net.Socket>>();
  const sockets = new Set<net.Socket>();
  // key -> counter value, and key -> absolute expiry (ms since epoch).
  const counters = new Map<string, number>();
  const expiries = new Map<string, number>();
  const log: string[][] = [];

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
        log.push(parts);
        const cmd = (parts[0] ?? "").toUpperCase();
        const key = parts[1] ?? "";

        // Honour TTLs lazily, the way Redis does: an expired key is simply gone.
        const expiry = expiries.get(key);
        if (expiry !== undefined && expiry <= Date.now()) {
          counters.delete(key);
          expiries.delete(key);
        }

        switch (cmd) {
          case "AUTH":
            socket.write("+OK\r\n");
            break;

          // --- pub/sub ---------------------------------------------------
          case "SUBSCRIBE": {
            let count = 0;
            for (const channel of parts.slice(1)) {
              let subs = channels.get(channel);
              if (!subs) {
                subs = new Set();
                channels.set(channel, subs);
              }
              subs.add(socket);
              count += 1;
              // Real Redis confirms with ['subscribe', channel, <integer count>].
              socket.write(
                `*3\r\n$9\r\nsubscribe\r\n$${Buffer.byteLength(channel)}\r\n${channel}\r\n:${count}\r\n`,
              );
            }
            break;
          }
          case "UNSUBSCRIBE": {
            for (const channel of parts.slice(1)) {
              channels.get(channel)?.delete(socket);
            }
            socket.write(":0\r\n");
            break;
          }
          case "PUBLISH": {
            const payload = parts[2] ?? "";
            const subs = channels.get(key);
            const receivers = subs ? subs.size : 0;
            if (subs) {
              const frame = encodeCommand(["message", key, payload]);
              for (const sub of subs) {
                if (!sub.destroyed) sub.write(frame);
              }
            }
            socket.write(`:${receivers}\r\n`);
            break;
          }

          // --- counters (atomic fixed-window rate limiting) ---------------
          case "INCR": {
            const next = (counters.get(key) ?? 0) + 1;
            counters.set(key, next);
            socket.write(`:${next}\r\n`);
            break;
          }
          case "PEXPIRE": {
            const ms = Number(parts[2]);
            if (counters.has(key)) {
              expiries.set(key, Date.now() + ms);
              socket.write(":1\r\n");
            } else {
              socket.write(":0\r\n");
            }
            break;
          }
          case "PTTL": {
            if (!counters.has(key)) {
              socket.write(":-2\r\n"); // key does not exist
            } else {
              const at = expiries.get(key);
              socket.write(
                at === undefined
                  ? ":-1\r\n" // exists, but no TTL set
                  : `:${Math.max(0, at - Date.now())}\r\n`,
              );
            }
            break;
          }
          case "DEL": {
            let removed = 0;
            for (const k of parts.slice(1)) {
              if (counters.delete(k)) removed += 1;
              expiries.delete(k);
            }
            socket.write(`:${removed}\r\n`);
            break;
          }

          default:
            socket.write("+OK\r\n");
        }
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
    throw new Error("fake redis failed to bind a TCP port");
  }

  return {
    port: address.port,
    connectionCount: () => sockets.size,
    commandLog: () => log,
    async close() {
      for (const socket of [...sockets]) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Poll until `predicate` holds or the timeout elapses (no arbitrary sleeps). */
export async function waitFor(
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
