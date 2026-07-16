import { describe, expect, it } from "vitest";

import { buildHealthPayload } from "./health";
import { redactSecrets, scrubSentryEvent } from "./scrub";

describe("scrubSentryEvent — PII y secretos nunca a Sentry", () => {
  it("redacta RUN, correo, token cifrado, JWT y credenciales de URL", () => {
    const s = redactSecrets("alumno 12.345.678-9 correo ana@otec.cl token v2.AAAA1111.BBBB2222.CCCC3333 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij url postgres://postgres:S3cr3t@db.host:5432/postgres");
    expect(s).not.toContain("12.345.678-9");
    expect(s).not.toContain("ana@otec.cl");
    expect(s).not.toContain("v2.AAAA1111.BBBB2222.CCCC3333");
    expect(s).not.toContain("eyJzdWIiOiIxIn0");
    expect(s).not.toContain("S3cr3t");
    expect(s).toContain("[REDACTED_RUN]");
    expect(s).toContain("[REDACTED_EMAIL]");
    expect(s).toContain("[REDACTED_TOKEN]");
    expect(s).toContain("[REDACTED_JWT]");
  });

  it("redacta por NOMBRE de clave el token descifrado con forma de UUID (4-ojos F1)", () => {
    const event = scrubSentryEvent({
      exception: { values: [{ stacktrace: { frames: [{ vars: { token: "12345678-90ab-cdef-1234-567890abcdef", Password: "hunter2" } }] } }] },
    });
    const asStr = JSON.stringify(event);
    expect(asStr).not.toContain("12345678-90ab-cdef-1234-567890abcdef");
    expect(asStr).not.toContain("hunter2");
    expect(asStr).toContain("[REDACTED]");
  });

  it("quita cookies/headers sensibles y el body de /api/sence", () => {
    const event = scrubSentryEvent({
      message: "error en 12.345.678-9",
      request: {
        url: "https://x/api/sence/start",
        cookies: "sb-access-token=secret",
        headers: { authorization: "Bearer secret", Cookie: "s=1", "content-type": "application/json" },
        data: { token: "v1.AAAA1111.BBBB2222.CCCC3333" },
      },
      extra: { SUPABASE_SERVICE_ROLE_KEY: "supersecret", nota: "ana@otec.cl" },
    });
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers?.authorization).toBeUndefined();
    expect(event.request?.headers?.Cookie).toBeUndefined();
    expect(event.request?.data).toBeUndefined(); // body de SENCE eliminado
    expect((event.extra as Record<string, unknown>).SUPABASE_SERVICE_ROLE_KEY).toBe("[REDACTED]");
    expect((event.extra as Record<string, unknown>).nota).toBe("[REDACTED_EMAIL]");
    expect(String(event.message)).toContain("[REDACTED_RUN]");
    // Una traza normal sin PII sobrevive.
    const clean = scrubSentryEvent({ message: "TypeError: undefined is not a function" });
    expect(clean.message).toBe("TypeError: undefined is not a function");
  });
});

describe("buildHealthPayload", () => {
  it("ok cuando la BD responde; degraded cuando falla", () => {
    expect(buildHealthPayload({ db: "ok" }, "v1", "2026-07-16T00:00:00Z").status).toBe("ok");
    expect(buildHealthPayload({ db: "fail" }, "v1", "2026-07-16T00:00:00Z").status).toBe("degraded");
  });
});
