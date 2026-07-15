-- =============================================================================
-- Task 2.4a (Hito 2): nombres/apellidos del alumno como SNAPSHOT en enrollments
-- (mismo patrón que `run`). El export del panel de cumplimiento (HU-5.5) exige
-- las columnas NOMBRES/APELLIDOS del reporte del plugin; hasta ahora el nombre
-- vivía solo en auth.users.user_metadata (Admin API paginada = inutilizable
-- para reportes). Sin cambios de policies: las columnas viajan con las
-- policies de fila existentes de enrollments.
-- =============================================================================

alter table public.enrollments
  add column first_names text check (first_names is null or length(first_names) <= 150),
  add column last_names text check (last_names is null or length(last_names) <= 150);

-- Backfill best-effort desde el metadata que dejó el import 1.3. El full_name
-- completo va a NOMBRES: un nombre compuesto chileno ("María José Pérez Soto")
-- NO se parte heurísticamente — apellidos quedan NULL hasta un re-import.
update public.enrollments e
set first_names = u.raw_user_meta_data->>'full_name'
from auth.users u
where u.id = e.user_id
  and e.first_names is null
  and coalesce(u.raw_user_meta_data->>'full_name', '') <> '';
