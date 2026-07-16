import { describe, expect, it } from "vitest";

import { buildHealthPayload } from "./health";
import { redactSecrets, scrubSentryEvent } from "./scrub";

describe("scrubSentryEvent — PII y secretos nunca a Sentry", () => {
  it("redacta RUN, correo y token cifrado en strings", () => {
    const s = redactSecrets("alumno 12.345.678-9 correo ana@otec.cl token v1.AAAA1111.BBBB2222.CCCC3333");
    expect(s).not.toContain("12.345.678-9");
    expect(s).not.toContain("ana@otec.cl");
    expect(s).not.toContain("v1.AAAA1111.BBBB2222.CCCC3333");
    expect(s).toContain("[REDACTED_RUN]");
    expect(s).toContain("[REDACTED_EMAIL]");
    expect(s).toContain("[REDACTED_TOKEN]");
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
