import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";
import { signSession } from "@/lib/session";

beforeAll(() => {
  process.env.AUTH_SECRET = "m".repeat(48);
  delete process.env.COOKIE_SECURE;
});

const req = (path: string, init: { method?: string; headers?: Record<string, string>; cookie?: string } = {}) =>
  new NextRequest(`http://crm.test${path}`, {
    method: init.method ?? "GET",
    headers: { host: "crm.test", ...(init.cookie ? { cookie: `crm_session=${init.cookie}` } : {}), ...init.headers },
  });

describe("middleware: sign-in gate", () => {
  it("sends anonymous visitors to /login, but lets them see /login and the health check", async () => {
    const r = await middleware(req("/leads"));
    expect(r.status).toBe(307);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/login");
    expect((await middleware(req("/login"))).headers.get("location")).toBeNull();
    expect((await middleware(req("/api/health"))).status).toBe(200);
  });

  it("lets a validly signed cookie through, and does NOT bounce it away from /login (a stale cookie would loop)", async () => {
    const cookie = await signSession({ id: 1, name: "A", email: "a@x", role: "owner" }, "pv");
    expect((await middleware(req("/leads", { cookie }))).headers.get("location")).toBeNull();
    expect((await middleware(req("/login", { cookie }))).headers.get("location")).toBeNull();
  });

  it("rejects a forged cookie", async () => {
    const r = await middleware(req("/leads", { cookie: "not.a.jwt" }));
    expect(new URL(r.headers.get("location")!).pathname).toBe("/login");
  });
});

describe("middleware: cross-site request forgery", () => {
  it("refuses a write whose Origin is another site, even with a valid cookie", async () => {
    const cookie = await signSession({ id: 1, name: "A", email: "a@x", role: "owner" }, "pv");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await middleware(req("/leads", { method, cookie, headers: { origin: "https://evil.example" } }));
      expect(r.status, method).toBe(403);
    }
    expect((await middleware(req("/leads", { method: "POST", cookie, headers: { origin: "null" } }))).status).toBe(403);
    expect((await middleware(req("/leads", { method: "POST", cookie, headers: { origin: "http://crm.test.evil.example" } }))).status).toBe(403);
  });

  it("allows same-origin writes, reads from anywhere, and non-browser writes without an Origin", async () => {
    const cookie = await signSession({ id: 1, name: "A", email: "a@x", role: "owner" }, "pv");
    expect((await middleware(req("/leads", { method: "POST", cookie, headers: { origin: "http://crm.test" } }))).status).toBe(200);
    expect((await middleware(req("/leads", { cookie, headers: { origin: "https://evil.example" } }))).status).toBe(200);
    expect((await middleware(req("/leads", { method: "POST", cookie }))).status).toBe(200);
  });

  it("behind a reverse proxy the public host from X-Forwarded-Host is what Origin must match", async () => {
    const cookie = await signSession({ id: 1, name: "A", email: "a@x", role: "owner" }, "pv");
    const proxied = { "x-forwarded-host": "crm.orladent.com" };
    expect((await middleware(req("/leads", { method: "POST", cookie, headers: { ...proxied, origin: "https://crm.orladent.com" } }))).status).toBe(200);
    expect((await middleware(req("/leads", { method: "POST", cookie, headers: { ...proxied, origin: "https://evil.example" } }))).status).toBe(403);
  });
});

describe("middleware: security headers", () => {
  it("sets a locked-down policy on every kind of response (production: no eval)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const responses = [await middleware(req("/login")), await middleware(req("/leads")), await middleware(req("/api/health")), await middleware(req("/x", { method: "POST", headers: { origin: "https://evil.example" } }))];
    for (const r of responses) {
      const csp = r.headers.get("content-security-policy")!;
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).not.toContain("unsafe-eval");
      expect(r.headers.get("x-frame-options")).toBe("DENY");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("referrer-policy")).toBe("same-origin");
    }
    vi.unstubAllEnvs();
  });

  it("only the dev server (hot reload) is allowed eval", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await middleware(req("/login"))).headers.get("content-security-policy")).toContain("'unsafe-eval'");
    vi.unstubAllEnvs();
  });

  it("adds HSTS only when the deployment is HTTPS (COOKIE_SECURE=true)", async () => {
    expect((await middleware(req("/login"))).headers.get("strict-transport-security")).toBeNull();
    process.env.COOKIE_SECURE = "true";
    expect((await middleware(req("/login"))).headers.get("strict-transport-security")).toContain("max-age=31536000");
    delete process.env.COOKIE_SECURE;
  });
});
