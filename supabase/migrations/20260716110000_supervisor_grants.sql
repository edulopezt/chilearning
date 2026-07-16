-- =============================================================================
-- Task 3.11 (Hito 3, HU-12.1/12.2): Portal Supervisor COMPLETO — invitaciones,
-- ALCANCE por acción, VIGENCIA (expiración) y REVOCACIÓN, con AUDITORÍA de cada
-- consulta (esto último en el servicio; RLS no escribe en SELECT).
--
-- El fiscalizador sigue siendo SOLO LECTURA (task 2.5, gate `supervisor-readonly`).
-- Aquí se le pone una LLAVE con vigencia y alcance: sin grant activo NO ve nada;
-- con grant de alcance 'actions' solo ve las acciones concedidas.
--
-- ⚠ MIGRACIÓN SENSIBLE (4-ojos): endurece 6 policies vivas — reemplaza el permiso
-- plano `has_role('supervisor')` por `has_role('supervisor') AND <grant activo y en
-- alcance>`. Solo RESTRINGE (nunca amplía). Backfill de supervisores existentes con
-- grant tenant-wide sin expiración en la MISMA migración (preserva comportamiento).
-- Las tablas SENCE (`sence_sessions`, `sence_events`) NO cambian su contrato ni su
-- escritura (siguen INSERT-only): solo se acota QUIÉN puede SELECT.
-- =============================================================================

create type public.supervisor_scope as enum ('tenant', 'actions');

-- ---------- supervisor_grants (vigencia + alcance del fiscalizador) ----------
create table public.supervisor_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  email text not null check (length(email) between 3 and 320),
  scope public.supervisor_scope not null default 'tenant',
  expires_at timestamptz,       -- null = sin expiración
  revoked_at timestamptz,       -- null = vigente
  revoked_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index supervisor_grants_tenant_idx on public.supervisor_grants (tenant_id);
create index supervisor_grants_user_idx on public.supervisor_grants (user_id, tenant_id);
-- A lo más un grant VIGENTE por (tenant, usuario): revocar antes de re-emitir.
create unique index supervisor_grants_active_uk
  on public.supervisor_grants (tenant_id, user_id) where revoked_at is null;
create trigger supervisor_grants_touch before update on public.supervisor_grants
  for each row execute function public.touch_updated_at();

-- Alcance por acción (solo cuando scope = 'actions').
create table public.supervisor_grant_actions (
  grant_id uuid not null references public.supervisor_grants (id) on delete cascade,
  action_id uuid not null references public.actions (id) on delete restrict,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  primary key (grant_id, action_id)
);
create index supervisor_grant_actions_action_idx on public.supervisor_grant_actions (action_id);
create index supervisor_grant_actions_tenant_idx on public.supervisor_grant_actions (tenant_id);

-- ---------- Helpers de vigencia/alcance (usados en las policies) ----------
-- SECURITY DEFINER: leen grants de terceros dentro de policies sin exigirle al
-- fiscalizador SELECT directo sobre las tablas de grants. `search_path=''` obliga
-- nombres calificados (anti-secuestro). STABLE: una evaluación por statement.
create or replace function public.supervisor_has_active_grant()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.supervisor_grants g
    where g.user_id = (select auth.uid())
      and g.tenant_id = public.jwt_tenant_id()
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
  )
$$;

create or replace function public.supervisor_action_in_scope(aid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.supervisor_grants g
    where g.user_id = (select auth.uid())
      and g.tenant_id = public.jwt_tenant_id()
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
      and (
        g.scope = 'tenant'
        or exists (
          select 1 from public.supervisor_grant_actions ga
          where ga.grant_id = g.id and ga.action_id = aid
        )
      )
  )
$$;

-- Transitivos: la fila cuelga de una inscripción / sesión, no de la acción directa.
create or replace function public.supervisor_enrollment_in_scope(eid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.enrollments e
    where e.id = eid and public.supervisor_action_in_scope(e.action_id)
  )
$$;

create or replace function public.supervisor_session_in_scope(sid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sence_sessions s
    where s.id = sid and public.supervisor_enrollment_in_scope(s.enrollment_id)
  )
$$;

-- ¿Tiene un grant VIGENTE de alcance TENANT? Para señales tenant-wide (alertas sin
-- acción): un fiscalizador de alcance 'actions' no debe ver las señales globales del OTEC.
create or replace function public.supervisor_has_tenant_grant()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.supervisor_grants g
    where g.user_id = (select auth.uid())
      and g.tenant_id = public.jwt_tenant_id()
      and g.scope = 'tenant'
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
  )
$$;

grant execute on function public.supervisor_has_active_grant() to authenticated;
grant execute on function public.supervisor_action_in_scope(uuid) to authenticated;
grant execute on function public.supervisor_enrollment_in_scope(uuid) to authenticated;
grant execute on function public.supervisor_session_in_scope(uuid) to authenticated;
grant execute on function public.supervisor_has_tenant_grant() to authenticated;

