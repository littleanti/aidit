import type { FastifyPluginAsync } from "fastify";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth } from "../auth.js";

// Auth routes — POST /auth/register, /auth/session, /auth/guest, /auth/refresh.
// Server is KEY-BLIND (PLAN L1): no apiKey is ever accepted, stored, or echoed.
// Identity is established via a server-signed JWT (Authorization: Bearer <token>).
//
// Runtime dual-mode: all three entry endpoints are ALWAYS active. The mode is
// chosen by the client from the login input, not by a server flag:
//   - password empty  → guest entry (POST /auth/guest, nickname only).
//   - password present → member: new username → POST /auth/register,
//                                 existing username → POST /auth/session.
// Google API key is orthogonal to the mode (never sent to the server).

const USERNAME_MAX = 32;
const USERNAME_MIN = 1;
const GUEST_USERNAME_MAX = 16;
const GUEST_ID_RETRIES = 8;
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

interface GuestBody {
  username?: unknown;
}

// Prisma unique-constraint violation code.
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
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
    if (username.includes("#")) {
      return reply.code(400).send({ error: "username must not contain #" });
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

  // POST /auth/guest — passwordless guest entry. body { username }. Server appends
  // "#" + 4 hex chars to the base nickname to form a unique stored username; the
  // #hex4 suffix guarantees uniqueness so no base-nickname reservation check is
  // needed (and a guest 'base#hex4' never collides with a member 'plain').
  // Returns 201 { token, id, username }, 400 on invalid username.
  app.post("/auth/guest", async (request, reply) => {
    const body = (request.body ?? {}) as GuestBody;

    if (typeof body.username !== "string") {
      return reply
        .code(400)
        .send({ error: "username is required and must be a string" });
    }

    const base = body.username.trim();

    if (base.length < USERNAME_MIN) {
      return reply.code(400).send({ error: "username must not be empty" });
    }
    if (base.length > GUEST_USERNAME_MAX) {
      return reply
        .code(400)
        .send({ error: `username must be at most ${GUEST_USERNAME_MAX} characters` });
    }
    if (base.includes("#")) {
      return reply.code(400).send({ error: "username must not contain #" });
    }

    // Append "#" + 4 hex chars; retry on the (rare) @unique collision.
    let user: { id: string; username: string } | null = null;
    for (let attempt = 0; attempt < GUEST_ID_RETRIES; attempt++) {
      const combined = `${base}#${randomBytes(2).toString("hex")}`;
      try {
        user = await prisma.user.create({
          data: { username: combined },
          select: { id: true, username: true },
        });
        break;
      } catch (err) {
        if (isUniqueViolation(err)) {
          continue;
        }
        throw err;
      }
    }

    if (!user) {
      return reply
        .code(409)
        .send({ error: "Could not allocate a unique guest identifier" });
    }

    const token = app.jwt.sign(
      { sub: user.id },
      { expiresIn: config.jwtExpires },
    );

    return reply.code(201).send({ token, id: user.id, username: user.username });
  });

  // POST /auth/refresh — sliding renewal (both modes). Requires a valid Bearer token.
  // Returns 200 { token } with a freshly signed token. requireAuth sends 401 on
  // a missing/invalid token; an unknown user also yields 401.
  app.post("/auth/refresh", async (request, reply) => {
    const userId = await requireAuth(request, reply);
    if (!userId) {
      return reply;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      return reply.code(401).send({ error: "Invalid or expired token" });
    }

    const token = app.jwt.sign(
      { sub: userId },
      { expiresIn: config.jwtExpires },
    );

    return reply.code(200).send({ token });
  });
};

export default plugin;
