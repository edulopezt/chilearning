-- =============================================================================
-- Task 5.2 (Hito 5, HU-8.1): Portal de la EMPRESA CLIENTE — modelo `companies`
-- + `company_members` y ESCOPADO del rol `company` a SUS trabajadores.
--
-- ⚠ MIGRACIÓN SENSIBLE (4-ojos) — cierra el follow-up de seguridad H4-R-008.
--
-- EL HUECO QUE CIERRA
-- -------------------
-- Hasta hoy `or public.has_role('company')` aparecía PLANO (sin filtro alguno) en
-- 2 policies vivas — `enrollments_select` y `sence_sessions_select_staff`, ambas
-- recreadas por última vez en 20260716110000_supervisor_grants.sql. Efecto real:
-- un usuario con rol `company` leía TODAS las inscripciones y TODAS las sesiones
-- SENCE de su tenant, es decir, las de TODAS las empresas clientes del OTEC —
-- incluido el RUN de cada trabajador ajeno. La CA de HU-8.1 exige literalmente lo
-- contrario: "jamás ve alumnos de otras empresas". El agujero existía porque NO
-- había modelo company↔trabajadores contra el cual filtrar: esta migración lo crea
-- y lo aplica en la MISMA transacción que lo necesita.
--
-- El cambio de las 2 policies solo RESTRINGE (nunca amplía): la rama `company` pasa
-- de `true` a `true AND <la fila es de MI empresa>`. Ninguna otra rama se toca — el
-- texto de las demás (alumno/staff/supervisor) se copia LITERAL de la migración
-- 3.11 para no reabrir el escopado del fiscalizador.
--
-- NO se agrega rama `company` a `grades_select` ni a `certificates_select`: el
-- snapshot del certificado lleva el RUN completo (precedente D-030). Notas y
-- certificados llegan a la empresa CURADOS por el servicio del portal (parte 2),
-- nunca por lectura directa de tabla.
--
-- Las tablas SENCE no cambian su contrato ni su escritura (siguen INSERT-only):
-- aquí solo se acota QUIÉN puede SELECT (esto es RLS, no el módulo `sence/`).
-- =============================================================================

-- ---------- companies (la empresa cliente que contrata acciones al OTEC) ----------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  rut text not null check (length(rut) between 3 and 12),
  razon_social text not null check (length(razon_social) between 1 and 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- El RUT identifica a la empresa DENTRO del OTEC: dos tenants pueden atender a
  -- la misma empresa real sin colisionar (y sin verse: son filas distintas).
  constraint companies_tenant_rut_uk unique (tenant_id, rut)
);
create index companies_tenant_idx on public.companies (tenant_id);
create trigger companies_touch before update on public.companies
  for each row execute function public.touch_updated_at();

