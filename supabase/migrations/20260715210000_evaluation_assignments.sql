-- =============================================================================
-- Task 2.2 (Hito 2, HU-6.2): tareas con entrega y corrección — esquema M2.
-- Spec: D-022 (§S8 rúbrica, §S9 fechas/tolerancia, §S11 auditoría, §S12 aviso).
--
--  - El alumno sube archivos; relator/tutor corrigen con rúbrica o nota directa.
--  - `submissions` es historial INSERT-only (cada reentrega = fila nueva).
--  - `grades` (M1) gana las FKs a assignments/submissions.
--  - Bucket `submissions`: privado, sin policies para `authenticated` — sube el
--    servidor (service_role bajo guard), descarga por signed URL tras authorize.
--  - `notifications`: outbox del aviso al alumno cuando publican su nota (S12).
-- =============================================================================

-- ---------- assignments ----------
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  title text not null check (length(title) between 1 and 200),
  instructions text not null default '',
  status public.instrument_status not null default 'draft',
  -- S9: plazo + tolerancia.
  due_at timestamptz,
  grace_hours int not null default 0 check (grace_hours between 0 and 720),
  -- S8: NULL = nota directa; jsonb = rúbrica {criteria:[{id,title,levels:[...]}]}
  rubric jsonb,
  passing_pct smallint not null default 60 check (passing_pct between 1 and 99),
  -- S10: ponderación en el libro de notas.
  weight numeric(6,2) not null default 1 check (weight >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assignments_tenant_idx on public.assignments (tenant_id);
create index assignments_course_idx on public.assignments (course_id);
create trigger assignments_touch before update on public.assignments
  for each row execute function public.touch_updated_at();

alter table public.assignments enable row level security;
alter table public.assignments force row level security;

create policy assignments_select on public.assignments
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
grant select on public.assignments to authenticated;
grant select, insert, update, delete on public.assignments to service_role;

-- ---------- submissions (historial INSERT-only) ----------
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  assignment_id uuid not null references public.assignments (id) on delete restrict,
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  version int not null check (version >= 1),
  comment text not null default '' check (length(comment) <= 4000),
  -- Ruta en el bucket privado: {tenant}/{assignment}/{enrollment}/{version}-{slug}
  file_path text not null,
  file_name text not null check (length(file_name) between 1 and 300),
  file_size bigint not null check (file_size > 0),
  mime_type text not null,
  late boolean not null default false,
  submitted_at timestamptz not null default now(),
  unique (assignment_id, enrollment_id, version)
);
create index submissions_tenant_idx on public.submissions (tenant_id);
create index submissions_assignment_idx on public.submissions (assignment_id);
create index submissions_enrollment_idx on public.submissions (enrollment_id, version desc);

alter table public.submissions enable row level security;
alter table public.submissions force row level security;

-- Lectura: alumno las SUYAS; staff (admin/coord/relator/tutor) el tenant.
create policy submissions_select on public.submissions
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        exists (
          select 1 from public.enrollments e
          where e.id = submissions.enrollment_id and e.user_id = (select auth.uid())
        )
        or public.has_role('otec_admin') or public.has_role('coordinator')
        or public.has_role('instructor') or public.has_role('tutor')
      )
    )
  );
grant select on public.submissions to authenticated;
-- Historial inmutable: sin update/delete ni para service_role.
grant select, insert on public.submissions to service_role;
revoke update, delete, truncate on table public.submissions from anon, authenticated, service_role;

-- ---------- grades: FKs de tareas (columnas creadas en M1) ----------
alter table public.grades
  add constraint grades_assignment_fk
    foreign key (assignment_id) references public.assignments (id) on delete restrict,
  add constraint grades_submission_fk
    foreign key (submission_id) references public.submissions (id) on delete restrict;

-- ---------- notifications (outbox del aviso al corregir, S12) ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  kind text not null check (kind in ('grade.published')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent')),
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_tenant_idx on public.notifications (tenant_id);

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

-- Cada usuario ve SOLO las suyas (+ superadmin).
create policy notifications_select on public.notifications
  for select to authenticated
  using (public.is_superadmin() or user_id = (select auth.uid()));
grant select on public.notifications to authenticated;
grant select, insert, update on public.notifications to service_role;

-- ---------- bucket privado `submissions` (Storage) ----------
-- 20 MB, allowlist de MIME. CERO policies sobre storage.objects para
-- `authenticated`: deny-by-default. Sube el servidor (service_role bajo guard);
-- descarga por signed URL generada tras authorize() (alumno dueño o staff).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'submissions', 'submissions', false, 20971520,
  array[
    'application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do nothing;
