-- =============================================================================
-- Courses CRUD (task 1.1, HU-3.1/4.4): modalidad, horas, reglas de completitud
-- y estado borrador/publicado. Extiende la tabla `courses` mínima creada para
-- el curso demo.
--
-- Las escrituras van por el servidor (service_role bajo tenantGuard) autorizadas
-- a otec_admin/coordinator (patrón D-007); `authenticated` solo LEE.
-- =============================================================================

create type public.course_modality as enum ('elearning', 'blended', 'presential');
create type public.course_status as enum ('draft', 'published');

alter table public.courses
  add column modality public.course_modality not null default 'elearning',
  add column hours integer not null default 0 check (hours >= 0 and hours <= 10000),
  -- Reglas de completitud (HU-4.4): forma validada en el dominio.
  -- { requireAllLessons: bool, requireSurvey: bool, minAttendancePct: 0..100 }
  add column completion_rules jsonb not null default
    '{"requireAllLessons": true, "requireSurvey": false, "minAttendancePct": 0}'::jsonb,
  add column status public.course_status not null default 'draft',
  add column updated_at timestamptz not null default now();

-- Un curso SENCE necesita su CodSence (salvo línea 1, que va en la acción).
-- Se valida en el dominio; aquí solo el largo (ya existía el check de <=10).

create trigger courses_touch
  before update on public.courses
  for each row execute function public.touch_updated_at();
