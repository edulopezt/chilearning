-- =============================================================================
-- Task 3.12 (Hito 3, HU-5.10): expediente digital de fiscalización por acción.
-- Documentos (OC OTIC, comunicación, rectificaciones, nóminas, DJs, certificados,
-- evidencias) con tipo/estado/fecha; checklist de completitud; descarga ZIP en un
-- clic; los marcados DEFINITIVOS son INMUTABLES (trigger). Staff-only (contiene
-- montos comerciales → sin supervisor).
-- =============================================================================

create type public.action_document_type as enum
  ('orden_compra_otic', 'comunicacion', 'rectificacion', 'nomina', 'dj', 'certificado', 'evidencia', 'otro');
create type public.action_document_status as enum ('borrador', 'vigente', 'anulado');

create table public.action_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  action_id uuid not null references public.actions (id) on delete restrict,
  doc_type public.action_document_type not null,
  title text not null check (length(title) between 1 and 200),
  status public.action_document_status not null default 'borrador',
  is_definitive boolean not null default false,
  document_date date,
  file_path text not null,
  file_name text not null check (length(file_name) between 1 and 300),
  file_size bigint not null check (file_size > 0),
  mime_type text not null,
  uploaded_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index action_documents_action_idx on public.action_documents (tenant_id, action_id, doc_type);
create trigger action_documents_touch before update on public.action_documents
  for each row execute function public.touch_updated_at();

-- Inmutabilidad de los definitivos (CA HU-5.10): un doc marcado definitivo no se
-- modifica ni borra, ni siquiera por service_role.
create or replace function public.action_documents_lock_definitive()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.is_definitive then
    raise exception 'documento definitivo es inmutable (HU-5.10)' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger action_documents_definitive_lock
  before update or delete on public.action_documents
  for each row execute function public.action_documents_lock_definitive();

alter table public.action_documents enable row level security;
alter table public.action_documents force row level security;
-- Staff académico del tenant (el expediente trae OC OTIC con montos → sin supervisor).
create policy action_documents_select on public.action_documents for select to authenticated using (
  public.is_superadmin() or (tenant_id = public.jwt_tenant_id() and (
    public.has_role('otec_admin') or public.has_role('coordinator') or public.has_role('instructor'))));
grant select on public.action_documents to authenticated;
-- Sin grant de DELETE a service_role (seguridad de los definitivos): revocar/anular
-- es un cambio de estado (mientras no sea definitivo), no un borrado.
grant select, insert, update on public.action_documents to service_role;

-- Bucket privado del expediente (50 MB, allowlist de MIME). Deny-by-default.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('action_documents', 'action_documents', false, 52428800, array[
  'application/pdf', 'image/png', 'image/jpeg', 'application/zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]) on conflict (id) do nothing;
