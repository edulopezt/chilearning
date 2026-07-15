import "server-only";

import { senceEnv } from "@/lib/env.server";
import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { isValidRun, normalizeRun } from "@/modules/sence/domain/run";
import { encryptToken, parseEncryptionKey } from "@/modules/sence/domain/token-crypto";

/**
 * Panel de configuración SENCE del tenant (task 1.2, HU-5.4). El admin del OTEC
 * define su RUT y su token; el token va CIFRADO (AES-256-GCM, I-6) y es
 * WRITE-ONLY: nunca se devuelve al cliente, solo su estado ("configurado").
 * Vive en `core` (config del tenant) porque compone auth + el cifrado del motor;
 * el motor `sence` permanece aislado.
 */

export type SenceEnvironment = "rcetest" | "rce";

export interface SenceConfigStatus {
  rutOtec: string | null;
  environment: SenceEnvironment;
  tokenConfigured: boolean;
}

export type SaveResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "invalid_rut" | "invalid_token" | "no_tenant" };

const TOKEN_LEN = 36; // largo normativo del Token (manual v1.1.6)

/** Estado de la config SENCE del tenant (sin exponer el token, I-6). */
export async function getSenceConfigStatus(principal: Principal): Promise<SenceConfigStatus | null> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin"])) {
    return null;
  }
  const guard = tenantGuard(principal.tenantId);
  const { data } = await guard.db
    .from("sence_otec_config")
    .select("rut_otec, default_environment, token_encrypted")
    .eq("tenant_id", principal.tenantId)
    .maybeSingle();

  if (!data) {
    return { rutOtec: null, environment: "rcetest", tokenConfigured: false };
  }
  return {
    rutOtec: data.rut_otec ?? null,
    environment: (data.default_environment as SenceEnvironment) ?? "rcetest",
    tokenConfigured: Boolean(data.token_encrypted),
  };
}

/**
 * Guarda la config SENCE. `token` es opcional: si viene vacío, se conserva el
 * token actual (write-only: no se puede "ver" para reescribir sin cambiarlo).
 */
export async function saveSenceConfig(
  principal: Principal,
  input: { rutOtec: string; token: string; environment: SenceEnvironment },
): Promise<SaveResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!authorize(principal, principal.tenantId, ["otec_admin"])) {
    return { ok: false, error: "forbidden" };
  }

  const rut = normalizeRun(input.rutOtec);
  if (!isValidRun(rut) || rut.length > 10) {
    return { ok: false, error: "invalid_rut" };
  }
  if (input.environment !== "rcetest" && input.environment !== "rce") {
    return { ok: false, error: "invalid_token" };
  }

  const token = input.token.trim();
  const guard = tenantGuard(principal.tenantId);

  const row: Record<string, unknown> = {
    tenant_id: principal.tenantId,
    rut_otec: rut,
    default_environment: input.environment,
    updated_at: new Date().toISOString(),
  };

  if (token !== "") {
    if (token.length !== TOKEN_LEN) {
      return { ok: false, error: "invalid_token" };
    }
    const key = parseEncryptionKey(senceEnv().tokenEncryptionKey);
    row.token_encrypted = encryptToken(token, key); // I-6: cifrado en reposo
  }

  const { error } = await guard.db
    .from("sence_otec_config")
    .upsert(row, { onConflict: "tenant_id" });
  if (error) return { ok: false, error: "invalid_token" };

  return { ok: true };
}
