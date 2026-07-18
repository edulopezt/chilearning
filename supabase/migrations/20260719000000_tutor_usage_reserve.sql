-- =============================================================================
-- Task 5.8b (fix post-revisión adversarial, HU-11.2): reserva ATÓMICA del cupo
-- de mensajes del Tutor IA.
--
-- Hallazgo de revisión de seguridad (2026-07-18, MEDIUM, CONFIRMADO en la
-- verificación independiente): el enforcement anterior separaba LECTURA
-- (`checkBudgetForContext`, simples SELECTs en `route.ts`, ANTES de invocar al
-- proveedor de IA) de ESCRITURA (el incremento real, `tutor_add_usage`, solo
-- al FINAL de `streamTutorAnswer`, después de todo el streaming del LLM — la
-- parte más lenta). Sin ningún lock ni upsert atómico "reserva primero" entre
-- ambos pasos, una ráfaga de requests concurrentes del mismo alumno (o de
-- varios alumnos del mismo tenant a la vez) podía leer el mismo contador
-- "viejo", pasar TODAS el chequeo, e incurrir cada una en una llamada REAL y
-- pagada a OpenRouter antes de que ninguna alcanzara a incrementar el
-- contador — rompiendo el "corte automático al llegar al tope" de la CA de
-- HU-11.2, no como un bug transitorio sino por diseño.
--
-- Esta RPC hace CHEQUEO + INCREMENTO del contador de MENSAJES en la MISMA
-- transacción, serializada con un advisory lock POR TENANT
-- (`pg_advisory_xact_lock`, liberado automáticamente al terminar la llamada —
-- cada RPC top-level de supabase-js es su propia transacción implícita). Se
-- llama SIEMPRE antes de invocar al proveedor de IA
-- (`reserveBudgetForContext` en `tutor-chat-service.ts`, usada por
-- `route.ts` en el mismo punto donde antes se llamaba `checkBudgetForContext`).
--
-- Límite conocido, documentado (no es un descuido): el presupuesto MENSUAL de
-- tokens del tenant no se puede reservar exacto por adelantado — el conteo
-- real de tokens de una respuesta solo se sabe al terminar su streaming. Este
-- mecanismo cierra el conteo de MENSAJES de forma exacta y ACOTA la ventana
-- del presupuesto de tokens al advisory lock: como el lock serializa TODOS
-- los intentos concurrentes del mismo tenant, el peor caso ya no es "N
-- requests concurrentes leen el mismo valor viejo" sino "como mucho 1
-- request en vuelo por tenant cuyo costo aún no se sumó" — una franja
-- acotada por la concurrencia real, no una carrera sin límite.
--
-- Mismo contrato de identidad que `tutor_add_usage`/`tutor_add_usage_cost`
-- (5.8a/5.8b): exige `auth.uid()` real e igual a `p_user_id` — el llamador
-- SIEMPRE debe usar el cliente de SESIÓN, nunca `tenantGuard().db`.
-- =============================================================================

create or replace function public.tutor_try_reserve_message(
  p_tenant_id uuid,
  p_user_id uuid,
  p_day date,
  p_daily_limit int,
  p_monthly_token_budget bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month_start date;
  v_tenant_tokens bigint;
  v_messages_today int;
begin
  if p_tenant_id is null or p_user_id is null or p_day is null
     or p_daily_limit is null or p_monthly_token_budget is null then
    raise exception 'tutor_try_reserve_message: parámetros obligatorios faltantes';
  end if;
  if auth.uid() is null then
    raise exception 'tutor_try_reserve_message: requiere un usuario autenticado' using errcode = '42501';
  end if;
  if p_user_id is distinct from auth.uid() then
    raise exception 'tutor_try_reserve_message: p_user_id no coincide con el usuario autenticado' using errcode = '42501';
  end if;
  if p_tenant_id is distinct from public.jwt_tenant_id() then
    raise exception 'tutor_try_reserve_message: p_tenant_id no coincide con el tenant del usuario autenticado' using errcode = '42501';
  end if;

  -- Serializa TODOS los intentos concurrentes de ESTE tenant: mientras una
  -- transacción está entre el chequeo y la reserva, ninguna otra puede leer
  -- los mismos contadores todavía no actualizados. Ámbito de transacción
  -- (se libera solo al terminar esta llamada).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text, 0));

  v_month_start := pg_catalog.date_trunc('month', p_day::timestamp)::date;
  select coalesce(sum(input_tokens + output_tokens), 0) into v_tenant_tokens
    from public.tutor_usage_daily
    where tenant_id = p_tenant_id and day >= v_month_start;

  -- Presupuesto del TENANT primero (mismo orden que `checkTutorBudget`,
  -- `domain/budget.ts`): es el corte de plataforma, vinculante sin importar
  -- cuánto margen diario le quede a este alumno en particular.
  if v_tenant_tokens >= p_monthly_token_budget then
    return 'tenant_budget';
  end if;

  select messages into v_messages_today
    from public.tutor_usage_daily
    where tenant_id = p_tenant_id and user_id = p_user_id and day = p_day;

  if coalesce(v_messages_today, 0) >= p_daily_limit then
    return 'daily_limit';
  end if;

  -- Reserva: cuenta el mensaje YA, antes de que el caller invoque al LLM.
  perform public.tutor_upsert_usage_daily(p_tenant_id, p_user_id, p_day, 1, 0, 0);
  return null;
end;
$$;
revoke all on function public.tutor_try_reserve_message(uuid, uuid, date, int, bigint) from public;
-- SOLO `authenticated` (mismo criterio que `tutor_add_usage`): con el chequeo
-- de `auth.uid()` incondicional, un caller `service_role` (sin JWT de
-- usuario) siempre fallaría igual.
grant execute on function public.tutor_try_reserve_message(uuid, uuid, date, int, bigint) to authenticated;
