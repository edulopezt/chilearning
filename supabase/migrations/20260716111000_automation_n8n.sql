-- =============================================================================
-- Task 3.9 (Hito 3, HU-5.9): automatizaciones periféricas por n8n. La lógica
-- crítica SIGUE en el worker (P3, ADR-004); n8n solo recibe eventos AGREGADOS y
-- SEUDONIMIZADOS (RNF-10: cero RUN/nombre/correo). El correo con destinatario
-- real lo manda el worker por `EmailSender`; n8n solo dispara flujos periféricos.
--
-- Dos tablas: opt-out del alumno (auto-gestionable) y config por acción del staff.
-- =============================================================================

-- Recordatorios nuevos como kinds de la outbox `notifications` (dedup diario).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in (
    'grade.published', 'announcement.published', 'forum.reply', 'message.received',
    'reminder.no_attendance', 'reminder.inactive', 'reminder.coordinator_report'
  ));

-- ---------- opt-out de comunicaciones (Ley 21.719: el alumno decide) ----------
create table public.communication_opt_outs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  channel text not null check (channel in ('email', 'whatsapp')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, channel)
);
create index communication_opt_outs_user_idx on public.communication_opt_outs (user_id, tenant_id);

alter table public.communication_opt_outs enable row level security;
alter table public.communication_opt_outs force row level security;
-- El alumno gestiona SU propio opt-out; el staff del tenant lo lee.
create policy comm_opt_outs_select on public.communication_opt_outs for select to authenticated using (
  public.is_superadmin() or (tenant_id = public.jwt_tenant_id() and (
    user_id = (select auth.uid()) or public.has_role('otec_admin') or public.has_role('coordinator'))));
create policy comm_opt_outs_insert on public.communication_opt_outs for insert to authenticated with check (
  tenant_id = public.jwt_tenant_id() and user_id = (select auth.uid()));
create policy comm_opt_outs_delete on public.communication_opt_outs for delete to authenticated using (
  tenant_id = public.jwt_tenant_id() and user_id = (select auth.uid()));
grant select, insert, delete on public.communication_opt_outs to authenticated;
grant select, insert, delete on public.communication_opt_outs to service_role;

-- ---------- config de automatización por acción (staff) ----------
create table public.automation_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  action_id uuid not null references public.actions (id) on delete restrict,
  kind text not null check (kind in ('no_attendance', 'inactive', 'coordinator_report')),
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (action_id, kind)
);
create index automation_config_tenant_idx on public.automation_config (tenant_id, action_id);
create trigger automation_config_touch before update on public.automation_config
  for each row execute function public.touch_updated_at();

alter table public.automation_config enable row level security;
alter table public.automation_config force row level security;
-- Lee: staff del tenant. Escribe: solo service_role (vía servicio, con audit).
create policy automation_config_select on public.automation_config for select to authenticated using (
  public.is_superadmin() or (tenant_id = public.jwt_tenant_id() and (
    public.has_role('otec_admin') or public.has_role('coordinator'))));
grant select on public.automation_config to authenticated;
grant select, insert, update on public.automation_config to service_role;
