// WP XC-9 (§15.3) — rate-limit storage adapter.
//
// The policies (how many, per how long) live in plugins/rateLimit.ts; WHERE the
// counters live is decided here:
//
//   InMemoryRateLimitStore — process-local. Correct for ONE instance.
//   RedisRateLimitStore    — shared across instances (REDIS_URL set).
//
// ---------------------------------------------------------------------------
// WHY A FIXED WINDOW (and not the sliding window this replaced)
//
// The first cut kept per-hit timestamps and counted the ones inside the window
// (a sliding window). In Redis that means READ-then-ACT: trim, count, decide,
// then add. Concurrent requests all read the pre-add count and ALL pass — a test
// with three simultaneous hits against a limit of two let all three through.
// A limiter that silently over-permits under exactly the burst it exists to stop
// is worse than a coarser one.
//
// So both backends now use a FIXED window counter, whose Redis form (INCR) is
// atomic by construction and therefore can never over-permit. The tradeoff is
// the well-known one: a client can send up to `max` at the end of one window and
// `max` again at the start of the next, i.e. up to 2x across a boundary. For
// these policies (10 posts/min, 3 documents/5min …) that is acceptable; silently
// exceeding the limit under concurrency was not.
//
// Both backends implement the SAME semantics on purpose: an environment-dependent
// limit ("why does it only 429 in production?") is a bug report waiting to
// happen.
// ---------------------------------------------------------------------------

import { config } from "../config.js";
import { RedisCommandClient } from "../redis/client.js";
import { parseRedisUrl } from "../redis/resp.js";

export interface RateLimitDecision {
  allowed: boolean;
  /** When denied: how long until the current window resets. */
  retryAfterMs: number;
}

export interface RateLimitStore {
  /** Count an attempt against `key` and decide whether it is allowed. */
  hit(key: string, windowMs: number, max: number): Promise<RateLimitDecision>;
  close(): void;
}

const ALLOWED: RateLimitDecision = { allowed: true, retryAfterMs: 0 };

// ---------------------------------------------------------------------------
// In-memory (default)
// ---------------------------------------------------------------------------

interface Window {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, Window>();

  async hit(
    key: string,
    windowMs: number,
    max: number,
  ): Promise<RateLimitDecision> {
    const now = Date.now();
    const current = this.windows.get(key);

    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return ALLOWED;
    }

    current.count += 1;
    if (current.count > max) {
      return { allowed: false, retryAfterMs: current.resetAt - now };
    }
    return ALLOWED;
  }

  close(): void {
    this.windows.clear();
  }
}

// ---------------------------------------------------------------------------
// Redis (shared) — atomic fixed window: INCR + a TTL set on the first hit.
// ---------------------------------------------------------------------------

export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly client: RedisCommandClient,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  async hit(
    key: string,
    windowMs: number,
    max: number,
  ): Promise<RateLimitDecision> {
    const redisKey = `aidit:rl:${key}`;

    try {
      // INCR is atomic, so every concurrent request gets a DISTINCT count and
      // the (count > max) verdict can never over-permit.
      const countReply = await this.client.command("INCR", redisKey);
      const count = typeof countReply === "number" ? countReply : 1;

      if (count === 1) {
        // First hit of this window opens it. Expiry is set ONLY here: doing it on
        // every hit would keep pushing the reset out, so a client sending
        // continuously would never get a fresh window.
        await this.client.command("PEXPIRE", redisKey, String(windowMs));
      }

      if (count > max) {
        const ttlReply = await this.client.command("PTTL", redisKey);
        const ttl = typeof ttlReply === "number" ? ttlReply : -1;
        if (ttl < 0) {
          // No TTL (a lost PEXPIRE, or a key from before this code): the counter
          // would otherwise never reset. Re-arm it rather than locking the
          // identity out forever.
          await this.client.command("PEXPIRE", redisKey, String(windowMs));
          return { allowed: false, retryAfterMs: windowMs };
        }
        return { allowed: false, retryAfterMs: ttl };
      }

      return ALLOWED;
    } catch (err) {
      // FAIL OPEN. Rate limiting is a secondary defence; turning a Redis blip
      // into a site-wide 429 storm is a worse outcome than briefly unmetered
      // writes. Auth and validation still apply to every request.
      this.log(
        `[ratelimit] redis unavailable, allowing request: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return ALLOWED;
    }
  }

  close(): void {
    this.client.close();
  }
}

// ---------------------------------------------------------------------------
// Selection — mirrors createPubSub(): REDIS_URL decides, callers never branch.
// ---------------------------------------------------------------------------

export function createRateLimitStore(
  redisUrl: string | null = config.redisUrl,
  log: (msg: string) => void = (msg) => console.log(msg),
): RateLimitStore {
  if (!redisUrl) return new InMemoryRateLimitStore();

  const target = parseRedisUrl(redisUrl);
  if (!target) {
    log(
      "[ratelimit] REDIS_URL is not a valid redis:// URL — using in-memory rate limiting (single instance only).",
    );
    return new InMemoryRateLimitStore();
  }

  log(
    `[ratelimit] using Redis at ${target.host}:${target.port} — limits are shared across instances.`,
  );
  return new RedisRateLimitStore(new RedisCommandClient(target, log), log);
}

/** Process-wide singleton, chosen once at startup. */
export const rateLimitStore: RateLimitStore = createRateLimitStore();
