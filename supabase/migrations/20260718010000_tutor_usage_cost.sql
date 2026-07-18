-- =============================================================================
-- Task 5.8b (Hito 5, M11, HU-11.2/11.3): costo REAL en USD del Tutor IA.
--
-- OpenRouter manda, en el ÚLTIMO chunk SSE del stream de chat, un objeto
-- `usage` con `cost` (USD real cobrado a la cuenta) — ver
-- `src/modules/tutor-ia/domain/sse.ts`/`ai-client.ts`. Este costo se acumula
-- por alumno × día en una columna nueva de `tutor_usage_daily`.
--
-- ⚠ NO se tocan las firmas de `tutor_add_usage`/`tutor_add_usage_system`
-- (5.8a): en Postgres, `CREATE OR REPLACE FUNCTION` con un parámetro NUEVO
-- agregado cambia el tipo de firma y crea un OVERLOAD DUPLICADO en vez de
-- reemplazar la función existente. La RPC del costo va SEPARADA
-- (`tutor_add_usage_cost`) y se llama SIEMPRE justo DESPUÉS de
-- `tutor_add_usage` en la misma request (mismo `p_day`): si se llamara antes,
-- el UPDATE afectaría 0 filas en silencio porque la fila del día aún no
-- existiría (documentado también en el código, no solo aquí).
--
-- Mismo contrato de identidad que `tutor_add_usage` (5.8a, hallazgo MED de esa
-- migración): exige `auth.uid()` real e igual a `p_user_id` — el llamador
-- SIEMPRE debe usar el cliente de SESIÓN (`createSupabaseServerClient()`),
-- nunca `tenantGuard().db` (service-role, sin JWT de usuario), o esta RPC
-- rechaza por diseño.
-- =============================================================================

alter table public.tutor_usage_daily
  add column cost_usd numeric(12, 6) not null default 0;

create or replace function public.tutor_add_usage_cost(
  p_tenant_id uuid,
  p_user_id uuid,
  p_day date,
  p_cost_usd numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tenant_id is null or p_user_id is null or p_day is null then
    raise exception 'tutor_add_usage_cost: parámetros obligatorios faltantes';
  end if;
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception 'tutor_add_usage_cost: requiere que p_user_id coincida con el usuario autenticado' using errcode = '42501';
  end if;
  if p_tenant_id is distinct from public.jwt_tenant_id() then
    raise exception 'tutor_add_usage_cost: p_tenant_id no coincide con el tenant del usuario autenticado' using errcode = '42501';
  end if;

  -- UPDATE, no upsert: la fila del día la crea `tutor_add_usage` (llamada
  -- SIEMPRE primero, mismo p_day) — si no existe todavía, este UPDATE afecta
  -- 0 filas en silencio (comportamiento documentado, no un bug de esta RPC).
  update public.tutor_usage_daily
    set cost_usd = cost_usd + greatest(coalesce(p_cost_usd, 0), 0)
    where tenant_id = p_tenant_id and user_id = p_user_id and day = p_day;
end;
$$;
revoke all on function public.tutor_add_usage_cost(uuid, uuid, date, numeric) from public;
-- SOLO `authenticated` (mismo criterio que `tutor_add_usage`): con el chequeo
-- de `auth.uid()` incondicional, un caller `service_role` (sin JWT de usuario)
-- siempre fallaría igual, así que no se le concede el grant.
grant execute on function public.tutor_add_usage_cost(uuid, uuid, date, numeric) to authenticated;
