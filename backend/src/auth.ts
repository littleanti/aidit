// Auth helpers — extract the acting user from a Bearer JWT.
//
// requireAuth: verifies the JWT and returns userId (payload.sub), or sends 401
//   and returns null (caller must return immediately).
// optionalAuth: returns userId when a valid Bearer token is present, null
//   otherwise — never sends 401 (used for optional enrichment on public GETs).

import type { FastifyReply, FastifyRequest } from "fastify";

interface JwtPayload {
  sub: string;
}

function extractBearer(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (typeof auth !== "string") return null;
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const token = extractBearer(req);
  if (!token) {
    await reply.code(401).send({ error: "Missing or invalid Authorization header" });
    return null;
  }
  try {
    const payload = req.server.jwt.verify<JwtPayload>(token);
    if (!payload.sub) {
      await reply.code(401).send({ error: "Invalid token payload" });
      return null;
    }
    return payload.sub;
  } catch {
    await reply.code(401).send({ error: "Invalid or expired token" });
    return null;
  }
}

export async function optionalAuth(req: FastifyRequest): Promise<string | null> {
  const token = extractBearer(req);
  if (!token) return null;
  try {
    const payload = req.server.jwt.verify<JwtPayload>(token);
    return payload.sub ?? null;
  } catch {
    return null;
  }
}
