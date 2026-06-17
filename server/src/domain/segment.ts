// BE-5 — ContextSegment helpers (PLAN L5).
//
// ContextSegment is the single source of truth for summary boundaries. Exactly ONE
// segment per post has isActive=true; tokenSum is the 128K-threshold basis.
//
// seg#0 is auto-created on post creation (index 0, isActive=true). M4 extends this
// module to open new segments when a summary bubble is produced, so the helpers are
// written to accept either the PrismaClient or a transaction client.

import type { Prisma, PrismaClient, ContextSegment } from "@prisma/client";

// Accepts the singleton `prisma` or a `$transaction` callback client. We use the
// narrowest shape Prisma exposes for both so callers can pass a tx interchangeably.
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Create the initial context segment (index 0, isActive=true) for a freshly
 * created post. Call inside the same transaction as the Post insert.
 */
export function createInitialSegment(
  db: Db,
  postId: string,
): Promise<ContextSegment> {
  return db.contextSegment.create({
    data: {
      postId,
      index: 0,
      isActive: true,
      tokenSum: 0,
    },
  });
}

/**
 * Find the active segment for a post (the single isActive=true row). Returns null
 * if none exists (should not happen for a well-formed post).
 */
export function findActiveSegment(
  db: Db,
  postId: string,
): Promise<ContextSegment | null> {
  return db.contextSegment.findFirst({
    where: { postId, isActive: true },
  });
}