-- ---------- company_members (quién de RRHH entra por la empresa) ----------
create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  company_id uuid not null references public.companies (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  email text not null check (length(email) between 3 and 320),
  revoked_at timestamptz,       -- null = vigente
  revoked_by uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index company_members_company_idx on public.company_members (company_id);
-- Un usuario `company` pertenece a UNA sola empresa ACTIVA por tenant (ruling
-- aprobado). Es lo que hace bien definido a `company_member_company_id()`: sin este
-- índice, "mi empresa" sería ambiguo y el escopado dependería del `limit 1`.
-- Para mover a alguien de empresa: revocar y re-invitar (deja rastro).
create unique index company_members_active_uk
  on public.company_members (tenant_id, user_id) where revoked_at is null;

-- ---------- enrollments.company_id (el trabajador de QUÉ empresa) ----------
-- NULL = alumno particular (se inscribió por su cuenta, no lo manda una empresa):
-- ninguna empresa lo ve. Es el default y falla CERRADO.
alter table public.enrollments
  add column company_id uuid references public.companies (id) on delete restrict;
create index enrollments_company_idx on public.enrollments (company_id)
  where company_id is not null;

-- ---------- Helpers de escopado (usados en las policies) ----------
-- Mismo patrón que `supervisor_has_active_grant()` (3.11): SECURITY DEFINER para
-- leer `company_members` dentro de una policy sin exigirle al usuario `company`
-- SELECT directo sobre la tabla; `search_path=''` obliga nombres calificados
-- (anti-secuestro); STABLE = una evaluación por statement.
--
-- Devuelve NULL si el usuario no tiene membresía vigente (o si su tenant no está
-- activo: `jwt_tenant_id()` ya devuelve NULL en ese caso, 20260717010000). Ese NULL
-- propaga a las comparaciones de las policies como NULL → la fila NO pasa el USING:
-- deny-by-default (P7) sin ramas especiales.
create or replace function public.company_member_company_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select cm.company_id
  from public.company_members cm
  where cm.user_id = (select auth.uid())
    and cm.tenant_id = public.jwt_tenant_id()
    and cm.revoked_at is null
  limit 1
$$;

-- Transitivo: la sesión SENCE cuelga de una inscripción, no de la empresa.
-- `e.company_id is not null` es explícito (y no solo implícito por la igualdad)
-- para que la intención se lea sola: el alumno particular NO es de nadie.
create or replace function public.company_enrollment_is_mine(eid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.enrollments e
    where e.id = eid
      and e.company_id is not null
      and e.company_id = public.company_member_company_id()
  )
$$;

grant execute on function public.company_member_company_id() to authenticated;
grant execute on function public.company_enrollment_is_mine(uuid) to authenticated;

-- ---------- RLS de las tablas nuevas ----------
alter table public.companies enable row level security;
alter table public.companies force row level security;
-- El usuario de la empresa ve SU empresa; admin/coordinator gestionan las del tenant.
create policy companies_select on public.companies for select to authenticated using (
  public.is_superadmin() or (tenant_id = public.jwt_tenant_id() and (
    public.has_role('otec_admin') or public.has_role('coordinator')
    or id = public.company_member_company_id())));
grant select on public.companies to authenticated;
-- Sin DELETE: una empresa con inscripciones es historial SENCE (fk `on delete
-- restrict` en enrollments.company_id lo respalda).
grant select, insert, update on public.companies to service_role;

alter table public.company_members enable row level security;
alter table public.company_members force row level security;
create policy company_members_select on public.company_members for select to authenticated using (
  public.is_superadmin() or (tenant_id = public.jwt_tenant_id() and (
    public.has_role('otec_admin') or public.has_role('coordinator')
    or user_id = (select auth.uid())
    or company_id = public.company_member_company_id())));
grant select on public.company_members to authenticated;
-- Sin DELETE: una membresía se REVOCA (rastro), no se borra.
grant select, insert, update on public.company_members to service_role;

-- =============================================================================
-- HARDENING H4-R-008: las 2 policies VIVAS con `company` PLANO.
-- Texto copiado LITERAL de 20260716110000_supervisor_grants.sql (verificado contra
-- pg_policies); el ÚNICO cambio es la rama `company`.
-- =============================================================================

-- 1) enrollments: `or public.has_role('company')`
--    → `or (public.has_role('company') and company_id is not null
--           and company_id = public.company_member_company_id())`
--    La comparación va INLINE (no por helper) porque la fila ya trae `company_id`:
--    el planner filtra por índice en vez de invocar la función por fila.
drop policy enrollments_select on public.enrollments;
create policy enrollments_select on public.enrollments
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        user_id = (select auth.uid())
        or public.has_role('otec_admin')
        or public.has_role('coordinator')
        or public.has_role('instructor')
        or public.has_role('tutor')
        or (public.has_role('supervisor') and public.supervisor_action_in_scope(action_id))
        or (
          public.has_role('company')
          and company_id is not null
          and company_id = public.company_member_company_id()
        )
      )
    )
  );

-- 2) sence_sessions: `or public.has_role('company')`
--    → `or (public.has_role('company') and public.company_enrollment_is_mine(enrollment_id))`
--    Transitivo por `enrollment_id` (la sesión no tiene `company_id` propio).
--    Los grants de COLUMNA de 20260716120000 (callback_nonce oculto) no se tocan.
drop policy sence_sessions_select_staff on public.sence_sessions;
create policy sence_sessions_select_staff on public.sence_sessions
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        public.has_role('otec_admin')
        or public.has_role('coordinator')
        or public.has_role('instructor')
        or public.has_role('tutor')
        or (public.has_role('supervisor') and public.supervisor_enrollment_in_scope(enrollment_id))
        or (public.has_role('company') and public.company_enrollment_is_mine(enrollment_id))
      )
    )
  );

-- ---------- Sin backfill: el escopado ENTRA CERRADO (a diferencia de 3.11) ----------
-- 3.11 backfilleó grants tenant-wide para PRESERVAR el acceso del supervisor. Aquí
-- lo correcto es lo opuesto: no existe dato de qué empresa es cada usuario `company`
-- (el modelo nace en esta migración), así que inventar una vinculación sería
-- inventar el permiso que este PR viene a acotar. Tras migrar, todo usuario
-- `company` ve 0 inscripciones hasta que un admin/coordinador lo vincule a su
-- empresa (parte 2). Es exactamente el estado seguro: H4-R-008 cerrado por
-- construcción, y el acceso se vuelve a abrir SOLO de forma explícita y auditada.