-- ---------- RLS de las nuevas tablas ----------
alter table public.supervisor_grants enable row level security;
alter table public.supervisor_grants force row level security;
-- El fiscalizador ve SU propio grant; admin/coordinator gestionan los del tenant.
create policy supervisor_grants_select on public.supervisor_grants for select to authenticated using (
  public.is_superadmin() or (tenant_id = public.jwt_tenant_id() and (
    user_id = (select auth.uid()) or public.has_role('otec_admin') or public.has_role('coordinator'))));
grant select on public.supervisor_grants to authenticated;
-- Sin DELETE: un grant se REVOCA (rastro), no se borra.
grant select, insert, update on public.supervisor_grants to service_role;

alter table public.supervisor_grant_actions enable row level security;
alter table public.supervisor_grant_actions force row level security;
create policy supervisor_grant_actions_select on public.supervisor_grant_actions for select to authenticated using (
  public.is_superadmin() or (tenant_id = public.jwt_tenant_id() and (
    public.has_role('otec_admin') or public.has_role('coordinator')
    or exists (select 1 from public.supervisor_grants g where g.id = grant_id and g.user_id = (select auth.uid())))));
grant select on public.supervisor_grant_actions to authenticated;
grant select, insert, delete on public.supervisor_grant_actions to service_role;

-- =============================================================================
-- ENDURECIMIENTO de las 6 policies vivas: `has_role('supervisor')` →
-- `has_role('supervisor') AND <vigente y en alcance>`. Solo se toca la rama del
-- supervisor; el resto de cada policy queda idéntico (company/alumno/staff sin cambio).
-- =============================================================================

-- 1) enrollments (tiene action_id directo → alcance por acción tight en RLS).
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
        or public.has_role('company')
      )
    )
  );

-- 2) sence_sessions (transitivo por enrollment_id).
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
        or public.has_role('company')
      )
    )
  );

-- 3) sence_events (transitivo por session_id).
drop policy sence_events_select_admin on public.sence_events;
create policy sence_events_select_admin on public.sence_events
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        public.has_role('otec_admin')
        or (public.has_role('supervisor') and public.supervisor_session_in_scope(session_id))
      )
    )
  );

-- 4) grades (transitivo por enrollment_id; supervisor solo publicadas y en alcance).
drop policy grades_select on public.grades;
create policy grades_select on public.grades
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        public.has_role('otec_admin') or public.has_role('coordinator')
        or public.has_role('instructor') or public.has_role('tutor')
        or (
          status = 'published'
          and (
            exists (
              select 1 from public.enrollments e
              where e.id = grades.enrollment_id and e.user_id = (select auth.uid())
            )
            or (public.has_role('supervisor') and public.supervisor_enrollment_in_scope(grades.enrollment_id))
          )
        )
      )
    )
  );

-- 5) lesson_progress (transitivo por enrollment_id).
drop policy lesson_progress_select on public.lesson_progress;
create policy lesson_progress_select on public.lesson_progress
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        exists (
          select 1 from public.enrollments e
          where e.id = lesson_progress.enrollment_id and e.user_id = (select auth.uid())
        )
        or public.has_role('otec_admin')
        or public.has_role('coordinator')
        or public.has_role('instructor')
        or public.has_role('tutor')
        or (public.has_role('supervisor') and public.supervisor_enrollment_in_scope(lesson_progress.enrollment_id))
      )
    )
  );

-- 6) alerts: OJO — algunas alertas SÍ cuelgan de una acción (`sence_day1_low_attendance`
-- lleva `action_id` + código + cifras); otras son tenant-wide (`sence_error_rate`,
-- `action_id` NULL). Se escopa igual que el resto (4-ojos MED): la alerta con acción
-- exige la acción en alcance; la tenant-wide exige grant de alcance TENANT.
drop policy alerts_select_admin on public.alerts;
create policy alerts_select_admin on public.alerts
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        public.has_role('otec_admin')
        or (public.has_role('supervisor') and (
          case
            when action_id is not null then public.supervisor_action_in_scope(action_id)
            else public.supervisor_has_tenant_grant()
          end
        ))
      )
    )
  );

-- ---------- Backfill: supervisores EXISTENTES conservan acceso ----------
-- Grant tenant-wide sin expiración por cada membership de supervisor sin grant
-- vigente. En dev local las memberships se siembran DESPUÉS de las migraciones,
-- así que aquí no inserta nada; el seed crea sus propios grants (ver seed.sql).
-- En cloud/prod (memberships ya existen) sí corre y preserva el comportamiento.
insert into public.supervisor_grants (tenant_id, user_id, email, scope, created_by)
select m.tenant_id, m.user_id, coalesce(u.email, 'supervisor@backfill.local'), 'tenant', null
from public.memberships m
join auth.users u on u.id = m.user_id
where 'supervisor' = any (m.roles)
  and not exists (
    select 1 from public.supervisor_grants g
    where g.tenant_id = m.tenant_id and g.user_id = m.user_id and g.revoked_at is null
  );
