// Typed runtime configuration loaded from environment variables.

import { loadEnvFile } from "node:process";

// Load server/.env into process.env BEFORE reading any config below. Without
// this, only Prisma auto-loads .env (for DATABASE_URL) — the app's own vars
// (JWT_SECRET, PORT, HOST) would be ignored locally. In production (Fly) there
// is no .env file, so the load throws and we fall back to the real env vars
// injected by the platform.
try {
  loadEnvFile();
} catch {
  // No .env present (e.g. production) — rely on the process environment.
}

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const DEV_JWT_SECRET = "dev-insecure-secret-change-me";

export interface Config {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpires: string;
  signupRequired: boolean;
  apiPrefix: string;
  storageBackend: "local" | "s3";
  storageS3Region: string | null;
  storageS3Bucket: string | null;
  storageS3UploadPrefix: string;
  storageS3PublicBaseUrl: string | null;
}

export const config: Config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: requireEnv("DATABASE_URL", "file:./dev.db"),
  jwtSecret: process.env.JWT_SECRET ?? DEV_JWT_SECRET,
  jwtExpires: process.env.JWT_EXPIRES ?? "7d",
  signupRequired: (process.env.AUTH_SIGNUP_REQUIRED ?? "true").toLowerCase() !== "false",
  apiPrefix: (process.env.API_PREFIX ?? "/").trim() || "/",
  storageBackend:
    (process.env.STORAGE_BACKEND ?? "local").toLowerCase() === "s3"
      ? "s3"
      : "local",
  storageS3Region: process.env.AWS_REGION ?? null,
  storageS3Bucket: process.env.AWS_S3_BUCKET_NAME ?? null,
  storageS3UploadPrefix: (process.env.S3_UPLOAD_PREFIX ?? "uploads").trim() || "uploads",
  storageS3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL?.trim() || null,
};

if (!config.apiPrefix.startsWith("/")) {
  throw new Error("API_PREFIX must start with /");
}
if (config.apiPrefix !== "/" && config.apiPrefix.endsWith("/")) {
  config.apiPrefix = config.apiPrefix.replace(/\/+$/, "");
}
if (config.storageBackend === "s3" && (!config.storageS3Region || !config.storageS3Bucket)) {
  throw new Error(
    "Missing required environment variable: AWS_REGION, AWS_S3_BUCKET_NAME",
  );
}

// Warn once at startup when using the insecure dev fallback secret.
if (config.jwtSecret === DEV_JWT_SECRET) {
  console.warn(
    "[auth] WARNING: JWT_SECRET is not set — using insecure dev fallback. " +
      "Set JWT_SECRET in production.",
  );
}

// Gemini model id — single source of truth (PLAN L7). Used later in M3 (BYOK calls
// happen in the browser; the server stays key-blind and only references the model id).
export const GEMINI_MODEL = "gemini-3.1-flash-lite";
