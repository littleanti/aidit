// CORS origin policy (app.ts) — locks in the allowlist after the GitHub Pages
// cleanup of 2026-07-28.
//
// Why this file exists: the app used to allow a hardcoded production origin
// (https://littleanti.github.io) by default. That default was removed when
// deployment moved to self-hosting, which means the PRODUCTION frontend origin
// must now come from WEB_ORIGIN. A silent regression here would either lock the
// real frontend out (no CORS headers) or re-open a stale origin, and neither is
// visible from a unit test of any other module.
//
// Contract under test:
//   * localhost / 127.0.0.1 (any port, http)  -> allowed (local dev)
//   * private-LAN IPv4 over http              -> allowed (phone on the same Wi-Fi)
//   * anything in WEB_ORIGIN                  -> allowed
//   * every other origin                      -> NOT allowed, but NOT a 500
//     (graceful deny: the browser blocks it client-side; the request still works
//     for non-browser callers, which is what `cb(null, false)` means)

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { build } from "../src/app.js";

const ACAO = "access-control-allow-origin";

/** Preflight an actual endpoint and report the CORS decision. */
async function probe(app: FastifyInstance, origin: string) {
  const res = await app.inject({
    method: "OPTIONS",
    url: "/posts",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,authorization",
    },
  });
  return {
    statusCode: res.statusCode,
    allowOrigin: res.headers[ACAO] as string | undefined,
  };
}

describe("CORS origin allowlist", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("allows localhost and 127.0.0.1 on any port", async () => {
    for (const origin of [
      "http://localhost:5173",
      "http://localhost",
      "http://127.0.0.1:4173",
    ]) {
      const r = await probe(app, origin);
      expect(r.allowOrigin, origin).toBe(origin);
    }
  });

  it("allows private-LAN IPv4 over http (phone on the same Wi-Fi)", async () => {
    for (const origin of [
      "http://192.168.0.12:5173",
      "http://10.1.2.3:5173",
      "http://172.16.5.9:5173",
    ]) {
      const r = await probe(app, origin);
      expect(r.allowOrigin, origin).toBe(origin);
    }
  });

  it("does NOT allow an arbitrary external origin, and does not 500", async () => {
    const r = await probe(app, "https://evil.example.com");
    expect(r.allowOrigin).toBeUndefined();
    // Graceful deny (cb(null, false)) — NOT an error response.
    expect(r.statusCode).toBeLessThan(500);
  });

  it("no longer allows the removed GitHub Pages origin by default", async () => {
    // REGRESSION LOCK: this origin was hardcoded as always-allowed until
    // 2026-07-28. Deployment is self-hosted now; production origins come from
    // WEB_ORIGIN only.
    const r = await probe(app, "https://littleanti.github.io");
    expect(r.allowOrigin).toBeUndefined();
  });

  it("does NOT allow a private-LAN origin over https (http-only by design)", async () => {
    // The LAN allowance exists for plain-http dev servers; an https origin in the
    // same range must not slip through the regex.
    const r = await probe(app, "https://192.168.0.12");
    expect(r.allowOrigin).toBeUndefined();
  });
});

describe("CORS with WEB_ORIGIN configured", () => {
  let app: FastifyInstance;
  const previous = process.env.WEB_ORIGIN;

  beforeAll(async () => {
    // WEB_ORIGIN is read inside build(), so set it before constructing the app.
    process.env.WEB_ORIGIN =
      "https://app.example.com, https://staging.example.com";
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (previous === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = previous;
  });

  it("allows every origin listed in WEB_ORIGIN (whitespace tolerated)", async () => {
    for (const origin of [
      "https://app.example.com",
      "https://staging.example.com",
    ]) {
      const r = await probe(app, origin);
      expect(r.allowOrigin, origin).toBe(origin);
    }
  });

  it("still rejects an origin that is not listed", async () => {
    const r = await probe(app, "https://other.example.com");
    expect(r.allowOrigin).toBeUndefined();
  });
});
