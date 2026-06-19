import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

// WP XC-3 (server) — Security headers.
//
// L2: the CSP `connect-src` allowlist is the PRIMARY key-exfiltration mitigation.
// A compromised/XSS script can only POST the user's Google API key to origins in
// connect-src; restricting it to 'self' + the Gemini endpoint means a leaked key
// cannot be shipped to an attacker-controlled host. The SPA additionally ships a
// CSP <meta>; these response headers cover anything the server itself serves.
//
// Set via an onSend hook so every response (routes, errors, static) is covered.

const CSP = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self' https://generativelanguage.googleapis.com",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Wrapped with fastify-plugin so the onSend hook is NOT encapsulated and applies
// to EVERY response in the app (sibling route plugins + /health), not just this
// plugin's own context. Without fp(), register() encapsulates the hook and the
// CSP header (L2's primary key-exfiltration mitigation) never reaches responses.
const securityImpl: FastifyPluginAsync = async (app) => {
  app.addHook("onSend", async (_req, reply, payload) => {
    void reply.header("Content-Security-Policy", CSP);
    void reply.header("X-Content-Type-Options", "nosniff");
    void reply.header("X-Frame-Options", "DENY");
    void reply.header("Referrer-Policy", "no-referrer");
    void reply.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    return payload;
  });
};

const plugin = fp(securityImpl, { name: "security" });

export default plugin;
