-- =============================================================================
-- Task 5.1a (Hito 5, HU-4.2, ADR-006): ingesta de paquetes SCORM 1.2/2004.
-- El paquete se sube como un .zip a Storage y se valida/extrae EN EL WORKER
-- (job `scorm-extract`), nunca en el request web (RNF-6, cursos largos).
--
--  - `scorm_packages`: una fila por paquete subido, con su ciclo de vida
--    (uploaded → processing → ready|error) y un RESUMEN del manifiesto (jamás
--    el XML crudo completo: mantiene la fila liviana y evita filtrar rutas
--    internas del paquete de autor).
--  - `scorm_cmi`: el estado de intento (cmi.*) por (inscripción, paquete). La
--    usará el reproductor de la task 5.1b (scorm-again), pero se crea AHORA
--    para no partir el esquema en dos PRs.
--  - Bucket privado `scorm`: sube el servidor (service_role bajo guard); el
--    alumno NUNCA entra a Storage directo, siempre vía proxy autenticado
--    (5.1b). Por eso NO hay policy de `authenticated` para `scorm_packages`
--    del lado del alumno — el staff sí lee para gestionar la ingesta.
-- =============================================================================

-- ⚠ ÚNICA sentencia de esta migración que toca el enum `lesson_kind`: Postgres
-- prohíbe usar un valor de enum recién agregado en la MISMA transacción/migración.
alter type public.lesson_kind add value if not exists 'scorm';

-- ---------- scorm_packages ----------
create type public.scorm_package_status as enum ('uploaded', 'processing', 'ready', 'error');

create table public.scorm_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  title text not null check (length(title) between 1 and 200),
  status public.scorm_package_status not null default 'uploaded',
  scorm_version text check (scorm_version is null or scorm_version in ('1.2', '2004')),
  zip_path text not null,
  extracted_prefix text,
  entry_href text,
  -- Resumen ACOTADO del manifiesto (version/entryHref/resourceCount): jamás el
  -- XML crudo completo (mantiene la fila liviana, sin rutas internas del autor).
  manifest jsonb,
  error_code text check (
    error_code is null or error_code in (
      'no_manifest', 'invalid_manifest', 'entry_missing', 'unsafe_path', 'too_large', 'storage_error'
    )
  ),
  file_size bigint check (file_size > 0),
  uploaded_by uuid not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scorm_packages_tenant_course_status_idx
  on public.scorm_packages (tenant_id, course_id, status);

create trigger scorm_packages_touch
  before update on public.scorm_packages
  for each row execute function public.touch_updated_at();

alter table public.scorm_packages enable row level security;
alter table public.scorm_packages force row level security;

-- Lectura: staff de gestión del curso (admin/coordinador/relator). El alumno
-- NO tiene select directo: pasa por el proxy autenticado del servidor (5.1b).
create policy scorm_packages_select on public.scorm_packages
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        public.has_role('otec_admin') or public.has_role('coordinator') or public.has_role('instructor')
      )
    )
  );
grant select on public.scorm_packages to authenticated;
grant select, insert, update, delete on public.scorm_packages to service_role;

-- ---------- scorm_cmi (estado de intento; lo consume el PR 5.1b) ----------
create table public.scorm_cmi (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  package_id uuid not null references public.scorm_packages (id) on delete restrict,
  lesson_id uuid not null references public.lessons (id) on delete restrict,
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 262144), -- 256 KB
  lesson_status text,
  score_raw numeric,
  updated_at timestamptz not null default now(),
  unique (enrollment_id, package_id)
);

create index scorm_cmi_enrollment_idx on public.scorm_cmi (enrollment_id);
create index scorm_cmi_tenant_idx on public.scorm_cmi (tenant_id);

create trigger scorm_cmi_touch
  before update on public.scorm_cmi
  for each row execute function public.touch_updated_at();

alter table public.scorm_cmi enable row level security;
alter table public.scorm_cmi force row level security;

-- Lectura: el propio alumno (dueño de la inscripción) o staff de gestión.
create policy scorm_cmi_select on public.scorm_cmi
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        exists (
          select 1 from public.enrollments e
          where e.id = scorm_cmi.enrollment_id and e.user_id = (select auth.uid())
        )
        or public.has_role('otec_admin') or public.has_role('coordinator')
        or public.has_role('instructor') or public.has_role('tutor')
      )
    )
  );
grant select on public.scorm_cmi to authenticated;
-- SIN delete: el estado de intento es corregible (upsert de scorm-again) pero
-- nunca se borra por RLS/grant — solo el ciclo de vida del paquete lo arrastra.
grant select, insert, update on public.scorm_cmi to service_role;

-- ---------- bucket privado `scorm` (Storage) ----------
-- 250 MB (igual al límite de subida del servicio). SIN allowlist de MIME: además
-- del .zip original se guardan los assets extraídos (html/js/css/img/mp4/…),
-- variedad de mimetypes que no vale la pena enumerar.
insert into storage.buckets (id, name, public, file_size_limit)
values ('scorm', 'scorm', false, 262144000)
on conflict (id) do nothing;
