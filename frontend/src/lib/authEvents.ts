// Leaf module — no imports from rest.ts / authStore.ts (avoids circular deps).
//
// Lets the REST client signal "an attached token was rejected (401)" without
// importing the auth/ui stores. The app registers a handler (AppLayout) that
// clears the session and prompts re-login, so we never sit in a
// "logged-in but every write 401s" zombie state.

let handler: (() => void) | null = null;

export function setOnAuthExpired(fn: (() => void) | null): void {
  handler = fn;
}

export function notifyAuthExpired(): void {
  handler?.();
}
