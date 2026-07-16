-- =============================================================================
-- Fix de seguridad (revisión adversarial H4, hallazgo H4-R-002): ocultar
-- `callback_nonce` a nivel de columna.
--
-- `sence_sessions` tenía un `grant select` de TABLA COMPLETA a `authenticated`
-- (20260714192729:144); la columna `callback_nonce` se añadió después
-- (20260714220251:159) SIN revoke de columna. En PostgreSQL el revoke de columna
-- NO anula un grant de tabla (misma lección que `token_encrypted`, #22 /
-- 20260715074253), así que el nonce —el ÚNICO autenticador del callback público
-- (H-2, D-013)— era legible por cualquier cuenta de staff del tenant vía PostgREST.
-- Con el par (id_sesion_alumno, callback_nonce) de una víctima, un insider podía
-- POSTear a /api/sence/cb/{nonce} un callback forjado y ALTERAR la asistencia
-- SENCE (valor legal/tributario) de OTRO alumno. Anula la premisa de D-013.
--
-- Fix: quitar el grant de tabla y otorgar SELECT solo en las columnas no
-- sensibles (todas MENOS `callback_nonce`). El motor lee el nonce SIEMPRE vía
-- service-role (inmune a los grants de `authenticated`), tanto en `handleCallback`
-- como en `buildCloseForm`; ningún consumo client-facing selecciona la columna.
-- Las policies RLS (qué FILAS ve cada rol) no se tocan: esto solo acota COLUMNAS.
-- =============================================================================

revoke select on public.sence_sessions from authenticated;

grant select (
  id, tenant_id, enrollment_id, sence_course_code, action_code, training_line,
  run_alumno, id_sesion_alumno, id_sesion_sence, status, environment, opened_at,
  closed_at, zona_horaria, expires_at, error_codes, created_at, updated_at,
  error_origin
) on public.sence_sessions to authenticated;
