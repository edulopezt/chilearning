-- =============================================================================
-- Tenant lifecycle (task 5.3, HU-1.1/1.4/1.3):
--   1) RPC pública de estado por slug (aviso de suspensión en el middleware).
--   2) Auth Hook endurecido: usuario de tenant suspendido = login sin roles.
--   3) Trigger de roles: exención explícita para el service_role (código de
--      servidor confiable bajo tenantGuard) — sin ella HU-1.1 es imposible.
--   4) jwt_tenant_id() endurecido: la suspensión corta el plano de datos al
--      instante, no solo la emisión de tokens (revisión 4-ojos).
-- No crea tablas: `tenants` ya trae slug/plan/branding/flags/status.
-- =============================================================================

-- ---------- 1) Estado del tenant por slug (sin JWT) ----------
-- El middleware debe saber si el tenant del subdominio está suspendido ANTES de
-- que exista sesión (el aviso se ve también deslogueado, HU-1.4). SECURITY
-- DEFINER: anon no tiene GRANT sobre tenants y no debe tenerlo; esta función
-- expone SOLO el enum de estado. Sondear la existencia de un slug no filtra
-- nada sensible: el subdominio ya responde públicamente.
create or replace function public.tenant_status_by_slug(p_slug text)
returns public.tenant_status
language sql
stable
security definer
set search_path = ''
as $$
  select t.status from public.tenants t where t.slug = p_slug
$$;

revoke all on function public.tenant_status_by_slug(text) from public;
grant execute on function public.tenant_status_by_slug(text) to anon, authenticated;

-- Bajo `force row level security` el rol dueño (postgres) NO bypassa RLS en
-- Supabase cloud (mismo hallazgo que motivó el hook SECURITY INVOKER en la
-- migración 20260714212003): sin esta policy el DEFINER leería 0 filas en
-- producción y la función devolvería NULL siempre. En local (postgres es
-- superusuario) no hace falta, en cloud sí. Solo SELECT, solo para el definer.
create policy tenants_select_definer on public.tenants
  for select to postgres
  using (true);

-- ---------- 2) Auth Hook endurecido (HU-1.4: suspensión bloquea el login) ----------
-- El hook ahora también lee public.tenants (join por status). Mismo patrón de
-- permisos que memberships/platform_admins: GRANT + policy permisiva para
-- supabase_auth_admin, el rol con el que GoTrue ejecuta el hook (INVOKER).
grant select on public.tenants to supabase_auth_admin;

create policy tenants_select_auth_admin on public.tenants
  as permissive for select to supabase_auth_admin
  using (true);

-- Cuerpo EXACTO de la migración 20260714212003 con UN solo cambio: TODAS las
-- consultas a public.memberships exigen tenant ACTIVO (join public.tenants con
-- t.status = 'active'). Resultado: usuario de tenant suspendido => claims sin
-- roles => RLS deniega todo (falla cerrado). platform_admins no se toca: el
-- superadmin no pertenece a ningún tenant y debe poder reactivar.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  claims jsonb;
  uid uuid;
  is_platform_admin boolean;
  membership_count int;
  active_tenant uuid;
  active_roles text[];
  all_memberships jsonb;
