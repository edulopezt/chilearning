-- =============================================================================
-- Config SENCE por tenant + académico MÍNIMO para el flujo del Hito 0 (task 0.7/0.8).
--
-- `courses`/`actions`/`enrollments` son un SUBCONJUNTO mínimo para ejecutar el
-- motor SENCE y el curso demo; el módulo académico completo llega en el Hito 1.
-- Todo lleva tenant_id + RLS. El token del OTEC va CIFRADO (AES-256-GCM, I-6):
-- la BD nunca ve el token en claro.
-- =============================================================================

-- ---------- sence_otec_config (credenciales SENCE por tenant, HU-5.4) ----------
create table public.sence_otec_config (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  rut_otec text not null check (length(rut_otec) <= 10),
  -- Token cifrado en reposo (formato `v1.<iv>.<tag>.<ct>`). NUNCA en claro.
  token_encrypted text,
  default_environment public.sence_environment not null default 'rcetest',
  updated_at timestamptz not null default now()
);

alter table public.sence_otec_config enable row level security;
alter table public.sence_otec_config force row level security;

-- Solo el admin del OTEC gestiona sus credenciales SENCE (matriz §3 "Config
-- tenant + SENCE"). El token cifrado NUNCA se expone al cliente: se lee solo
-- desde el servidor (service_role vía tenantGuard) al construir el POST.
create policy sence_config_select_admin on public.sence_otec_config
  for select to authenticated
  using (tenant_id = public.jwt_tenant_id() and public.has_role('otec_admin'));

grant select on public.sence_otec_config to authenticated;
grant select, insert, update on public.sence_otec_config to service_role;

-- ⚠ El token_encrypted no debe salir por PostgREST ni al admin. Se revoca la
-- columna a `authenticated` (defensa a nivel de columna); el admin ve el resto.
revoke select (token_encrypted) on public.sence_otec_config from authenticated;

-- ---------- courses (mínimo) ----------
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null check (length(name) between 1 and 200),
  sence boolean not null default false,
  -- CodSence (código del CURSO, 10 dígitos). NULL si no es SENCE o es línea 1.
  cod_sence text check (cod_sence is null or length(cod_sence) <= 10),
  created_at timestamptz not null default now()
);

create index courses_tenant_idx on public.courses (tenant_id);

alter table public.courses enable row level security;
alter table public.courses force row level security;

create policy courses_select on public.courses
  for select to authenticated
  using (tenant_id = public.jwt_tenant_id() or public.is_superadmin());

grant select on public.courses to authenticated;
grant select, insert, update, delete on public.courses to service_role;

-- ---------- actions (acción de capacitación, mínimo) ----------
create table public.actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  -- CodigoCurso (código de la ACCIÓN; formato SIC en línea 1).
  codigo_accion text not null check (length(codigo_accion) between 1 and 50),
  training_line smallint not null check (training_line in (1, 3, 6)),
  -- Ambiente SENCE configurable POR ACCIÓN (I-11), jamás hardcodeado.
  environment public.sence_environment not null default 'rcetest',
  -- Candado de contenido: bloquea hasta registrar asistencia (I-12).
  attendance_lock boolean not null default true,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now()
);

create index actions_tenant_idx on public.actions (tenant_id);
create index actions_course_idx on public.actions (course_id);

alter table public.actions enable row level security;
alter table public.actions force row level security;

create policy actions_select on public.actions
  for select to authenticated
  using (tenant_id = public.jwt_tenant_id() or public.is_superadmin());

grant select on public.actions to authenticated;
grant select, insert, update, delete on public.actions to service_role;

-- ---------- enrollments (inscripción alumno ↔ acción, mínimo) ----------
create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  action_id uuid not null references public.actions (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  -- RUN del alumno (snapshot; formato xxxxxxxx-x).
  run text not null check (length(run) <= 10),
  -- Alumno exento (becario): salta SENCE sin bloquearse (I-14).
  exento boolean not null default false,
  created_at timestamptz not null default now(),
  unique (action_id, user_id)
);

create index enrollments_tenant_idx on public.enrollments (tenant_id);
create index enrollments_action_idx on public.enrollments (action_id);
create index enrollments_user_idx on public.enrollments (user_id);

alter table public.enrollments enable row level security;
alter table public.enrollments force row level security;

-- El alumno ve SUS inscripciones; el staff ve las del tenant.
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
        or public.has_role('supervisor')
        or public.has_role('company')
      )
    )
  );

grant select on public.enrollments to authenticated;
grant select, insert, update, delete on public.enrollments to service_role;

-- ---------- Cerrar el FK pendiente de sence_sessions → enrollments ----------
-- (La migración del motor dejó enrollment_id sin FK porque enrollments no
-- existía aún; ahora sí.)
alter table public.sence_sessions
  add constraint sence_sessions_enrollment_fk
  foreign key (enrollment_id) references public.enrollments (id) on delete restrict;

-- Origen del estado `error` (T3 inicio vs T7 cierre): necesario para reconstruir
-- el SessionState del dominio al procesar un callback posterior (T8/T9, I-4).
alter table public.sence_sessions
  add column error_origin text check (error_origin in ('start', 'close'));

-- Vista de asistencia del alumno: puede leer SU sesión SENCE por su enrollment.
create policy sence_sessions_select_own on public.sence_sessions
  for select to authenticated
  using (
    tenant_id = public.jwt_tenant_id()
    and enrollment_id in (
      select e.id from public.enrollments e where e.user_id = (select auth.uid())
    )
  );

-- Nonce por sesión (hallazgo H-2 de la revisión adversarial): va en la URL de
-- callback (UrlRetoma/UrlError). Bloquea que un tercero que conozca el
-- IdSesionAlumno de una víctima transicione su sesión (falsificación
-- cross-sesión): el nonce viaja solo por el navegador de la víctima.
alter table public.sence_sessions add column callback_nonce text;

-- El dedupe_hash NO debe ser único (hallazgo C-1): un replay legítimo DEBE
-- persistir un SEGUNDO evento (I-1: perder un callback es perder evidencia); la
-- idempotencia de la TRANSICIÓN la garantiza la máquina de estados, no la BD.
drop index if exists public.sence_events_dedupe_idx;
create index sence_events_dedupe_idx on public.sence_events (dedupe_hash);
