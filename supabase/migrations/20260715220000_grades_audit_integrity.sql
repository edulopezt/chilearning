-- =============================================================================
-- Integridad del registro de notas (task 2.2/2.3 — el GATE del hito).
-- Corrige tres defectos de la máquina de estados de `grades` detectados en la
-- revisión adversarial 4-ojos del PR #39:
--
--  R#39-1  una nota PUBLICADA podía revertirse a borrador (pérdida de estado:
--          desaparece de la vista del alumno) sin motivo ni auditoría.
--  R#39-2  una nota PUBLICADA podía re-publicarse con otro valor saltándose el
--          gate de motivo/`grade.updated`.
--  R#39-3  el cambio de nota + su auditoría NO eran atómicos (dos statements
--          HTTP separados vía PostgREST): un fallo del insert de auditoría
--          dejaba la nota cambiada SIN rastro (Ley 21.719 / P8).
--
-- Defensa en profundidad: (1) trigger que prohíbe despublicar en cualquier ruta
-- de escritura; (2) RPC transaccional `write_assignment_grade` que hace el
-- upsert de la nota + la auditoría en UNA transacción y se auto-protege de
-- mutar una publicada fuera del flujo `grade.updated`. La lógica de estado y la
-- validación del motivo siguen en la capa de dominio/servicio; esto es el
-- cinturón de la BD.
-- =============================================================================

-- ---------- (1) una nota publicada JAMÁS vuelve a borrador (P8) ----------
create or replace function public.grades_no_unpublish()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'published' and new.status <> 'published' then
    raise exception 'una nota publicada no puede volver a borrador (P8)';
  end if;
  return new;
end;
$$;

create trigger grades_no_unpublish
  before update on public.grades
  for each row execute function public.grades_no_unpublish();

-- ---------- (2)+(3) escritura atómica de nota de tarea + auditoría ----------
-- Un solo statement HTTP = una sola transacción. Si el insert de auditoría
-- falla, la actualización de la nota se revierte con él (atomicidad real).
-- Se auto-protege: una nota ya PUBLICADA solo se puede modificar por el flujo
-- de cambio con motivo (`p_audit_action = 'grade.updated'`); cualquier otro
-- intento (guardar borrador o re-publicar sobre una publicada) aborta.
create or replace function public.write_assignment_grade(
  p_tenant_id uuid,
  p_enrollment_id uuid,
  p_assignment_id uuid,
  p_grade numeric,
  p_score numeric,
  p_max_score numeric,
  p_rubric_scores jsonb,
  p_feedback text,
  p_actor uuid,
  p_publish boolean,
  p_audit_action text,
  p_audit_details jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.grades%rowtype;
  v_grade_id uuid;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id es obligatorio';
  end if;
  if p_audit_action is not null
     and p_audit_action not in ('grade.published', 'grade.updated') then
    raise exception 'audit_action inválido: %', p_audit_action;
  end if;

  -- Nota vigente para (inscripción, tarea): a lo más una (índice único parcial).
  select * into v_existing
  from public.grades
  where tenant_id = p_tenant_id
    and enrollment_id = p_enrollment_id
    and assignment_id = p_assignment_id
  for update;

  -- Guardia dura: una nota ya publicada SOLO se modifica por el flujo con motivo.
  if found and v_existing.status = 'published'
     and p_audit_action is distinct from 'grade.updated' then
    raise exception
      'una nota publicada solo se modifica por el flujo de cambio con motivo (grade.updated)';
  end if;

  if found then
    update public.grades set
      grade = p_grade,
      score = p_score,
      max_score = p_max_score,
      rubric_scores = p_rubric_scores,
      feedback = left(coalesce(p_feedback, ''), 4000),
      graded_by = p_actor,
      status = case when p_publish then 'published'::public.grade_status else status end,
      published_by = case when p_publish then p_actor else published_by end,
      published_at = case when p_publish then coalesce(published_at, now()) else published_at end
    where id = v_existing.id
    returning id into v_grade_id;
  else
    insert into public.grades (
      tenant_id, enrollment_id, source_kind, assignment_id,
      grade, score, max_score, rubric_scores, feedback, graded_by,
      status, published_by, published_at
    ) values (
      p_tenant_id, p_enrollment_id, 'assignment', p_assignment_id,
      p_grade, p_score, p_max_score, p_rubric_scores, left(coalesce(p_feedback, ''), 4000), p_actor,
      case when p_publish then 'published'::public.grade_status else 'draft'::public.grade_status end,
      case when p_publish then p_actor else null end,
      case when p_publish then now() else null end
    )
    returning id into v_grade_id;
  end if;

  if p_audit_action is not null then
    insert into public.audit_log (tenant_id, actor_user_id, action, entity, entity_id, details)
    values (p_tenant_id, p_actor, p_audit_action, 'grades', v_grade_id::text,
            coalesce(p_audit_details, '{}'::jsonb));
  end if;

  return v_grade_id;
end;
$$;

-- Solo el servidor (service_role bajo tenantGuard) invoca el RPC.
revoke all on function public.write_assignment_grade(
  uuid, uuid, uuid, numeric, numeric, numeric, jsonb, text, uuid, boolean, text, jsonb
) from public;
grant execute on function public.write_assignment_grade(
  uuid, uuid, uuid, numeric, numeric, numeric, jsonb, text, uuid, boolean, text, jsonb
) to service_role;
