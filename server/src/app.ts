// Aidit — MIT License. See LICENSE.
import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";

import { config } from "./config.js";
import rateLimit from "./plugins/rateLimit.js";
import security from "./plugins/security.js";
import authRoutes from "./routes/auth.js";
import commentRoutes from "./routes/comments.js";
import communityRoutes from "./routes/communities.js";
import contextRoutes from "./routes/context.js";
import metricsRoutes from "./routes/metrics.js";
import postRoutes from "./routes/posts.js";
import streamRoutes from "./realtime/stream.js";

export async function build(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
  });

  // CORS — allow local dev origins (Vite, etc.). The server is key-blind:
  // no apiKey headers are ever read, stored, or relayed.
  await app.register(cors, {
    origin: [
      /^http:\/\/localhost(:\d+)?$/,
      /^http:\/\/127\.0\.0\.1(:\d+)?$/,
    ],
    credentials: true,
  });

  // Cross-cutting plugins (register BEFORE routes so their global hooks apply to
  // every response/request): XC-3 security headers (CSP) + XC-9 rate limiting.
  await app.register(security);
  await app.register(rateLimit);

  // Health check.
  app.get("/health", async () => ({ status: "ok" }));

  // Feature route plugins. Each default-exports a FastifyPluginAsync.
  await app.register(authRoutes, { prefix: "/" });
  await app.register(communityRoutes, { prefix: "/" });
  await app.register(postRoutes, { prefix: "/" });
  await app.register(commentRoutes, { prefix: "/" });
  await app.register(contextRoutes, { prefix: "/" });
  await app.register(metricsRoutes, { prefix: "/" });
  await app.register(streamRoutes, { prefix: "/" });

  return app;
}

async function start(): Promise<void> {
  const app = await build();
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
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
