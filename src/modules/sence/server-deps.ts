import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { senceEnv } from "@/lib/env.server";
import { untenantedServiceClient } from "@/lib/tenant-guard";
import { senceTimingFromEnv } from "@/modules/sence/domain/timing";
import { parseEncryptionKey } from "@/modules/sence/domain/token-crypto";
import type { CallbackDeps, EngineDeps } from "@/modules/sence/engine";
import { resolvePublicOrigin, type SenceEnvironment } from "@/modules/sence/domain/protocol";

/**
 * Arma las dependencias del motor desde el entorno y la request. En modo `mock`
 * el motor habla contra el mock local; en `test`/`prod` contra rcetest/rce.
 * `callbackUrl` se deriva del origin PÚBLICO (headers del proxy), no de
 * `request.url` crudo, para que SENCE reciba un `https://` alcanzable (I-8).
 */
export function buildEngineDeps(request: Request): EngineDeps {
  const sence = senceEnv();
  const key = parseEncryptionKey(sence.tokenEncryptionKey);
  // El host reenviado se valida contra el dominio raíz (anti-spoofing del
  // callback). Se lee directo de env para no acoplar con la config pública.
  const rootDomain = process.env.TENANT_ROOT_DOMAIN ?? "localtest.me";
  // Fail-closed (H4-R-015): si el host reenviado no valida, el origin del callback
  // se ancla al canónico de config (APP_BASE_URL o https del dominio raíz), NUNCA a
  // `request.url` (que sale http tras el proxy y es influenciable por el cliente).
  const canonicalOrigin = process.env.APP_BASE_URL ?? `https://${rootDomain}`;
  const origin = resolvePublicOrigin((n) => request.headers.get(n), canonicalOrigin, rootDomain);

  const baseOverride: Partial<Record<SenceEnvironment, string>> | undefined =
    sence.mode === "mock"
      ? { rcetest: `${sence.mockUrl}/rcetest`, rce: `${sence.mockUrl}/rce` }
      : undefined;

  return {
    encryptionKey: key,
    baseOverride,
    callbackUrl: `${origin}/api/sence/cb`,
    now: () => Date.now(),
    newUuid: () => randomUUID(),
    // Nonce corto (16 chars base64url) para caber en el límite de 100 chars de
    // UrlRetoma/UrlError junto con el origin (I-8).
    newNonce: () => randomBytes(12).toString("base64url"),
    sessionMaxMs: sence.timing.sessionMaxMs,
  };
}

/**
 * Deps MÍNIMAS para el receptor de callbacks (H4-R-005): solo `now` +
 * `sessionMaxMs`. NO parsea la clave de cifrado ni exige
 * `SENCE_TOKEN_ENCRYPTION_KEY` (el callback no descifra nada), así una clave
 * ausente o rota jamás tumba el callback con un 500 y se pierde la asistencia
 * (I-1). `senceTimingFromEnv` degrada a los defaults del contrato sin lanzar.
 */
export function buildCallbackDeps(): CallbackDeps {
  const timing = senceTimingFromEnv(process.env);
  return {
    now: () => Date.now(),
    sessionMaxMs: timing.sessionMaxMs,
  };
}

/** Cliente service-role para el callback (origin SENCE, sin sesión de usuario). */
export function senceServiceClient(): SupabaseClient {
  return untenantedServiceClient();
}
