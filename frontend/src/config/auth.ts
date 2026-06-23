// Build-time signup mode flag. Mirrors the backend's AUTH_SIGNUP_REQUIRED
// (the operator keeps the two values in sync; only the VITE_ prefix differs).
// Read from the public Vite env at build time — the signup mode is public info,
// so VITE_ exposure to the browser bundle is appropriate.
//   true  (default): username+password signup/login (current behavior).
//   false: password-less guest entry (nickname only).
// Any value other than the literal "false" is treated as true (default true).
export const SIGNUP_REQUIRED = import.meta.env.VITE_AUTH_SIGNUP_REQUIRED !== 'false';
