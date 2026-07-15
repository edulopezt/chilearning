/**
 * Integración del editor de marca (task 1.10): guarda colores + datos legales,
 * valida hex, solo admin, y deja traza en audit_log.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { getBrandingState, saveBranding } from "@/modules/core/branding-service";
import type { Principal } from "@/modules/core/domain/rbac";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const student: Principal = { userId: "s", tenantId: TENANT_A, roles: ["student"] };

let svc: SupabaseClient;
const valid = { primaryColor: "#1e3a8a", accentColor: "#0ea5e9", logoUrl: "https://cdn.otec.cl/logo.png", name: "OTEC Andes", rut: "76111111-6" };

beforeAll(() => {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  process.env.NEXT_PUBLIC_SUPABASE_URL = get("API_URL");
  process.env.SUPABASE_SERVICE_ROLE_KEY = get("SERVICE_ROLE_KEY");
  svc = createClient(get("API_URL"), get("SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
});

describe("editor de marca (task 1.10, HU-1.2)", () => {
  it("un student no puede guardar (deny-by-default)", async () => {
    expect(await saveBranding(student, valid)).toEqual({ ok: false, error: "forbidden" });
  });

  it("rechaza un color con hex inválido", async () => {
    const r = await saveBranding(admin, { ...valid, primaryColor: "azul" });
    expect("validation" in r).toBe(true);
  });

  it("rechaza un logo que no es https", async () => {
    const r = await saveBranding(admin, { ...valid, logoUrl: "http://inseguro.cl/l.png" });
    expect("validation" in r).toBe(true);
  });

  it("el admin guarda la marca y se lee de vuelta", async () => {
    expect(await saveBranding(admin, valid)).toEqual({ ok: true });
    const state = await getBrandingState(admin);
    expect(state?.branding.primaryColor).toBe("#1e3a8a");
    expect(state?.branding.logoUrl).toBe("https://cdn.otec.cl/logo.png");
    expect(state?.name).toBe("OTEC Andes");
  });

  it("deja traza del cambio en audit_log (P8)", async () => {
    await saveBranding(admin, { ...valid, primaryColor: "#0f766e" });
    const { data } = await svc
      .from("audit_log")
      .select("action")
      .eq("tenant_id", TENANT_A)
      .eq("action", "branding.updated");
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("permite guardar un color con contraste bajo (advisory, no bloquea)", async () => {
    // #ffe000 no cumple AA, pero el guardado no lo bloquea (la UI advierte).
    expect(await saveBranding(admin, { ...valid, accentColor: "#ffe000" })).toEqual({ ok: true });
  });
});
