import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

// WP XC-9 — Rate limiting (in-memory, single instance per L10).
//
// Per-identity limits keyed on x-user-id (falling back to the socket IP when the
// header is absent). Two conservative PoC policies:
//   - POST /posts        : max POST_MAX posts per POST_WINDOW_MS (sliding window).
//   - POST /communities  : 1 community per COMMUNITY_COOLDOWN_MS (creation cooldown).
//
// Reads, comment posting, upvotes, and the realtime stream are intentionally NOT
// limited so the live demo stays smooth. Server stays KEY-BLIND (no apiKey here).
// On breach we return 429 with a clear message and a Retry-After header.

const POST_WINDOW_MS = 60_000; // 1 minute
const POST_MAX = 10; // up to 10 posts/min/identity
const COMMUNITY_COOLDOWN_MS = 180_000; // 1 community / 3 minutes/identity
const UPLOAD_WINDOW_MS = 60_000; // 1 minute
const UPLOAD_MAX = 20; // up to 20 uploads/min/identity (only disk-write endpoint)

// Sliding-window timestamps for post creation, per identity.
const postTimestamps = new Map<string, number[]>();
// Sliding-window timestamps for image uploads, per identity.
const uploadTimestamps = new Map<string, number[]>();
// Last community-creation instant, per identity.
const lastCommunityAt = new Map<string, number>();

function identity(req: FastifyRequest): string {
  // Prefer the JWT sub (Bearer token) for per-user rate-limiting; fall back to
  // IP when unauthenticated. We extract sub without full verification here
  // (rate-limit keying only, not an auth decision) — a forgery just hits the
  // attacker's own bucket.
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token.length > 0) {
      try {
        const payload = req.server.jwt.verify<{ sub?: string }>(token);
        if (payload.sub) return `u:${payload.sub}`;
      } catch {
        // invalid token — fall through to IP
      }
    }
  }
  return `ip:${req.ip}`;
}

// Wrapped with fastify-plugin so the onRequest hook is NOT encapsulated and runs
// for EVERY request (the sibling route plugins where /posts and /communities are
// defined). Without fp(), register() scopes the hook to this plugin's context
// only, so the gate never sees POST /posts or POST /communities and never 429s.
const rateLimitImpl: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (req, reply) => {
    const isPost = req.method === "POST";
    if (!isPost) return;

    // routerPath is the matched route template ("/posts", "/communities").
    const routePath = req.routeOptions?.url ?? req.url;
    const id = identity(req);
    const now = Date.now();

    if (routePath === "/posts") {
      const arr = (postTimestamps.get(id) ?? []).filter(
        (t) => now - t < POST_WINDOW_MS,
      );
      if (arr.length >= POST_MAX) {
        const oldest = arr[0]!;
        const retryMs = POST_WINDOW_MS - (now - oldest);
        void reply.header("Retry-After", Math.ceil(retryMs / 1000));
        return reply.code(429).send({
          error: `Rate limit: at most ${POST_MAX} posts per minute. Try again shortly.`,
        });
      }
      arr.push(now);
      postTimestamps.set(id, arr);
      return;
    }

    if (routePath === "/uploads") {
      const arr = (uploadTimestamps.get(id) ?? []).filter(
        (t) => now - t < UPLOAD_WINDOW_MS,
      );
      if (arr.length >= UPLOAD_MAX) {
        const oldest = arr[0]!;
        const retryMs = UPLOAD_WINDOW_MS - (now - oldest);
        void reply.header("Retry-After", Math.ceil(retryMs / 1000));
        return reply.code(429).send({
          error: "Rate limit: too many uploads. Try again shortly.",
        });
      }
      arr.push(now);
      uploadTimestamps.set(id, arr);
      return;
    }

    if (routePath === "/communities") {
      const last = lastCommunityAt.get(id);
      if (last !== undefined && now - last < COMMUNITY_COOLDOWN_MS) {
        const retryMs = COMMUNITY_COOLDOWN_MS - (now - last);
        void reply.header("Retry-After", Math.ceil(retryMs / 1000));
        return reply.code(429).send({
          error: `Rate limit: one community every ${Math.round(
            COMMUNITY_COOLDOWN_MS / 60_000,
          )} minutes. Try again shortly.`,
        });
      }
      // Record optimistically on the gate; a downstream validation failure still
      // consumes the cooldown slot, which is acceptable for a PoC.
      lastCommunityAt.set(id, now);
      return;
    }
  });
};

const plugin = fp(rateLimitImpl, { name: "rate-limit" });

export default plugin;
