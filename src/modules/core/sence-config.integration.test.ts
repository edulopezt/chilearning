/**
 * Integración del panel de config SENCE (task 1.2): guarda RUT + token cifrado
 * (write-only), solo el admin, con la clave de cifrado del entorno.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import { getSenceConfigStatus, saveSenceConfig } from "@/modules/core/sence-config";
import { decryptToken, parseEncryptionKey } from "@/modules/sence/domain/token-crypto";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const KEY_B64 = Buffer.from("0".repeat(32)).toString("base64");

function env() {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

let svc: SupabaseClient;
const admin: Principal = { userId: "admin", tenantId: TENANT_A, roles: ["otec_admin"] };
const student: Principal = { userId: "stu", tenantId: TENANT_A, roles: ["student"] };
const VALID_TOKEN = "12345678-90ab-cdef-1234-567890abcdef"; // 36 chars

beforeAll(() => {
  const e = env();
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
  process.env.SENCE_TOKEN_ENCRYPTION_KEY = KEY_B64;
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
});

describe("panel de config SENCE (task 1.2, HU-5.4)", () => {
  it("un NO admin no puede guardar (deny-by-default)", async () => {
    const r = await saveSenceConfig(student, {
      rutOtec: "76111111-6",
      token: VALID_TOKEN,
      environment: "rcetest",
    });
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("rechaza un RUT con dígito verificador inválido", async () => {
    const r = await saveSenceConfig(admin, {
      rutOtec: "76111111-1", // DV incorrecto
      token: VALID_TOKEN,
      environment: "rcetest",
    });
    expect(r).toEqual({ ok: false, error: "invalid_rut" });
  });

  it("rechaza un token de largo incorrecto", async () => {
    const r = await saveSenceConfig(admin, {
      rutOtec: "76111111-6",
      token: "corto",
      environment: "rcetest",
    });
    expect(r).toEqual({ ok: false, error: "invalid_token" });
  });

  it("el admin guarda RUT + token; el token queda CIFRADO (I-6) y descifra bien", async () => {
    const r = await saveSenceConfig(admin, {
      rutOtec: "76111111-6",
      token: VALID_TOKEN,
      environment: "rce",
    });
    expect(r).toEqual({ ok: true });

    const { data } = await svc
      .from("sence_otec_config")
      .select("rut_otec, default_environment, token_encrypted")
      .eq("tenant_id", TENANT_A)
      .single();
    expect(data).not.toBeNull();
    expect(data!.rut_otec).toBe("76111111-6");
    expect(data!.default_environment).toBe("rce");
    // El valor guardado NO es el token en claro (I-6).
    expect(data!.token_encrypted).not.toContain(VALID_TOKEN);
    expect(data!.token_encrypted.startsWith("v1.")).toBe(true);
    // Y descifra al token original con la clave del entorno.
    expect(decryptToken(data!.token_encrypted, parseEncryptionKey(KEY_B64))).toBe(VALID_TOKEN);
  });

  it("guardar con token vacío CONSERVA el token anterior (write-only)", async () => {
    const before = await svc
      .from("sence_otec_config")
      .select("token_encrypted")
      .eq("tenant_id", TENANT_A)
      .single();

    const r = await saveSenceConfig(admin, {
      rutOtec: "76111111-6",
      token: "", // no cambiar el token
      environment: "rcetest",
    });
    expect(r).toEqual({ ok: true });

    const after = await svc
      .from("sence_otec_config")
      .select("token_encrypted, default_environment")
      .eq("tenant_id", TENANT_A)
      .single();
    expect(after.data!.token_encrypted).toBe(before.data!.token_encrypted); // conservado
    expect(after.data!.default_environment).toBe("rcetest"); // pero el ambiente sí cambió
  });

  it("getSenceConfigStatus nunca expone el token, solo su estado", async () => {
    const status = await getSenceConfigStatus(admin);
    expect(status?.tokenConfigured).toBe(true);
    expect(JSON.stringify(status)).not.toContain(VALID_TOKEN);
    // Un student no obtiene status.
    expect(await getSenceConfigStatus(student)).toBeNull();
  });
});
