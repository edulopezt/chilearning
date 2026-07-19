import { headers } from "next/headers";

import { getPublicBranding } from "@/modules/core/public-branding";

function toDeclarations(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
}

/**
 * Emite un `<style>` con los overrides de branding del tenant activo del
 * subdominio (task 6.6) — se monta por layout de área (login; el resto del
 * app shell en el PR siguiente). Sin slug, sin tenant activo, o sin colores
 * hex válidos guardados: no emite nada y rige el default de `globals.css`.
 *
 * Usa `headers()`: el layout que la monta deja de poder prerenderizarse
 * estático (necesario — el branding depende del subdominio, no puede
 * resolverse en build time). Deliberadamente NO se monta en el root layout
 * ni en la landing pública (`/`), que sí deben seguir estáticos.
 */
async function TenantBrandStyle() {
  const slug = (await headers()).get("x-tenant-slug");
  if (!slug) return null;

  const branding = await getPublicBranding(slug);
  if (!branding?.cssVars) return null;

  const css = `:root{${toDeclarations(branding.cssVars.light)}}.dark{${toDeclarations(branding.cssVars.dark)}}`;

  return <style>{css}</style>;
}

export { TenantBrandStyle };
