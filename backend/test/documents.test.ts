// FR-13 / TRD §4.3 — discussion document (문서 응결) route contract.
//
// The markdown is produced in the browser with the caller's own key; these tests
// cover ONLY the server's half of the contract: validation, derived communityId,
// idempotency, listing/pagination, and the rate-limit gate. No LLM is involved
// and no key ever appears in a request (L1 key-blind).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
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

async function seed() {
  const user = await createUser(app);
  const community = await createCommunity(user.id);
  const post = await createPostViaApi(app, user.token, community.id, {
    title: "Code Agent 잘 쓰는 법",
  });
  return { user, community, post };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    body: "# Code Agent 사용 가이드\n\n## 1. 프롬프트\n- 컨텍스트를 먼저 준다.\n",
    segmentIndex: 0,
    sourceSeq: 12,
    ...overrides,
  };
}

describe("documents (FR-13)", () => {
  beforeEach(async () => {
    if (!app) app = await makeApp();
    await prisma.document.deleteMany();
    await resetDb();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // --- POST /posts/:id/documents -------------------------------------------

  it("creates a document and derives communityId from the post", async () => {
    const { user, community, post } = await seed();

    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/documents`,
      headers: authHeader(user.token),
      payload: validBody({ title: "Code Agent 사용 가이드" }),
    });

    expect(res.statusCode).toBe(201);
    const { document } = JSON.parse(res.body) as { document: Record<string, unknown> };
    expect(document.title).toBe("Code Agent 사용 가이드");
    expect(document.postId).toBe(post.id);
    // Derived server-side — the request never carried a communityId.
    expect(document.communityId).toBe(community.id);
    expect(document.communitySlug).toBe(community.slug);
    expect(document.authorId).toBe(user.id);
    expect(document.segmentIndex).toBe(0);
    expect(document.sourceSeq).toBe(12);
    expect(document.body).toContain("## 1. 프롬프트");
    // L1: nothing key-shaped crosses the boundary.
    expect(res.body).not.toContain("apiKey");
  });

  it("falls back to the post title when no title is supplied", async () => {
    const { user, post } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/documents`,
      headers: authHeader(user.token),
      payload: validBody(),
    });
    expect(res.statusCode).toBe(201);
    const { document } = JSON.parse(res.body) as { document: { title: string } };
    expect(document.title).toBe("Code Agent 잘 쓰는 법");
  });

  it("falls back to the post title when the title is whitespace only", async () => {
    const { user, post } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/documents`,
      headers: authHeader(user.token),
      payload: validBody({ title: "   " }),
    });
    expect(res.statusCode).toBe(201);
    const { document } = JSON.parse(res.body) as { document: { title: string } };
    expect(document.title).toBe("Code Agent 잘 쓰는 법");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { post } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/documents`,
      payload: validBody(),
    });
    expect(res.statusCode).toBe(401);
    expect(await prisma.document.count()).toBe(0);
  });

  it("404s for a nonexistent post", async () => {
    const user = await createUser(app);
    const res = await app.inject({
      method: "POST",
      url: "/posts/does-not-exist/documents",
      headers: authHeader(user.token),
      payload: validBody(),
    });
    expect(res.statusCode).toBe(404);
  });

  // Each malformed payload uses a FRESH identity: the XC-9 gate runs onRequest
  // (before validation), so four bad requests from one identity would trip the
  // 3-per-5-min limit and mask the 400s we are asserting here.
  it("400s on an empty body, a missing segmentIndex, or a bad sourceSeq", async () => {
    const { post } = await seed();
    const url = `/posts/${post.id}/documents`;

    const cases: Array<[string, Record<string, unknown>]> = [
      ["empty body", validBody({ body: "   " })],
      ["missing segmentIndex", { body: "text", sourceSeq: 1 }],
      ["negative sourceSeq", validBody({ sourceSeq: -3 })],
      ["fractional segmentIndex", validBody({ segmentIndex: 1.5 })],
      ["non-string clientId", validBody({ clientId: 42 })],
      ["non-string title", validBody({ title: 7 })],
    ];

    for (const [label, payload] of cases) {
      const author = await createUser(app);
      const res = await app.inject({
        method: "POST",
        url,
        headers: authHeader(author.token),
        payload,
      });
      expect(res.statusCode, label).toBe(400);
    }

    expect(await prisma.document.count()).toBe(0);
  });

  it("400s when the body exceeds the 200K character cap", async () => {
    const { user, post } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/documents`,
      headers: authHeader(user.token),
      payload: validBody({ body: "x".repeat(200_001) }),
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.document.count()).toBe(0);
  });

  it("is idempotent for the same clientId (retry returns the existing document)", async () => {
    const { user, post } = await seed();
    const payload = validBody({ clientId: "doc-abc" });

    const first = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/documents`,
      headers: authHeader(user.token),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstId = (JSON.parse(first.body) as { document: { id: string } }).document.id;

    const retry = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/documents`,
      headers: authHeader(user.token),
      payload,
    });
    expect(retry.statusCode).toBe(200);
    const retryDoc = (JSON.parse(retry.body) as { document: { id: string; body: string } })
      .document;
    expect(retryDoc.id).toBe(firstId);
    expect(retryDoc.body).toContain("프롬프트");

    expect(await prisma.document.count()).toBe(1);
  });

  it("accumulates a new version per run when no clientId is given (FR-13.5)", async () => {
    const { user, post } = await seed();
    for (const seq of [5, 9]) {
      const res = await app.inject({
        method: "POST",
        url: `/posts/${post.id}/documents`,
        headers: authHeader(user.token),
        payload: validBody({ sourceSeq: seq }),
      });
      expect(res.statusCode).toBe(201);
    }
    expect(await prisma.document.count()).toBe(2);
  });

  it("does not consume a comment seq or touch the thread (L4 unchanged)", async () => {
    const { user, post } = await seed();
    const before = await prisma.comment.count({ where: { postId: post.id } });

    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/documents`,
      headers: authHeader(user.token),
      payload: validBody(),
    });

    expect(await prisma.comment.count({ where: { postId: post.id } })).toBe(before);
  });

  // --- GET /posts/:id/documents --------------------------------------------

  it("lists a thread's documents newest-first with a preview and no full body", async () => {
    const { user, post } = await seed();
    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/documents`,
      headers: authHeader(user.token),
      payload: validBody({ title: "older", sourceSeq: 1 }),
    });
    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/documents`,
      headers: authHeader(user.token),
      payload: validBody({ title: "newer", sourceSeq: 2 }),
    });

    const res = await app.inject({ method: "GET", url: `/posts/${post.id}/documents` });
    expect(res.statusCode).toBe(200);
    const { items } = JSON.parse(res.body) as {
      items: Array<{ title: string; preview: string; body?: string }>;
    };
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.title)).toEqual(["newer", "older"]);
    // Preview is plain text (markdown syntax stripped), body is NOT shipped.
    expect(items[0]!.preview).toContain("Code Agent 사용 가이드");
    expect(items[0]!.preview).not.toContain("#");
    expect(items[0]!.body).toBeUndefined();
  });

  it("404s the thread list for a nonexistent post", async () => {
    const res = await app.inject({ method: "GET", url: "/posts/nope/documents" });
    expect(res.statusCode).toBe(404);
  });

  // --- GET /communities/:slug/documents ------------------------------------

  it("paginates a community's documents by cursor", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    // 3 posts x 1 document each — one identity, so keep it under the rate limit
    // by using a distinct user per document.
    const created: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const author = await createUser(app);
      const post = await createPostViaApi(app, author.token, community.id, {
        title: `post-${i}`,
      });
      const res = await app.inject({
        method: "POST",
        url: `/posts/${post.id}/documents`,
        headers: authHeader(author.token),
        payload: validBody({ title: `doc-${i}` }),
      });
      expect(res.statusCode).toBe(201);
      created.push(`doc-${i}`);
    }

    const all = await app.inject({
      method: "GET",
      url: `/communities/${community.slug}/documents`,
    });
    expect(all.statusCode).toBe(200);
    const page = JSON.parse(all.body) as {
      items: Array<{ title: string; id: string }>;
      nextCursor: string | null;
    };
    expect(page.items).toHaveLength(3);
    expect(new Set(page.items.map((i) => i.title))).toEqual(new Set(created));
    // 3 items with a page size of 20 → no further page.
    expect(page.nextCursor).toBeNull();

    // A cursor built from the first item excludes it and everything newer.
    const firstId = page.items[0]!.id;
    const row = await prisma.document.findUnique({ where: { id: firstId } });
    const cursor = Buffer.from(
      `${row!.createdAt.getTime()}|${firstId}`,
      "utf8",
    ).toString("base64url");
    const after = await app.inject({
      method: "GET",
      url: `/communities/${community.slug}/documents?cursor=${cursor}`,
    });
    const afterPage = JSON.parse(after.body) as { items: Array<{ id: string }> };
    expect(afterPage.items.map((i) => i.id)).not.toContain(firstId);
    expect(afterPage.items).toHaveLength(2);
  });

  it("404s the community list for an unknown slug", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/communities/no-such-slug/documents",
    });
    expect(res.statusCode).toBe(404);
  });

  // --- GET /documents/:id --------------------------------------------------

  it("returns a single document with its markdown body and provenance", async () => {
    const { user, post } = await seed();
    const created = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/documents`,
      headers: authHeader(user.token),
      payload: validBody({ sourceSeq: 17, segmentIndex: 2 }),
    });
    const id = (JSON.parse(created.body) as { document: { id: string } }).document.id;

    const res = await app.inject({ method: "GET", url: `/documents/${id}` });
    expect(res.statusCode).toBe(200);
    const { document } = JSON.parse(res.body) as {
      document: {
        body: string;
        segmentIndex: number;
        sourceSeq: number;
        postTitle: string;
        authorUsername: string;
      };
    };
    expect(document.body).toContain("# Code Agent 사용 가이드");
    expect(document.segmentIndex).toBe(2);
    expect(document.sourceSeq).toBe(17);
    expect(document.postTitle).toBe("Code Agent 잘 쓰는 법");
    expect(document.authorUsername).toBe(user.username);
  });

  it("404s an unknown document id", async () => {
    const res = await app.inject({ method: "GET", url: "/documents/nope" });
    expect(res.statusCode).toBe(404);
  });

  // --- lifecycle -----------------------------------------------------------

  it("deleting the post removes its documents", async () => {
    const { user, post } = await seed();
    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/documents`,
      headers: authHeader(user.token),
      payload: validBody(),
    });
    expect(await prisma.document.count()).toBe(1);

    const del = await app.inject({
      method: "DELETE",
      url: `/posts/${post.id}`,
      headers: authHeader(user.token),
    });
    expect(del.statusCode).toBe(200);
    expect(await prisma.document.count()).toBe(0);
  });

  // --- rate limit (XC-9) ---------------------------------------------------

  it("rate-limits condensation to 3 per identity per 5 minutes", async () => {
    const { user, post } = await seed();
    for (let i = 0; i < 3; i += 1) {
      const ok = await app.inject({
        method: "POST",
        url: `/posts/${post.id}/documents`,
        headers: authHeader(user.token),
        payload: validBody({ sourceSeq: i + 1 }),
      });
      expect(ok.statusCode).toBe(201);
    }

    const limited = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/documents`,
      headers: authHeader(user.token),
      payload: validBody({ sourceSeq: 99 }),
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(await prisma.document.count()).toBe(3);
  });
});
