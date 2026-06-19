// WP XC-T — CONTRACT tests (app.inject; no network, no LLM).
//
// Covers: auth/session shape, key-blindness (no apiKey accepted/echoed),
// clientId idempotency, /context assembly (FR-6.1 seg0 + FR-7.2 seg1 exclusion),
// PATCH authz (HUMAN by x-user-id, AI bubble by clientId), and the AI_SUMMARY
// 409 conflict guard (stale segmentExpected → no double-open).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
});

describe("auth/session", () => {
  it("returns { id, username } and never an apiKey", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/session",
      payload: { username: "alice" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("id");
    expect(body.username).toBe("alice");
    expect(Object.keys(body).sort()).toEqual(["id", "username"]);
  });

  it("rejects a missing/invalid username (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/session",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("key-blindness (L1)", () => {
  it("ignores a posted apiKey on auth/session and never echoes it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/session",
      payload: { username: "carol", apiKey: "SECRET-KEY-123" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("SECRET-KEY-123");
    expect(res.body).not.toContain("apiKey");
    const body = JSON.parse(res.body);
    expect(body).not.toHaveProperty("apiKey");
  });

  it("ignores an apiKey on comment create and never persists/echoes it", async () => {
    const user = await createUser();
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.id, community.id);

    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: { "x-user-id": user.id },
      payload: {
        type: "HUMAN",
        body: "hello",
        clientId: "c-key-blind",
        apiKey: "SECRET-KEY-XYZ",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain("SECRET-KEY-XYZ");
    expect(res.body).not.toContain("apiKey");

    // And it must not have been stored anywhere on the comment row.
    const row = JSON.parse(res.body);
    const stored = await prisma.comment.findUnique({ where: { id: row.id } });
    expect(JSON.stringify(stored)).not.toContain("SECRET-KEY-XYZ");
  });
});

describe("clientId idempotency", () => {
  it("returns the same comment for a repeated (postId, clientId), no dup", async () => {
    const user = await createUser();
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.id, community.id);

    const payload = {
      type: "HUMAN" as const,
      body: "idempotent body",
      clientId: "dedupe-1",
    };

    const first = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: { "x-user-id": user.id },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstDto = JSON.parse(first.body);

    const second = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: { "x-user-id": user.id },
      payload,
    });
    // Idempotent replay returns the SAME comment with 200.
    expect(second.statusCode).toBe(200);
    const secondDto = JSON.parse(second.body);
    expect(secondDto.id).toBe(firstDto.id);
    expect(secondDto.seq).toBe(firstDto.seq);

    // Exactly ONE comment exists for that post.
    const count = await prisma.comment.count({ where: { postId: post.id } });
    expect(count).toBe(1);
  });
});

describe("/context assembly", () => {
  it("segment 0 includes the original post + seg-0 bubbles (FR-6.1)", async () => {
    const author = await createUser("postauthor");
    const commenter = await createUser("human1");
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.id, community.id, {
      title: "First Post",
      body: "Post body text.",
    });

    // Human comment + an AI_REPLY in segment 0.
    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: { "x-user-id": commenter.id },
      payload: { type: "HUMAN", body: "a question", clientId: "h1" },
    });
    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      payload: {
        type: "AI_REPLY",
        body: "an AI answer",
        clientId: "ai1",
        status: "COMPLETE",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/posts/${post.id}/context`,
    });
    expect(res.statusCode).toBe(200);
    const ctx = JSON.parse(res.body);
    expect(ctx.segmentIndex).toBe(0);
    // First turn is the original post rendered as a user turn (FR-6.1 "#5").
    expect(ctx.contents[0]).toEqual({
      role: "user",
      text: "「postauthor」: First Post\nPost body text.",
    });
    expect(ctx.contents[1]).toEqual({
      role: "user",
      text: "「human1」: a question",
    });
    expect(ctx.contents[2]).toEqual({ role: "model", text: "an AI answer" });
  });

  it("after a summary, segment 1 returns (summary opening + after) EXCLUDING prior history (FR-7.2)", async () => {
    const author = await createUser("auth2");
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.id, community.id, {
      title: "T",
      body: "B",
    });

    // Seg 0 chatter that must be EXCLUDED from segment 1's context.
    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: { "x-user-id": author.id },
      payload: { type: "HUMAN", body: "old seg0 message", clientId: "old1" },
    });

    // Open segment 1 with an AI_SUMMARY (current active index is 0).
    const sum = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      payload: {
        type: "AI_SUMMARY",
        body: "everything so far summarized",
        clientId: "sum1",
        segmentExpected: 0,
      },
    });
    expect(sum.statusCode).toBe(201);

    // New message lands in segment 1.
    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: { "x-user-id": author.id },
      payload: { type: "HUMAN", body: "new seg1 message", clientId: "new1" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/posts/${post.id}/context`,
    });
    const ctx = JSON.parse(res.body);
    expect(ctx.segmentIndex).toBe(1);
    // Opening turn is the summary as a user turn (FR-7.2 "#7").
    expect(ctx.contents[0]).toEqual({
      role: "user",
      text: "지금까지 요약: everything so far summarized",
    });
    expect(ctx.contents[1]).toEqual({
      role: "user",
      text: "「auth2」: new seg1 message",
    });
    // Prior segment-0 history is EXCLUDED.
    const joined = JSON.stringify(ctx.contents);
    expect(joined).not.toContain("old seg0 message");
    expect(joined).not.toContain("「auth2」: T"); // original post not in seg1
  });
});

