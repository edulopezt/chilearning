-- =============================================================================
-- Lecciones (mínimo para el curso demo, task 0.8). Un curso tiene lecciones de
-- texto o video embed. Módulo académico completo (módulos, orden, progreso
-- detallado) llega en el Hito 1. Todo con tenant_id + RLS.
-- =============================================================================

create type public.lesson_kind as enum ('text', 'video');

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  title text not null check (length(title) between 1 and 200),
  kind public.lesson_kind not null default 'text',
  -- Texto (markdown simple) o, para video, el ID/URL del embed (Bunny en prod).
  content text not null default '',
  position smallint not null default 1,
  created_at timestamptz not null default now()
);

create index lessons_course_idx on public.lessons (course_id, position);

alter table public.lessons enable row level security;
alter table public.lessons force row level security;

-- Lecturas por tenant (el alumno inscrito ve el contenido; el candado SENCE se
-- aplica en la capa de aplicación, no en RLS: RLS controla acceso al dato, no
-- la regla de negocio de "registra asistencia primero").
create policy lessons_select on public.lessons
  for select to authenticated
  using (tenant_id = public.jwt_tenant_id() or public.is_superadmin());

grant select on public.lessons to authenticated;
grant select, insert, update, delete on public.lessons to service_role;
-- Las lecciones demo se siembran en supabase/seed.sql (dependen del tenant seed).
