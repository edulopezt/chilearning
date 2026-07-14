-- =============================================================================
-- Core foundation: tenants, memberships, audit_log (task 0.2)
-- Multi-tenant con RLS en TODAS las tablas (P2) + audit_log INSERT-only (P8).
-- Los claims del JWT (tenant_id, roles) los inyecta el Auth Hook (task 0.4);
-- las policies ya los leen desde ahora para que los tests de aislamiento
-- ejerciten el modelo definitivo.
-- Roles (spec §3, identificadores en inglés):
--   superadmin (plataforma) · otec_admin (Admin OTEC) · coordinator (Coordinador
--   académico) · instructor (Relator) · tutor (Tutor/ayudante) · student (Alumno)
--   · company (Empresa cliente) · supervisor (Supervisor externo/fiscalizador)
-- =============================================================================

-- ---------- Tipos ----------
create type public.role_key as enum (
  'superadmin', 'otec_admin', 'coordinator', 'instructor',
  'tutor', 'student', 'company', 'supervisor'
);

create type public.tenant_status as enum ('active', 'suspended');
create type public.membership_status as enum ('active', 'disabled');

-- ---------- Helpers de claims (usados por TODAS las policies) ----------
-- Devuelven NULL/array vacío si el claim no existe: deny-by-default (P7).

create or replace function public.jwt_tenant_id()
returns uuid
language sql stable
as $$
  -- Cast SEGURO: un claim malformado deniega (NULL) en vez de reventar la query
  -- con 22P02 (deny-by-default limpio, P7; evita DoS si el Hook emite basura).
  select case
    when (auth.jwt() ->> 'tenant_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (auth.jwt() ->> 'tenant_id')::uuid
    else null
  end
$$;

create or replace function public.jwt_roles()
returns text[]
language sql stable
as $$
  select coalesce(
    array(select jsonb_array_elements_text(
      case when jsonb_typeof(auth.jwt() -> 'roles') = 'array'
           then auth.jwt() -> 'roles'
           else '[]'::jsonb
      end
    )),
    '{}'::text[]
  )
$$;

create or replace function public.has_role(required text)
returns boolean
language sql stable
as $$
  select required = any (public.jwt_roles())
$$;

create or replace function public.is_superadmin()
returns boolean
language sql stable
as $$
  select public.has_role('superadmin')
$$;

-- ---------- tenants ----------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
  name text not null check (length(name) between 1 and 200),
  rut text,
  plan text not null default 'standard',
  branding jsonb not null default '{}'::jsonb,
  flags jsonb not null default '{}'::jsonb,
  status public.tenant_status not null default 'active',
  created_at timestamptz not null default now()
);

comment on table public.tenants is
  'OTECs (tenants). Slugs reservados se validan en aplicación y en seeds.';

alter table public.tenants enable row level security;
alter table public.tenants force row level security;

-- Miembros del tenant lo pueden LEER; solo superadmin lo administra (HU-1.1).
create policy tenants_select_member on public.tenants
  for select to authenticated
  using (id = public.jwt_tenant_id() or public.is_superadmin());

create policy tenants_all_superadmin on public.tenants
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- ---------- memberships ----------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  roles public.role_key[] not null check (cardinality(roles) >= 1),
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  -- `superadmin` es rol de PLATAFORMA: vive solo en el claim del JWT que emite
  -- el Auth Hook, jamás en una membership. Sin esto, un otec_admin/coordinator
  -- podría escalar a superadmin escribiéndose la fila (hallazgo C1 de la
  -- revisión adversarial).
  constraint memberships_no_platform_role
    check (not ('superadmin' = any (roles)))
);

create index memberships_tenant_idx on public.memberships (tenant_id);
create index memberships_user_idx on public.memberships (user_id);

alter table public.memberships enable row level security;
alter table public.memberships force row level security;

-- Matriz spec §3 "Usuarios del tenant": AdminOTEC CRUD · Coordinador CRU ·
-- cada usuario ve su propia membresía. Todo acotado al tenant del JWT.
create policy memberships_select on public.memberships
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        public.has_role('otec_admin')
        or public.has_role('coordinator')
        or user_id = (select auth.uid())
      )
    )
  );

create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (
    tenant_id = public.jwt_tenant_id()
    and (public.has_role('otec_admin') or public.has_role('coordinator'))
  );

