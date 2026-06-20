// Profile activity pagination — keyset/cursor pagination for the three profile
// endpoints, mirroring the feed pattern: first page size, nextCursor present
// when more, second page continues, end-of-list nextCursor null, invalid 400.
//
// Covers:
//   GET /users/:id/posts        (anchor: post.createdAt + post.id)
//   GET /users/:id/bookmarks    (anchor: BOOKMARK row createdAt + id)
//   GET /users/:id/communities  (anchor: community.createdAt + community.id)

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import {
  authHeader,
  createCommunity,
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

const PAGE = 20;

// Helper: collect all ids from a paginated endpoint by walking nextCursor.
async function walkAll(url: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  // Guard against infinite loops in case of a bug.
  for (let i = 0; i < 100; i += 1) {
    const full: string = cursor
      ? `${url}${url.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`
      : url;
    const res = await app.inject({ method: "GET", url: full });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    for (const item of body.items) ids.push(item.id);
    if (!body.nextCursor) break;
    cursor = body.nextCursor;
  }
  return ids;
}

// ---------------------------------------------------------------------------
// GET /users/:id/posts
// ---------------------------------------------------------------------------

describe("GET /users/:id/posts pagination", () => {
  it("first page is capped at PAGE size with nextCursor; second page continues; end null", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);

    // 25 posts -> 2 pages (20 + 5). Distinct createdAt so the keyset is total.
    const total = 25;
    const created: string[] = [];
    for (let i = 0; i < total; i += 1) {
      const p = await prisma.post.create({
        data: {
          communityId: community.id,
          authorId: user.id,
          title: `post-${i}`,
          body: "b",
          createdAt: new Date(Date.now() + i * 1000),
        },
        select: { id: true },
      });
      created.push(p.id);
    }

    const first = await app.inject({
      method: "GET",
      url: `/users/${user.id}/posts`,
    });
    expect(first.statusCode).toBe(200);
    const firstBody = JSON.parse(first.body);
    expect(firstBody.items).toHaveLength(PAGE);
    expect(firstBody.nextCursor).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/users/${user.id}/posts?cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    });
    expect(second.statusCode).toBe(200);
    const secondBody = JSON.parse(second.body);
    expect(secondBody.items).toHaveLength(total - PAGE);
    expect(secondBody.nextCursor).toBeNull();

    // No overlap, covers all posts, newest-first ordering across pages.
    const all = [
      ...firstBody.items.map((i: { id: string }) => i.id),
      ...secondBody.items.map((i: { id: string }) => i.id),
    ];
    expect(new Set(all).size).toBe(total);
    // Newest created (last) should be first.
    expect(all[0]).toBe(created[total - 1]);
    expect(all[total - 1]).toBe(created[0]);
  });

  it("single short page -> nextCursor null", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    await prisma.post.create({
      data: { communityId: community.id, authorId: user.id, title: "t", body: "b" },
    });

    const res = await app.inject({ method: "GET", url: `/users/${user.id}/posts` });
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
  });

  it("invalid cursor -> 400", async () => {
    const user = await createUser(app);
    const res = await app.inject({
      method: "GET",
      url: `/users/${user.id}/posts?cursor=%%%not-base64%%%`,
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /users/:id/bookmarks  (anchor = BOOKMARK row, not post.createdAt)
// ---------------------------------------------------------------------------

describe("GET /users/:id/bookmarks pagination", () => {
  it("orders by bookmark createdAt (not post createdAt) and paginates over bookmark rows", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);

    const total = 25;
    // Create posts with INCREASING createdAt, then bookmark them in REVERSE
    // order with DECREASING bookmark createdAt. If pagination anchored on
    // post.createdAt the order would be wrong; it must follow the bookmark row.
    const postIds: string[] = [];
    for (let i = 0; i < total; i += 1) {
      const p = await prisma.post.create({
        data: {
          communityId: community.id,
          authorId: user.id,
          title: `post-${i}`,
          body: "b",
          createdAt: new Date(Date.now() + i * 1000),
        },
        select: { id: true },
      });
      postIds.push(p.id);
    }
    // Bookmark in post order, but assign bookmark.createdAt so the FIRST post
    // bookmarked is the MOST recent bookmark (reverse of post order).
    for (let i = 0; i < total; i += 1) {
      await prisma.bookmark.create({
        data: {
          userId: user.id,
          postId: postIds[i]!,
          createdAt: new Date(Date.now() + (total - i) * 1000),
        },
      });
    }
    // Expected order (most recent bookmark first) = postIds[0], postIds[1], ...
    const expectedOrder = [...postIds];

    const ids = await walkAll(`/users/${user.id}/bookmarks`);
    expect(ids).toHaveLength(total);
    expect(ids).toEqual(expectedOrder);
  });

  it("first page size + nextCursor present, second page continues, end null", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const total = 25;
    for (let i = 0; i < total; i += 1) {
      const p = await prisma.post.create({
        data: { communityId: community.id, authorId: user.id, title: `p${i}`, body: "b" },
        select: { id: true },
      });
      await prisma.bookmark.create({
        data: {
          userId: user.id,
          postId: p.id,
          createdAt: new Date(Date.now() + i * 1000),
        },
      });
    }

    const first = await app.inject({
      method: "GET",
      url: `/users/${user.id}/bookmarks`,
    });
    const firstBody = JSON.parse(first.body);
    expect(firstBody.items).toHaveLength(PAGE);
    expect(firstBody.nextCursor).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/users/${user.id}/bookmarks?cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    });
    const secondBody = JSON.parse(second.body);
    expect(secondBody.items).toHaveLength(total - PAGE);
    expect(secondBody.nextCursor).toBeNull();

    const all = [
      ...firstBody.items.map((i: { id: string }) => i.id),
      ...secondBody.items.map((i: { id: string }) => i.id),
    ];
    expect(new Set(all).size).toBe(total);
  });

  it("invalid cursor -> 400", async () => {
    const user = await createUser(app);
    const res = await app.inject({
      method: "GET",
      url: `/users/${user.id}/bookmarks?cursor=not a valid cursor`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("reflects voted per card when authed", async () => {
    const user = await createUser(app);
    const community = await createCommunity(user.id);
    const p = await prisma.post.create({
      data: { communityId: community.id, authorId: user.id, title: "p", body: "b" },
      select: { id: true },
    });
    await prisma.bookmark.create({ data: { userId: user.id, postId: p.id } });
    await app.inject({
      method: "POST",
      url: `/posts/${p.id}/upvote`,
      headers: authHeader(user.token),
    });

    const res = await app.inject({
      method: "GET",
      url: `/users/${user.id}/bookmarks`,
      headers: authHeader(user.token),
    });
    const body = JSON.parse(res.body);
    expect(body.items[0].voted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /users/:id/communities
// ---------------------------------------------------------------------------

describe("GET /users/:id/communities pagination", () => {
  it("first page size + nextCursor, second page continues, end null, newest-first", async () => {
    const user = await createUser(app);
    const total = 25;
    const created: string[] = [];
    for (let i = 0; i < total; i += 1) {
      const c = await prisma.community.create({
        data: {
          slug: `slug-${i}-${Date.now()}`,
          name: `c-${i}`,
          personaPrompt: "p",
          creatorId: user.id,
          createdAt: new Date(Date.now() + i * 1000),
        },
        select: { id: true },
      });
      created.push(c.id);
    }

    const first = await app.inject({
      method: "GET",
      url: `/users/${user.id}/communities`,
    });
    expect(first.statusCode).toBe(200);
    const firstBody = JSON.parse(first.body);
    expect(firstBody.items).toHaveLength(PAGE);
    expect(firstBody.nextCursor).toBeTruthy();
    // Item shape preserved.
    expect(firstBody.items[0]).toHaveProperty("slug");
    expect(firstBody.items[0]).toHaveProperty("postCount");

    const second = await app.inject({
      method: "GET",
      url: `/users/${user.id}/communities?cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    });
    const secondBody = JSON.parse(second.body);
    expect(secondBody.items).toHaveLength(total - PAGE);
    expect(secondBody.nextCursor).toBeNull();

    const all = [
      ...firstBody.items.map((i: { id: string }) => i.id),
      ...secondBody.items.map((i: { id: string }) => i.id),
    ];
    expect(new Set(all).size).toBe(total);
    expect(all[0]).toBe(created[total - 1]); // newest first
  });

  it("single short page -> nextCursor null", async () => {
    const user = await createUser(app);
    await createCommunity(user.id);
    const res = await app.inject({
      method: "GET",
      url: `/users/${user.id}/communities`,
    });
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
  });

  it("invalid cursor -> 400", async () => {
    const user = await createUser(app);
    const res = await app.inject({
      method: "GET",
      url: `/users/${user.id}/communities?cursor=@@@`,
    });
    expect(res.statusCode).toBe(400);
  });
});
