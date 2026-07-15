-- =============================================================================
-- Acciones SENCE (task 1.2, cierre): `updated_at` + trigger para el CRUD.
-- El resto de la tabla `actions` ya existe (migración del curso demo).
-- =============================================================================

alter table public.actions
  add column updated_at timestamptz not null default now();

create trigger actions_touch
  before update on public.actions
  for each row execute function public.touch_updated_at();
