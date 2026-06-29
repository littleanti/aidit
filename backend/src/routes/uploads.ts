import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyPluginAsync } from "fastify";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

import { config } from "../config.js";
import { UPLOAD_DIR } from "../uploads-dir.js";
import { normalizeImageUrl } from "../storage/imageUrl.js";
import { requireAuth } from "../auth.js";

// WP-6 Image upload route. KEY-BLIND (L1): no LLM key is ever accepted; only
// a valid Bearer JWT is required. Can store uploads locally (default) or to S3
// when STORAGE_BACKEND=s3 is configured.

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const s3Client =
  config.storageBackend === "s3"
    ? new S3Client({
        region: config.storageS3Region!,
      })
    : null;

const s3UploadPrefix = config.storageS3UploadPrefix.replace(/^\/+|\/+$/g, "");

function fileExtensionFromMime(mime: string): string | null {
  return MIME_TO_EXT[mime] ?? null;
}

function localImageUrl(name: string): string {
  return normalizeImageUrl(`/uploads/${name}`);
}

function s3ImageUrl(key: string): string {
  const base = config.storageS3PublicBaseUrl?.replace(/\/+$/g, "");
  const fallback = `https://${config.storageS3Bucket}.s3.${config.storageS3Region}.amazonaws.com`;
  const origin = base || fallback;
  return `${origin}/${key}`;
}

function s3Key(name: string): string {
  return s3UploadPrefix ? `${s3UploadPrefix}/${name}` : name;
}

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

    const ext = fileExtensionFromMime(file.mimetype);
    if (!ext) {
      return reply.code(400).send({ error: "Unsupported image type" });
    }

    // Stored name = UUID + MIME-derived ext only. NEVER use file.filename.
    const name = `${crypto.randomUUID()}.${ext}`;

    if (config.storageBackend === "local") {
      const dest = path.join(UPLOAD_DIR, name);

      try {
        await pipeline(file.file, fs.createWriteStream(dest));
      } catch (err) {
        // Clean up partial writes before surfacing the error.
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

      // Oversize detection: stream is truncated when the limit is hit.
      if (file.file.truncated) {
        fs.rm(dest, { force: true }, () => {});
        return reply.code(413).send({ error: "Image too large" });
      }

      return reply.code(201).send({ imageUrl: localImageUrl(name) });
    }

    if (!s3Client) {
      return reply
        .code(500)
        .send({ error: "S3 storage client is not configured" });
    }

    const key = s3Key(name);
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: config.storageS3Bucket!,
          Key: key,
          Body: file.file,
          ContentType: file.mimetype,
        }),
      );
    } catch (err) {
      return reply.code(500).send({ error: "Failed to upload image" });
    }

    return reply.code(201).send({ imageUrl: s3ImageUrl(key) });
  });
};

export default plugin;
