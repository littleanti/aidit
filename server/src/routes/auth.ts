import type { FastifyPluginAsync } from "fastify";
import bcrypt from "bcryptjs";

import { prisma } from "../db.js";
import { config } from "../config.js";

// Auth routes — POST /auth/register and POST /auth/session.
// Server is KEY-BLIND (PLAN L1): no apiKey is ever accepted, stored, or echoed.
// Identity is established via a server-signed JWT (Authorization: Bearer <token>).

const USERNAME_MAX = 32;
const USERNAME_MIN = 1;
const PASSWORD_MIN = 8;
const BCRYPT_ROUNDS = 10;

interface RegisterBody {
  username?: unknown;
  password?: unknown;
}

interface SessionBody {
  username?: unknown;
  password?: unknown;
}

const plugin: FastifyPluginAsync = async (app) => {
  // POST /auth/register — create a new user with a hashed password.
  // Returns 201 { token, id, username } on success.
  // Returns 409 if username already exists.
  // Returns 400 if username or password validation fails.
  app.post("/auth/register", async (request, reply) => {
    const body = (request.body ?? {}) as RegisterBody;

    if (typeof body.username !== "string") {
      return reply
        .code(400)
        .send({ error: "username is required and must be a string" });
    }
    if (typeof body.password !== "string") {
      return reply
        .code(400)
        .send({ error: "password is required and must be a string" });
    }

    const username = body.username.trim();
    const password = body.password;

    if (username.length < USERNAME_MIN) {
      return reply.code(400).send({ error: "username must not be empty" });
    }
    if (username.length > USERNAME_MAX) {
      return reply
        .code(400)
        .send({ error: `username must be at most ${USERNAME_MAX} characters` });
    }
    if (password.length < PASSWORD_MIN) {
      return reply
        .code(400)
        .send({ error: `password must be at least ${PASSWORD_MIN} characters` });
    }

    // Check for duplicate username.
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return reply.code(409).send({ error: "Username already taken" });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: { username, passwordHash },
      select: { id: true, username: true },
    });

    const token = app.jwt.sign(
      { sub: user.id },
      { expiresIn: config.jwtExpires },
    );

    return reply.code(201).send({ token, id: user.id, username: user.username });
  });

  // POST /auth/session — authenticate with username + password, return a JWT.
  // Returns 200 { token, id, username } on success.
  // Returns 401 on unknown user, wrong password, or legacy passwordless rows.
  app.post("/auth/session", async (request, reply) => {
    const body = (request.body ?? {}) as SessionBody;

    if (typeof body.username !== "string") {
      return reply
        .code(400)
        .send({ error: "username is required and must be a string" });
    }
    if (typeof body.password !== "string") {
      return reply
        .code(400)
        .send({ error: "password is required and must be a string" });
    }

    const username = body.username.trim();
    const password = body.password;

    const user = await prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, passwordHash: true },
    });

    // Unknown user, no passwordHash (legacy row), or wrong password all return
    // the same 401 to avoid username enumeration.
    if (!user || !user.passwordHash) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const token = app.jwt.sign(
      { sub: user.id },
      { expiresIn: config.jwtExpires },
    );

    return reply.code(200).send({ token, id: user.id, username: user.username });
  });
};

export default plugin;