create policy memberships_update on public.memberships
  for update to authenticated
  using (
    tenant_id = public.jwt_tenant_id()
    and (public.has_role('otec_admin') or public.has_role('coordinator'))
  )
  with check (tenant_id = public.jwt_tenant_id());

create policy memberships_delete on public.memberships
  for delete to authenticated
  using (tenant_id = public.jwt_tenant_id() and public.has_role('otec_admin'));

create policy memberships_all_superadmin on public.memberships
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- Techo de asignación de roles (hallazgo C1): RLS no puede comparar el rol del
-- actor contra el rol que asigna, así que lo hace un trigger. Regla: solo un
-- otec_admin (o el superadmin de plataforma, HU-1.1: crea el admin inicial)
-- puede otorgar `otec_admin`; un coordinator NO puede crear administradores ni
-- ascenderse. En contextos sin JWT (seeds, migraciones, worker con service_role
-- bajo tenantGuard) la regla no aplica: son código servidor confiable.
create or replace function public.memberships_guard_roles()
returns trigger
language plpgsql
as $$
begin
  if 'otec_admin' = any (new.roles)
     and auth.jwt() is not null
     and not (public.has_role('otec_admin') or public.is_superadmin())
  then
    raise exception 'solo un otec_admin puede otorgar el rol otec_admin'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger memberships_guard_roles_trg
  before insert or update on public.memberships
  for each row execute function public.memberships_guard_roles();

-- ---------- audit_log (INSERT-only, P8) ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  -- NULL = acción de plataforma (superadmin) sin tenant.
  tenant_id uuid references public.tenants (id) on delete restrict,
  actor_user_id uuid,
  action text not null check (length(action) between 1 and 100),
  entity text,
  entity_id text,
  ip inet,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_tenant_idx on public.audit_log (tenant_id, created_at desc);

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

-- Escribe: cualquier usuario autenticado, SOLO sobre su propio tenant y como
-- su propio actor. Superadmin puede escribir eventos de plataforma (tenant NULL).
create policy audit_insert_member on public.audit_log
  for insert to authenticated
  with check (
    (
      tenant_id = public.jwt_tenant_id()
      and actor_user_id = (select auth.uid())
    )
    -- El superadmin escribe eventos de plataforma (sin tenant), pero TAMBIÉN
    -- queda fijado como actor: la traza nunca puede falsear quién actuó (P8).
    or (
      public.is_superadmin()
      and tenant_id is null
      and actor_user_id = (select auth.uid())
    )
  );

-- Lee: AdminOTEC su tenant; superadmin todo (matriz spec §3 "Auditoría").
create policy audit_select_admin on public.audit_log
  for select to authenticated
  using (
    public.is_superadmin()
    or (tenant_id = public.jwt_tenant_id() and public.has_role('otec_admin'))
  );

-- Sin policies de UPDATE/DELETE y ADEMÁS privilegios revocados a nivel de rol
-- de BD (plan §4, reglas duras): ni siquiera el service role puede mutar.
revoke update, delete, truncate on table public.audit_log from anon;
revoke update, delete, truncate on table public.audit_log from authenticated;
revoke update, delete, truncate on table public.audit_log from service_role;

-- ---------- Privilegios explícitos (mínimos) ----------
-- Las imágenes actuales de Supabase NO otorgan privilegios por defecto en
-- tablas nuevas: cada migración declara los suyos. `anon` NO recibe ninguno
-- (deny-by-default, P7); RLS restringe lo que estos GRANTs permiten.
grant usage on schema public to authenticated, service_role;

-- tenants: los miembros solo LEEN; crear/editar/borrar es potestad del
-- superadmin, que actúa por el servidor (service_role bajo tenantGuard).
grant select on public.tenants to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert on public.audit_log to authenticated;

grant select, insert, update, delete on public.tenants to service_role;
grant select, insert, update, delete on public.memberships to service_role;
grant select, insert on public.audit_log to service_role;

-- Sin GRANT sobre secuencias: las identity columns no lo requieren y `select`
-- sobre la secuencia de audit_log filtraría el conteo global de eventos de
-- TODA la plataforma (las secuencias no están sujetas a RLS).

-- Cinturón y tirantes: trigger que bloquea UPDATE/DELETE incluso para roles
-- con privilegios de tabla (el mantenimiento de BD queda fuera de la app).
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is INSERT-only (P8)';
end;
$$;

create trigger audit_log_no_update
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- TRUNCATE no dispara triggers de fila: necesita su propio trigger de sentencia.
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();
