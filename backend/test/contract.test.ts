// WP XC-T — CONTRACT tests (app.inject; no network, no LLM).
//
// Covers: auth/register + auth/session shape, key-blindness (no apiKey),
// clientId idempotency, /context assembly (FR-6.1 seg0 + FR-7.2 seg1 exclusion),
// PATCH authz (HUMAN by JWT, AI bubble by clientId), the AI_SUMMARY 409 conflict
// guard (stale segmentExpected → no double-open), and JWT security gate tests.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import {
  authHeader,
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

// ---------------------------------------------------------------------------
// Auth: register + session
// ---------------------------------------------------------------------------

describe("auth/register", () => {
  it("returns 201 { token, id, username } with a valid Bearer token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { username: "alice", password: "password123" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("token");
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
    expect(body).toHaveProperty("id");
    expect(body.username).toBe("alice");
    expect(Object.keys(body).sort()).toEqual(["id", "token", "username"]);
  });

  it("returns 409 when username already exists", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { username: "bob", password: "password123" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { username: "bob", password: "different123" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("returns 400 when password is too short (< 8 chars)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { username: "charlie", password: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when username is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { password: "password123" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("auth/session", () => {
  it("returns 200 { token, id, username } with correct credentials", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { username: "dave", password: "password123" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/auth/session",
      payload: { username: "dave", password: "password123" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("token");
    expect(body.username).toBe("dave");
    expect(Object.keys(body).sort()).toEqual(["id", "token", "username"]);
  });

  it("returns 401 on wrong password", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { username: "eve", password: "password123" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/auth/session",
      payload: { username: "eve", password: "wrongpassword" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 on unknown username", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/session",
      payload: { username: "nobody", password: "password123" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for legacy user with no passwordHash", async () => {
    // Create a user directly in DB without a passwordHash (legacy row).
    await prisma.user.create({ data: { username: "legacy-user" } });
    const res = await app.inject({
      method: "POST",
      url: "/auth/session",
      payload: { username: "legacy-user", password: "password123" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when username is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/session",
      payload: { password: "password123" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Auth: guest entry
// ---------------------------------------------------------------------------

describe("auth/guest (guest mode)", () => {
  it("returns 201 { token, id, username } with a #hex4-suffixed username from a nickname alone", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/guest",
      payload: { username: "guestnick" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
    expect(body).toHaveProperty("id");
    expect(typeof body.username).toBe("string");
    // Server appends "#" + 4 hex chars to the base nickname.
    expect(body.username).toMatch(/#[0-9a-f]{4}$/);
    expect(body.username.startsWith("guestnick#")).toBe(true);
    expect(Object.keys(body).sort()).toEqual(["id", "token", "username"]);
  });

  it("the issued guest token passes a protected write (POST /communities)", async () => {
    const guest = await app.inject({
      method: "POST",
      url: "/auth/guest",
      payload: { username: "writer" },
    });
    expect(guest.statusCode).toBe(201);
    const { token } = JSON.parse(guest.body);

    const res = await app.inject({
      method: "POST",
      url: "/communities",
      headers: authHeader(token),
      payload: {
        name: `Guest Community ${Date.now()}`,
        slug: `guest-c-${Date.now()}`,
        personaPrompt: "You are a helpful persona.",
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("returns 400 when the nickname contains #", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/guest",
      payload: { username: "bad#name" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when the nickname exceeds 16 chars", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/guest",
      payload: { username: "a".repeat(17) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("a member 'foo' and a guest 'foo' coexist as distinct users (guest gets foo#hex4)", async () => {
    // Member registers the plain username "foo".
    const member = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { username: "foo", password: "password123" },
    });
    expect(member.statusCode).toBe(201);
    const memberBody = JSON.parse(member.body);
    expect(memberBody.username).toBe("foo");

    // A guest entering the same base nickname is NOT rejected — the server
    // always assigns a #hex4 suffix, so it never collides with the member.
    const guest = await app.inject({
      method: "POST",
      url: "/auth/guest",
      payload: { username: "foo" },
    });
    expect(guest.statusCode).toBe(201);
    const guestBody = JSON.parse(guest.body);
    expect(guestBody.username).toMatch(/^foo#[0-9a-f]{4}$/);

    // Distinct usernames and distinct user rows.
    expect(guestBody.username).not.toBe(memberBody.username);
    expect(guestBody.id).not.toBe(memberBody.id);
  });
});

// ---------------------------------------------------------------------------
// Auth: sliding refresh (both modes)
// ---------------------------------------------------------------------------

describe("auth/refresh", () => {
  it("a valid Bearer token (from createUser) returns 200 { token } with a new token string", async () => {
    const user = await createUser(app);

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: authHeader(user.token),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// JWT security gate
// ---------------------------------------------------------------------------

describe("JWT security gate", () => {
  it("a forged / garbage Bearer token → 401 on a protected write", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/upvote`,
      headers: { Authorization: "Bearer this.is.garbage" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("no token → 401 on a protected write", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/upvote`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("valid token → authed write succeeds", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/upvote`,
      headers: authHeader(user.token),
    });
    expect(res.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Key-blindness (L1)
// ---------------------------------------------------------------------------

describe("key-blindness (L1)", () => {
  it("ignores a posted apiKey on auth/register and never echoes it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { username: "carol", password: "password123", apiKey: "SECRET-KEY-123" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain("SECRET-KEY-123");
    expect(res.body).not.toContain("apiKey");
    const body = JSON.parse(res.body);
    expect(body).not.toHaveProperty("apiKey");
  });

  it("ignores an apiKey on comment create and never persists/echoes it", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: authHeader(user.token),
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

// ---------------------------------------------------------------------------
// clientId idempotency
// ---------------------------------------------------------------------------

describe("clientId idempotency", () => {
  it("returns the same comment for a repeated (postId, clientId), no dup", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    const payload = {
      type: "HUMAN" as const,
      body: "idempotent body",
      clientId: "dedupe-1",
    };

    const first = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: authHeader(user.token),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstDto = JSON.parse(first.body);

    const second = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: authHeader(user.token),
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

// ---------------------------------------------------------------------------
// /context assembly
// ---------------------------------------------------------------------------

describe("/context assembly", () => {
  it("segment 0 includes the original post + seg-0 bubbles (FR-6.1)", async () => {
    const author = await createUser(app, "postauthor");
    const commenter = await createUser(app, "human1");
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.token, community.id, {
      title: "First Post",
      body: "Post body text.",
    });

    // Human comment + an AI_REPLY in segment 0.
    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: authHeader(commenter.token),
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
    // Username comes from the returned value so this holds in both modes
    // (register: "postauthor"; guest: "postauthor#hex4").
    expect(ctx.contents[0]).toEqual({
      role: "user",
      text: `「${author.username}」: First Post\nPost body text.`,
    });
    expect(ctx.contents[1]).toEqual({
      role: "user",
      text: `「${commenter.username}」: a question`,
    });
    expect(ctx.contents[2]).toEqual({ role: "model", text: "an AI answer" });
  });

  it("after a summary, segment 1 returns (summary opening + after) EXCLUDING prior history (FR-7.2)", async () => {
    const author = await createUser(app, "auth2");
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.token, community.id, {
      title: "T",
      body: "B",
    });

    // Seg 0 chatter that must be EXCLUDED from segment 1's context.
    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: authHeader(author.token),
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
      headers: authHeader(author.token),
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
      text: `「${author.username}」: new seg1 message`,
    });
    // Prior segment-0 history is EXCLUDED.
    const joined = JSON.stringify(ctx.contents);
    expect(joined).not.toContain("old seg0 message");
    expect(joined).not.toContain(`「${author.username}」: T`); // original post not in seg1
  });
});

// ---------------------------------------------------------------------------
// PATCH authz (L12 / §6)
// ---------------------------------------------------------------------------

describe("PATCH authz (L12 / §6)", () => {
  it("HUMAN comment: author can edit; wrong user -> 403", async () => {
    const author = await createUser(app);
    const other = await createUser(app);
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.token, community.id);

    const created = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: authHeader(author.token),
      payload: { type: "HUMAN", body: "mine", clientId: "h-auth" },
    });
    const dto = JSON.parse(created.body);

    // Owner edits OK.
    const ok = await app.inject({
      method: "PATCH",
      url: `/comments/${dto.id}`,
      headers: authHeader(author.token),
      payload: { body: "edited" },
    });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).body).toBe("edited");

    // Wrong user -> 403.
    const forbidden = await app.inject({
      method: "PATCH",
      url: `/comments/${dto.id}`,
      headers: authHeader(other.token),
      payload: { body: "hijack" },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("AI bubble: correct clientId can edit; wrong clientId -> 403", async () => {
    const author = await createUser(app);
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.token, community.id);

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

// ---------------------------------------------------------------------------
// GET /posts/:id — community.personaPrompt (L6 systemInstruction source)
// ---------------------------------------------------------------------------

describe("GET /posts/:id — community.personaPrompt (L6 systemInstruction source)", () => {
  it("returns community.personaPrompt so the client AI engine can apply the persona", async () => {
    const author = await createUser(app);
    const community = await createCommunity(author.id); // persona: "You are a helpful persona."
    const post = await createPostViaApi(app, author.token, community.id);

    const res = await app.inject({ method: "GET", url: `/posts/${post.id}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Regression guard: omitting this left the Thread persona empty so every
    // @AI / 1차 reply ran with NO systemInstruction.
    expect(body.community.personaPrompt).toBe("You are a helpful persona.");
  });
});

// ---------------------------------------------------------------------------
// PATCH /posts/:id
// ---------------------------------------------------------------------------

describe("PATCH /posts/:id", () => {
  it("author edits title+body -> 200 and response reflects new values", async () => {
    const author = await createUser(app);
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.token, community.id, {
      title: "Original Title",
      body: "Original body.",
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/posts/${post.id}`,
      headers: authHeader(author.token),
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
    const author = await createUser(app);
    const other = await createUser(app);
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.token, community.id);

    const res = await app.inject({
      method: "PATCH",
      url: `/posts/${post.id}`,
      headers: authHeader(other.token),
      payload: { title: "Hijack" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("missing token -> 401", async () => {
    const author = await createUser(app);
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.token, community.id);

    const res = await app.inject({
      method: "PATCH",
      url: `/posts/${post.id}`,
      payload: { title: "No auth" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("non-existent post id -> 404", async () => {
    const author = await createUser(app);

    const res = await app.inject({
      method: "PATCH",
      url: "/posts/nonexistent-id-that-does-not-exist",
      headers: authHeader(author.token),
      payload: { title: "Ghost" },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /posts/:id
// ---------------------------------------------------------------------------

describe("DELETE /posts/:id", () => {
  it("author deletes -> success and the post is gone (GET -> 404)", async () => {
    const author = await createUser(app);
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.token, community.id);

    const res = await app.inject({
      method: "DELETE",
      url: `/posts/${post.id}`,
      headers: authHeader(author.token),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ deleted: true });

    const gone = await app.inject({ method: "GET", url: `/posts/${post.id}` });
    expect(gone.statusCode).toBe(404);
  });

  it("a different user deleting -> 403", async () => {
    const author = await createUser(app);
    const other = await createUser(app);
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.token, community.id);

    const res = await app.inject({
      method: "DELETE",
      url: `/posts/${post.id}`,
      headers: authHeader(other.token),
    });
    expect(res.statusCode).toBe(403);
  });

  it("non-existent post id -> 404", async () => {
    const author = await createUser(app);

    const res = await app.inject({
      method: "DELETE",
      url: "/posts/nonexistent-id-that-does-not-exist",
      headers: authHeader(author.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("deletes a post WITH a comment + vote + bookmark (cascade) without FK error", async () => {
    const author = await createUser(app);
    const commenter = await createUser(app);
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.token, community.id);

    // A human comment in seg-0.
    const comment = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: authHeader(commenter.token),
      payload: { type: "HUMAN", body: "a question", clientId: "c1" },
    });
    expect(comment.statusCode).toBe(201);

    // A vote and a bookmark on the post.
    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/upvote`,
      headers: authHeader(commenter.token),
    });
    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/bookmark`,
      headers: authHeader(commenter.token),
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/posts/${post.id}`,
      headers: authHeader(author.token),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ deleted: true });

    // Post and all its children are gone.
    const gone = await app.inject({ method: "GET", url: `/posts/${post.id}` });
    expect(gone.statusCode).toBe(404);
    expect(await prisma.comment.count({ where: { postId: post.id } })).toBe(0);
    expect(await prisma.vote.count({ where: { postId: post.id } })).toBe(0);
    expect(await prisma.bookmark.count({ where: { postId: post.id } })).toBe(0);
    expect(
      await prisma.contextSegment.count({ where: { postId: post.id } }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

describe("bookmarks", () => {
  it("POST bookmark -> 201 { bookmarked: true }", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/bookmark`,
      headers: authHeader(user.token),
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ bookmarked: true });
  });

  it("POST bookmark is idempotent (second call still succeeds, one DB row)", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/bookmark`,
      headers: authHeader(user.token),
    });
    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/bookmark`,
      headers: authHeader(user.token),
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ bookmarked: true });

    const count = await prisma.bookmark.count({
      where: { userId: user.id, postId: post.id },
    });
    expect(count).toBe(1);
  });

  it("GET /users/:id/bookmarks returns the post as a feed card", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id, {
      title: "Bookmarked Post",
      body: "body here",
    });

    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/bookmark`,
      headers: authHeader(user.token),
    });

    const res = await app.inject({
      method: "GET",
      url: `/users/${user.id}/bookmarks`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("items");
    expect(body.items).toHaveLength(1);
    const card = body.items[0];
    expect(card.id).toBe(post.id);
    expect(card.title).toBe("Bookmarked Post");
    expect(card).toHaveProperty("communitySlug");
    expect(card).toHaveProperty("authorUsername");
  });

  it("GET /posts/:id with valid token returns bookmarked:true; without returns bookmarked:false", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/bookmark`,
      headers: authHeader(user.token),
    });

    const withUser = await app.inject({
      method: "GET",
      url: `/posts/${post.id}`,
      headers: authHeader(user.token),
    });
    expect(JSON.parse(withUser.body).bookmarked).toBe(true);

    const withoutUser = await app.inject({
      method: "GET",
      url: `/posts/${post.id}`,
    });
    expect(JSON.parse(withoutUser.body).bookmarked).toBe(false);
  });

  it("DELETE bookmark -> 200 { bookmarked: false }", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/bookmark`,
      headers: authHeader(user.token),
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/posts/${post.id}/bookmark`,
      headers: authHeader(user.token),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ bookmarked: false });
  });

  it("DELETE bookmark is idempotent when none exists", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    const res = await app.inject({
      method: "DELETE",
      url: `/posts/${post.id}/bookmark`,
      headers: authHeader(user.token),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ bookmarked: false });
  });

  it("POST bookmark without token -> 401", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/bookmark`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST bookmark on missing post -> 404", async () => {
    const user = await createUser(app);

    const res = await app.inject({
      method: "POST",
      url: "/posts/nonexistent-post-id/bookmark",
      headers: authHeader(user.token),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Upvote toggle
// ---------------------------------------------------------------------------

describe("upvote toggle", () => {
  it("POST upvote -> 201 { voted: true, score: 1 }", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/upvote`,
      headers: authHeader(user.token),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.voted).toBe(true);
    expect(body.score).toBe(1);
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("hotScore");
  });

  it("POST upvote is idempotent (second call: score stays 1, one DB row)", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/upvote`,
      headers: authHeader(user.token),
    });
    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/upvote`,
      headers: authHeader(user.token),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.score).toBe(1);
    expect(body.voted).toBe(true);

    const count = await prisma.vote.count({
      where: { userId: user.id, postId: post.id },
    });
    expect(count).toBe(1);
  });

  it("DELETE upvote -> 200 { voted: false, score: 0 }", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/upvote`,
      headers: authHeader(user.token),
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/posts/${post.id}/upvote`,
      headers: authHeader(user.token),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.voted).toBe(false);
    expect(body.score).toBe(0);
  });

  it("DELETE upvote is idempotent when no vote exists", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    const res = await app.inject({
      method: "DELETE",
      url: `/posts/${post.id}/upvote`,
      headers: authHeader(user.token),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.voted).toBe(false);
    expect(body.score).toBe(0);
  });

  it("GET /posts/:id with valid token returns voted:true; without returns voted:false", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/upvote`,
      headers: authHeader(user.token),
    });

    const withUser = await app.inject({
      method: "GET",
      url: `/posts/${post.id}`,
      headers: authHeader(user.token),
    });
    expect(JSON.parse(withUser.body).voted).toBe(true);

    const withoutUser = await app.inject({
      method: "GET",
      url: `/posts/${post.id}`,
    });
    expect(JSON.parse(withoutUser.body).voted).toBe(false);
  });

  it("GET /posts (feed) with valid token reflects voted per card", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/upvote`,
      headers: authHeader(user.token),
    });

    const res = await app.inject({
      method: "GET",
      url: "/posts",
      headers: authHeader(user.token),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const card = body.items.find((c: { id: string }) => c.id === post.id);
    expect(card).toBeDefined();
    expect(card.voted).toBe(true);
  });

  it("POST upvote without token -> 401", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const post = await createPostViaApi(app, user.token, community.id);

    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/upvote`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST upvote on missing post -> 404", async () => {
    const user = await createUser(app);

    const res = await app.inject({
      method: "POST",
      url: "/posts/nonexistent-post-id/upvote",
      headers: authHeader(user.token),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// AI_SUMMARY 409 guard (BE-7)
// ---------------------------------------------------------------------------

describe("AI_SUMMARY 409 guard (BE-7)", () => {
  it("stale segmentExpected -> 409 and no double-open", async () => {
    const author = await createUser(app);
    const community = await createCommunity(author.id);
    const post = await createPostViaApi(app, author.token, community.id);

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

// ---------------------------------------------------------------------------
// FR-1.4: GET /posts?q= — post search (title OR body partial match, ANDed
// with the keyset cursor so search pages exactly like the feed)
// ---------------------------------------------------------------------------

describe("GET /posts?q= — post search (FR-1.4)", () => {
  it("filters by title OR body (case-insensitive), excluding non-matching posts", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const byTitle = await createPostViaApi(app, user.token, community.id, {
      title: "All about zebra habitats",
      body: "Plains and savannas.",
    });
    const byBody = await createPostViaApi(app, user.token, community.id, {
      title: "Striped animals",
      body: "The zebra is the most famous one.",
    });
    await createPostViaApi(app, user.token, community.id, {
      title: "Unrelated post",
      body: "Nothing to see here.",
    });

    const res = await app.inject({
      method: "GET",
      url: "/posts?sort=new&q=ZEBRA",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const ids = body.items.map((p: { id: string }) => p.id).sort();
    expect(ids).toEqual([byTitle.id, byBody.id].sort());
  });

  it("returns an empty page (items: [], nextCursor: null) when nothing matches", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    await createPostViaApi(app, user.token, community.id);

    const res = await app.inject({
      method: "GET",
      url: "/posts?sort=new&q=no-such-needle",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it("pages matching posts with the cursor and never leaks non-matching rows", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    // 22 matching posts (> FEED_PAGE_SIZE=20) + 1 non-matching in between.
    // Inserted directly via prisma (NOT the route) to sidestep the per-user
    // posting rate limit; GET /posts only reads Post rows, no segment needed.
    const base = Date.now() - 60_000;
    const rows = [] as {
      communityId: string;
      authorId: string;
      title: string;
      body: string;
      score: number;
      commentCount: number;
      hotScore: number;
      createdAt: Date;
    }[];
    for (let i = 0; i < 22; i++) {
      rows.push({
        communityId: community.id,
        authorId: user.id,
        title: `needle post ${i}`,
        body: `match ${i}`,
        score: 0,
        commentCount: 0,
        hotScore: 0,
        createdAt: new Date(base + i * 1000),
      });
      if (i === 10) {
        rows.push({
          communityId: community.id,
          authorId: user.id,
          title: "hay only",
          body: "no match here",
          score: 0,
          commentCount: 0,
          hotScore: 0,
          createdAt: new Date(base + i * 1000 + 500),
        });
      }
    }
    await prisma.post.createMany({ data: rows });

    const page1Res = await app.inject({
      method: "GET",
      url: "/posts?sort=new&q=needle",
    });
    expect(page1Res.statusCode).toBe(200);
    const page1 = JSON.parse(page1Res.body);
    expect(page1.items).toHaveLength(20);
    expect(page1.nextCursor).toBeTruthy();
    for (const p of page1.items) expect(p.title).toContain("needle");

    const page2Res = await app.inject({
      method: "GET",
      url: `/posts?sort=new&q=needle&cursor=${encodeURIComponent(page1.nextCursor)}`,
    });
    expect(page2Res.statusCode).toBe(200);
    const page2 = JSON.parse(page2Res.body);
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    for (const p of page2.items) expect(p.title).toContain("needle");

    // no overlap between pages
    const ids1 = new Set(page1.items.map((p: { id: string }) => p.id));
    for (const p of page2.items) expect(ids1.has(p.id)).toBe(false);
  });
});
