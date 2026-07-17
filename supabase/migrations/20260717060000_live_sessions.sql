-- =============================================================================
-- Task 5.4 (Hito 5, spec §7-R3): sincrónico en vivo — ALCANCE SEGURO.
--
-- La videoconferencia se enlaza EXTERNA (Zoom/Meet/Teams, fuera de alcance v1,
-- spec §6); esta migración solo agrega (a) programación de sesiones en vivo
-- por acción y (b) asistencia INTERNA (no SENCE) por sesión, exportable.
--
-- ⚠ El registro de asistencia SENCE de sesiones sincrónicas vía RCE está
-- PENDIENTE DE VERIFICACIÓN NORMATIVA (spec §7-R3). Esta migración NO crea
-- ninguna tabla `sence_*`, no toca ninguna tabla/policy existente del motor
-- SENCE y no implementa lógica de registro RCE: la asistencia de aquí es
-- informativa, sin efecto en el candado de contenido ni en DJ/GCA (ver
-- docs/sence/SINCRONICO-PENDIENTE-NORMA.md).
-- =============================================================================

-- ---------- live_sessions (sesión en vivo programada por acción) ----------
create table public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  action_id uuid not null references public.actions (id) on delete restrict,
  title text not null check (length(title) between 1 and 200),
  provider text not null check (provider in ('zoom', 'meet', 'teams', 'otro')),
  -- Enlace EXTERNO (la videoconferencia propia queda fuera de alcance v1).
  meeting_url text not null check (meeting_url like 'https://%' and length(meeting_url) <= 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  details text not null default '' check (length(details) <= 2000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index live_sessions_tenant_idx on public.live_sessions (tenant_id);
create index live_sessions_action_idx on public.live_sessions (tenant_id, action_id, starts_at);

-- Reusa el trigger genérico ya definido para otras tablas (courses/actions no
-- lo usan, pero announcements/calendar_items/forum_threads sí): actualiza
-- `updated_at`, sin relación alguna con el motor SENCE.
create trigger live_sessions_touch before update on public.live_sessions
  for each row execute function public.touch_updated_at();

alter table public.live_sessions enable row level security;
alter table public.live_sessions force row level security;

-- Select: superadmin, staff del tenant, supervisor CON la acción en su
-- alcance vigente (reusa `supervisor_action_in_scope`, task 3.11), o el propio
-- alumno SI está inscrito en la acción de la sesión.
create policy live_sessions_select on public.live_sessions
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
        or (public.has_role('supervisor') and public.supervisor_action_in_scope(action_id))
        or exists (
          select 1 from public.enrollments e
          where e.action_id = live_sessions.action_id
            and e.user_id = (select auth.uid())
            and e.tenant_id = public.jwt_tenant_id()
        )
      )
    )
  );

grant select on public.live_sessions to authenticated;
-- DELETE incluido: `deleteLiveSession` borra la fila cuando NO tiene asistencia
-- registrada (si la tiene, el servicio rechaza antes de llegar aquí — nunca
-- se borra en cascada, ver la tabla de abajo).
grant select, insert, update, delete on public.live_sessions to service_role;

-- ---------- live_session_attendance (asistencia INTERNA, no SENCE/RCE) ----------
create table public.live_session_attendance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  session_id uuid not null references public.live_sessions (id) on delete restrict,
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  present boolean not null default true,
  source text not null check (source in ('self', 'manual')),
  marked_by uuid not null,
  note text not null default '' check (length(note) <= 500),
  marked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, enrollment_id)
);

create index live_session_attendance_tenant_idx on public.live_session_attendance (tenant_id);
create index live_session_attendance_session_idx on public.live_session_attendance (session_id);
create index live_session_attendance_enrollment_idx on public.live_session_attendance (enrollment_id);

create trigger live_session_attendance_touch before update on public.live_session_attendance
  for each row execute function public.touch_updated_at();

alter table public.live_session_attendance enable row level security;
alter table public.live_session_attendance force row level security;

-- Select: superadmin, staff del tenant, supervisor con la acción (transitiva
-- por enrollment, reusa `supervisor_enrollment_in_scope`), o el propio alumno
-- vía su enrollment_id.
create policy live_session_attendance_select on public.live_session_attendance
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
        or exists (
          select 1 from public.enrollments e
          where e.id = live_session_attendance.enrollment_id
            and e.user_id = (select auth.uid())
            and e.tenant_id = public.jwt_tenant_id()
        )
      )
    )
  );

grant select on public.live_session_attendance to authenticated;
-- SIN delete (a propósito): una sesión con asistencia registrada NO se borra
-- ni se corrige por eliminación — se corrige con un nuevo upsert (manual gana
-- sobre self-mark, ver live-session-service.ts). El cliente tampoco escribe
-- directo: solo el servidor vía tenantGuard (insert/update).
grant select, insert, update on public.live_session_attendance to service_role;
