-- =============================================================================
-- Task 3.1 (Hito 3, HU-6.3): encuesta de satisfacción al cierre.
--
-- CA: "anónima o nominada según configuración; puede ser requisito de
-- completitud; resultados agregados por acción."
--
-- Diseño (D-101 anonimato = identidad separada del contenido):
--  - `surveys`: la plantilla, cuelga del CURSO (reusa `completion_rules
--    .requireSurvey`, ya definido en course.ts) y el enum `instrument_status`.
--  - `survey_submissions`: ledger INSERT-only de QUIÉN respondió (siempre
--    enrollment_id) — habilita el gate de completitud y el anti-duplicado SIN
--    tocar las respuestas.
--  - `survey_responses`: las RESPUESTAS (INSERT-only). `enrollment_id` va NULL
--    cuando la encuesta es anónima → el anonimato es ESTRUCTURAL, no por
--    convención (el staff no puede mapear respuesta ↔ alumno).
--  - RPC `submit_survey` (SECURITY DEFINER) inserta ledger + respuesta en UNA
--    transacción; el `unique(survey_id, enrollment_id)` del ledger corta el doble
--    envío. Solo el servidor (service_role bajo tenantGuard) lo invoca.
-- =============================================================================

-- ---------- surveys (plantilla, cuelga del curso) ----------
create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  title text not null check (length(title) between 1 and 200),
  intro text not null default '' check (length(intro) <= 2000),
  -- D-102: por defecto anónima (feedback honesto).
  anonymous boolean not null default true,
  status public.instrument_status not null default 'draft',
  -- {"questions":[{id,type:'scale'|'single'|'text',label,required,options?,scaleMax?}]}
  questions jsonb not null default '{"questions":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index surveys_tenant_idx on public.surveys (tenant_id);
create index surveys_course_idx on public.surveys (course_id);
create trigger surveys_touch before update on public.surveys
  for each row execute function public.touch_updated_at();

alter table public.surveys enable row level security;
alter table public.surveys force row level security;

-- Lectura: staff del tenant ve todo; alumno/supervisor/empresa solo publicadas.
create policy surveys_select on public.surveys
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        public.has_role('otec_admin') or public.has_role('coordinator')
        or public.has_role('instructor') or public.has_role('tutor')
        or status = 'published'
      )
    )
  );
grant select on public.surveys to authenticated;
grant select, insert, update, delete on public.surveys to service_role;

-- ---------- survey_submissions (ledger INSERT-only: quién respondió) ----------
create table public.survey_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  survey_id uuid not null references public.surveys (id) on delete restrict,
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  submitted_at timestamptz not null default now(),
  unique (survey_id, enrollment_id)
);
create index survey_submissions_tenant_idx on public.survey_submissions (tenant_id);
create index survey_submissions_survey_idx on public.survey_submissions (survey_id);
create index survey_submissions_enrollment_idx on public.survey_submissions (enrollment_id);

alter table public.survey_submissions enable row level security;
alter table public.survey_submissions force row level security;

-- Lectura: staff del tenant; el alumno SOLO las suyas (para saber si ya respondió).
create policy survey_submissions_select on public.survey_submissions
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        exists (
          select 1 from public.enrollments e
          where e.id = survey_submissions.enrollment_id and e.user_id = (select auth.uid())
        )
        or public.has_role('otec_admin') or public.has_role('coordinator')
        or public.has_role('instructor') or public.has_role('tutor')
      )
    )
  );
grant select on public.survey_submissions to authenticated;
-- Ledger inmutable: sin update/delete ni para service_role.
grant select, insert on public.survey_submissions to service_role;
revoke update, delete, truncate on table public.survey_submissions from anon, authenticated, service_role;

-- ---------- survey_responses (respuestas INSERT-only; anónimas por diseño) ----------
create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  survey_id uuid not null references public.surveys (id) on delete restrict,
  -- La acción (cohorte) para agregar por acción; NO es PII.
  action_id uuid not null references public.actions (id) on delete restrict,
  -- NULL = anónima (sin vínculo a persona en reposo). Solo se llena si nominada.
  enrollment_id uuid references public.enrollments (id) on delete restrict,
  answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now()
);
create index survey_responses_tenant_idx on public.survey_responses (tenant_id);
create index survey_responses_survey_idx on public.survey_responses (survey_id);
create index survey_responses_action_idx on public.survey_responses (action_id);

alter table public.survey_responses enable row level security;
alter table public.survey_responses force row level security;

-- Lectura: SOLO staff del tenant (para agregados). El alumno NO lee respuestas —
-- garantía estructural del anonimato (ni las suyas, para no dar pie a correlación).
create policy survey_responses_select on public.survey_responses
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        public.has_role('otec_admin') or public.has_role('coordinator')
        or public.has_role('instructor') or public.has_role('tutor')
      )
    )
  );
grant select on public.survey_responses to authenticated;
grant select, insert on public.survey_responses to service_role;
revoke update, delete, truncate on table public.survey_responses from anon, authenticated, service_role;

-- ---------- RPC submit_survey: ledger + respuesta atómicos (D-103) ----------
-- Inserta el ledger (el `unique` aborta un segundo envío) y la respuesta con
-- `enrollment_id` NULL si es anónima. Todo o nada. Solo el servidor lo invoca.
create or replace function public.submit_survey(
  p_tenant_id uuid,
  p_survey_id uuid,
  p_action_id uuid,
  p_enrollment_id uuid,
  p_anonymous boolean,
  p_answers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response_id uuid;
begin
  if p_tenant_id is null or p_survey_id is null or p_enrollment_id is null then
    raise exception 'tenant_id, survey_id y enrollment_id son obligatorios';
  end if;

  -- Ledger: el unique(survey_id, enrollment_id) hace fallar el doble envío.
  insert into public.survey_submissions (tenant_id, survey_id, enrollment_id)
    values (p_tenant_id, p_survey_id, p_enrollment_id);

  insert into public.survey_responses (tenant_id, survey_id, action_id, enrollment_id, answers)
    values (
      p_tenant_id, p_survey_id, p_action_id,
      case when p_anonymous then null else p_enrollment_id end,
      coalesce(p_answers, '{}'::jsonb)
    )
    returning id into v_response_id;

  return v_response_id;
end;
$$;

revoke all on function public.submit_survey(uuid, uuid, uuid, uuid, boolean, jsonb) from public;
grant execute on function public.submit_survey(uuid, uuid, uuid, uuid, boolean, jsonb) to service_role;

-- ---------- clone_course: arrastrar también las encuestas del curso (draft) ----------
-- Reemplaza el cuerpo de clone_course (D-025) para copiar `surveys` a la copia.
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

  -- 3.1: las encuestas del curso también se clonan (en borrador siempre).
  insert into public.surveys (tenant_id, course_id, title, intro, anonymous, questions, status)
    select p_tenant_id, v_new_course, title, intro, anonymous, questions, 'draft'
    from public.surveys
    where course_id = p_course_id and tenant_id = p_tenant_id;

  return v_new_course;
end;
$$;

revoke all on function public.clone_course(uuid, uuid) from public;
grant execute on function public.clone_course(uuid, uuid) to service_role;
