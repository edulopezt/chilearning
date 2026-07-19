-- Hito 6, task 6.6: RPC pública de branding por tenant (espejo de
-- `tenant_status_by_slug`, migración 20260717010000). El shell de la app
-- necesita el color/logo del tenant para pintar el layout ANTES de saber si
-- hay sesión (login, páginas públicas del subdominio) — `getBrandingState()`
-- (branding-service.ts) exige rol otec_admin y no sirve para esto.
--
-- Solo 4 columnas de tenants ACTIVOS: nombre + los 3 campos de `branding`
-- (JSON, validado como hex/URL en el cliente vía brand-palette.ts antes de
-- usarse en un <style> — nunca se confía en el JSON crudo para CSS). Un
-- tenant suspendido no expone su marca (mismo criterio que `tenant_status_by_slug`
-- ya aplicaba al estado).
--
-- SECURITY DEFINER + `search_path = ''`: mismo patrón exacto que
-- `tenant_status_by_slug`. La policy `tenants_select_definer` (creada en
-- 20260717010000, `for select to postgres using (true)`) ya cubre esta
-- función: bajo `force row level security` el rol postgres NO bypassa RLS en
-- Supabase cloud, así que sin esa policy el DEFINER leería 0 filas en
-- producción (mismo hallazgo documentado en esa migración).
create or replace function public.tenant_branding_by_slug(p_slug text)
returns table (
  name text,
  primary_color text,
  accent_color text,
  logo_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.name,
    t.branding->>'primaryColor' as primary_color,
    t.branding->>'accentColor' as accent_color,
    t.branding->>'logoUrl' as logo_url
  from public.tenants t
  where t.slug = p_slug and t.status = 'active'
$$;

revoke all on function public.tenant_branding_by_slug(text) from public;
grant execute on function public.tenant_branding_by_slug(text) to anon, authenticated;