describe("PATCH authz (L12 / §6)", () => {
  it("HUMAN comment: author can edit; wrong user -> 403", async () => {
    const author = await createUser();
    const other = await createUser();
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.id, community.id);

    const created = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: { "x-user-id": author.id },
      payload: { type: "HUMAN", body: "mine", clientId: "h-auth" },
    });
    const dto = JSON.parse(created.body);

    // Owner edits OK.
    const ok = await app.inject({
      method: "PATCH",
      url: `/comments/${dto.id}`,
      headers: { "x-user-id": author.id },
      payload: { body: "edited" },
    });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).body).toBe("edited");

    // Wrong user -> 403.
    const forbidden = await app.inject({
      method: "PATCH",
      url: `/comments/${dto.id}`,
      headers: { "x-user-id": other.id },
      payload: { body: "hijack" },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("AI bubble: correct clientId can edit; wrong clientId -> 403", async () => {
    const author = await createUser();
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.id, community.id);

    // PENDING AI bubble owned by clientId "ai-owner".
    const created = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      payload: {
        type: "AI_REPLY",
        body: "loading",
        clientId: "ai-owner",
        status: "PENDING",
      },
    });
    const dto = JSON.parse(created.body);

    // Owner (clientId match) completes it.
    const ok = await app.inject({
      method: "PATCH",
      url: `/comments/${dto.id}`,
      payload: { status: "COMPLETE", body: "done", clientId: "ai-owner" },
    });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).status).toBe("COMPLETE");

    // Wrong clientId -> 403.
    const forbidden = await app.inject({
      method: "PATCH",
      url: `/comments/${dto.id}`,
      payload: { body: "hijack", clientId: "not-the-owner" },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("PATCH /posts/:id", () => {
  it("author edits title+body -> 200 and response reflects new values", async () => {
    const author = await createUser();
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.id, community.id, {
      title: "Original Title",
      body: "Original body.",
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/posts/${post.id}`,
      headers: { "x-user-id": author.id },
      payload: { title: "Edited Title", body: "Edited body." },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.title).toBe("Edited Title");
    expect(body.body).toBe("Edited body.");
    expect(body.id).toBe(post.id);
    expect(body).toHaveProperty("communityId");
    expect(body).toHaveProperty("authorId");
    expect(body).toHaveProperty("community");
    expect(body).toHaveProperty("author");
  });

  it("a different user editing -> 403", async () => {
    const author = await createUser();
    const other = await createUser();
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.id, community.id);

    const res = await app.inject({
      method: "PATCH",
      url: `/posts/${post.id}`,
      headers: { "x-user-id": other.id },
      payload: { title: "Hijack" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("missing x-user-id -> 401", async () => {
    const author = await createUser();
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.id, community.id);

    const res = await app.inject({
      method: "PATCH",
      url: `/posts/${post.id}`,
      payload: { title: "No auth" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("non-existent post id -> 404", async () => {
    const author = await createUser();

    const res = await app.inject({
      method: "PATCH",
      url: "/posts/nonexistent-id-that-does-not-exist",
      headers: { "x-user-id": author.id },
      payload: { title: "Ghost" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("AI_SUMMARY 409 guard (BE-7)", () => {
  it("stale segmentExpected -> 409 and no double-open", async () => {
    const author = await createUser();
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.id, community.id);

    // First summary wins: active index 0 -> opens segment 1.
    const first = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      payload: {
        type: "AI_SUMMARY",
        body: "first summary",
        clientId: "sum-A",
        segmentExpected: 0,
      },
    });
    expect(first.statusCode).toBe(201);

    // A second summary that STILL believes index 0 is active is stale -> 409.
    const stale = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      payload: {
        type: "AI_SUMMARY",
        body: "second summary",
        clientId: "sum-B",
        segmentExpected: 0,
      },
    });
    expect(stale.statusCode).toBe(409);
    const conflict = JSON.parse(stale.body);
    expect(conflict.segmentIndex).toBe(1); // current active segment

    // No double-open: exactly one segment beyond seg0 (index 1), and only the
    // winning summary comment exists.
    const segments = await prisma.contextSegment.findMany({
      where: { postId: post.id },
      orderBy: { index: "asc" },
    });
    expect(segments.map((s) => s.index)).toEqual([0, 1]);
    const summaries = await prisma.comment.count({
      where: { postId: post.id, type: "AI_SUMMARY" },
    });
    expect(summaries).toBe(1);

    // The active segment is index 1.
    const active = segments.find((s) => s.isActive);
    expect(active?.index).toBe(1);
  });
});
