import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../db.js";

// WP BE-3 — Auth route.
// Registered in app.ts under prefix '/'. Server is KEY-BLIND (PLAN L1):
// this route NEVER accepts, reads, or stores any API key.

const USERNAME_MAX = 32;
const USERNAME_MIN = 1;

interface SessionBody {
  username?: unknown;
}

const plugin: FastifyPluginAsync = async (app) => {
  // POST /auth/session — upsert a User by unique username, return the 'me'
  // identifier (User.id, per PLAN L11). No keys involved, ever.
  app.post("/auth/session", async (request, reply) => {
    const body = (request.body ?? {}) as SessionBody;

    if (typeof body.username !== "string") {
      return reply
        .code(400)
        .send({ error: "username is required and must be a string" });
    }

    const username = body.username.trim();

    if (username.length < USERNAME_MIN) {
      return reply.code(400).send({ error: "username must not be empty" });
    }

    if (username.length > USERNAME_MAX) {
      return reply
        .code(400)
        .send({ error: `username must be at most ${USERNAME_MAX} characters` });
    }

    const user = await prisma.user.upsert({
      where: { username },
      update: {},
      create: { username },
      select: { id: true, username: true },
    });

    // L11: 'me' identifier is the persisted User.id.
    return reply.code(200).send({ id: user.id, username: user.username });
  });
};

export default plugin;
