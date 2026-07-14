-- =============================================================================
-- SENCE engine (task 0.7): sence_sessions + sence_events.
-- Deriva LITERALMENTE del contrato congelado src/modules/sence/README.md §6
-- (manual oficial v1.1.6). Cambiar este esquema exige actualizar el contrato.
--
-- Notas de diseño:
--  - `sence_events` es INSERT-only (I-2, P8): sin policies de UPDATE/DELETE,
--    privilegios revocados y triggers de fila y de sentencia.
--  - Toda escritura la hace el servidor (service_role bajo tenantGuard): el
--    callback de SENCE llega al navegador del alumno y de ahí a una ruta
--    nuestra; nunca viene autenticado como el alumno. Por eso `authenticated`
--    solo LEE.
--  - `enrollments`, `actions` y `courses` llegan en el Hito 1; hasta entonces
--    `enrollment_id` es un uuid sin FK.
-- =============================================================================

create type public.sence_session_status as enum (
  'iniciada_pendiente', 'iniciada', 'cerrada', 'expirada', 'error'
);

create type public.sence_environment as enum ('rcetest', 'rce');

create type public.sence_event_kind as enum (
  'start_ok', 'start_error', 'close_ok', 'close_error', 'unmatched'
);

-- ---------- sence_sessions ----------
create table public.sence_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  enrollment_id uuid not null,
  -- CodSence: código del CURSO (10 dígitos). NULL en línea 1 (I-10).
  sence_course_code text check (sence_course_code is null or length(sence_course_code) <= 10),
  -- CodigoCurso: código de la ACCIÓN (no invertir con el anterior — I-10).
  action_code text not null check (length(action_code) between 1 and 50),
  training_line smallint not null check (training_line in (1, 3, 6)),
  run_alumno text not null check (length(run_alumno) <= 10),
  id_sesion_alumno text not null unique check (length(id_sesion_alumno) <= 149),
  id_sesion_sence text check (id_sesion_sence is null or length(id_sesion_sence) <= 149),
  status public.sence_session_status not null default 'iniciada_pendiente',
  environment public.sence_environment not null,
  opened_at timestamptz,
  closed_at timestamptz,
  -- ZonaHoraria puede NO venir en el callback (visto en terreno): se tolera.
  zona_horaria text,
  expires_at timestamptz,
  error_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Línea 1 (Programas Sociales): CodSence va VACÍO (I-10, manual Anexo 5).
  constraint sence_sessions_line1_empty_course_code
    check (training_line <> 1 or sence_course_code is null),
  -- Una sesión `iniciada` siempre tiene IdSesionSence (llega en T2).
  constraint sence_sessions_open_needs_sence_id
    check (status <> 'iniciada' or id_sesion_sence is not null)
);

create index sence_sessions_tenant_idx on public.sence_sessions (tenant_id, created_at desc);
create index sence_sessions_enrollment_idx on public.sence_sessions (enrollment_id);
create index sence_sessions_expiry_idx on public.sence_sessions (status, expires_at);

-- Una sola sesión viva por inscripción: evita dobles aperturas simultáneas y
-- sostiene la idempotencia del motor (I-3).
create unique index sence_sessions_one_open_per_enrollment
  on public.sence_sessions (enrollment_id)
  where status in ('iniciada_pendiente', 'iniciada');

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger sence_sessions_touch
  before update on public.sence_sessions
  for each row execute function public.touch_updated_at();

alter table public.sence_sessions enable row level security;
alter table public.sence_sessions force row level security;

-- Lectura por tenant y rol (matriz spec §3 "Asistencia SENCE"). La correlación
-- alumno↔enrollment se afina en el Hito 1 (cuando exista `enrollments`); hasta
-- entonces el alumno no ve filas por esta vía.
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
        or public.has_role('supervisor')
        or public.has_role('company')
      )
    )
  );

-- ---------- sence_events (INSERT-only, I-2) ----------
create table public.sence_events (
  id uuid primary key default gen_random_uuid(),
  -- NULL si la correlación falla y el evento no se puede atribuir (I-1):
  -- igual se persiste, jamás se descarta.
  tenant_id uuid references public.tenants (id) on delete restrict,
  session_id uuid references public.sence_sessions (id) on delete restrict,
  kind public.sence_event_kind not null,
  -- POST crudo del callback. NUNCA contiene el Token (I-7): el motor lo quita
  -- antes de persistir; el check lo hace cumplir.
  payload jsonb not null default '{}'::jsonb,
  glosa_error_raw text,
  error_codes text[] not null default '{}',
  late boolean not null default false,
  dedupe_hash text not null,
  received_at timestamptz not null default now(),
  constraint sence_events_no_token
    check (not (payload ? 'Token') and not (payload ? 'token'))
);

create index sence_events_session_idx on public.sence_events (session_id, received_at desc);
create index sence_events_tenant_idx on public.sence_events (tenant_id, received_at desc);
-- Idempotencia (I-3): el mismo callback reenviado no crea un evento nuevo.
create unique index sence_events_dedupe_idx on public.sence_events (dedupe_hash);

alter table public.sence_events enable row level security;
alter table public.sence_events force row level security;

create policy sence_events_select_admin on public.sence_events
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (public.has_role('otec_admin') or public.has_role('supervisor'))
    )
  );

-- ---------- Privilegios ----------
grant select on public.sence_sessions to authenticated;
grant select on public.sence_events to authenticated;

grant select, insert, update on public.sence_sessions to service_role;
grant select, insert on public.sence_events to service_role;

-- INSERT-only en profundidad: ni el service role puede mutar la bitácora.
revoke update, delete, truncate on table public.sence_events from anon;
revoke update, delete, truncate on table public.sence_events from authenticated;
revoke update, delete, truncate on table public.sence_events from service_role;

create trigger sence_events_no_update
  before update or delete on public.sence_events
  for each row execute function public.audit_log_immutable();

create trigger sence_events_no_truncate
  before truncate on public.sence_events
  for each statement execute function public.audit_log_immutable();
