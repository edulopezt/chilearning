-- =============================================================================
-- Task 2.1 (Hito 2, HU-6.1): quizzes autocorregidos — esquema M1.
-- Spec de módulo: defaults S1–S13 en specs/DECISIONES.md (D-022).
--
-- Diseño (plan del hito):
--  - Los instrumentos cuelgan del CURSO; las notas se consolidan por
--    INSCRIPCIÓN (= por acción, HU-6.4).
--  - El cliente autenticado solo LEE (RLS); toda escritura va por el servidor
--    (Server Action → servicio → tenantGuard). Así "el tutor no publica" y
--    "el supervisor solo lee" quedan garantizados a nivel de BD.
--  - `quiz_attempts` congela la selección/orden de preguntas del intento
--    (`questions_snapshot`, SIN pauta) y la pauta (`answer_key`) en una
--    columna SIN grant a `authenticated` — mismo mecanismo que
--    `token_encrypted` (hallazgo de la task 1.7).
--  - `grades` nace aquí (el submit del quiz la escribe); las FKs de tareas
--    (assignment_id/submission_id) llegan en la migración M2 (task 2.2).
-- =============================================================================

create type public.instrument_status as enum ('draft', 'published');
create type public.attempt_scoring as enum ('best', 'last', 'average');
create type public.review_policy as enum ('never', 'after_submit', 'after_close');
create type public.question_kind as enum ('multiple_choice', 'true_false', 'matching');
create type public.attempt_status as enum ('in_progress', 'submitted', 'expired');
create type public.grade_status as enum ('draft', 'published');
create type public.grade_source as enum ('quiz', 'assignment');

-- ---------- quizzes ----------
create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  title text not null check (length(title) between 1 and 200),
  description text not null default '',
  status public.instrument_status not null default 'draft',
  -- S6: NULL = sin límite de tiempo.
  time_limit_minutes int check (time_limit_minutes between 1 and 600),
  -- S2: NULL = intentos ilimitados.
  max_attempts int check (max_attempts between 1 and 50),
  attempt_scoring public.attempt_scoring not null default 'best',
  -- S1: exigencia de la escala chilena (nota 4.0 en E% del puntaje).
  passing_pct smallint not null default 60 check (passing_pct between 1 and 99),
  -- S3: NULL = todas las preguntas del banco; N = submuestra aleatoria.
  pool_size int check (pool_size >= 1),
  shuffle_questions boolean not null default true,
  shuffle_choices boolean not null default true,
  review_policy public.review_policy not null default 'after_submit',
  opens_at timestamptz,
  closes_at timestamptz,
  -- S10: ponderación en el libro de notas de la acción.
  weight numeric(6,2) not null default 1 check (weight >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- S7: revisar "tras el cierre" exige que exista un cierre.
  constraint quizzes_after_close_needs_closes_at
    check (review_policy <> 'after_close' or closes_at is not null)
);
create index quizzes_tenant_idx on public.quizzes (tenant_id);
create index quizzes_course_idx on public.quizzes (course_id);
create trigger quizzes_touch before update on public.quizzes
  for each row execute function public.touch_updated_at();

alter table public.quizzes enable row level security;
alter table public.quizzes force row level security;

-- Lectura: staff del tenant ve todo; alumno/supervisor/empresa solo publicados.
create policy quizzes_select on public.quizzes
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
grant select on public.quizzes to authenticated;
grant select, insert, update, delete on public.quizzes to service_role;

-- ---------- questions (el alumno JAMÁS las lee: body contiene la pauta) ----------
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  kind public.question_kind not null,
  prompt text not null check (length(prompt) between 1 and 2000),
  -- Por tipo (Zod + parse de dominio en el borde):
  --  multiple_choice: {"choices":[{"id","text","correct"}]} (exactamente 1 correcta, 2–8)
  --  true_false:      {"correct": boolean}
  --  matching:        {"pairs":[{"id","left","right"}]} (2–10 pares)
  body jsonb not null,
  points numeric(6,2) not null default 1 check (points > 0),
  position smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index questions_tenant_idx on public.questions (tenant_id);
create index questions_quiz_idx on public.questions (quiz_id, position);
create trigger questions_touch before update on public.questions
  for each row execute function public.touch_updated_at();

alter table public.questions enable row level security;
alter table public.questions force row level security;

create policy questions_select_staff on public.questions
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
grant select on public.questions to authenticated;
grant select, insert, update, delete on public.questions to service_role;

