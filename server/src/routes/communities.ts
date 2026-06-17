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

    try {
      const community = await prisma.community.create({
        data: {
          name: body.name.trim(),
          slug: body.slug.trim(),
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
        return reply.code(409).send({ error: "slug already exists" });
      }
      throw err;
    }
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
