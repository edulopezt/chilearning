import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { senceEnv } from "@/lib/env.server";
import { untenantedServiceClient } from "@/lib/tenant-guard";
import { parseEncryptionKey } from "@/modules/sence/domain/token-crypto";
import type { EngineDeps } from "@/modules/sence/engine";
import type { SenceEnvironment } from "@/modules/sence/domain/protocol";

/**
 * Arma las dependencias del motor desde el entorno y la request. En modo `mock`
 * el motor habla contra el mock local; en `test`/`prod` contra rcetest/rce.
 * `callbackUrl` se deriva del host de la request (debe caber en 100 chars, I-8).
 */
export function buildEngineDeps(requestUrl: string): EngineDeps {
  const sence = senceEnv();
  const key = parseEncryptionKey(sence.tokenEncryptionKey);
  const origin = new URL(requestUrl).origin;

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
  };
}

/** Cliente service-role para el callback (origin SENCE, sin sesión de usuario). */
export function senceServiceClient(): SupabaseClient {
  return untenantedServiceClient();
}
