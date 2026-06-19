import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyPluginAsync } from "fastify";

import { UPLOAD_DIR } from "../uploads-dir.js";
import { requireAuth } from "../auth.js";

// WP — Image upload route. KEY-BLIND (L1): no Gemini key is ever accepted; only
// a valid Bearer JWT is required. Stores a single image on the local
// filesystem under <serverRoot>/uploads and returns a same-origin serving URL.

// Allowed MIME types → stored file extension. The extension is derived ONLY from
// the validated MIME; the client-supplied filename is read nowhere (R-6:
// path-traversal hardening).
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const plugin: FastifyPluginAsync = async (app) => {
  app.post("/uploads", async (req, reply) => {
    // Login REQUIRED (no anonymous uploads). JWT Bearer required.
    const userId = await requireAuth(req, reply);
    if (!userId) return;

    let file: Awaited<ReturnType<typeof req.file>>;
    try {
      file = await req.file();
    } catch (err) {
      // @fastify/multipart throws on oversize when the limit is exceeded.
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE"
      ) {
        return reply.code(413).send({ error: "Image too large" });
      }
      throw err;
    }

    if (!file) {
      return reply.code(400).send({ error: "No file uploaded" });
    }

    const ext = MIME_TO_EXT[file.mimetype];
    if (!ext) {
      return reply.code(400).send({ error: "Unsupported image type" });
    }

    // Stored name = UUID + MIME-derived ext only. NEVER use file.filename.
    const name = `${crypto.randomUUID()}.${ext}`;
    const dest = path.join(UPLOAD_DIR, name);

    try {
      await pipeline(file.file, fs.createWriteStream(dest));
    } catch (err) {
      // Clean up any partial write before surfacing the error.
      fs.rm(dest, { force: true }, () => {});
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE"
      ) {
        return reply.code(413).send({ error: "Image too large" });
      }
      throw err;
    }

    // Oversize detection: the stream is truncated when the limit is hit.
    if (file.file.truncated) {
      fs.rm(dest, { force: true }, () => {});
      return reply.code(413).send({ error: "Image too large" });
    }

    return reply.code(201).send({ imageUrl: `/uploads/${name}` });
  });
};

export default plugin;
