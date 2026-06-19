// Build-time backend origin. UNSET in dev (relative URLs → Vite proxy).
// In production (GitHub Pages) set VITE_API_ORIGIN to the deployed backend origin,
// e.g. https://aidit-api.onrender.com (NO trailing slash, NO /api suffix).
const ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');
export const API_ORIGIN = ORIGIN;
export const API_BASE = ORIGIN + '/api';                 // dev: "/api"
export function apiUrl(path: string): string { return API_BASE + path; }
// Resolve a server-relative asset (e.g. "/uploads/x") to an absolute URL in prod;
// pass through absolute URLs and (in dev) relative paths unchanged.
export function assetUrl(path: string): string;
export function assetUrl(path: string | null | undefined): string | undefined;
export function assetUrl(path: string | null | undefined) {
  if (!path) return path ?? undefined;
  if (/^https?:\/\//.test(path) || path.startsWith('blob:') || path.startsWith('data:')) return path;
  return ORIGIN ? ORIGIN + path : path;
}
