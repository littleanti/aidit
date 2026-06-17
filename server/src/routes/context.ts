// WP BE-12 — GET /posts/:id/context.
//
// Read-only context endpoint. Returns the active segment's conversation turns so
// the browser can make a direct BYOK Gemini call (M3). The server stays
// KEY-BLIND (L1): no apiKey is accepted or returned. No auth is required —
// reading thread context exposes nothing key-related.

import type { FastifyPluginAsync } from "fastify";

import { prisma } from "../db.js";
import {
  assembleContext,
  ERR_NO_ACTIVE_SEGMENT,
  ERR_POST_NOT_FOUND,
} from "../domain/contextAssembler.js";

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    "/posts/:id/context",
    async (req, reply) => {
      const postId = req.params.id;
      try {
        const result = await assembleContext(prisma, postId);
        return reply.send(result);
      } catch (err) {
        if (err instanceof Error && err.message === ERR_POST_NOT_FOUND) {
          return reply.code(404).send({ error: "Post not found" });
        }
        if (err instanceof Error && err.message === ERR_NO_ACTIVE_SEGMENT) {
          return reply
            .code(409)
            .send({ error: "No active context segment for post" });
        }
        throw err;
      }
    },
  );
};

export default plugin;
