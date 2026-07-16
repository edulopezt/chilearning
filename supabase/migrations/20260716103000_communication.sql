-- =============================================================================
-- Task 3.4 (Hito 3, M9): comunicación nativa — anuncios, foro, mensajería y
-- calendario. Canal OFICIAL 100% NATIVO (sin n8n/terceros): la mensajería
-- asincrónica alumno↔relator/tutor es EXIGIBLE por SENCE (HU-9.3). El correo es
-- best-effort vía EmailSender (degrada a no-op sin RESEND). WhatsApp = Hito 5.
--
-- Modelo: anuncios (curso o acción) con fan-out único al publicar; foro con
-- hilos + respuestas planas y marca "resuelta" (modera staff); mensajería
-- agrupada por (curso, alumno) → tiempos de respuesta computables; calendario
-- manual fusionado en el dominio con plazos de instrumentos.
-- =============================================================================

create type public.calendar_item_kind as enum ('hito', 'evaluacion', 'plazo', 'sesion', 'otro');

-- Helper: ¿el usuario actual está inscrito en el curso? (self-scoping del alumno)
create or replace function public.is_enrolled_in_course(cid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.enrollments e join public.actions a on a.id = e.action_id
    where a.course_id = cid and e.user_id = (select auth.uid())
      and e.tenant_id = public.jwt_tenant_id()
  )
$$;

-- ---------- announcements (HU-9.1) ----------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  course_id uuid references public.courses (id) on delete restrict,
  action_id uuid references public.actions (id) on delete restrict,
  author_user_id uuid not null,
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) between 1 and 20000),
  status public.instrument_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_target check (course_id is not null or action_id is not null)
);
create index announcements_tenant_idx on public.announcements (tenant_id, created_at desc);
create index announcements_course_idx on public.announcements (course_id);
create index announcements_action_idx on public.announcements (action_id);
create trigger announcements_touch before update on public.announcements for each row execute function public.touch_updated_at();

alter table public.announcements enable row level security;
alter table public.announcements force row level security;
create policy announcements_select on public.announcements for select to authenticated using (
  public.is_superadmin() or (tenant_id = public.jwt_tenant_id() and (
    public.has_role('otec_admin') or public.has_role('coordinator') or public.has_role('instructor') or public.has_role('tutor')
    or (status = 'published' and course_id is not null and public.is_enrolled_in_course(course_id))
    or (status = 'published' and action_id is not null and exists (
      select 1 from public.enrollments e where e.action_id = announcements.action_id and e.user_id = (select auth.uid()) and e.tenant_id = public.jwt_tenant_id()))
  )));
grant select on public.announcements to authenticated;
grant select, insert, update, delete on public.announcements to service_role;

-- ---------- forum_threads / forum_posts (HU-9.2) ----------
create table public.forum_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  author_user_id uuid not null,
  title text not null check (length(title) between 1 and 200),
  resolved boolean not null default false,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index forum_threads_course_idx on public.forum_threads (tenant_id, course_id, created_at desc);
create trigger forum_threads_touch before update on public.forum_threads for each row execute function public.touch_updated_at();

alter table public.forum_threads enable row level security;
alter table public.forum_threads force row level security;
-- staff del tenant o alumno inscrito en el curso leen y crean hilos.
create policy forum_threads_select on public.forum_threads for select to authenticated using (
  public.is_superadmin() or (tenant_id = public.jwt_tenant_id() and (
    public.has_role('otec_admin') or public.has_role('coordinator') or public.has_role('instructor') or public.has_role('tutor')
    or public.is_enrolled_in_course(course_id))));
grant select on public.forum_threads to authenticated;
grant select, insert, update, delete on public.forum_threads to service_role;

create table public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  thread_id uuid not null references public.forum_threads (id) on delete restrict,
  author_user_id uuid not null,
  from_staff boolean not null default false,
  body text not null check (length(body) between 1 and 20000),
  created_at timestamptz not null default now()
);
create index forum_posts_thread_idx on public.forum_posts (thread_id, created_at);
alter table public.forum_posts enable row level security;
alter table public.forum_posts force row level security;
create policy forum_posts_select on public.forum_posts for select to authenticated using (
  public.is_superadmin() or (tenant_id = public.jwt_tenant_id() and exists (
    select 1 from public.forum_threads t where t.id = forum_posts.thread_id and (
      public.has_role('otec_admin') or public.has_role('coordinator') or public.has_role('instructor') or public.has_role('tutor')
      or public.is_enrolled_in_course(t.course_id)))));
grant select on public.forum_posts to authenticated;
grant select, insert on public.forum_posts to service_role;

-- ---------- message_threads / messages (HU-9.3, exigible SENCE) ----------
create table public.message_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  student_user_id uuid not null,
  subject text not null check (length(subject) between 1 and 200),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, course_id, student_user_id, subject)
);
create index message_threads_course_idx on public.message_threads (tenant_id, course_id, last_message_at desc);
create index message_threads_student_idx on public.message_threads (student_user_id, last_message_at desc);
alter table public.message_threads enable row level security;
alter table public.message_threads force row level security;
-- El alumno ve SOLO sus hilos; el staff los del tenant. Nunca otro alumno.
create policy message_threads_select on public.message_threads for select to authenticated using (
  public.is_superadmin() or (tenant_id = public.jwt_tenant_id() and (
    student_user_id = (select auth.uid())
    or public.has_role('otec_admin') or public.has_role('coordinator') or public.has_role('instructor') or public.has_role('tutor'))));
grant select on public.message_threads to authenticated;
grant select, insert, update on public.message_threads to service_role;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  thread_id uuid not null references public.message_threads (id) on delete restrict,
  sender_user_id uuid not null,
  sender_is_staff boolean not null,
  body text not null check (length(body) between 1 and 20000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_thread_idx on public.messages (thread_id, created_at);
alter table public.messages enable row level security;
alter table public.messages force row level security;
create policy messages_select on public.messages for select to authenticated using (
  public.is_superadmin() or (tenant_id = public.jwt_tenant_id() and exists (
    select 1 from public.message_threads t where t.id = messages.thread_id and (
      t.student_user_id = (select auth.uid())
      or public.has_role('otec_admin') or public.has_role('coordinator') or public.has_role('instructor') or public.has_role('tutor')))));
grant select on public.messages to authenticated;
grant select, insert, update on public.messages to service_role;

-- ---------- calendar_items (HU-9.4) ----------
create table public.calendar_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  kind public.calendar_item_kind not null default 'hito',
  title text not null check (length(title) between 1 and 200),
  description text not null default '' check (length(description) <= 4000),
  due_at timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calendar_items_course_idx on public.calendar_items (tenant_id, course_id, due_at);
create trigger calendar_items_touch before update on public.calendar_items for each row execute function public.touch_updated_at();
alter table public.calendar_items enable row level security;
alter table public.calendar_items force row level security;
create policy calendar_items_select on public.calendar_items for select to authenticated using (
  public.is_superadmin() or (tenant_id = public.jwt_tenant_id() and (
    public.has_role('otec_admin') or public.has_role('coordinator') or public.has_role('instructor') or public.has_role('tutor')
    or public.is_enrolled_in_course(course_id))));
grant select on public.calendar_items to authenticated;
grant select, insert, update, delete on public.calendar_items to service_role;

-- ---------- notifications: extender los kinds (outbox de 2.2) ----------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('grade.published', 'announcement.published', 'forum.reply', 'message.received'));
