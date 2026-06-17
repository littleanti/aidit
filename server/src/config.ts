// Typed runtime configuration loaded from environment variables.

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface Config {
  port: number;
  databaseUrl: string;
}

export const config: Config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: requireEnv("DATABASE_URL", "file:./dev.db"),
};

// Gemini model id — single source of truth (PLAN L7). Used later in M3 (BYOK calls
// happen in the browser; the server stays key-blind and only references the model id).
export const GEMINI_MODEL = "gemini-3.1-flash-lite";
