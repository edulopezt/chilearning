-- =============================================================================
-- Task 5.10 (Hito 5, HU-3.5/4.5): asistente guiado de creación de cursos.
--
--  - `course_drafts`: el estado de un asistente en curso (7 pasos, ver el CHECK
--    de `current_step`). `state` es un jsonb ACOTADO (256 KB, igual criterio que
--    `scorm_cmi.data`) con TODO lo que el usuario ha ido llenando; se guarda a
--    medias y se retoma. `status='discarded'` en vez de DELETE (el registro
--    queda para auditoría, mismo criterio que `assignments`/`quizzes`).
--  - `generated_course_id`: se fija la PRIMERA vez que `generateFromDraft` logra
--    crear el curso — antes de tocar lecciones/evaluaciones — para que un fallo
--    a medio camino dentro del bucle deje rastro de qué curso ya existe y NUNCA
--    se reintente el bucle completo (evita duplicar contenido).
--  - Bucket privado `course_descriptors`: el .docx que sube el coordinador queda
--    ARCHIVADO junto al curso (HU-3.5); solo Word (.docx), 10 MB. Igual criterio
--    que `submissions`/`scorm`: sube el servidor (service_role bajo guard), sin
--    policies de `authenticated` sobre `storage.objects` (deny-by-default).
--  - Lectura de `course_drafts`: SOLO otec_admin/coordinator (quienes gestionan
--    el catálogo, matriz §3) — el instructor/relator NO gestiona altas de curso.
-- =============================================================================

create table public.course_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  created_by uuid not null,
  source text not null check (source in ('scratch', 'descriptor')),
  descriptor_path text,
  descriptor_name text check (descriptor_name is null or length(descriptor_name) <= 300),
  state jsonb not null default '{}'::jsonb check (pg_column_size(state) <= 262144), -- 256 KB
  current_step text not null default 'datos' check (
    current_step in ('datos', 'estructura', 'aprendizajes', 'contenido', 'evaluaciones', 'completitud', 'revision')
  ),
  status text not null default 'in_progress' check (status in ('in_progress', 'generated', 'discarded')),
  generated_course_id uuid references public.courses (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index course_drafts_tenant_status_updated_idx
  on public.course_drafts (tenant_id, status, updated_at desc);

create trigger course_drafts_touch
  before update on public.course_drafts
  for each row execute function public.touch_updated_at();

alter table public.course_drafts enable row level security;
alter table public.course_drafts force row level security;

-- Lectura: solo otec_admin/coordinator del propio tenant (o superadmin). El
-- asistente escribe SIEMPRE vía service-role bajo tenantGuard (wizard-service),
-- por eso `authenticated` no tiene insert/update/delete.
create policy course_drafts_select on public.course_drafts
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (public.has_role('otec_admin') or public.has_role('coordinator'))
    )
  );
grant select on public.course_drafts to authenticated;
grant select, insert, update on public.course_drafts to service_role;

-- ---------- bucket privado `course_descriptors` (Storage) ----------
-- 10 MB, solo .docx (Anexo 4 SENCE se sube en Word). CERO policies sobre
-- storage.objects para `authenticated`: deny-by-default, igual que `submissions`
-- y `scorm`. Descarga por signed URL (`descriptorDownloadUrl`, tras authorize()).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course_descriptors', 'course_descriptors', false, 10485760,
  array['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;
