-- =============================================================================
-- Progreso del alumno (task 1.5, HU-4.3): una fila por (inscripción, lección)
-- que se marca completada. Sirve para el % de avance y "retomar donde quedé".
-- Las escrituras van por el servidor (service_role bajo tenantGuard) tras
-- verificar que la inscripción es del alumno; el cliente solo LEE.
-- =============================================================================

create table public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  lesson_id uuid not null references public.lessons (id) on delete restrict,
  completed boolean not null default false,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (enrollment_id, lesson_id)
);

create index lesson_progress_enrollment_idx on public.lesson_progress (enrollment_id);
create index lesson_progress_tenant_idx on public.lesson_progress (tenant_id);

create trigger lesson_progress_touch
  before update on public.lesson_progress
  for each row execute function public.touch_updated_at();

alter table public.lesson_progress enable row level security;
alter table public.lesson_progress force row level security;

-- Lectura: el alumno ve el progreso de SUS inscripciones; el staff, el del tenant.
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
        or public.has_role('supervisor')
      )
    )
  );

grant select on public.lesson_progress to authenticated;
grant select, insert, update on public.lesson_progress to service_role;
