// Aidit — MIT License. See LICENSE.
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";

import { config } from "./config.js";
import rateLimit from "./plugins/rateLimit.js";
import security from "./plugins/security.js";
import authRoutes from "./routes/auth.js";
import commentRoutes from "./routes/comments.js";
import communityRoutes from "./routes/communities.js";
import contextRoutes from "./routes/context.js";
import documentRoutes from "./routes/documents.js";
import metricsRoutes from "./routes/metrics.js";
import postRoutes from "./routes/posts.js";
import uploadRoutes from "./routes/uploads.js";
import streamRoutes from "./realtime/stream.js";
import { UPLOAD_DIR } from "./uploads-dir.js";

export async function build(): Promise<FastifyInstance> {
  const apiPrefix = config.apiPrefix === "/" ? "" : config.apiPrefix;

  const app = Fastify({
    logger: true,
  });

  // CORS — allow local dev origins (Vite, etc.) plus the GitHub Pages frontend
  // and any extra origins declared in WEB_ORIGIN. The server is key-blind:
  // no apiKey headers are ever read, stored, or relayed.
  //
  // Origin resolution order:
  //   1. localhost / 127.0.0.1 (any port) — always allowed for local dev.
  //   2. https://littleanti.github.io — always allowed for the Pages frontend.
  //   3. WEB_ORIGIN — optional comma-separated list of extra allowed origins
  //      (e.g. WEB_ORIGIN=https://staging.example.com,https://preview.example.com).
  const DEFAULT_ALLOWED_ORIGINS: Array<string | RegExp> = [
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/,
    // Private-LAN IPv4 over http — lets a phone on the same Wi-Fi reach the dev
    // server when the frontend runs with `vite --host` (the proxied request
    // forwards Origin: http://192.168.x.x:5173). http-only + private ranges, so
    // production https origins never match. (RFC1918: 10/8, 172.16-31/12, 192.168/16)
    /^http:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/,
    "https://littleanti.github.io",
  ];

  const extraOrigins: string[] = (process.env.WEB_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const allowedOrigins: Array<string | RegExp> = [
    ...DEFAULT_ALLOWED_ORIGINS,
    ...extraOrigins,
  ];

  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin / server-to-server requests have no Origin header.
      if (origin === undefined) {
        cb(null, true);
        return;
      }
      const allowed = allowedOrigins.some((o) =>
        o instanceof RegExp ? o.test(origin) : o === origin
      );
      // Graceful deny: a disallowed origin gets NO CORS headers (browser blocks
      // it client-side) but the request itself is not turned into a 500. Passing
      // an Error here previously made every cross-origin call fail hard.
      cb(null, allowed);
    },
    credentials: true,
  });

  // JWT plugin — must be registered before any route that calls req.jwtVerify().
  await app.register(fastifyJwt, { secret: config.jwtSecret });

  // Cross-cutting plugins (register BEFORE routes so their global hooks apply to
  // every response/request): XC-3 security headers (CSP) + XC-9 rate limiting.
  await app.register(security);
  await app.register(rateLimit);

  // Ensure the upload directory exists before registering static serving so the
  // first GET /uploads/<name> never races a missing dir. Same path in dev/prod.
  mkdirSync(UPLOAD_DIR, { recursive: true });

  // Multipart parsing for POST /uploads (single file, 5MB cap). Register BEFORE
  // the upload route so req.file() is available. Server stays key-blind.
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  // Serve stored images at /uploads/<name> (or /api/uploads/<name> when
  // API_PREFIX=/api). decorateReply:false avoids clobbering reply.sendFile used
  // elsewhere (none today, future-safe).
  await app.register(fastifyStatic, {
    root: UPLOAD_DIR,
    prefix: apiPrefix ? `${apiPrefix}/uploads/` : "/uploads/",
    decorateReply: false,
  });

  // Health check.
  app.get(`${apiPrefix}/health`, async () => ({ status: "ok" }));

  // Feature route plugins. Each default-exports a FastifyPluginAsync.
  await app.register(authRoutes, { prefix: config.apiPrefix });
  await app.register(communityRoutes, { prefix: config.apiPrefix });
  await app.register(postRoutes, { prefix: config.apiPrefix });
  await app.register(commentRoutes, { prefix: config.apiPrefix });
  await app.register(contextRoutes, { prefix: config.apiPrefix });
  await app.register(documentRoutes, { prefix: config.apiPrefix });
  await app.register(metricsRoutes, { prefix: config.apiPrefix });
  await app.register(uploadRoutes, { prefix: config.apiPrefix });
  await app.register(streamRoutes, { prefix: config.apiPrefix });

  return app;
}

async function start(): Promise<void> {
  const app = await build();
  try {
    // Bind host is configurable via HOST (default 0.0.0.0). Set HOST=127.0.0.1
    // to keep the API reachable only from the local machine (e.g. behind the
    // frontend dev proxy) and NOT exposed on the LAN.
    await app.listen({ port: config.port, host: process.env.HOST ?? "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Run when executed directly (tsx/node app.ts). Under ESM there is no `require`,
// so compare the resolved module URL against the invoked script path.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  void start();
}
