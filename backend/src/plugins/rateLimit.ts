import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { rateLimitStore } from "../store/rateLimitStore.js";

// WP XC-9 — Rate limiting.
//
// This file owns the POLICY (which route, how many, per how long). WHERE the
// counters live is the store's job (store/rateLimitStore.ts): process-local by
// default, shared over Redis when REDIS_URL is set, so limits stay per-identity
// rather than per-identity-per-instance when the app is scaled out (§15.3).
//
// Reads, comment posting, upvotes, and the realtime stream are intentionally NOT
// limited so the live demo stays smooth. Server stays KEY-BLIND (no apiKey here).
// On breach we return 429 with a clear message and a Retry-After header.

interface Policy {
  windowMs: number;
  max: number;
  /** 429 body message. */
  message: string;
}

// Route template (req.routeOptions.url) -> policy.
const POLICIES: Record<string, Policy> = {
  "/posts": {
    windowMs: 60_000,
    max: 10,
    message: "Rate limit: at most 10 posts per minute. Try again shortly.",
  },
  "/uploads": {
    windowMs: 60_000,
    max: 20,
    message: "Rate limit: too many uploads. Try again shortly.",
  },
  // FR-13: document condensation burns a whole context window on the caller's
  // own key and writes up to 200K chars — the heaviest user-triggered action.
  "/posts/:id/documents": {
    windowMs: 300_000,
    max: 3,
    message: "Rate limit: at most 3 documents per 5 minutes. Try again shortly.",
  },
  // TRD §16: the event sink is unauthenticated, so it needs a bound. The limit is
  // generous because a single user action can emit several events (e.g. @AI ->
  // ai_reply_invoked + llm_success), and losing counts to a 429 would quietly bias
  // the very rates we compute from them.
  "/metrics/events": {
    windowMs: 60_000,
    max: 120,
    message: "Rate limit: too many metrics events. Try again shortly.",
  },
  // Community creation is a cooldown, i.e. a window of one.
  "/communities": {
    windowMs: 180_000,
    max: 1,
    message: "Rate limit: one community every 3 minutes. Try again shortly.",
  },
};

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
        // fall through to IP keying
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
    if (req.method !== "POST") return;

    // routerPath is the matched route template ("/posts", "/communities").
    const routePath = req.routeOptions?.url ?? req.url;
    const policy = POLICIES[routePath];
    if (!policy) return;

    // Recorded on the gate (onRequest), so a malformed request also consumes a
    // slot. Accepted tradeoff: the client only POSTs a document after its own
    // LLM call succeeded, and posts/uploads validate cheaply.
    const decision = await rateLimitStore.hit(
      `${routePath}|${identity(req)}`,
      policy.windowMs,
      policy.max,
    );

    if (!decision.allowed) {
      void reply.header("Retry-After", Math.ceil(decision.retryAfterMs / 1000));
      return reply.code(429).send({ error: policy.message });
    }
  });
};

const plugin = fp(rateLimitImpl, { name: "rate-limit" });

export default plugin;
