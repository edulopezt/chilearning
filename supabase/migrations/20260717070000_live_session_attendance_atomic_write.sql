-- =============================================================================
-- 4-ojos (task 5.4, PR de sesiones en vivo): la regla "manual gana" (una marca
-- de staff jamás es pisada por una auto-marca del alumno) estaba implementada
-- en la capa de servicio como un SELECT-luego-UPSERT no atómico (dos
-- round-trips HTTP separados) — una auto-marca concurrente con un
-- `markAttendance` del staff podía intercalarse entre el SELECT y el UPSERT del
-- alumno y pisar la fila manual recién escrita. Además, si NINGUNA fila existía
-- todavía, dos escrituras concurrentes (un self-mark y un markAttendance para
-- la primera marca de esa sesión/inscrito) podían chocar en el INSERT.
--
-- Esta migración mueve la garantía a la BD: `write_live_attendance` hace TODO
-- en un único statement `INSERT ... ON CONFLICT (session_id, enrollment_id) DO
-- UPDATE ... WHERE ...` — Postgres serializa el insert/update concurrente vía
-- el índice único (sin necesidad de un lock explícito), y la cláusula WHERE
-- hace que una fila ya `manual` ignore cualquier intento de pisarla con
-- `self` (la fila simplemente no se actualiza y no se devuelve por
-- `returning`). No toca `src/modules/sence/` ni ninguna tabla `sence_*`: sigue
-- siendo asistencia INTERNA/informativa.
-- =============================================================================

create or replace function public.write_live_attendance(
  p_tenant_id uuid,
  p_session_id uuid,
  p_enrollment_id uuid,
  p_present boolean,
  p_source text,
  p_marked_by uuid,
  p_note text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id es obligatorio';
  end if;
  if p_source not in ('self', 'manual') then
    raise exception 'source inválido: %', p_source;
  end if;

  insert into public.live_session_attendance (
    tenant_id, session_id, enrollment_id, present, source, marked_by, note
  ) values (
    p_tenant_id, p_session_id, p_enrollment_id, p_present, p_source, p_marked_by,
    left(coalesce(p_note, ''), 500)
  )
  on conflict (session_id, enrollment_id) do update set
    present = excluded.present,
    source = excluded.source,
    marked_by = excluded.marked_by,
    note = excluded.note,
    marked_at = now()
  -- Regla "manual gana": si la fila existente es `manual` y esta escritura es
  -- `self`, NO se actualiza (queda tal cual, sin volver a `self`).
  where not (
    public.live_session_attendance.source = 'manual' and excluded.source = 'self'
  )
  returning id into v_id;

  if v_id is null then
    return 'kept_manual';
  end if;
  return 'written';
end;
$$;

-- Solo el servidor (service_role bajo tenantGuard) invoca el RPC.
revoke all on function public.write_live_attendance(
  uuid, uuid, uuid, boolean, text, uuid, text
) from public;
grant execute on function public.write_live_attendance(
  uuid, uuid, uuid, boolean, text, uuid, text
) to service_role;
