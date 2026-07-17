-- =============================================================================
-- Task 5.13 (Hito 5, HU-1.5): export completo del tenant en formatos abiertos.
--
-- CA: el admin OTEC exporta TODOS los datos de su tenant (cursos, alumnos,
-- registros SENCE, notas, certificados, documentos) en CSV/JSON + archivos.
-- Export ASÍNCRONO con notificación al estar listo; incluye MANIFIESTO; la
-- ejecución queda en auditoría.
--
-- `tenant_exports` es la cola de trabajos (1 fila = 1 solicitud). El worker
-- reclama la más antigua en `pending` (claim optimista de dos pasos, ver
-- `tenant-export-runner.ts`), arma el ZIP y deja la fila en `done`/`failed`.
--
-- DECISIONES
-- ----------
--  - Índice ÚNICO PARCIAL `(tenant_id) where status in (pending, running)`: un
--    solo export en vuelo por tenant. Evita reprocesar y una carrera de "pedí
--    dos veces sin querer" (el segundo insert choca con 23505 → `already_running`).
--  - RLS: SOLO `otec_admin` (y superadmin) puede leer. Ni `coordinator` — el
--    export trae RUN, notas, certificados y documentos de TODA la OTEC, un
--    universo más amplio que lo que hoy ve un coordinador por tabla.
--  - Sin policy de INSERT/UPDATE para `authenticated`: el único camino de
--    escritura es `tenant-export-service` (gate + auditoría) y el worker
--    (service_role). Sin DELETE ni para el service_role: el historial de
--    solicitudes queda (mismo criterio que `certificates`/`supervisor_grants`).
-- =============================================================================

create table public.tenant_exports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  requested_by uuid not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  file_path text,
  file_size bigint,
  counts jsonb not null default '{}'::jsonb,
  error text check (error is null or length(error) <= 500),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index tenant_exports_tenant_idx on public.tenant_exports (tenant_id, requested_at desc);

-- Un solo export PENDING/RUNNING por tenant: el barrido del worker (claim de la
-- más antigua) y este índice son lo que evita reprocesar o pisar un export en
-- curso con uno nuevo.
create unique index tenant_exports_one_active_uk
  on public.tenant_exports (tenant_id) where status in ('pending', 'running');

alter table public.tenant_exports enable row level security;
alter table public.tenant_exports force row level security;

-- Lectura: SOLO otec_admin (y superadmin) — ni el coordinador. El export trae
-- TODOS los datos del tenant (RUN, notas, certificados, documentos), un
-- universo mayor al que cualquier policy por tabla le concede hoy a coordinator.
create policy tenant_exports_select on public.tenant_exports
  for select to authenticated
  using (
    public.is_superadmin()
    or (tenant_id = public.jwt_tenant_id() and public.has_role('otec_admin'))
  );
grant select on public.tenant_exports to authenticated;
-- Sin DELETE: la cola de solicitudes es historial (mismo criterio que
-- `certificates`/`supervisor_grants`). Escribe SOLO el servidor:
-- `tenant-export-service` (insert, gate+audit) y el worker (update de estado).
grant select, insert, update on public.tenant_exports to service_role;

-- ---------- bucket privado `exports` (ZIP del tenant) ----------
-- Deny-by-default: CERO policies de storage para `authenticated`. Descarga
-- SIEMPRE por signed URL (`tenant-export-service.getExportDownloadUrl`), nunca
-- por la ruta pública del bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exports', 'exports', false, 524288000, array['application/zip'])
on conflict (id) do nothing;

-- ---------- notifications.kind: + export.ready / export.failed ----------
-- Se recrea con la lista COMPLETA (el CHECK no es acumulable). Leída del
-- esquema real tras 20260717040000 (que ya agregó `certificate.expiring`).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in (
    'grade.published', 'announcement.published', 'forum.reply', 'message.received',
    'reminder.no_attendance', 'reminder.inactive', 'reminder.coordinator_report',
    'certificate.expiring', 'export.ready', 'export.failed'
  ));
