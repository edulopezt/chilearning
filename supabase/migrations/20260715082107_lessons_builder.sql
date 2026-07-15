-- =============================================================================
-- Constructor de lecciones (task 1.4, HU-4.1): tipos archivo/embed + estado
-- borrador/publicado + updated_at para reordenar y editar.
-- =============================================================================

-- Nuevos tipos de lección (además de text/video). ADD VALUE es idempotente.
alter type public.lesson_kind add value if not exists 'file';
alter type public.lesson_kind add value if not exists 'embed';

create type public.lesson_status as enum ('draft', 'published');

alter table public.lessons
  add column status public.lesson_status not null default 'draft',
  add column updated_at timestamptz not null default now();

create trigger lessons_touch
  before update on public.lessons
  for each row execute function public.touch_updated_at();

-- Orden estable por curso: útil para el reordenamiento.
create index lessons_course_position_idx on public.lessons (course_id, position);
