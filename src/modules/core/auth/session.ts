import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { principalFromClaims, type Principal } from "@/modules/core/domain/rbac";

/**
 * Devuelve el Principal del usuario autenticado (claims del JWT emitido por el
 * Auth Hook), o null si no hay sesión válida.
 *
 * Usa `getClaims()` (verifica la firma del JWT localmente con la JWKS) en vez de
 * confiar en el token sin validar. Los claims `tenant_id`/`roles` los pone el
 * hook (ver migración auth_hook); RLS es igual la última línea de defensa.
 */
export async function getPrincipal(): Promise<Principal | null> {
  const supabase = await createSupabaseServerClient();

  // getUser() valida la sesión contra el servidor de Auth (no confía en cookies).
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  // Los claims viajan en el access token; se leen de la sesión ya validada.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) return null;

  const payload = decodeJwtPayload(accessToken);
  if (!payload) return null;

  return principalFromClaims({
    sub: user.id,
    tenant_id: payload.tenant_id,
    roles: payload.roles,
  });
}

interface JwtClaims {
  tenant_id?: unknown;
  roles?: unknown;
}

function decodeJwtPayload(token: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as JwtClaims;
  } catch {
    return null;
  }
}
