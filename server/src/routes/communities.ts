import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";

import { prisma } from "../db.js";

// WP BE-4 — Community routes.
// Server is KEY-BLIND (PLAN L1): no apiKey is ever read, stored, or relayed here.
// Acting user is identified by the `x-user-id` header = persisted User.id (L11).

interface CreateCommunityBody {
  name?: unknown;
  slug?: unknown;
  description?: unknown;
  personaPrompt?: unknown;
  personaIcon?: unknown;
}

interface PatchCommunityBody {
  name?: unknown;
  description?: unknown;
  personaPrompt?: unknown;
  personaIcon?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string";
}

// Resolve and validate the acting user from the `x-user-id` header.
// Returns the user id on success, or null after replying with the right error.
async function resolveActingUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const raw = req.headers["x-user-id"];
  const userId = Array.isArray(raw) ? raw[0] : raw;

  if (!userId || userId.trim().length === 0) {
    await reply.code(401).send({ error: "Missing x-user-id header" });
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    await reply.code(401).send({ error: "Unknown user" });
    return null;
  }

  return user.id;
}

const plugin: FastifyPluginAsync = async (app) => {
  // GET /communities?q= — partial, case-insensitive match on name OR slug OR description.
  app.get("/communities", async (req) => {
    const q = (req.query as { q?: unknown } | undefined)?.q;
    const term = typeof q === "string" ? q.trim() : "";

    // SQLite is case-insensitive for ASCII by default; `contains` performs a LIKE.
    const where: Prisma.CommunityWhereInput = term
      ? {
          OR: [
            { name: { contains: term } },
            { slug: { contains: term } },
            { description: { contains: term } },
          ],
        }
      : {};

    const communities = await prisma.community.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { posts: true } } },
    });

    return communities.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      personaPrompt: c.personaPrompt,
      personaIcon: c.personaIcon,
      creatorId: c.creatorId,
      createdAt: c.createdAt,
      postCount: c._count.posts,
    }));
  });

  // GET /users/:id/communities — communities created by a user, newest first.
  // Public profile view, read-only. Mirrors the GET /communities item shape.
  app.get("/users/:id/communities", async (req) => {
    const { id } = req.params as { id: string };

    const communities = await prisma.community.findMany({
      where: { creatorId: id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { posts: true } } },
    });

    return communities.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      personaPrompt: c.personaPrompt,
      personaIcon: c.personaIcon,
      creatorId: c.creatorId,
      createdAt: c.createdAt,
      postCount: c._count.posts,
    }));
  });

  // POST /communities — create a community. Acting user becomes the creator.
  app.post("/communities", async (req, reply) => {
    const creatorId = await resolveActingUser(req, reply);
    if (creatorId === null) return;

    const body = (req.body ?? {}) as CreateCommunityBody;

    if (!isNonEmptyString(body.name)) {
      return reply.code(400).send({ error: "name is required" });
    }
    if (!isNonEmptyString(body.slug)) {
      return reply.code(400).send({ error: "slug is required" });
    }
    if (!isNonEmptyString(body.personaPrompt)) {
      return reply.code(400).send({ error: "personaPrompt is required" });
    }
    if (!isOptionalString(body.description)) {
      return reply.code(400).send({ error: "description must be a string" });
    }
    if (!isOptionalString(body.personaIcon)) {
      return reply.code(400).send({ error: "personaIcon must be a string" });
    }

    const trimmedName = body.name.trim();
    const trimmedSlug = body.slug.trim();

    // Name-uniqueness is enforced here at the route level (the Prisma schema
    // keeps `name` non-unique; only `slug` has a DB unique index). SQLite's
    // default LIKE is case-insensitive for ASCII, so a `contains` match on the
    // full name plus a case-insensitive exact compare catches both the Korean
    // (no-case) exact match and common ASCII casing variants.
    const sameName = await prisma.community.findFirst({
      where: { name: { contains: trimmedName } },
    });
    if (
      sameName &&
      sameName.name.trim().toLowerCase() === trimmedName.toLowerCase()
    ) {
      return reply
        .code(409)
        .send({ error: "이미 있는 커뮤니티 이름이에요", code: "DUPLICATE_NAME" });
    }

    try {
      const community = await prisma.community.create({
        data: {
          name: trimmedName,
          slug: trimmedSlug,
          description: body.description ?? null,
          personaPrompt: body.personaPrompt,
          personaIcon: body.personaIcon ?? null,
          creatorId,
        },
      });
      return reply.code(201).send(community);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // P2002 backstops the slug unique index (also guards a name race that
        // slipped past the findFirst check above, if a name unique index is
        // ever added). The target tells us which field collided.
        const target = err.meta?.target;
        const onName = Array.isArray(target)
          ? target.includes("name")
          : typeof target === "string" && target.includes("name");
        if (onName) {
          return reply
            .code(409)
            .send({ error: "이미 있는 커뮤니티 이름이에요", code: "DUPLICATE_NAME" });
        }
        return reply
          .code(409)
          .send({ error: "이미 있는 주소(slug)예요", code: "DUPLICATE_SLUG" });
      }
      throw err;
    }
  });

  // GET /communities/:slug — resolve a SINGLE community by its EXACT slug.
  // Mirrors the GET /communities list item shape (incl. postCount). This is
  // the canonical detail lookup; the UI no longer abuses the partial search.
  // Distinct path from GET /communities/:slug/posts, so no route conflict.
  app.get("/communities/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };

    const c = await prisma.community.findUnique({
      where: { slug },
      include: { _count: { select: { posts: true } } },
    });
    if (!c) {
      return reply.code(404).send({ error: "커뮤니티를 찾을 수 없어요" });
    }

    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      personaPrompt: c.personaPrompt,
      personaIcon: c.personaIcon,
      creatorId: c.creatorId,
      createdAt: c.createdAt,
      postCount: c._count.posts,
    };
  });

  // PATCH /communities/:id — only the creator may edit.
  app.patch("/communities/:id", async (req, reply) => {
    const actingUserId = await resolveActingUser(req, reply);
    if (actingUserId === null) return;

    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as PatchCommunityBody;

    const existing = await prisma.community.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Community not found" });
    }
    if (existing.creatorId !== actingUserId) {
      return reply.code(403).send({ error: "Only the creator may edit" });
    }

    const data: Prisma.CommunityUpdateInput = {};

    if (body.name !== undefined) {
      if (!isNonEmptyString(body.name)) {
        return reply.code(400).send({ error: "name must be a non-empty string" });
      }
      data.name = body.name.trim();
    }
    if (body.personaPrompt !== undefined) {
      if (!isNonEmptyString(body.personaPrompt)) {
        return reply
          .code(400)
          .send({ error: "personaPrompt must be a non-empty string" });
      }
      data.personaPrompt = body.personaPrompt;
    }
    if (body.description !== undefined) {
      if (!isOptionalString(body.description)) {
        return reply.code(400).send({ error: "description must be a string" });
      }
      data.description = body.description;
    }
    if (body.personaIcon !== undefined) {
      if (!isOptionalString(body.personaIcon)) {
        return reply.code(400).send({ error: "personaIcon must be a string" });
      }
      data.personaIcon = body.personaIcon;
    }

    const updated = await prisma.community.update({ where: { id }, data });
    return updated;
  });
};

export default plugin;
