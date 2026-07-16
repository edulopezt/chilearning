-- =============================================================================
-- Task 3.5 (Hito 3, HU-2.4 / RNF-3): derechos Ley 21.719 + consentimiento.
-- Ley 21.719 vigente (01-12-2026). Derechos operables desde la UI SIN tocar la BD
-- a mano (P4). La supresión RESPETA las retenciones legales: los registros SENCE
-- (sence_sessions/events), certificados y audit_log se CONSERVAN e informan como
-- tales (obligación de fiscalización SENCE > derecho de supresión).
--
--  - `consents`: INSERT-only, un registro por aceptación de una versión de política.
--  - `dsr_requests`: solicitudes del titular (acceso/rectificación/supresión/
--    portabilidad); acceso y portabilidad se autoservicen (JSON), rectificación y
--    supresión pasan por acción de staff (control SENCE de RUN/nombres).
-- =============================================================================

create type public.dsr_kind as enum ('access', 'rectification', 'erasure', 'portability');
create type public.dsr_status as enum ('pending', 'processing', 'completed', 'rejected');

-- La supresión (applyErasure) redacta el cuerpo de los posts del foro del titular;
-- `forum_posts` nació sin grant de UPDATE (append-only) → se habilita al servidor
-- (service_role bajo tenantGuard) SOLO para la supresión Ley 21.719 (4-ojos HIGH).
grant update on public.forum_posts to service_role;

-- ---------- consents (INSERT-only) ----------
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  policy_version text not null check (length(policy_version) between 1 and 40),
  accepted_at timestamptz not null default now(),
  ip inet,
  unique (tenant_id, user_id, policy_version)
);
create index consents_user_idx on public.consents (user_id, accepted_at desc);
create index consents_tenant_idx on public.consents (tenant_id);

alter table public.consents enable row level security;
alter table public.consents force row level security;
-- El titular ve/inserta los suyos; el otec_admin los lee (auditoría de consentimiento).
create policy consents_select on public.consents for select to authenticated using (
  public.is_superadmin() or user_id = (select auth.uid())
  or (tenant_id = public.jwt_tenant_id() and public.has_role('otec_admin')));
create policy consents_insert_self on public.consents for insert to authenticated
  with check (tenant_id = public.jwt_tenant_id() and user_id = (select auth.uid()));
grant select, insert on public.consents to authenticated;
grant select, insert on public.consents to service_role;
-- INSERT-only: sin update/delete ni para service_role (reusa el guard de audit_log).
revoke update, delete, truncate on table public.consents from anon, authenticated, service_role;
create trigger consents_no_update before update or delete on public.consents
  for each row execute function public.audit_log_immutable();

-- ---------- dsr_requests ----------
create table public.dsr_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  kind public.dsr_kind not null,
  status public.dsr_status not null default 'pending',
  detail text not null default '' check (length(detail) <= 4000),
  resolution_note text not null default '' check (length(resolution_note) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index dsr_requests_user_idx on public.dsr_requests (user_id, created_at desc);
create index dsr_requests_tenant_idx on public.dsr_requests (tenant_id, status, created_at desc);
create trigger dsr_requests_touch before update on public.dsr_requests
  for each row execute function public.touch_updated_at();

alter table public.dsr_requests enable row level security;
alter table public.dsr_requests force row level security;
-- El titular ve/crea las suyas; el staff (otec_admin/coordinator) gestiona.
create policy dsr_select on public.dsr_requests for select to authenticated using (
  public.is_superadmin() or user_id = (select auth.uid())
  or (tenant_id = public.jwt_tenant_id() and (public.has_role('otec_admin') or public.has_role('coordinator'))));
create policy dsr_insert_self on public.dsr_requests for insert to authenticated
  with check (tenant_id = public.jwt_tenant_id() and user_id = (select auth.uid()));
create policy dsr_update_staff on public.dsr_requests for update to authenticated
  using (tenant_id = public.jwt_tenant_id() and (public.has_role('otec_admin') or public.has_role('coordinator')))
  with check (tenant_id = public.jwt_tenant_id());
grant select, insert, update on public.dsr_requests to authenticated;
grant select, insert, update on public.dsr_requests to service_role;
