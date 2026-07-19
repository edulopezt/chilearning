import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";
import { brandCssVars, type BrandCssVars } from "./domain/brand-palette";

export interface PublicBranding {
  name: string;
  logoUrl: string | null;
  cssVars: BrandCssVars | null;
}

interface TenantBrandingRow {
  name: string | null;
  primary_color: string | null;
  accent_color: string | null;
  logo_url: string | null;
}

// Caché module-level por slug (mismo patrón que `tenantStatusBySlug` en
// src/lib/supabase/middleware.ts): evita un RPC por request de página. Vive
// por instancia del runtime; un cambio de marca tarda ≤30s en propagarse.
const TTL_MS = 30_000;
const CACHE_MAX = 1000;
const cache = new Map<string, { value: PublicBranding | null; exp: number }>();

function cacheGet(slug: string, now: number): PublicBranding | null | undefined {
  const hit = cache.get(slug);
  return hit && hit.exp > now ? hit.value : undefined;
}

function cacheSet(slug: string, value: PublicBranding | null, now: number): void {
  if (cache.size >= CACHE_MAX && !cache.has(slug)) {
    for (const [key, entry] of cache) {
      if (entry.exp <= now) cache.delete(key);
    }
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  cache.set(slug, { value, exp: now + TTL_MS });
}

/**
 * Branding público de un tenant por slug (task 6.6) — SIN sesión (cliente
 * anon plano, sin cookies: no fuerza dynamic rendering por sí mismo en el
 * Server Component que lo llama). `null` si no hay tenant activo con ese
 * slug, o sus colores guardados no son hex válidos — el caller usa el
 * default de Chilearning.
 */
export async function getPublicBranding(slug: string): Promise<PublicBranding | null> {
  const now = Date.now();
  const cached = cacheGet(slug, now);
  if (cached !== undefined) return cached;

  const env = getPublicEnv();
  const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey);
  const { data, error } = await supabase
    .rpc("tenant_branding_by_slug", { p_slug: slug })
    .maybeSingle<TenantBrandingRow>();

  if (error || !data) {
    cacheSet(slug, null, now);
    return null;
  }

  const primaryColor = data.primary_color;
  const accentColor = data.accent_color;
  const result: PublicBranding = {
    name: data.name ?? "",
    logoUrl: data.logo_url && data.logo_url.trim() !== "" ? data.logo_url : null,
    cssVars: primaryColor && accentColor ? brandCssVars({ primaryColor, accentColor }) : null,
  };
  cacheSet(slug, result, now);
  return result;
}
