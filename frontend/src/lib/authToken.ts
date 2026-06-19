/** Leaf module — no imports from rest.ts or authStore.ts (avoids circular deps). */
let token: string | null = null;
export function getAuthToken(): string | null { return token; }
export function setAuthToken(t: string | null): void { token = t; }
