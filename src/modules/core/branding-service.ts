import "server-only";

import { tenantGuard } from "@/lib/tenant-guard";
import { parseHex } from "@/modules/core/domain/contrast";
import { authorize, type Principal } from "@/modules/core/domain/rbac";

/**
 * Editor de marca del tenant (task 1.10, HU-1.2). Guarda colores (validados como
 * hex) + datos legales. El chequeo de contraste WCAG es ADVISORY (se muestra en
 * la UI en vivo); no bloquea el guardado (algunas marcas lo exigen). Todo cambio
 * queda en `audit_log`. Solo el otec_admin.
 */

export interface Branding {
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
}

export interface BrandingState {
  branding: Branding;
  name: string;
  rut: string | null;
}

export type BrandingField = "primaryColor" | "accentColor" | "logoUrl" | "name";
export type SaveBrandingResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "no_tenant" }
  | { ok: false; validation: { field: BrandingField; message: string }[] };

const DEFAULTS: Branding = { primaryColor: "#1e3a8a", accentColor: "#0ea5e9", logoUrl: null };

function asBranding(raw: unknown): Branding {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    primaryColor: typeof o.primaryColor === "string" && parseHex(o.primaryColor) ? o.primaryColor : DEFAULTS.primaryColor,
    accentColor: typeof o.accentColor === "string" && parseHex(o.accentColor) ? o.accentColor : DEFAULTS.accentColor,
    logoUrl: typeof o.logoUrl === "string" && o.logoUrl.trim() !== "" ? o.logoUrl : null,
  };
}

export async function getBrandingState(principal: Principal): Promise<BrandingState | null> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin"])) return null;
  const guard = tenantGuard(principal.tenantId);
  // `tenants` se filtra por `id` (no `tenant_id`): se usa el cliente con filtro
  // explícito en vez del builder `from()` que asume la columna `tenant_id`.
  const { data } = await guard.db
    .from("tenants")
    .select("name, rut, branding")
    .eq("id", principal.tenantId)
    .maybeSingle();
  return {
    branding: asBranding(data?.branding),
    name: (data?.name as string) ?? "",
    rut: (data?.rut as string) ?? null,
  };
}

export async function saveBranding(
  principal: Principal,
  input: { primaryColor: string; accentColor: string; logoUrl: string; name: string; rut: string },
): Promise<SaveBrandingResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!authorize(principal, principal.tenantId, ["otec_admin"])) return { ok: false, error: "forbidden" };

  const errors: { field: BrandingField; message: string }[] = [];
  if (!parseHex(input.primaryColor)) errors.push({ field: "primaryColor", message: "Color primario inválido (usa formato #rrggbb)." });
  if (!parseHex(input.accentColor)) errors.push({ field: "accentColor", message: "Color de acento inválido (usa formato #rrggbb)." });
  const name = input.name.trim();
  if (name.length < 1 || name.length > 200) errors.push({ field: "name", message: "La razón social es obligatoria." });
  const logo = input.logoUrl.trim();
  if (logo !== "" && !/^https:\/\//.test(logo)) errors.push({ field: "logoUrl", message: "El logo debe ser una URL https." });
  if (errors.length > 0) return { ok: false, validation: errors };

  const branding: Branding = {
    primaryColor: input.primaryColor,
    accentColor: input.accentColor,
    logoUrl: logo === "" ? null : logo,
  };

  const guard = tenantGuard(principal.tenantId);
  const { error } = await guard.db
    .from("tenants")
    .update({ name, rut: input.rut.trim() || null, branding })
    .eq("id", principal.tenantId);
  if (error) return { ok: false, error: "no_tenant" };

  // Auditoría (P8): el cambio de marca queda registrado.
  await guard.db.from("audit_log").insert(
    guard.withTenant({ actor_user_id: principal.userId, action: "branding.updated", entity: "tenant", entity_id: principal.tenantId, details: { branding } }),
  );

  return { ok: true };
}
