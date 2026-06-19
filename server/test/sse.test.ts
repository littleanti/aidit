// WP XC-T — INTEGRATION: SSE stream (RT-4 / RT-6 / RT-8).
//
// Boots the real app on an ephemeral port (so reply.hijack() + reply.raw work
// exactly as in production — app.inject cannot model a hijacked long-lived
// stream) and drives it with a raw HTTP client that parses SSE frames. No
// network beyond loopback, no LLM.
//
// Asserts:
//  - comment.created / comment.updated / segment.opened arrive in seq order
//    with `id:` lines.
//  - Reconnect replay via ?afterSeq / Last-Event-ID delivers ONLY missed
//    bubbles (not the ones already seen).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";

import {
  createCommunity,
  createPostViaApi,
  createUser,
  makeApp,
  prisma,
  resetDb,
} from "./helpers.js";

let app: FastifyInstance;
let port: number;

beforeAll(async () => {
  app = await makeApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
});

// --- minimal SSE client ----------------------------------------------------

interface SseFrame {
  id?: string;
  event?: string;
  data?: unknown;
}

interface SseHandle {
  frames: SseFrame[];
  close(): void;
  /** Resolve once `frames.length >= n` (or reject on timeout). */
  waitFor(n: number, timeoutMs?: number): Promise<void>;
}