begin
  uid := (event ->> 'user_id')::uuid;
  claims := coalesce(event -> 'claims', '{}'::jsonb);

  -- Punto de partida: SIN privilegios. Cada claim se agrega solo si se prueba.
  -- (Impide que un claim inyectado aguas arriba sobreviva.)
  claims := claims - 'tenant_id' - 'roles' - 'memberships';

  select exists (select 1 from public.platform_admins pa where pa.user_id = uid)
    into is_platform_admin;

  if is_platform_admin then
    -- Superadmin de plataforma: sin tenant (opera transversalmente).
    claims := jsonb_set(claims, '{roles}', '["superadmin"]'::jsonb);
    event := jsonb_set(event, '{claims}', claims);
    return event;
  end if;

  select count(*) into membership_count
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id and t.status = 'active'
  where m.user_id = uid and m.status = 'active';

  if membership_count = 1 then
    select m.tenant_id, array(select unnest(m.roles)::text)
      into active_tenant, active_roles
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
    where m.user_id = uid and m.status = 'active';

    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(active_tenant::text));
    claims := jsonb_set(claims, '{roles}', to_jsonb(active_roles));

  elsif membership_count > 1 then
    -- Multi-tenant: se informan las membresías pero NO se activa ninguna.
    -- Sin `tenant_id`, el RLS deniega todo (falla cerrado). La selección de
    -- tenant por sesión llega en el Hito 1.
    select jsonb_agg(
             jsonb_build_object(
               'tenant_id', m.tenant_id::text,
               'roles', array(select unnest(m.roles)::text)
             )
           )
      into all_memberships
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
    where m.user_id = uid and m.status = 'active';

    claims := jsonb_set(claims, '{memberships}', coalesce(all_memberships, '[]'::jsonb));
    claims := jsonb_set(claims, '{roles}', '[]'::jsonb);
  else
    -- Sin membresías activas (o suspendidas, o de tenants suspendidos):
    -- usuario sin acceso a nada.
    claims := jsonb_set(claims, '{roles}', '[]'::jsonb);
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- SOLO para tests de integración: permite invocar el hook vía RPC con el
-- service_role y verificar los claims que emitiría un login real (en producción
-- lo invoca GoTrue como supabase_auth_admin). No amplía poder alguno: el
-- service_role ya bypassa RLS; el hook solo COMPUTA claims, no muta nada.
grant execute on function public.custom_access_token_hook(jsonb) to service_role;

-- ---------- 3) memberships_guard_roles: exención del service_role ----------
-- La migración 20260714185828 documentó que la regla "solo un otec_admin otorga
-- otec_admin" NO aplica al código de servidor confiable, pero su check
-- `auth.jwt() is not null` no lo cumplía: PostgREST SÍ adjunta claims
-- ({"role":"service_role"}) al service role, y el trigger bloqueaba el alta del
-- admin inicial de un tenant nuevo (HU-1.1, verificado en local). Se exime
-- explícitamente al service_role, que en la app solo opera detrás de
-- tenantGuard() y jamás se expone al cliente. La regla para usuarios reales
-- (otec_admin/coordinator con JWT de la app) queda intacta.
create or replace function public.memberships_guard_roles()
returns trigger
language plpgsql
as $$
begin
  if 'otec_admin' = any (new.roles)
     and auth.jwt() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not (public.has_role('otec_admin') or public.is_superadmin())
  then
    raise exception 'solo un otec_admin puede otorgar el rol otec_admin'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------- 4) jwt_tenant_id(): la suspensión corta el plano de datos ----------
-- El hook (sección 2) solo actúa al EMITIR tokens: un access token ya firmado
-- (jwt_expiry = 3600) seguiría leyendo/escribiendo contra PostgREST hasta 1 h
-- después de suspender — ese camino no pasa por el middleware de la app. Este
-- endurecimiento cierra la BD: si el tenant del claim NO está activo,
-- jwt_tenant_id() devuelve NULL y toda policy de negocio deniega AL INSTANTE
-- (deny-by-default, P7). Simétrico: al reactivar, los tokens emitidos antes de
-- la suspensión vuelven a operar sin re-login (HU-1.4, reactivación en 1 clic).
--
-- SECURITY DEFINER: la consulta a public.tenants corre como postgres, cubierta
-- por la policy tenants_select_definer (sección 1). NO recursa: esa policy es
-- `using (true)` y no invoca helpers de claims. El cast sigue siendo SEGURO
-- (claim malformado => NULL, sin 22P02), como en 20260714185828.
create or replace function public.jwt_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.tenants t
  where t.id = case
      when (auth.jwt() ->> 'tenant_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (auth.jwt() ->> 'tenant_id')::uuid
      else null
    end
    and t.status = 'active'
$$;
