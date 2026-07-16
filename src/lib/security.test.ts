import { describe, expect, it } from "vitest";

import { mfaGateDecision, mfaModeFromEnv, requiresMfa } from "@/modules/core/auth/mfa-policy";
import { assertSameOrigin, rootDomain } from "./csrf";
import { decideFromCount, enforce, rateLimitKey, type RlBackend } from "./rate-limit";
import { buildCsp, buildSecurityHeaders } from "./security-headers";

describe("security headers", () => {
  it("incluye las cabeceras enforcing y la CSP en report-only", () => {
    const keys = buildSecurityHeaders({ APP_ENV: "production" }).map((h) => h.key);
    expect(keys).toContain("Strict-Transport-Security");
    expect(keys).toContain("X-Content-Type-Options");
    expect(keys).toContain("X-Frame-Options");
    expect(keys).toContain("Referrer-Policy");
    expect(keys).toContain("Permissions-Policy");
    expect(keys).toContain("Content-Security-Policy-Report-Only");
    expect(keys).not.toContain("Content-Security-Policy"); // aún no enforcing
  });

  it("la CSP permite el form-action a SENCE (load-bearing) y los orígenes de video/Supabase", () => {
    const csp = buildCsp(true);
    expect(csp).toContain("form-action 'self' https://sistemas.sence.cl");
    expect(csp).toContain("https://iframe.mediadelivery.net");
    expect(csp).toContain("https://www.youtube-nocookie.com");
    expect(csp).toContain("https://*.supabase.co");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("en no-prod la CSP agrega orígenes locales (mock/dev)", () => {
    expect(buildCsp(false)).toContain("http://127.0.0.1:4010");
  });
});

describe("csrf assertSameOrigin", () => {
  it("permite mismo dominio raíz y bloquea cross-site", () => {
    expect(assertSameOrigin("https://seminarea.chilearning.cl", "seminarea.chilearning.cl")).toBe(true);
    expect(assertSameOrigin("https://evil.com", "seminarea.chilearning.cl")).toBe(false);
  });
  it("es conservador: sin Origin o malformado no bloquea", () => {
    expect(assertSameOrigin(null, "x.chilearning.cl")).toBe(true);
    expect(assertSameOrigin("no-es-url", "x.chilearning.cl")).toBe(true);
  });
  it("rootDomain toma las últimas dos etiquetas sin puerto", () => {
    expect(rootDomain("a.b.chilearning.cl")).toBe("chilearning.cl");
    expect(rootDomain("localhost:3000")).toBe("localhost");
  });
});

/** Backend en memoria para probar el limiter sin Redis. */
function fakeBackend(): RlBackend {
  const store = new Map<string, number>();
  return { async incr(key) { const n = (store.get(key) ?? 0) + 1; store.set(key, n); return n; } };
}

describe("rate-limit", () => {
  it("decideFromCount permite hasta el límite y bloquea al superarlo", () => {
    expect(decideFromCount(10, 10).allowed).toBe(true);
    expect(decideFromCount(11, 10).allowed).toBe(false);
  });

  it("enforce hace fail-open sin backend (null)", async () => {
    const res = await enforce([{ surface: "s", dim: "ip", id: "1", limit: 1, windowSec: 60 }], null);
    expect(res).toBeNull();
  });

  it("enforce bloquea con 429 al superar el límite (backend inyectado, now fijo)", async () => {
    const backend = fakeBackend();
    const rule = { surface: "sence_start", dim: "user", id: "t:u", limit: 3, windowSec: 60 };
    const now = 1_000_000_000_000;
    for (let i = 0; i < 3; i += 1) {
      expect(await enforce([rule], backend, now)).toBeNull();
    }
    const blocked = await enforce([rule], backend, now);
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("retry-after")).toBeTruthy();
  });

  it("rateLimitKey namespacea por superficie/dimensión/ventana", () => {
    expect(rateLimitKey("sence_cb", "ip", "1.2.3.4", 100)).toBe("rl:sence_cb:ip:1.2.3.4:100");
  });
});

describe("mfa-policy (P7)", () => {
  it("2FA obligatorio solo para superadmin y otec_admin", () => {
    expect(requiresMfa(["superadmin"])).toBe(true);
    expect(requiresMfa(["otec_admin"])).toBe(true);
    expect(requiresMfa(["coordinator"])).toBe(false);
    expect(requiresMfa(["instructor", "tutor", "student"])).toBe(false);
  });
  it("el modo por defecto es off (dormido hasta Pro)", () => {
    expect(mfaModeFromEnv({})).toBe("off");
    expect(mfaModeFromEnv({ MFA_ENFORCEMENT: "enforce" })).toBe("enforce");
  });
  it("el gate solo actúa en modo enforce sobre roles que lo requieren", () => {
    expect(mfaGateDecision({ mode: "off", roles: ["otec_admin"], aal: "aal1", hasFactor: false })).toBe("ok");
    expect(mfaGateDecision({ mode: "enforce", roles: ["coordinator"], aal: "aal1", hasFactor: false })).toBe("ok");
    expect(mfaGateDecision({ mode: "enforce", roles: ["otec_admin"], aal: "aal1", hasFactor: false })).toBe("enroll");
    expect(mfaGateDecision({ mode: "enforce", roles: ["otec_admin"], aal: "aal1", hasFactor: true })).toBe("stepup");
    expect(mfaGateDecision({ mode: "enforce", roles: ["otec_admin"], aal: "aal2", hasFactor: true })).toBe("ok");
  });
});
