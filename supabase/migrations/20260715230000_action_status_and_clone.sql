-- =============================================================================
-- Clonado de cursos y re-ejecución de acciones (task 2.8, HU-3.6).
--
-- Introduce el estado de la acción (draft/active): una acción NACE en borrador y
-- solo pasa a activa con fechas (y, si es re-ejecución, con un código nuevo ≠ al
-- de origen — eso se valida en el servicio, no es expresable como CHECK entre
-- filas). Y el RPC transaccional `clone_course` que copia un curso completo
-- (contenido + instrumentos) SIN arrastrar acciones, inscripciones ni datos de
-- runtime — la copia nace siempre en borrador.
-- =============================================================================

create type public.action_status as enum ('draft', 'active');

alter table public.actions
  add column status public.action_status not null default 'draft',
  -- Trazabilidad de la re-ejecución (de qué acción se clonó la configuración).
  add column cloned_from uuid references public.actions (id) on delete set null;

-- Backfill: las acciones existentes CON fechas ya estaban operando → activas.
update public.actions set status = 'active'
  where starts_on is not null and ends_on is not null;

-- Una acción ACTIVA SIEMPRE tiene fechas (gate a nivel BD). Draft puede no tener.
alter table public.actions
  add constraint actions_active_needs_dates
    check (status = 'draft' or (starts_on is not null and ends_on is not null));

create index actions_cloned_from_idx on public.actions (cloned_from)
  where cloned_from is not null;

-- ---------- clone_course: copia transaccional de un curso completo ----------
-- Copia courses + lessons + quizzes(+questions) + assignments al MISMO tenant.
-- La copia nace en 'draft' con el nombre + " (copia)". NUNCA copia actions,
-- enrollments, grades, submissions ni sesiones SENCE (datos de ejecución). El
-- curso draft sin acciones deja el contenido inalcanzable hasta re-ejecutar.
create or replace function public.clone_course(p_tenant_id uuid, p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.courses%rowtype;
  v_new_course uuid;
  q record;
  v_new_quiz uuid;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id es obligatorio';
  end if;

  select * into v_src from public.courses
    where id = p_course_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'curso no encontrado en el tenant';
  end if;

  insert into public.courses (tenant_id, name, sence, cod_sence, modality, hours, completion_rules, status)
    values (p_tenant_id, left(v_src.name || ' (copia)', 200), v_src.sence, v_src.cod_sence,
            v_src.modality, v_src.hours, v_src.completion_rules, 'draft')
    returning id into v_new_course;

  insert into public.lessons (tenant_id, course_id, title, kind, content, position, status)
    select p_tenant_id, v_new_course, title, kind, content, position, status
    from public.lessons
    where course_id = p_course_id and tenant_id = p_tenant_id;

  for q in
    select * from public.quizzes where course_id = p_course_id and tenant_id = p_tenant_id
  loop
    insert into public.quizzes (tenant_id, course_id, title, description, time_limit_minutes,
      max_attempts, attempt_scoring, passing_pct, pool_size, shuffle_questions, shuffle_choices,
      review_policy, opens_at, closes_at, weight, status)
      values (p_tenant_id, v_new_course, q.title, q.description, q.time_limit_minutes,
        q.max_attempts, q.attempt_scoring, q.passing_pct, q.pool_size, q.shuffle_questions,
        q.shuffle_choices, q.review_policy, q.opens_at, q.closes_at, q.weight, q.status)
      returning id into v_new_quiz;

    insert into public.questions (tenant_id, quiz_id, kind, prompt, body, points, position)
      select p_tenant_id, v_new_quiz, kind, prompt, body, points, position
      from public.questions where quiz_id = q.id;
  end loop;

  insert into public.assignments (tenant_id, course_id, title, instructions, status, due_at,
    grace_hours, rubric, passing_pct, weight)
    select p_tenant_id, v_new_course, title, instructions, status, due_at, grace_hours, rubric,
      passing_pct, weight
    from public.assignments
    where course_id = p_course_id and tenant_id = p_tenant_id;

  return v_new_course;
end;
$$;

-- Solo el servidor (service_role bajo tenantGuard) invoca el clonado.
revoke all on function public.clone_course(uuid, uuid) from public;
grant execute on function public.clone_course(uuid, uuid) to service_role;
