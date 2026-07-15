-- =============================================================================
-- Task 2.6 (Hito 2): worker de expiración SENCE + alertas operativas.
--
--  - `alerts`: bitácora de alertas operativas (v1: tasa de error SENCE por
--    tenant; la tarea 2.7 añade la alerta de asistencia baja el día 1). Solo el
--    servidor (worker, service_role) escribe; el staff del tenant la lee.
--  - Índice parcial para el barrido T4: `sence_sessions_expiry_idx` cubre
--    (status, expires_at), pero en `iniciada_pendiente` el deadline es
--    `created_at + SENCE_PENDING_TIMEOUT_MINUTES` y `expires_at` es NULL.
-- =============================================================================

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  -- NULL = alerta de plataforma (sin tenant); solo la ve el superadmin.
  tenant_id uuid references public.tenants (id) on delete restrict,
  kind text not null check (kind in ('sence_error_rate', 'sence_day1_low_attendance')),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  -- Mensaje legible en español de Chile (lo compone el servidor).
  message text not null check (length(message) between 1 and 500),
  details jsonb not null default '{}'::jsonb,
  -- Acción asociada (alerta día-1); NULL para alertas por tenant/plataforma.
  action_id uuid references public.actions (id) on delete restrict,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid
);

create index alerts_tenant_idx on public.alerts (tenant_id, created_at desc);
-- Lookup del cooldown: "¿ya alerté este kind para este tenant hace poco?".
create index alerts_kind_idx on public.alerts (kind, tenant_id, created_at desc);

alter table public.alerts enable row level security;
alter table public.alerts force row level security;

-- Lee: admin del OTEC y supervisor (fiscalizador) de su tenant; superadmin todo
-- (incluidas las alertas de plataforma, tenant NULL).
create policy alerts_select_admin on public.alerts
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (public.has_role('otec_admin') or public.has_role('supervisor'))
    )
  );

grant select on public.alerts to authenticated;
-- Escribe solo el servidor. `update` queda para el acknowledge futuro.
grant select, insert, update on public.alerts to service_role;

-- Barrido T4 del worker: pendientes ordenadas por antigüedad.
create index sence_sessions_pending_expiry_idx
  on public.sence_sessions (created_at)
  where status = 'iniciada_pendiente';
