import { describe, expect, it } from "vitest";

import { createGrantSchema, expiresOnToTimestamp, grantStatus, isGrantActive, normalizeActionIds } from "./supervisor";

describe("estado del grant de supervisor", () => {
  const now = "2026-07-16T12:00:00.000Z";
  it("revocado gana a todo; expirado por fecha; activo si vigente", () => {
    expect(grantStatus({ expiresAt: null, revokedAt: "2026-07-01T00:00:00Z" }, now)).toBe("revoked");
    expect(grantStatus({ expiresAt: "2026-07-01T00:00:00Z", revokedAt: "2026-07-05T00:00:00Z" }, now)).toBe("revoked");
    expect(grantStatus({ expiresAt: "2026-07-10T00:00:00Z", revokedAt: null }, now)).toBe("expired");
    expect(grantStatus({ expiresAt: "2026-12-31T23:59:59Z", revokedAt: null }, now)).toBe("active");
    expect(grantStatus({ expiresAt: null, revokedAt: null }, now)).toBe("active");
    expect(isGrantActive({ expiresAt: null, revokedAt: null }, now)).toBe(true);
    expect(isGrantActive({ expiresAt: "2026-07-10T00:00:00Z", revokedAt: null }, now)).toBe(false);
  });
});

describe("createGrantSchema", () => {
  it("acepta tenant sin acciones y actions con acciones", () => {
    expect(createGrantSchema.safeParse({ email: "sup@otec.cl", scope: "tenant" }).success).toBe(true);
    const withActions = createGrantSchema.safeParse({ email: "sup@otec.cl", scope: "actions", actionIds: ["11111111-1111-4111-8111-111111111111"] });
    expect(withActions.success).toBe(true);
  });
  it("rechaza actions sin acciones y email inválido", () => {
    expect(createGrantSchema.safeParse({ email: "sup@otec.cl", scope: "actions", actionIds: [] }).success).toBe(false);
    expect(createGrantSchema.safeParse({ email: "no-email", scope: "tenant" }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("normaliza (dedup) y convierte expiresOn a fin de día UTC", () => {
    expect(normalizeActionIds(["a", "a", "b"])).toEqual(["a", "b"]);
    expect(expiresOnToTimestamp("2026-08-30")).toBe("2026-08-30T23:59:59.000Z");
    expect(expiresOnToTimestamp(null)).toBeNull();
  });
});
