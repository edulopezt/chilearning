-- =============================================================================
-- Task 5.2 (Hito 5, HU-8.1): Portal de la EMPRESA CLIENTE — modelo `companies`
-- + `company_members`, y CIERRE del acceso directo del rol `company` a las tablas
-- con dato personal (llega a sus trabajadores solo por el servicio del portal).
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
-- contrario: "jamás ve alumnos de otras empresas".
--
-- EL RULING (4-ojos): la rama `company` se ELIMINA, no se escopa
-- ----------------------------------------------------------------
-- La primera versión de esta migración acotaba la rama a "las filas de MI empresa".
-- Sonaba a defensa en profundidad; era lo contrario. Razón, en dos pasos:
--
--  1. La rama NO defiende el camino real. El portal lee por SERVICE-ROLE (a través
--     de `tenantGuard`), y el service-role BYPASSA RLS: si un día una consulta del
--     servicio olvidara `.eq("company_id", …)`, esta policy no la detendría. O sea:
--     sobre el único camino de la app, la rama aporta CERO.
--  2. La rama SÍ abre el camino que nadie usa, y ahí sí filtra. `company`,
--     `student` e `instructor` comparten el MISMO rol de Postgres (`authenticated`),
--     y el grant vivo de `enrollments` es de TABLA COMPLETA — incluida `run` — igual
--     que el de columnas de `sence_sessions` incluye `run_alumno` (20260716120000).
--     Con la anon key y su access token en el browser, RRHH podía hacer
--     `GET /rest/v1/enrollments?select=nombre,run` y saltarse el servicio que
--     enmascara y audita. Un `revoke select (run)` no es opción: rompería al alumno
--     y al staff, que son el mismo rol de Postgres.
--
-- Es decir: el enmascarado del RUN era COSMÉTICO (solo de UI) mientras existiera la
-- rama. El ruling ya aprobado dice "la empresa NUNCA ve el RUN completo"
-- (minimización, Ley 21.719); esto es lo que lo hace VERDADERO a nivel de dato.
--
-- Con la rama fuera, el rol `company` ve 0 filas de `enrollments` y `sence_sessions`
-- por PostgREST, y el ÚNICO camino al dato es `company-portal-service`, que enmascara
-- el RUN, acota por empresa y audita CADA consulta. No se pierde funcionalidad: la
-- matriz del spec §3 ("Empresa: R sus trabajadores") se sigue cumpliendo por ese
-- servicio, exactamente igual que ya se cumple para Calificaciones y Certificados.
--
-- Y es coherente con lo que esta misma migración ya decidía para `grades_select` y
-- `certificates_select`, que tampoco reciben rama `company` (el snapshot del
-- certificado lleva el RUN completo — precedente D-030). Ahora las 4 tablas con dato
-- personal siguen la MISMA regla: a la empresa llegan CURADAS por el servicio, nunca
-- por lectura directa de tabla.
--
-- Ninguna otra rama se toca — el texto de las demás (alumno/staff/supervisor) se
-- copia LITERAL de la migración 3.11 para no reabrir el escopado del fiscalizador.
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
  constraint companies_tenant_rut_uk unique (tenant_id, rut),
  -- Clave candidata redundante con la PK, pero necesaria como DESTINO de las FK
  -- compuestas de abajo: es lo que permite que el esquema —y no la memoria de cada
  -- writer— garantice que una empresa y lo que cuelga de ella son del MISMO tenant.
  constraint companies_id_tenant_uk unique (id, tenant_id)
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
  created_at timestamptz not null default now(),
  -- INTEGRIDAD COMPUESTA POR TENANT: sin esto nada del esquema impide una fila
  -- `(tenant_id = A, company_id = <empresa del tenant B>)`. `inviteCompanyMember`
  -- ya lo valida, pero un invariante multi-tenant no puede depender de que TODOS
  -- los writers futuros se acuerden.
  constraint company_members_company_same_tenant_fk
    foreign key (company_id, tenant_id) references public.companies (id, tenant_id)
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
-- Misma integridad compuesta que en `company_members`: una inscripción del tenant A
-- no puede quedar etiquetada con una empresa del tenant B. MATCH SIMPLE (el default)
-- no exige nada cuando `company_id` es NULL, así que el alumno particular sigue
-- funcionando sin `tenant_id` de por medio.
alter table public.enrollments
  add constraint enrollments_company_same_tenant_fk
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id);

-- ---------- Helper de escopado (usado en las policies de las 2 tablas nuevas) ----------
-- Mismo patrón que `supervisor_has_active_grant()` (3.11): SECURITY DEFINER para
-- leer `company_members` dentro de una policy sin exigirle al usuario `company`
-- SELECT directo sobre la tabla; `search_path=''` obliga nombres calificados
-- (anti-secuestro); STABLE = una evaluación por statement.
--
-- Alcance deliberadamente CHICO: solo escopa `companies` y `company_members`, que
-- NO llevan dato personal del trabajador (razón social, RUT de la empresa, correo
-- del propio equipo de RRHH). Las tablas con RUN —`enrollments`, `sence_sessions`,
-- `grades`, `certificates`— no tienen rama `company` en absoluto: ver el ruling de
-- la cabecera.
--
-- Devuelve NULL si el usuario no tiene membresía vigente (o si su tenant no está
-- activo: `jwt_tenant_id()` ya devuelve NULL en ese caso, 20260717010000). Ese NULL
-- propaga a las comparaciones de las policies como NULL → la fila NO pasa el USING:
-- deny-by-default (P7) sin ramas especiales.
--
-- No revalida el tenant de la empresa devuelta porque ya no puede hacer falta: la FK
-- compuesta `company_members_company_same_tenant_fk` lo garantiza en el esquema.
create or replace function public.company_member_company_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select cm.company_id
  from public.company_members cm
  where cm.user_id = (select auth.uid())
    and cm.tenant_id = public.jwt_tenant_id()
    and cm.revoked_at is null
  limit 1
$$;

grant execute on function public.company_member_company_id() to authenticated;

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

-- 1) enrollments: `or public.has_role('company')` → la rama DESAPARECE.
--    La fila de `enrollments` lleva `run` y el grant a `authenticated` es de tabla
--    completa: cualquier rama `company` aquí entrega el RUN por PostgREST. RRHH lee
--    a sus trabajadores por `company-portal-service` (RUN enmascarado + auditoría).
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
      )
    )
  );

-- 2) sence_sessions: `or public.has_role('company')` → la rama DESAPARECE.
--    Mismo motivo: los grants de COLUMNA de 20260716120000 ocultan `callback_nonce`
--    pero conceden `run_alumno` a `authenticated`. Esos grants no se tocan.
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
      )
    )
  );

-- ---------- Sin backfill: el acceso ENTRA CERRADO (a diferencia de 3.11) ----------
-- 3.11 backfilleó grants tenant-wide para PRESERVAR el acceso del supervisor. Aquí
-- lo correcto es lo opuesto: tras migrar, todo usuario `company` ve 0 inscripciones
-- y 0 sesiones por tabla —para siempre— y llega a sus trabajadores SOLO cuando un
-- admin/coordinador lo vincula a su empresa (parte 2) y SOLO a través del servicio
-- del portal, que enmascara el RUN y audita cada consulta. H4-R-008 queda cerrado
-- por construcción, y el acceso se abre únicamente de forma explícita y auditada.
