-- =============================================================================
-- Fix de seguridad (task 1.7): proteger token_encrypted a nivel de columna.
--
-- La migración original hacía `grant select on sence_otec_config` (tabla
-- completa) y luego `revoke select (token_encrypted)`. En PostgreSQL el revoke
-- de columna NO anula un grant de tabla: la columna seguía siendo legible por
-- PostgREST para el otec_admin (verificado por la suite de matriz de la 1.7).
-- El token va cifrado (I-6), pero exponer el ciphertext al cliente rompe la
-- defensa en profundidad y el diseño write-only del panel.
--
-- Fix: quitar el grant de tabla y otorgar SELECT solo en las columnas no
-- sensibles. El service_role conserva acceso total (descifra en el servidor).
-- =============================================================================

revoke select on public.sence_otec_config from authenticated;

grant select (tenant_id, rut_otec, default_environment, updated_at)
  on public.sence_otec_config to authenticated;
