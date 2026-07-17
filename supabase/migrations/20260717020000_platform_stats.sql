-- =============================================================================
-- Métricas de negocio de plataforma (task 5.5, HU-10.3).
--
-- Una sola RPC que devuelve SOLO AGREGADOS por tenant (conteos, tasas, fechas).
-- El "no PII" no depende de que el llamador se porte bien: lo garantiza la FORMA
-- del retorno — no hay forma de sacar de aquí el nombre, RUN ni correo de un
-- alumno. Restricción de rol del spec §3: el superadmin NO ve contenido
-- pedagógico ni datos de alumnos (salvo soporte, que se audita aparte desde
-- platform-service.recordTenantSupportView).
-- =============================================================================

-- ⚠ SECURITY INVOKER, *no* DEFINER (desviación deliberada del diseño original).
--
-- Motivo: bajo `force row level security` el rol dueño (postgres) NO bypassa RLS
-- en Supabase cloud — hallazgo ya documentado dos veces en este repo
-- (20260714212003, que por eso dejó el Auth Hook en INVOKER, y 20260717010000,
-- que necesitó la policy `tenants_select_definer` para que un DEFINER pudiera
-- leer `tenants`). Todas las policies de las tablas que se agregan aquí son
-- `for select to authenticated`: el rol `postgres` no calza NINGUNA, así que un
-- DEFINER leería 0 filas en producción. Verificado en local: una función DEFINER
-- cuyo dueño no tiene BYPASSRLS devuelve 0 contra 95 filas reales. Y como el
-- postgres LOCAL sí trae BYPASSRLS, el bug pasaría los tests en verde y llegaría
-- a producción como un tablero de puros ceros.
--
-- INVOKER es además ESTRICTAMENTE más seguro: la RPC corre con el JWT real del
-- llamador, así que RLS sigue siendo la última línea de defensa. Es correcto
-- porque las policies YA le dan al superadmin lectura transversal: todas traen
-- `public.is_superadmin()` como primer disyunto (tenants, courses, actions,
-- enrollments, certificates, alerts) y todas tienen `grant select` a
-- `authenticated`. No hace falta privilegio extra alguno.
--
-- El gate 42501 va PRIMERO igual: sin él, un otec_admin recibiría la fila de SU
-- tenant (RLS filtra) en vez de un error — un tablero parcial silencioso en vez
-- de un "no tienes permiso" nítido. Gate + RLS = defensa en profundidad.
create or replace function public.platform_tenant_stats()
returns table (
  tenant_id uuid,
  slug text,
  name text,
  plan text,
  status public.tenant_status,
  created_at timestamptz,
  students bigint,
  enrollments bigint,
  actions bigint,
  courses bigint,
  certificates bigint,
  open_alerts bigint,
  sence_error_alerts_7d bigint,
  last_enrollment_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  -- Deny-by-default (P7): el claim `superadmin` lo emite el Auth Hook desde
  -- platform_admins; nadie puede fabricárselo desde memberships (D-006).
  if not public.is_superadmin() then
    raise exception 'solo superadmin' using errcode = '42501';
  end if;

  return query
  select
    t.id,
    t.slug,
    t.name,
    t.plan,
    t.status,
    t.created_at,
    -- Alumnos ÚNICOS del tenant (un alumno en 3 acciones cuenta 1 vez).
    (select count(distinct e.user_id) from public.enrollments e where e.tenant_id = t.id),
    (select count(*) from public.enrollments e where e.tenant_id = t.id),
    (select count(*) from public.actions a where a.tenant_id = t.id),
    (select count(*) from public.courses c where c.tenant_id = t.id),
    (select count(*) from public.certificates ce where ce.tenant_id = t.id),
    -- `alerts.tenant_id` es NULLABLE (alertas de plataforma): el `= t.id` las
    -- excluye por construcción, que es justo lo que queremos por tenant.
    (select count(*) from public.alerts al
      where al.tenant_id = t.id and al.acknowledged_at is null),
    (select count(*) from public.alerts al
      where al.tenant_id = t.id
        and al.kind = 'sence_error_rate'
        and al.created_at > now() - interval '7 days'),
    (select max(e.created_at) from public.enrollments e where e.tenant_id = t.id)
  from public.tenants t;
end;
$$;

comment on function public.platform_tenant_stats() is
  'Metricas agregadas por tenant para el tablero superadmin (HU-10.3). Solo agregados: jamas PII de alumnos. Gate 42501 + RLS (INVOKER).';

revoke all on function public.platform_tenant_stats() from public;
grant execute on function public.platform_tenant_stats() to authenticated;