function openSse(
  path: string,
  headers: Record<string, string> = {},
): Promise<SseHandle> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path, headers },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE open failed: ${res.statusCode}`));
          res.resume();
          return;
        }

        const frames: SseFrame[] = [];
        const waiters: Array<{ n: number; resolve: () => void }> = [];
        let buf = "";

        function flushWaiters(): void {
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (frames.length >= waiters[i]!.n) {
              waiters[i]!.resolve();
              waiters.splice(i, 1);
            }
          }
        }

        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buf += chunk;
          // Frames are separated by a blank line.
          let sep: number;
          while ((sep = buf.indexOf("\n\n")) !== -1) {
            const rawFrame = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            // Skip comment/keepalive frames (": ping", "retry:").
            const lines = rawFrame.split("\n");
            const frame: SseFrame = {};
            let isData = false;
            for (const line of lines) {
              if (line.startsWith(":")) continue;
              if (line.startsWith("id:")) frame.id = line.slice(3).trim();
              else if (line.startsWith("event:"))
                frame.event = line.slice(6).trim();
              else if (line.startsWith("data:")) {
                isData = true;
                frame.data = JSON.parse(line.slice(5).trim());
              } else if (line.startsWith("retry:")) {
                // ignore
              }
            }
            if (frame.event || isData) {
              frames.push(frame);
              flushWaiters();
            }
          }
        });

        const handle: SseHandle = {
          frames,
          close() {
            req.destroy();
            res.destroy();
          },
          waitFor(n: number, timeoutMs = 5000) {
            if (frames.length >= n) return Promise.resolve();
            return new Promise<void>((res2, rej2) => {
              const timer = setTimeout(() => {
                rej2(
                  new Error(
                    `Timed out waiting for ${n} frames; have ${frames.length}: ${JSON.stringify(
                      frames,
                    )}`,
                  ),
                );
              }, timeoutMs);
              waiters.push({
                n,
                resolve: () => {
                  clearTimeout(timer);
                  res2();
                },
              });
            });
          },
        };

        resolve(handle);
      },
    );
    req.on("error", reject);
  });
}

async function postComment(
  postId: string,
  payload: Record<string, unknown>,
  token?: string,
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await app.inject({
    method: "POST",
    url: `/posts/${postId}/comments`,
    headers,
    payload,
  });
  return JSON.parse(res.body);
}

describe("SSE stream", () => {
  it("delivers comment.created / comment.updated / segment.opened in seq order with id lines", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    // Open a live subscription from the start (no prior history).
    const sse = await openSse(`/posts/${post.id}/stream`);

    // 1) HUMAN comment -> comment.created (seq 1).
    await postComment(
      post.id,
      { type: "HUMAN", body: "hi", clientId: "h1" },
      user.token,
    );

    // 2) AI bubble PENDING -> created (seq 2), then PATCH -> comment.updated.
    const aiBubble = (await postComment(post.id, {
      type: "AI_REPLY",
      body: "...",
      clientId: "ai1",
      status: "PENDING",
    })) as { id: string };
    await app.inject({
      method: "PATCH",
      url: `/comments/${aiBubble.id}`,
      payload: { status: "COMPLETE", body: "answer", clientId: "ai1" },
    });

    // 3) AI_SUMMARY -> comment.created (the summary) + segment.opened.
    await postComment(post.id, {
      type: "AI_SUMMARY",
      body: "summary",
      clientId: "sum1",
      segmentExpected: 0,
    });

    // Expect 5 live frames: created(h1), created(ai1), updated(ai1),
    // created(summary), segment.opened.
    await sse.waitFor(5);

    const events = sse.frames.map((f) => f.event);
    expect(events).toEqual([
      "comment.created",
      "comment.created",
      "comment.updated",
      "comment.created",
      "segment.opened",
    ]);

    // Every frame carries an id line.
    for (const f of sse.frames) {
      expect(f.id).toBeDefined();
      expect(f.id).not.toBe("");
    }

    // created/segment frames carry monotonic seq ids (the human=1, ai=2,
    // summary=3); the updated frame reuses the AI bubble's seq (2).
    const created = sse.frames.filter((f) => f.event === "comment.created");
    expect(created.map((f) => Number(f.id))).toEqual([1, 2, 3]);
    const opened = sse.frames.find((f) => f.event === "segment.opened")!;
    expect(Number(opened.id)).toBe(3);
    expect((opened.data as { segmentIndex: number }).segmentIndex).toBe(1);

    sse.close();
  });

  it("replays only missed bubbles via ?afterSeq", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    // Three comments persisted before any subscription (seq 1,2,3).
    await postComment(
      post.id,
      { type: "HUMAN", body: "m1", clientId: "c1" },
      user.token,
    );
    await postComment(
      post.id,
      { type: "HUMAN", body: "m2", clientId: "c2" },
      user.token,
    );
    await postComment(
      post.id,
      { type: "HUMAN", body: "m3", clientId: "c3" },
      user.token,
    );

    // Reconnect from seq 1 -> snapshot should replay ONLY seq 2 and 3.
    const sse = await openSse(`/posts/${post.id}/stream?afterSeq=1`);
    await sse.waitFor(2);

    const seqs = sse.frames.map((f) => Number(f.id));
    expect(seqs).toEqual([2, 3]);
    const bodies = sse.frames.map(
      (f) => (f.data as { comment: { body: string } }).comment.body,
    );
    expect(bodies).toEqual(["m2", "m3"]);

    sse.close();
  });

  it("reconnect via Last-Event-ID header replays missed bubbles", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    await postComment(
      post.id,
      { type: "HUMAN", body: "a", clientId: "la" },
      user.token,
    );
    await postComment(
      post.id,
      { type: "HUMAN", body: "b", clientId: "lb" },
      user.token,
    );

    // EventSource auto-reconnect sends the last seq it saw as Last-Event-ID.
    const sse = await openSse(`/posts/${post.id}/stream`, {
      "Last-Event-ID": "1",
    });
    await sse.waitFor(1);

    expect(sse.frames.map((f) => Number(f.id))).toEqual([2]);
    expect(
      (sse.frames[0]!.data as { comment: { body: string } }).comment.body,
    ).toBe("b");

    sse.close();
  });

  it("snapshot + live: missed bubble replayed, then a new one streamed live", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    await postComment(
      post.id,
      { type: "HUMAN", body: "snap1", clientId: "s1" },
      user.token,
    );

    // Subscribe from scratch: snapshot replays seq 1, then we post seq 2 live.
    const sse = await openSse(`/posts/${post.id}/stream`);
    await sse.waitFor(1);
    expect(sse.frames.map((f) => Number(f.id))).toEqual([1]);

    await postComment(
      post.id,
      { type: "HUMAN", body: "live2", clientId: "s2" },
      user.token,
    );
    await sse.waitFor(2);

    expect(sse.frames.map((f) => Number(f.id))).toEqual([1, 2]);
    expect(
      (sse.frames[1]!.data as { comment: { body: string } }).comment.body,
    ).toBe("live2");

    sse.close();
  });
});