-- ---------- quiz_attempts ----------
create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  quiz_id uuid not null references public.quizzes (id) on delete restrict,
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  attempt_number int not null check (attempt_number >= 1),
  status public.attempt_status not null default 'in_progress',
  -- Snapshot SANITIZADO (sin pauta): preguntas del intento, ya barajadas.
  questions_snapshot jsonb not null,
  -- Pauta congelada. SIN grant a authenticated (ver grants de columnas abajo).
  answer_key jsonb not null,
  -- Autosave {questionId: respuesta cruda}.
  answers jsonb not null default '{}'::jsonb,
  score numeric(8,2),
  max_score numeric(8,2) not null,
  grade numeric(3,1) check (grade between 1.0 and 7.0),
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (enrollment_id, quiz_id, attempt_number)
);
-- Concurrencia: UN intento en curso por (inscripción, quiz).
create unique index quiz_attempts_one_open
  on public.quiz_attempts (enrollment_id, quiz_id)
  where status = 'in_progress';
create index quiz_attempts_tenant_idx on public.quiz_attempts (tenant_id);
create index quiz_attempts_quiz_idx on public.quiz_attempts (quiz_id);
create index quiz_attempts_enrollment_idx on public.quiz_attempts (enrollment_id);
create trigger quiz_attempts_touch before update on public.quiz_attempts
  for each row execute function public.touch_updated_at();

-- Inmutabilidad post-envío (cinturón y tirantes, estilo audit_log_immutable):
-- un intento enviado o expirado no se toca ni con service_role.
create or replace function public.quiz_attempts_lock_submitted()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('submitted', 'expired') then
    raise exception 'attempt is immutable after submit/expiry'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger quiz_attempts_lock
  before update or delete on public.quiz_attempts
  for each row execute function public.quiz_attempts_lock_submitted();

alter table public.quiz_attempts enable row level security;
alter table public.quiz_attempts force row level security;

-- Lectura: el alumno SUS intentos; staff los del tenant.
create policy quiz_attempts_select on public.quiz_attempts
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        exists (
          select 1 from public.enrollments e
          where e.id = quiz_attempts.enrollment_id and e.user_id = (select auth.uid())
        )
        or public.has_role('otec_admin') or public.has_role('coordinator')
        or public.has_role('instructor') or public.has_role('tutor')
      )
    )
  );
-- Grant de COLUMNAS: `answer_key` EXCLUIDA para authenticated (la pauta jamás
-- viaja al cliente antes de tiempo; la revisión la sirve el servidor, S7).
grant select (id, tenant_id, quiz_id, enrollment_id, attempt_number, status,
  questions_snapshot, answers, score, max_score, grade, started_at, expires_at,
  submitted_at, updated_at)
  on public.quiz_attempts to authenticated;
grant select, insert, update on public.quiz_attempts to service_role;

-- ---------- grades (registro oficial por inscripción × instrumento) ----------
create table public.grades (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  source_kind public.grade_source not null,
  quiz_id uuid references public.quizzes (id) on delete restrict,
  -- assignment_id / submission_id llegan con FK en M2 (task 2.2).
  assignment_id uuid,
  submission_id uuid,
  score numeric(8,2),
  max_score numeric(8,2),
  grade numeric(3,1) not null check (grade between 1.0 and 7.0),
  feedback text not null default '' check (length(feedback) <= 4000),
  rubric_scores jsonb,
  status public.grade_status not null default 'draft',
  -- NULL = autocorregido (quiz).
  graded_by uuid,
  published_by uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grades_one_source check (
    (source_kind = 'quiz' and quiz_id is not null and assignment_id is null)
    or (source_kind = 'assignment' and assignment_id is not null and quiz_id is null)
  ),
  constraint grades_published_fields
    check (status = 'draft' or published_at is not null)
);
create unique index grades_quiz_uq on public.grades (enrollment_id, quiz_id)
  where quiz_id is not null;
create unique index grades_assignment_uq on public.grades (enrollment_id, assignment_id)
  where assignment_id is not null;
create index grades_tenant_idx on public.grades (tenant_id);
create index grades_enrollment_idx on public.grades (enrollment_id);
create trigger grades_touch before update on public.grades
  for each row execute function public.touch_updated_at();

alter table public.grades enable row level security;
alter table public.grades force row level security;

-- Lectura: staff todo; alumno SUS notas PUBLICADAS (jamás el draft del tutor);
-- supervisor solo publicadas; company nada (portal empresa = Hito 5).
create policy grades_select on public.grades
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        public.has_role('otec_admin') or public.has_role('coordinator')
        or public.has_role('instructor') or public.has_role('tutor')
        or (
          status = 'published'
          and (
            exists (
              select 1 from public.enrollments e
              where e.id = grades.enrollment_id and e.user_id = (select auth.uid())
            )
            or public.has_role('supervisor')
          )
        )
      )
    )
  );
grant select on public.grades to authenticated;
-- Sin DELETE ni para service_role: las notas no se borran (P8).
grant select, insert, update on public.grades to service_role;
