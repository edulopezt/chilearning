-- =============================================================================
-- Auth Hook (task 0.4): inyecta los claims `tenant_id` y `roles` en el JWT.
--
-- Las policies RLS de la migración inicial ya EXIGEN estos claims; sin el hook,
-- un login real no ve nada (deny-by-default, P7). Aquí se cierra ese circuito.
--
-- Fuente de cada claim:
--  - `roles` + `tenant_id`  ← tabla `memberships` (usuario ↔ tenant ↔ roles[])
--  - rol `superadmin`       ← tabla `platform_admins` (NUNCA una membership;
--                             ver DECISIONES D-006: un otec_admin no puede
--                             fabricarse un superadmin escribiendo memberships)
--
-- Usuario multi-tenant (ej. relator en dos OTECs): el hook NO adivina cuál es
-- el tenant activo. Emite la lista en `memberships` y deja `tenant_id` SIN
-- definir → el RLS deniega todo hasta que exista selección de tenant por sesión
-- (Hito 1). Falla cerrado, nunca abierto.
-- =============================================================================

-- ---------- platform_admins (quién es superadmin de la plataforma) ----------
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Superadmins de plataforma. Fuente UNICA del rol superadmin (D-006). Solo se administra por migracion/servidor: ningun rol de la app puede escribirla.';

alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;

-- Ni `authenticated` ni `anon` reciben GRANT alguno: la tabla es invisible y no
-- escribible desde la app. Solo la leen el hook y el servidor (service_role).
grant select on public.platform_admins to service_role;

create policy platform_admins_select_service on public.platform_admins
  for select to service_role
  using (true);

-- ---------- El hook ----------
-- SECURITY INVOKER (patrón oficial de Supabase): GoTrue lo invoca como el rol
-- `supabase_auth_admin`, así que el cuerpo lee memberships/platform_admins con
-- ese rol, autorizado por los GRANT + policies `_select_auth_admin` de más
-- abajo. NO se usa SECURITY DEFINER: bajo `force row level security` el rol
-- dueño (postgres) NO bypassa RLS en Supabase cloud (solo lo hace en algunos
-- entornos locales), y un definer leería 0 filas en producción → login roto.
-- `search_path = ''` + nombres calificados: no secuestrable por resolución de
-- nombres.
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
  where m.user_id = uid and m.status = 'active';

  if membership_count = 1 then
    select m.tenant_id, array(select unnest(m.roles)::text)
      into active_tenant, active_roles
    from public.memberships m
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
    where m.user_id = uid and m.status = 'active';

    claims := jsonb_set(claims, '{memberships}', coalesce(all_memberships, '[]'::jsonb));
    claims := jsonb_set(claims, '{roles}', '[]'::jsonb);
  else
    -- Sin membresías activas (o suspendidas): usuario sin acceso a nada.
    claims := jsonb_set(claims, '{roles}', '[]'::jsonb);
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- ---------- Permisos del hook (patrón oficial de Supabase) ----------
grant usage on schema public to supabase_auth_admin;

grant execute on function public.custom_access_token_hook(jsonb)
  to supabase_auth_admin;

revoke execute on function public.custom_access_token_hook(jsonb)
  from authenticated, anon, public;

grant select on public.memberships to supabase_auth_admin;
grant select on public.platform_admins to supabase_auth_admin;

create policy memberships_select_auth_admin on public.memberships
  as permissive for select to supabase_auth_admin
  using (true);

create policy platform_admins_select_auth_admin on public.platform_admins
  as permissive for select to supabase_auth_admin
  using (true);
