-- =============================================================================
-- Task 3.3 (Hito 3, HU-5.6): checklist de Declaración Jurada (DJ/GCA) por
-- participante + estado + nómina exportable. La DJ se emite en la GCA de SENCE;
-- la plataforma GUÍA y REGISTRA, no la reemplaza (P3). Los recordatorios corren
-- por el pipeline periférico (3.9/n8n) — aquí solo el registro de estado.
--
-- Estados (guía GCA v1.3): pendiente_emitir → pendiente_validacion → emitida →
-- aprobado_reemision / rechazado_reemision → … / anulada (terminal). Ventana de
-- liquidación 60 días corridos desde el término de la acción (DJ_SETTLEMENT_DAYS).
-- =============================================================================

create type public.dj_state as enum
  ('pendiente_emitir', 'pendiente_validacion', 'emitida', 'aprobado_reemision', 'rechazado_reemision', 'anulada');

create table public.dj_checklist (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  action_id uuid not null references public.actions (id) on delete restrict,
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  state public.dj_state not null default 'pendiente_emitir',
  settlement_deadline date,
  last_reminder_at timestamptz,
  notes text check (notes is null or length(notes) <= 1000),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (action_id, enrollment_id)
);
create index dj_checklist_tenant_idx on public.dj_checklist (tenant_id, action_id);
create index dj_checklist_deadline_idx on public.dj_checklist (settlement_deadline) where state <> 'anulada';
create trigger dj_checklist_touch before update on public.dj_checklist
  for each row execute function public.touch_updated_at();

alter table public.dj_checklist enable row level security;
alter table public.dj_checklist force row level security;
-- Lectura: staff del tenant (otec_admin/coordinator/instructor). Escritura: otec_admin/
-- coordinator vía servicio. Sin supervisor: la DJ es cumplimiento SENCE interno de la OTEC
-- (liquidación con la GCA), no dato de la empresa — mismo criterio que el expediente (3.12).
create policy dj_select on public.dj_checklist for select to authenticated using (
  public.is_superadmin() or (tenant_id = public.jwt_tenant_id() and (
    public.has_role('otec_admin') or public.has_role('coordinator')
    or public.has_role('instructor'))));
grant select on public.dj_checklist to authenticated;
grant select, insert, update on public.dj_checklist to service_role;
