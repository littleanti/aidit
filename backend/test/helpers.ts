// WP XC-T (backend) — shared test helpers.
//
// Builds the real Fastify app (src/app.ts → build()) and exercises it via
// app.inject. No network, no LLM. The DATABASE_URL is pinned to the fresh test
// DB by vitest.config.ts env, so importing src/db.ts here connects there.

import type { FastifyInstance } from "fastify";

import { build } from "../src/app.js";
import { prisma } from "../src/db.js";

export { prisma };

export async function makeApp(): Promise<FastifyInstance> {
  const app = await build();
  await app.ready();
  return app;
}

// Wipe all rows between tests so suites are independent (order matters for FKs).
export async function resetDb(): Promise<void> {
  await prisma.vote.deleteMany();
  await prisma.bookmark.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.contextSegment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.community.deleteMany();
  await prisma.visitEvent.deleteMany();
  await prisma.user.deleteMany();
}

let counter = 0;
function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

// Register a real user via POST /auth/register and return { id, username, token }.
// The password is fixed to "password123" (satisfies min-length 8).
export async function createUser(
  app: FastifyInstance,
  username?: string,
): Promise<{ id: string; username: string; token: string }> {
  const name = username ?? uniq("user");
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { username: name, password: "password123" },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createUser failed: ${res.statusCode} ${res.body}`);
  }
  const body = JSON.parse(res.body) as { id: string; username: string; token: string };
  return body;
}

// Return an Authorization header object for the given token.
export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export async function createCommunity(creatorId: string): Promise<{
  id: string;
  slug: string;
}> {
  const c = await prisma.community.create({
    data: {
      slug: uniq("c"),
      name: "Test Community",
      personaPrompt: "You are a helpful persona.",
      creatorId,
    },
    select: { id: true, slug: true },
  });
  return c;
}

// Create a post + its seg#0 directly via the route so the real BE-5 path runs.
export async function createPostViaApi(
  app: FastifyInstance,
  token: string,
  communityId: string,
  overrides?: { title?: string; body?: string },
): Promise<{ id: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/posts",
    headers: authHeader(token),
    payload: {
      communityId,
      title: overrides?.title ?? "Test Post",
      body: overrides?.body ?? "Original post body.",
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createPostViaApi failed: ${res.statusCode} ${res.body}`);
  }
  return JSON.parse(res.body) as { id: string };
}
