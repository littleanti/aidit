import { config } from "../config.js";

const normalizedApiPrefix =
  config.apiPrefix === "/" ? "" : config.apiPrefix.replace(/\/+$/, "");
const uploadPrefix = normalizedApiPrefix
  ? `${normalizedApiPrefix}/uploads/`
  : "/uploads/";

export const localUploadPathPrefixes = ["/uploads/", uploadPrefix];
const uniquePrefixes = Array.from(new Set(localUploadPathPrefixes));

export function isAllowedImageUrl(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.includes("..")) return false;
  if (/^https?:\/\//.test(path)) return true;
  return uniquePrefixes.some((prefix) => path.startsWith(prefix));
}

export function normalizeImageUrl(path: string): string {
  if (typeof path !== "string") return path;
  if (!path.startsWith("/")) return path;
  if (!path.startsWith("/uploads/")) return path;
  return normalizedApiPrefix ? `${normalizedApiPrefix}${path}` : path;
}
