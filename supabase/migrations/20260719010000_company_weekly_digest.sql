-- =============================================================================
-- Task 5.9 (Hito 5, HU-8.2): digest semanal por correo a RRHH de la empresa
-- cliente ("avance, riesgos, hitos" redactado en lenguaje ejecutivo, con IA
-- cuando hay proveedor y con una plantilla determinística de respaldo si no).
--
-- `company_weekly_digest_log`: ledger INSERT-only, mismo patrón que
-- `certificate_expiry_alerts` (task 5.12) y `certificate_expiry_config` — el
-- unique `(tenant_id, company_id, week_start)` es la idempotencia: si el tick
-- corre dos veces en la misma semana, la 2ª ve el 23505 y no reenvía. Lectura
-- de staff del tenant (transparencia operativa, "¿ya se envió el digest de
-- esta semana?"); sin INSERT/UPDATE/DELETE para nadie salvo `service_role`
-- (el worker).
-- =============================================================================

create table public.company_weekly_digest_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  company_id uuid not null references public.companies (id) on delete restrict,
  week_start date not null,
  sent_at timestamptz not null default now(),
  -- Integridad compuesta por tenant, mismo criterio que `company_members`
  -- (20260717030000): sin esto nada del esquema impide una fila
  -- `(tenant_id = A, company_id = <empresa del tenant B>)`.
  constraint company_weekly_digest_log_company_same_tenant_fk
    foreign key (company_id, tenant_id) references public.companies (id, tenant_id),
  constraint company_weekly_digest_log_uk unique (tenant_id, company_id, week_start)
);
create index company_weekly_digest_log_tenant_idx
  on public.company_weekly_digest_log (tenant_id, week_start desc);

alter table public.company_weekly_digest_log enable row level security;
alter table public.company_weekly_digest_log force row level security;

-- Lectura de staff del tenant (es la bitácora de "a qué empresa ya se le
-- envió el digest de esta semana"). Ni la empresa ni el alumno la leen: es
-- dato OPERATIVO del OTEC, no del cliente ni del trabajador.
create policy company_weekly_digest_log_select on public.company_weekly_digest_log
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        public.has_role('otec_admin') or public.has_role('coordinator')
        or public.has_role('instructor')
      )
    )
  );
grant select on public.company_weekly_digest_log to authenticated;

-- INSERT-only, y solo para el service_role (el worker): sin UPDATE ni DELETE,
-- "ya se envió esta semana" no se reescribe (mismo criterio que
-- `certificate_expiry_alerts`, `sence_events` y `audit_log`).
grant select, insert on public.company_weekly_digest_log to service_role;
