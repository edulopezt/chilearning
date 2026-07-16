# Revisión OWASP Top 10 — Chilearning (task 3.6, RNF-2)

> Estado vivo del endurecimiento. Se actualiza en cada cambio de seguridad. La
> revisión adversarial 4-ojos por PR (DoD #9) es el mecanismo continuo; este doc
> es el resumen por categoría OWASP 2021.

| # | Categoría | Estado | Cómo se mitiga en Chilearning |
|---|---|---|---|
| A01 | Broken Access Control | ✔ fuerte | RLS `enable`+`force` en toda tabla de negocio, deny-by-default; `tenantGuard()` única puerta al service-role; los servicios que usan service-role re-chequean propiedad/rol en código (revisado en 3.2/3.4 por 4-ojos). |
| A02 | Cryptographic Failures | ✔ | Token SENCE cifrado AES-256-GCM en reposo; HTTPS en todo (Cloudflare); HSTS (3.6); certificados con token de verificación opaco de 128 bits. |
| A03 | Injection | ✔ | Zod en todo borde (requests, callbacks SENCE, imports); acceso a datos por supabase-js parametrizado; export CSV neutraliza fórmulas (CWE-1236); IDs interpolados en filtros PostgREST validados como UUID (3.4/3.6). |
| A04 | Insecure Design | ✔ | SDD spec-primero; módulo `sence` aislado; RPCs `security definer` con `search_path=''` y EXECUTE acotado a service_role. |
| A05 | Security Misconfiguration | ✔ (3.6) | Cabeceras de seguridad (HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy) + **CSP en Report-Only** (endurecer a enforcing tras verificación en navegador); `serverActions.allowedOrigins` acotado a subdominios de tenant. |
| A06 | Vulnerable Components | ✔ (3.6) | Dependabot semanal (npm + actions); deps "aburridas" (P5); ADRs de supply-chain (exceljs/pdf-lib). |
| A07 | Identification & Auth Failures | 🔶 | Auth por Supabase (JWT firmado, claims por Auth Hook); rate-limit nativo de Supabase en auth + `enable_signup=false` (D-011). **2FA TOTP** para superadmin/otec_admin: config habilitada, enforcement gated por `MFA_ENFORCEMENT` — **pendiente plan Supabase Pro** (handoff). |
| A08 | Software & Data Integrity | ✔ | `audit_log`/`sence_events` INSERT-only; snapshot de certificados inmutable en BD (trigger); CI verde obligatorio antes de `main`. |
| A09 | Logging & Monitoring | 🔶 | `audit_log` de acciones sensibles; observabilidad v1 = logs JSON de Coolify. **Sentry + healthcheck + Uptime Kuma = task 3.7** (con scrubber de PII/token). |
| A10 | SSRF | ✔ (bajo) | Sin fetch de URLs arbitrarias del usuario; callback SENCE valida `x-forwarded-host` contra el dominio raíz (fix #20). |

## Rate-limiting (3.6)
- Endpoints propios (route handlers Node): `/api/sence/{start,close}` con ventana
  fija en Redis, **fail-open** sin Redis, límite **por USUARIO** (10/min). NO por
  IP (una cohorte tras NAT compartido colapsaría en una IP — 4-ojos H1). El
  callback `/cb` NO se limita en la app (I-1 exige persistir siempre; anti-DoS en
  el edge/proxy).
- Auth (login): es client-side directo a Supabase → se cubre con los knobs
  nativos `[auth.rate_limit]` de Supabase (endurecer en prod, D-011).
- CSRF: Server Actions con `allowedOrigins`; route handlers propios con
  `assertSameOrigin` (el callback SENCE queda EXENTO, protegido por el nonce).

## Handoff pendiente (Edu)
- Plan Supabase **Pro** para activar MFA en el cloud → luego `MFA_ENFORCEMENT=enforce`.
- Endurecer la CSP a `Content-Security-Policy` (enforcing) tras verificar en
  navegador que no rompe video/Supabase/hidratación.
- Considerar `preload` de HSTS (compromiso de dominio; requiere decisión).
