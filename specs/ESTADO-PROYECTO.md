# ESTADO-PROYECTO.md — Checklist Global de Chilearning

> **Qué es este documento:** el tablero vivo del proyecto. Sirve para retomar el trabajo
> desde cualquier sesión y en cualquier hito sin releer todo. Es **MUTABLE**: se actualiza
> sesión a sesión. Es el complemento operativo de `specs/03-tareas.md` (el backlog formal):
> aquí va el estado REAL, los PRs, los bloqueos, la deuda y el "cómo retomar".
>
> **Precedencia:** constitución > especificación > plan > tareas > este doc. Si algo aquí
> contradice un spec, gana el spec y este doc se corrige.

## Cómo mantener este documento (léelo antes de editar)

- **Cada sesión que cierre trabajo, actualiza:** (1) el "Snapshot actual" de abajo,
  (2) la marca de estado de las tareas tocadas (con su nº de PR), (3) "Bloqueos" y
  "Follow-ups" si cambiaron.
- **Leyenda de estado:** ✅ hecho y mergeado · 🔶 parcial · ⬜ pendiente ·
  🔒 bloqueado esperando a Edu · 🔁 follow-up (deuda conocida, no bloquea).
- **Regla:** una tarea solo es ✅ cuando pasó la Definición de Hecho (fondo de este doc) y
  su PR está mergeado con CI verde. Nunca marcar ✅ algo que no pasó su gate.
- **Cómo commitear cambios de este doc:** `main` está protegida → va por PR (puede ser el
  mismo PR de la tarea de esa sesión, o un PR de docs corto).

---

## 📸 Snapshot actual  ← ACTUALIZAR CADA SESIÓN

- **Fecha:** 2026-07-19
- **🎨 HITO 6 abierto (overhaul visual UX/UI), sesión autónoma end-to-end.** Con el código
  funcionalmente completo, Edu pidió mejorar la UI (hoy gris por defecto de shadcn, sin app
  shell, branding de tenant no aplicado a la app) e instalar la skill `ui-ux-pro-max` global
  para apoyar el diseño. Plan de 17 PRs aprobado (`feat/h6-6.0` a `feat/h6-6.16`), más los
  estándares transversales pedidos por Edu (4 estados de pantalla, loaders estratégicos,
  errores comprensibles, reglas de formulario) documentados en `docs/design/UX-STANDARDS.md`.
  Ver sección **HITO 6** más abajo para el detalle y cómo retomar si la sesión se corta.
- **Fecha (snapshot anterior):** 2026-07-18
- **🌙 HITO 5 completo de punta a punta en una sesión nocturna autónoma (2026-07-17/18), producido
  con Workflows (Implement → revisión adversarial en 3 lentes aislados → verificación escéptica
  independiente → fix → gates, por cada PR).** Las 13 tareas (5.1–5.13) están mergeadas a `main`
  (PRs #94, #95, #97/#98, #99, #100, #101, #102, #103, #104, #105, #106, #107, #108, #109, #110),
  cada migración aplicada y verificada en el Supabase cloud de producción, staging respondiendo
  después de cada merge, y el worker redesplegado una única vez al final (todas las tareas que lo
  tocaban ya mergeadas). **La "deuda de tablero" que había quedado anotada en sesiones anteriores
  (5.1–5.6, 5.10, 5.12, 5.13 mergeadas pero sin marcar) queda reconciliada en esta sesión** — ver el
  detalle honesto por tarea más abajo (§HITO 5). 10 tareas quedan ✅ contra su Definición de Hecho;
  3 quedan 🔶 parcial con el motivo explícito (5.1: spike con paquete Storyline real pendiente; 5.6:
  revisión de abogado pendiente; 5.11: verificación Meta + población del teléfono del alumno
  pendientes) — ninguna se marcó ✅ sin cumplir su DoD.
- **Bugs reales encontrados y corregidos por la revisión adversarial de esta sesión** (ninguno
  llegó a producción): condición de carrera (TOCTOU) en el límite de mensajes del Tutor IA que
  permitía romper el corte automático con requests concurrentes (5.8b, D-058); fuga de conexión en
  el lector del stream de OpenRouter, 100% de las respuestas exitosas (5.8b); fuga de PII + sobre-
  redacción en el regex de RUN/teléfono de los borradores de IA (5.9); asimetría real de opt-out
  entre canales email/WhatsApp (5.11); certificado del tenant demo con snapshot inventado que
  contradecía su propia asistencia sembrada (5.7); vigencia de certificado perdida al clonar un
  curso (5.12); UUID del tenant demo colisionando con un test de integración preexistente (5.7).
- **Gap de proceso detectado y cerrado en esta MISMA sesión:** ninguna de las tareas 5.1–5.8/5.10/
  5.12/5.13 había registrado sus decisiones de diseño en `specs/DECISIONES.md` (solo 5.9 y 5.11 lo
  hicieron, dentro de sus propios Workflows) — se agregaron 15 entradas nuevas (D-050 a D-064) en
  el cierre documental, más el amendment a ADR-007 (retrieval híbrido, `specs/02-plan-tecnico.md §12`).
- **🅿️ HITO 4 PARQUEADO (decisión de Edu, 2026-07-17): todo lo ejecutable está CERRADO; el piloto
  (4.2/4.5) espera mundo real** — curso de Seminarea codificado en SENCE + grupo de alumnos. El Hito 5
  parte en una sesión nueva. Sesión de cierre (2026-07-17, PRs #88–#93):
  - ✅ Gates del checklist **verificados con evidencia** (#92): CI verde, Kuma 3/3 re-apuntado a
    seminarea + monitor #3 del callback (POST, 303, creados por Edu), worker tickeando, migración del
    nonce en cloud, backup+restore §8.3, test RLS `H4-R-002`. **Hueco cazado y resuelto:** `SENTRY_DSN`
    de la app estaba marcada build-time en Coolify → el server-side no reportaba; fix = desmarcar +
    redeploy (verificado en runtime).
  - ✅ **Q-03 rate-limit del callback APLICADO+VERIFICADO+VERSIONADO** (#91): archivo dinámico de
    Traefik (la UI de Coolify 4.1.2 no expone labels); ráfaga → 429, resto de la app intacto.
  - ✅ **Config SENCE real de Edu:** token real del OTEC cargado (cifrado, verificado en BD sin leerlo)
    + ambiente `rce`. Bug aparente "se revierte a rcetest" era solo refresco de UI (la BD quedó bien).
  - ✅ **Grupos operativos de planilla (#93, HU-2.2):** columna `grupo` en el import CSV
    (`Sence-<código del curso>` validado contra la acción destino / `Becario` → exento I-14), etiqueta
    en import + cumplimiento + certificados + portal del alumno; plantilla CSV generada POR ACCIÓN con
    el código real. 4-ojos multi-agente (14 agentes): 8 CONFIRMED corregidos, 2 REFUTED con evidencia.
  - **Decisión (2026-07-17):** NO se generan datos falsos ni pruebas forzadas contra SENCE; la
    validación real ocurre en el primer curso del piloto (rcetest sigue bloqueado del lado de SENCE).
  - **Regla de re-entrada al piloto:** re-verificar los gates del checklist (~30 min) antes de activar;
    si algo del Hito 5 toca `src/modules/sence/`, re-pasa 4-ojos y el checklist se re-firma.
  - **Pendientes menores (no bloquean):** probar en vivo la alerta de correo de Kuma; evento de prueba
    en Sentry; 2FA (requiere Supabase Pro).
- **📋 SESIÓN HITO 4 — parte ejecutable por el agente (2026-07-16):** se avanzó lo que NO depende de
  producción SENCE ni de la ventana de Edu. **PRs mergeados #78–#82 (CI verde en los 4 jobs):**
  - ✅ **4.1b — revisión adversarial COMPLETA de `src/modules/sence/`** (#80, D-047): panel multi-agente
    (26 agentes: 6 lentes → consolidación → refutación). **19 hallazgos** (16 CONFIRMED, 2 PLAUSIBLE,
    1 REFUTED) + 10 rulings para Edu. Informe: `docs/sence/REVISION-ADVERSARIAL-H4.md`.
  - ✅ **Fixes CONFIRMED seguros** (#81, 4-ojos por agente fresco = APROBADO): cazó y corrigió **1 HIGH
    de seguridad real** — `callback_nonce` legible por staff del tenant (grant de tabla sin revoke de
    columna, mismo patrón que #22) → falsificación de callbacks ajenos — + 5 MED (nombres de campo con
    espacio → callback perdido; clave rota → callback perdido; error de correlación silencioso;
    `resolvePublicOrigin` no fail-closed; 500 crudo al alumno en doble start). **Migración del nonce
    APLICADA y VERIFICADA en el cloud** (0 grants a `callback_nonce`, 19 columnas no sensibles OK).
  - ✅ **4.1a — checklist pre-producción** (#82): `docs/sence/CHECKLIST-PREPRODUCCION.md` (gate go/no-go
    que Edu firma antes de 4.2).
  - ✅ **4.3 — runbooks del piloto** (#78): `docs/ops/{PLAN-B-CONTINGENCIA,RUNBOOK-MONITOREO-PILOTO,
    RUNBOOK-ROTACION-SECRETOS}.md` (cierra RNF-8).
  - ✅ **Back-fill del ledger** (#79): `specs/DECISIONES.md` D-026..D-046 formalizadas (el Hito 3 no las
    había volcado); D-047 = la revisión H4.
  - ✅ **4.4 — ensayo de restauración #2 (§8.3) HECHO:** end-to-end REAL con la clave `age` de Edu —
    backup cifrado de R2 → SHA-256 verificado → descifrado `age` → restore en BD limpia → integridad OK
    (tenants 2, memberships 14, sence_events 3, auth.users 15; 40 tablas RLS; triggers INSERT-only) en
    **~49 s** (RTO ≪ 4 h). 2 errores benignos en internals de Supabase. **§8.3 CUMPLIDO.** Hallazgos
    documentados en `docs/RESTORE.md` (el dump usa `--no-privileges` → re-aplicar grants vía migraciones
    en un restore real; restaurar en un proyecto Supabase nuevo). La clave `age` privada está en
    `age-key.txt` de Edu y **descifra el backup — verificado**.
  - **Rulings de Edu ✅ RESUELTOS + IMPLEMENTADOS (2026-07-16, D-048):** los 10 decididos; los 5 de
    código/contrato ya en `main` con contrato enmendado (§Enmiendas E-1..E-6, cada uno con 4-ojos):
    **PR #85** (parte I, máquina de estados: Q-01 cierre tardío = cierra en vez de falso `expirada`,
    Q-05 T8 alcanzable) + **PR #86** (parte II, robustez/UX: Q-04 re-emitir la pendiente + timeout
    15 min, Q-07 mensaje accionable al alumno, Q-02 contador M-4). **Q-03** (rate-limit del callback) =
    ✅ APLICADO en staging vía archivo dinámico de Traefik (`ops/traefik/sence-cb-ratelimit.yaml`).
    Q-06/08/09/10 = doc/sin cambio. **H4-R-010/012 (mensaje es-CL al alumno) = ✅ HECHO (#88).**
- **D-046 (Edu): el tenant demo pasa a ser `seminarea`** (cliente real, staging en
  `seminarea.chilearning.cl`). Mismo UUID; solo slug/nombre/correos semilla (`admin@seminarea.test`, …).
  Los datos del seed siguen siendo FICTICIOS (regla: nunca datos reales en fixtures); el RUT del tenant
  es placeholder hasta que Edu cargue el real por la app. `otec-pacifico` queda como tenant B de pruebas.
  **Corte de infra ✅ EJECUTADO (2026-07-16):** SQL cloud (slug/name + 7 correos auth) ✅ ·
  Coolify fqdn con AMBOS dominios (transición) + `APP_BASE_URL` ✅ · Auth `site_url` ✅ ·
  `STAGING-CREDENTIALS.txt` refrescado ✅ · verificado: seminarea.chilearning.cl 200 + login real
  `admin@seminarea.test` con claims correctos. **Pendiente Edu:** re-apuntar los monitores de Kuma
  y decidir cuándo retirar el dominio viejo.
- **HANDOFF INFRA ✅ (2026-07-16):** Resend + Sentry deployados en app/worker; backup off-site cifrado
  FUNCIONANDO (primer dump real en R2, cron diario); Uptime Kuma monitoreando con alertas. Fixes reales
  del despliegue: #70, #72, #73, #74, #75. Detalle en `STAGING-CREDENTIALS.txt` (local).
- **📋 REPORTE DEL TURNO NOCTURNO AUTÓNOMO (2026-07-16) — HITO 3 COMPLETO (12/12) ✅:** se avanzó el
  **Hito 3 de 0/12 a 12/12 tareas mergeadas** (#45, #46, #47, #48, #57, #58, #59, #60, #62, #64, #66, #68),
  cada una con revisión adversarial 4-ojos antes del merge (la de 3.11 fue **multi-agente**: 4 lentes +
  verificación) que cazó y corrigió **7 HIGH + 3 MED reales**. CI verde en cada PR (incluye el nuevo job
  **`e2e`**); migraciones aditivas aplicadas al cloud; staging vivo (200). **Gate del hito verde:** los 3
  flujos E2E (encuesta, subrutas anti-#41, verificación pública con RUN enmascarado) corren desktop+móvil.
  **Handoff a Edu** (nada bloquea el desarrollo; se necesita para producción-real): `RESEND_API_KEY`+dominio ·
  cuenta R2+clave `age` · Sentry DSN · Uptime Kuma · **Supabase Pro** (2FA enforcement) · confirmar §7-R7 del
  certificado + firma real · endurecer CSP a enforcing · iniciar trámite Meta · **n8n en Coolify** +
  `N8N_WEBHOOK_URL`/`SECRET` (`docs/n8n/WORKFLOWS.md`) · `APP_BASE_URL` para los correos del worker.
  (Nota: Resend, R2+age, Sentry, Kuma y APP_BASE_URL quedaron HECHOS ese mismo día — ver HANDOFF INFRA ✅.)
- **Hitos cerrados:** Hito 0 ✅ · Hito 1 ✅ (10/10) · Hito 2 ✅ (9/9) · **Hito 3 ✅ (12/12)**
- **Hito 2 CERRADO** — las 9 tareas mergeadas (#31–#41), cada una con revisión adversarial
  4-ojos aplicada; migraciones M1–M4 + bucket `submissions` en el cloud; worker VIVO en staging.
  ✅ 2.6 worker (#31) · ✅ correo Resend (#32) · ✅ 2.7 pre-flight (#33) · ✅ 2.4 panel+export
  (#34/#35) · ✅ 2.5 supervisor (#36) · ✅ 2.1 quizzes (#37/#38) · ✅ **2.2 tareas** (#39, D-023:
  3 HIGH máquina de notas + audit atómico) · ✅ **2.3 libro de notas / GATE** (#40, D-024:
  paginación + anti-inyección CSV) · ✅ **2.8 clonado** (#41, D-025: RPC `clone_course` + estado
  draft/active + re-ejecución; HIGH corregido: activación por UI).
  Pendientes que NO bloquean el hito: `RESEND_API_KEY` para correo real (necesita a Edu); cert
  rcetest **parqueada** (bloqueo de SENCE — su rcetest usa Clave SENCE deprecada; Edu decidió no
  escalar → validación al primer curso real; ver §Bloqueos). Staging tuvo un 500 por conflicto de
  rutas del #41, corregido en el hotfix **#43**. (Corrección: el CI **sí** corre `next build` desde
  0.1 (`ci.yml:28`); el hueco real es que un conflicto de slug de rutas es error de RUNTIME que
  `next build` no caza — lo cubre el E2E de 3.8.)
- **Hito 3 ✅ CERRADO** (turno autónomo 2026-07-16, plan aprobado, alcance A/B/C): ✅ **3.1 encuesta**
  (#45, HU-6.3) — anonimato ESTRUCTURAL; 4-ojos corrigió HIGH (join por `submitted_at`) + supresión
  <3. ✅ **3.2 certificados PDF** (#46, HU-7.1/7.2) — folio + QR + verificación pública (RUN
  enmascarado, RPC anon), snapshot congelado inmutable, revocación; 4-ojos corrigió HIGH (descarga
  del PDF sin chequeo de dueño → fuga de RUN) + MED (revocado descargable, supervisor con RUN vía
  RLS). **pdf-lib/qrcode = ADR-009.**
  ✅ **3.4 comunicación nativa** (#47, M9) — anuncios/foro/mensajería(exigible SENCE)/calendario, 6
  tablas + RLS (alumno solo sus mensajes, supervisor sin mensajería), SLA visible, notificaciones
  in-app + correo best-effort; 4-ojos sin HIGH/MED (L1 doble-notificación + L3 gate corregidos).
  🔶 **3.6 hardening** (#48, Plan §9) — cabeceras (CSP report-only + HSTS/nosniff/frame/referrer/
  permissions enforcing), rate-limit por-usuario en `/api/sence/{start,close}` (fail-open) + CSRF,
  Dependabot + OWASP doc, 2FA config+policy; 4-ojos cazó HIGH (rate-limit por IP tumbaba cohortes tras
  NAT + violaba I-1 en el callback → corregido a por-usuario, cb sin límite). **2FA enforcement/UI y
  CSP-enforcing PARQUEADOS** (Supabase Pro + verificación en navegador).
  🔶 **3.7 observabilidad** (#57) — /api/health + scrubber PII/token de Sentry (4-ojos F1) + backup
  pipeline + ensayo #3; SDK Sentry/R2 parqueados. ✅ **3.10 Meta checklist** (#58, docs). ✅ **3.5
  Ley 21.719** (#59) — consentimiento + export + supresión que conserva SENCE y redacta perfil/foro/
  mensajes (4-ojos cazó HIGH de supresión falsa → corregido). (Detalle por tarea en la tabla del Hito 3.)
  ✅ **3.12 expediente de fiscalización** (#60, HU-5.10) — documentos por acción con checklist,
  definitivos INMUTABLES (trigger), ZIP en un clic; staff-only admin/coordinador (montos comerciales);
  jszip. 4-ojos (MED de actionId sin validar corregido + restringido a admin/coord).
  ✅ **3.3 checklist DJ/GCA** (#62, HU-5.6) — `dj_checklist` + enum `dj_state` con transiciones legales
  puras, liquidación `ends_on+60d`, `ensureChecklist` idempotente (excluye exentos), **RPC atómico
  `dj_set_state`** (estado+audit en 1 transacción, TOCTOU cerrado con `p_from` bajo lock), nómina xlsx/csv;
  staff-only (sin supervisor — DJ es cumplimiento SENCE interno). 4-ojos SHIP: F1 MED (audit no atómico)
  → RPC, F2/F4 (gate muerto, actionId sin validar) corregidos. Recordatorios n8n = follow-up en 3.9.
  ✅ **3.11 portal supervisor COMPLETO** (#64, HU-12.1/12.2) — `supervisor_grants`+`grant_actions`, helpers
  `SECURITY DEFINER` de vigencia/alcance, **endurece 6 policies vivas** (el fiscalizador solo ve con grant
  activo Y en alcance; tablas SENCE mantienen su contrato, solo se acota el SELECT), backfill de existentes;
  portal GATED que **audita cada consulta** (`cumplimiento-service` pasó a staff-only + builders `*Unchecked`);
  invitación con link copiable (degrada sin RESEND). **Revisión 4-ojos MULTI-AGENTE** (4 lentes + verificación
  adversarial): 1 MED confirmado (`alerts` sin escopar por acción → escopado con `supervisor_has_tenant_grant`),
  el resto refutado. Migración aplicada al cloud (backfill de 2 supervisores).
  ✅ **3.9 automatizaciones n8n** (#66, HU-5.9) — worker `reminders-tick`; **RNF-10 por construcción**
  (a n8n solo agregado seudonimizado por HMAC; el correo PII lo manda el worker por EmailSender), opt-out
  del alumno + config por acción, dedup diario. 4-ojos SHIP (MED de link relativo corregido). Categoría B:
  no-op sin n8n (handoff `docs/n8n/WORKFLOWS.md`).
  ✅ **3.8 E2E Playwright** (#68, Plan §11) — harness real (app + Supabase local + login por UI con Auth
  Hook + tenant por subdominio vía `localtest.me`), desktop + móvil. **3 flujos verdes en CI** (encuesta;
  subrutas de acción = **guardia anti-#41**; verificación pública con RUN enmascarado) + smoke por rol sin
  scroll horizontal a 360px. Nuevo job `e2e` en CI. **Cierra el gate del Hito 3.**
- **Hito 3: 12/12 mergeadas. Pendientes: NINGUNO** (los items B/C tienen handoff documentado).
- **PRs mergeados a `main`:** 73 (incl. #78–#86: revisión H4, fixes, runbooks, rulings) · **Tests:** ~1015 verdes (unit + RLS + integración + E2E 3 flujos)
- **Staging:** VIVO en https://seminarea.chilearning.cl (D-046 ejecutado; el dominio viejo
  otec-andes.chilearning.cl sigue respondiendo en transición) (login demo en `STAGING-CREDENTIALS.txt`)
- **Deploy:** auto-deploy GitHub→Coolify activo (merge a `main` despliega solo)
- **Último gran hito humano pendiente:** certificación `rcetest` (con Edu presente, P3)

---

## 🚀 Cómo retomar en una sesión nueva (bootstrap)

1. **Herramientas:** Node ≥24, `pnpm`, Docker Desktop **encendido**, Supabase CLI, `gh` (auth `edulopezt`).
2. **Local:** `pnpm install` → `supabase start` → `supabase db reset` (migra + siembra 2 OTECs × 8 roles + curso demo).
3. **App local:** `pnpm dev` → http://localhost:3000. Login: `admin@seminarea.test` / `Password123!`.
4. **Verde antes de tocar nada:** `pnpm lint && pnpm typecheck && pnpm test:unit`; con Supabase arriba `pnpm test:rls && pnpm test:integration`.
5. **Ciclo por tarea:** rama `feat/h<hito>-<tarea>-<desc>` → dominio+tests → servicio (tenantGuard) → UI (verificar 360/1440px) → PR con CI verde → merge → **si hubo migración, aplicarla al cloud** (ver más abajo).
6. **Memoria persistente** (contexto rápido): `MEMORY.md` en el dir de memoria del proyecto (índice), con `estado-hito-0`, `estado-hito-1`, `staging-deploy`, etc.

> ⚠ **Rate-limit del auth local:** muchos logins de runtime seguidos degradan el GoTrue local
> y los tests de login real fallan con error `{}`. Solución: `supabase stop && supabase start`.

---

## 🔑 Infraestructura y accesos (estado)

| Recurso | Estado | Notas |
|---|---|---|
| Repo GitHub | `edulopezt/chilearning` **público**, `main` protegida (ruleset: PR + checks `checks`/`rls`/`integration`) | Claude mergea con CI verde |
| Staging (VPS) | `clawbot` = **216.185.51.57** (hostname `seminarea`). Coolify 4.1.2, Traefik en 80/443, app `chilearning-staging` (uuid `jrhorroii4zlcjdkafdv0l75`) | El VPS antes tenía el Moodle de Seminarea (borrado con backup en `Desktop/backup-seminarea-2026-07-14`) |
| Backend cloud | Supabase **`lms-edulopezt`** (ref `nnrlvprndsxcnyljccso`), ACTIVE_HEALTHY | Migraciones + seeds + Auth Hook aplicados |
| DNS | Cloudflare: `chilearning.cl` + `*.chilearning.cl` → VPS, **DNS-only (gris)** | Reactivar proxy naranja + SSL "Full" es opcional |
| Tokens en `.env.local` (gitignored) | `CLOUDFLARE_API_TOKEN` (filtro IP = VPS), `COOLIFY_API_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `SENCE_TOKEN_ENCRYPTION_KEY`, `STAGING_DEMO_PASSWORD`, `STAGING_SENCE_KEY` | Nunca pegarlos en el chat |
| Credenciales demo staging | `STAGING-CREDENTIALS.txt` (gitignored) | Todos los usuarios demo comparten esa clave |

**Trampas de infra ya resueltas (no repetir):** la API de Supabase y Cloudflare están tras
Cloudflare-bot-shield → curl/urllib necesitan `User-Agent` de navegador (si no, error 1010).
El token Sanctum de Coolify lleva `|` → al pasarlo por SSH, base64-encodear los valores.
Coolify env: el flag build-time es `is_buildtime` (sin guion bajo) y crea una copia `preview`
automática (los "duplicados" son normales). Las `NEXT_PUBLIC_*` van como build args en el Dockerfile.

### Cómo aplicar una migración nueva al Supabase cloud (tras mergear)
La tabla `supabase_migrations` NO existe en el cloud (se aplicó por API), así que **NO** uses
`supabase db push`. Aplica el SQL por la Management API con `User-Agent`:
```
POST https://api.supabase.com/v1/projects/nnrlvprndsxcnyljccso/database/query
Authorization: Bearer <SUPABASE_ACCESS_TOKEN>   ·   {"query": "<contenido del .sql>"}
```
Ojo: `ALTER TYPE ... ADD VALUE` debe ir en sentencia separada (no en transacción con su uso).

---

## 🔒 Bloqueos activos — necesitan a Edu

- ⏸️ **Certificación rcetest (0.9): PARQUEADA (2026-07-15).** Se intentó end-to-end con token +
  RUN reales de Edu; falló porque **el `rcetest` de SENCE todavía usa el login viejo de Clave
  SENCE** (error 210), que ellos **deprecaron e inactivaron** (recuperación fuera de servicio;
  Clave Única obligatoria desde 08/2019). Es un **bloqueo del lado de SENCE**, no del código:
  nuestra integración quedó **probada correcta** (SENCE aceptó la petición y el motor manejó el
  callback; un error de parámetros habría sido 200–209 *antes* del login). Edu **decidió no
  contactar a SENCE** ni forzar producción. **Validación diferida al primer curso real en
  producción** (Clave Única sobre `rce`). Detalle: memoria `rcetest-clave-sence-bloqueo` + el
  aviso al inicio del runbook. Riesgo a vigilar: si SENCE gatilla producción tras rcetest, habrá
  que reevaluar.
- 🔒 **Correo a `controlelearning@sence.cl` (0.10):** borrador en `docs/sence/BORRADOR-CORREO-SENCE.md`.
  Edu lo envía (pregunta obligatoriedad API LMS-SIC línea 3 + fuente normativa de la regla 3h/60min).
- 🔒 **Resend (decidido 2026-07-15, para 1.6/2.2/2.6/2.7):** Edu debe crear la cuenta en
  resend.com, verificar el dominio chilearning.cl (registros DNS en Cloudflare) y pasar
  `RESEND_API_KEY` por `.env.local` + Coolify. El código degrada a no-op/outbox mientras tanto.
- 🔒 **Dominio de producción / decisiones de marca (Hito 5):** cuesta plata → decisión de Edu.
- 🔒 **OpenRouter (Hito 5, Tutor IA):** crear cuenta, activar **ZDR account-wide** (Settings →
  Privacy — el código no puede verificarlo desde runtime, D-054), generar `OPENROUTER_API_KEY` y
  cargarla en `.env.local` + Coolify (app Y worker) → activa el chat del tutor y los embeddings.
  Revisar el modelo default (`anthropic/claude-haiku-latest`, económico, investigado en vivo) y el
  tope mensual por tenant (`AI_MONTHLY_TOKEN_BUDGET_DEFAULT`).
- 🔒 **Spike SCORM con paquete Storyline real (5.1):** el motor y el reproductor están listos y
  probados contra un fixture sintético; falta que Edu suba un paquete SCORM real (Storyline u otra
  herramienta de autor) y verifique manualmente que reproduce/reporta progreso correctamente.
- 🔒 **Revisión de abogado (5.6):** `/privacidad` (banner "BORRADOR") y
  `docs/legal/CONTRATO-ENCARGO-BORRADOR.md` necesitan revisión legal antes de considerarse vigentes
  — incluye el riesgo de transferencia internacional São Paulo (S2) aún sin resolver.
- 🔒 **Verificación Meta Business + población del teléfono del alumno (5.11):** el canal WhatsApp
  está cableado y probado en modo degradado; falta (a) que Edu complete el trámite de
  `docs/whatsapp/META-BUSINESS-VERIFICATION.md` y las plantillas `_v1` de
  `whatsapp-templates.ts` sean aprobadas por Meta, y (b) decidir cómo llega el teléfono del alumno
  al sistema (hoy ningún flujo escribe `user_metadata.phone` — plan concreto en
  `docs/whatsapp/ACTIVATION.md`).

---

## HITO 0 — Fundación y motor SENCE ✅ (contra mock)

| # | Tarea | Estado | PR |
|---|---|---|---|
| 0.1 | Esqueleto Next.js + estructura modular + CI | ✅ | #1 |
| 0.2 | Migración inicial `tenants`/`memberships`/`audit_log` + RLS + seeds | ✅ | #3 |
| 0.3 | Coolify + deploy staging + SSL | ✅ | #17 |
| 0.4 | Auth Supabase + Auth Hook (claims tenant/roles) + middleware subdominio + RBAC | ✅ | #7 |
| 0.5 | Congelar contrato SENCE contra manual **v1.1.6** (diff en `docs/sence/`) | ✅ | #2 |
| 0.6 | Mock RCE local (puerto 4010, tabla de errores 200–313) | ✅ | #5 |
| 0.7 | Motor SENCE (dominio, cifrado AES token, rutas `/api/sence/*`, estados) | ✅ | #8 (+ fix callback #20) |
| 0.8 | Curso demo con candado SENCE + contador 3 h | ✅ | #9 |
| 0.9 | **Certificación rcetest con token real** | 🔒 preparada | runbook #19 |
| 0.10 | Correo a SENCE + `RESTORE.md` ensayado | 🔶 restore ✅ (#6,#10), correo 🔒 | #6 |

---

## HITO 1 — Gestión académica y contenido ✅ (10/10)

| # | Tarea | Estado | PR | Ruta principal |
|---|---|---|---|---|
| 1.1 | CRUD cursos (modalidad, horas, reglas completitud, borrador/publicado) | ✅ | #14 | `/admin/cursos` |
| 1.2 | Panel SENCE (token cifrado write-only) + CRUD acciones (comodín -1 solo rcetest) | ✅ | #12,#21 | `/admin/sence`, `/admin/acciones` |
| 1.3 | Inscripciones + import CSV (RUN/DV fila a fila, exentos, idempotente) | ✅ | #13 | `/admin/inscripciones` |
| 1.4 | Constructor de lecciones (texto/video/archivo/embed, reordenar, borrador/publicado) | ✅ | #25 | `/admin/cursos/[id]/lecciones` |
| 1.5 | Progreso del alumno + "retomar donde quedé" | ✅ | #26 | `/mi-curso` |
| 1.6 | Correos transaccionales (invitación + bienvenida con guía Clave Única) | ✅ | #28 | `/admin/correos` (preview) |
| 1.7 | Matriz completa 8 roles + tests (cazó fuga de token_encrypted) | ✅ | #22 | suite RLS |
| 1.8 | Tablero relator con avance + semáforo | ✅ | #27 | `/tablero` |
| 1.9 | Magic links de acceso para alumnos | ✅ | #23 | `/login`, `/auth/callback` |
| 1.10 | Editor de marca (colores + contraste WCAG en vivo + preview) | ✅ | #24 | `/admin/marca` |

**Follow-ups del Hito 1 (🔁, no bloquean):** subida de logos a Storage (1.10) · asignación
relator↔curso para acotar "sus cursos" (1.8) · envío real de correos (1.6, falta proveedor) ·
edición inline de contenido de lección desde la UI (1.4, hoy: crear/reordenar/publicar/borrar).

---

## HITO 2 — Evaluación y panel SENCE ✅ (9/9 mergeadas, #31–#41)

- ✅ **2.1** Quizzes autocorregidos: 3 tipos (opción múltiple, V/F, pareados), intentos, banco
  de preguntas, escala 1.0–7.0 — HU-6.1 — **#37 (esquema/dominio/servicios) + #38 (UI + intento
  del alumno)**. `quizzes`/`questions`/`quiz_attempts`/`grades`; pauta (`answer_key`) sin grant a
  authenticated; finalización perezosa del intento vencido (D-022 S1–S7).
- ✅ **2.2** Tareas con entrega y corrección (relator/tutor) — HU-6.2 — **#39**.
  `assignments`/`submissions` (INSERT-only) + bucket privado `submissions` + `notifications`.
  Revisión adversarial 4-ojos aplicada (D-023): nota publicada blindada (no se revierte a
  borrador ni se re-publica sin motivo — trigger `grades_no_unpublish` + guardias de servicio),
  cambio de nota + auditoría ATÓMICOS vía RPC `write_assignment_grade`, cola paginada, sin
  huérfanos en Storage.
- ✅ **2.3** Libro de notas por acción + **auditoría de cambios de nota** — HU-6.4 — **#40 (el
  GATE del hito)**: consolida quizzes+tareas por inscripción con promedio ponderado parcial + fila
  "incompleta" (D-022 S10); export CSV; historial de cambios de nota (`grade.updated`) para el
  admin. Revisión 4-ojos (D-024): desempate de paginación + anti-inyección de fórmulas CSV.
- ✅ **2.4** Panel de cumplimiento SENCE + **export Excel** (columnas del plugin verbatim +
  `ID SESION SENCE`) — HU-5.5 — **#34 (nombres/apellidos snapshot en enrollments) + #35 (panel
  + export xlsx con exceljs, D-021)**.
- ✅ **2.5** Portal Supervisor v1: rol de **solo lectura** para fiscalizador SENCE — HU-5.5, M12
  — **#36**: `/supervisor` reusa el compliance-panel; suites de NO-escritura (RLS + servicios).
- ✅ **2.6** **Cron/worker**: expiración 3 h, inactividad 60 min, alertas de tasa de error —
  Plan §5.6 — **#31** (revisión adversarial R-1..R-6): worker BullMQ+Redis dispara T4/T6/T9
  (cierra el brick del índice único parcial), tabla `alerts` + tasa de error por tenant×ambiente
  (D-015/016/017/017b). Migración `alerts` en cloud ✔ · Redis `chilearning-redis` en Coolify ✔
  · ⚠ falta desplegar la app `chilearning-worker` en Coolify (target Docker `worker`). Dev
  local: `docker run -d --name chilearning-redis-dev -p 6379:6379 redis:7-alpine` + `pnpm worker`.
- ✅ **2.7** Pre-flight de acción SENCE — HU-5.8 — **#33**: checklist masivo de 8 ítems
  (`/admin/acciones/[id]/preflight`) reusando los validadores congelados de `preflight.ts`
  (RUN/DV de todo el roster, token descifrable, códigos, ambiente, fechas), envío REAL de la
  guía Clave Única (comunicacion → audit) con marca manual de respaldo, y alerta día-1 en el
  tick del worker (D-020: umbral 50%, corte 13:00 Chile, cooldown 24 h).
- ✅ **2.8** Clonado de cursos y re-ejecución de acciones (exige fechas y código nuevos) — HU-3.6
  — **#41**: RPC transaccional `clone_course` (copia curso+lecciones+quizzes(+preguntas)+tareas a
  borrador, NUNCA runtime), estado `action_status` draft/active + CHECK, `reexecuteAction` +
  activación por UI (`/admin/acciones/[id]/activar`). Revisión 4-ojos (D-025): HIGH corregido
  (la re-ejecución era inactivable por la UI) + MED (clone copiaba mal `description`).

**Gate del Hito 2 — ✅ verificado por tests (812 verdes) + CI + revisión 4-ojos por PR:**
libro de notas con auditoría (`grade.updated` con motivo, atómico) ✔ · export Excel/CSV del panel
SENCE ✔ · pre-flight detecta RUN inválidos plantados ✔ · clonado a borrador sin runtime + activación
exige fechas/código nuevos ✔ · portal supervisor v1 solo-lectura (suites de no-escritura) ✔.
Falta solo verificación humana en staging del **correo real** (needs `RESEND_API_KEY` de Edu).

---

## HITO 3 — Cierre del ciclo + endurecimiento ⬜

- ✅ **3.1** Encuesta de satisfacción (requisito de completitud, agregados) — HU-6.3 — **#45**:
  anonimato ESTRUCTURAL (`surveys` + `survey_submissions` ledger + `survey_responses` con
  `enrollment_id` NULL en anónima) + RPC atómico `submit_survey`; `hasCompletedSurvey` alimenta el
  gate de 3.2. Revisión 4-ojos (HIGH: eliminado `submitted_at` que permitía re-identificar por join;
  MEDIUM: supresión de muestra anónima <3).
- ✅ **3.2** **Certificados PDF** con plantilla SENCE (folio, QR, verificación pública, revocación,
  umbral de asistencia) — HU-7.1/7.2 — **#46**: `certificates` (ledger) + `certificate_counters`
  (folio atómico) + `min_attendance_pct_override`; snapshot §7-R7 CONGELADO (inmutable en BD); RPCs
  `issue`/`revoke`/`verify_certificate` (público anon, RUN enmascarado); pdf-lib+qrcode (ADR-009);
  elegibilidad reusa gradebook+cumplimiento+encuesta. Revisión 4-ojos (HIGH descarga sin dueño +
  MED revocado/supervisor). **Handoff Edu:** confirmar §7-R7 + firma real + umbral por defecto.
- ✅ **3.3** Checklist DJ/GCA: máquina de estados + liquidación 60d + nómina exportable — HU-5.6 (#62). RPC atómico estado+audit; staff-only. Recordatorios n8n = 3.9.
- ✅ **3.4** Anuncios + foro + mensajería + calendario (mínimos SENCE) — M9 — **#47**: canal oficial
  100% nativo; mensajería asincrónica alumno↔staff (exigible SENCE, HU-9.3); 6 tablas + RLS
  (privacidad del alumno, supervisor sin mensajería), SLA de respuesta visible, notificaciones in-app
  + correo best-effort (no-op sin RESEND). Revisión 4-ojos (sin HIGH/MED). Follow-up: fan-out por
  BullMQ a volumen.
- ✅ **3.5** Derechos Ley 21.719 en UI (export/supresión con retenciones) + consentimiento — HU-2.4,
  RNF-3 — **#59**: `consents` (INSERT-only) + `dsr_requests`; consentimiento al primer ingreso (gate),
  export JSON del titular, supresión que CONSERVA SENCE/cert/audit y REDACTA perfil/correo/foro/
  mensajes; catálogo de retención/tratamientos (flag legal). 4-ojos (HIGH de supresión falsa corregido).
  🔒 **Handoff:** revisión legal de períodos/textos + contrato de encargo (abogado, Hito 5).
- 🔶 **3.6** Hardening: rate limits, headers, 2FA obligatorio admins, revisión OWASP — Plan §9 —
  **#48**: cabeceras enforcing + CSP report-only, rate-limit por-usuario en rutas SENCE (fail-open) +
  CSRF, Dependabot + `docs/security/OWASP-REVIEW.md`, 2FA config habilitada + `mfa-policy` (P7). 4-ojos
  (HIGH de rate-limit por IP corregido). 🔒 **Falta (handoff Edu):** Supabase Pro para 2FA enforcement
  + UI de enrolamiento; endurecer CSP a enforcing tras verificar navegador.
  🔶 **3.7 observabilidad** (#57, Plan §8/10) — `/api/health` + HEALTHCHECK; scrubber de PII/token de
  Sentry (puro, testeado; 4-ojos F1: cazó fuga del token descifrado en var de stack → predicado por
  clave + `includeLocalVariables:false` mandado en doc); pipeline `ops/backup/` (pg_dump→age→R2) +
  ensayo restauración #3 real; docs Uptime Kuma/Sentry. 🔒 **Falta (handoff):** SDK Sentry+DSN, cuenta
  R2+clave age, Uptime Kuma self-host.
  ✅ **3.10 Meta/WhatsApp** (#58, M9) — checklist de verificación Meta Business producido
  (`docs/whatsapp/META-BUSINESS-VERIFICATION.md`); es trámite externo (handoff a Edu), el canal opera
  en Hito 5. **Hito 3 COMPLETO (12/12)** — no quedan tareas pendientes.
- 🔶 **3.7** Backups off-site + **ensayo de restauración 1** + Uptime Kuma + Sentry — Plan §8/§10 —
  **#57**: `/api/health` + HEALTHCHECK, scrubber de PII/token de Sentry (puro+testeado; 4-ojos F1–F4),
  `ops/backup/` (pg_dump→age→R2) + ensayo restauración #3 real, docs Uptime Kuma/Sentry. 🔒 **Handoff:**
  SDK Sentry+DSN (con `includeLocalVariables:false`+scrubber), cuenta R2+clave age, Uptime Kuma.
- ✅ **3.8** E2E Playwright de los 3 flujos críticos — Plan §11 (#68). Harness real (login por UI, tenant por subdominio, desktop+móvil); 3 flujos verdes en CI + smoke; job `e2e`. Guardia anti-#41.
- ✅ **3.9** Automatizaciones n8n (recordatorios asistencia, correos a inactivos, informes al coordinador) — HU-5.9 (#66). RNF-10 por construcción; opt-out + config; degrada no-op sin n8n.
- ✅ **3.10** Iniciar verificación Meta Business para WhatsApp (trámite lento) — M9 — **#58**:
  checklist `docs/whatsapp/META-BUSINESS-VERIFICATION.md` producido. El trámite (no-código) lo ejecuta
  Edu; el canal opera en Hito 5 (5.11). No bloquea nada.
- ✅ **3.11** Portal Supervisor completo (invitaciones, alcance por acción, vigencia, auditoría) — HU-12.1/12.2 (#64). Endurece 6 policies; portal GATED que audita cada consulta; 4-ojos multi-agente (1 MED de alcance de alerts corregido).
- ✅ **3.12** Expediente digital de fiscalización por acción (documentos, estados, ZIP) — HU-5.10 —
  **#60**: `action_documents` + definitivos inmutables (trigger, incluso service_role) + bucket
  privado + checklist de completitud + descarga ZIP con manifiesto; staff-only **admin/coordinador**
  (montos comerciales); jszip aislado. Revisión 4-ojos (MED de actionId sin validar corregido).

---

## HITO 4 — PILOTO REAL 🎯 🔶 (dirigido por Edu)

- 🔶 **4.1** Checklist pre-producción: **revisión adversarial del módulo `sence/` ✅ HECHA** por un
  panel multi-agente distinto del implementador (#80, D-047; 19 hallazgos, 1 HIGH corregido en #81 con
  4-ojos, migración del nonce aplicada al cloud) + **checklist pre-producción ✅** (#82,
  `docs/sence/CHECKLIST-PREPRODUCCION.md`). Falta la **certificación `rcetest` firmada** — 🔒 PARQUEADA
  por el bloqueo del lado de SENCE (Clave SENCE deprecada); validación diferida al primer curso real.
- 🔒 **4.2** Acción real de franquicia con grupo pequeño en **producción SENCE** (curso de la OTEC de Edu).
  **Depende de:** los rulings de Edu de la revisión H4 (H4-Q-01..Q-04) + el checklist 4.1a firmado.
- ✅ **4.3** Monitoreo diario + soporte a alumnos + **plan B** escrito — **#78**: `docs/ops/` con Plan B
  de contingencia (6 escenarios), runbook de monitoreo diario y runbook de rotación de secretos (cierra RNF-8).
- ✅ **4.4** **Ensayo de restauración 2** (spec §8.3) — **HECHO 2026-07-16** (end-to-end real: backup
  cifrado de R2 → SHA-256 → descifrado con la clave `age` de Edu → restore en BD limpia → integridad OK,
  RTO ~49 s ≪ 4 h). **§8.3 CUMPLIDO** (≥ 2 ensayos con éxito). Hallazgos (`--no-privileges` → re-aplicar
  grants vía migraciones; restaurar en proyecto Supabase nuevo) documentados en `docs/RESTORE.md` (ensayo #4).
- ⬜ **4.5** Retro del piloto → ajustes al spec (P1) → segunda acción real. (Post-piloto.)

> Durante el piloto el agente entra en **modo soporte**: cero features nuevas, fixes con prioridad máxima.
>
> **Rulings de Edu ✅ RESUELTOS + IMPLEMENTADOS (2026-07-16, D-048):** los 10 decididos; los 5 de
> código/contrato ya en `main` con el contrato enmendado (§Enmiendas E-1..E-6, cada PR con 4-ojos):
> **#85** (Q-01 cierre tardío cierra en vez de falso `expirada`; Q-05 T8 alcanzable) + **#86** (Q-04
> re-emitir la pendiente + timeout 15 min; Q-07 mensaje accionable 311/312; Q-02 contador M-4).
> **Q-03** (rate-limit del callback en el edge) = ✅ **APLICADO y verificado en staging** vía archivo
> dinámico de Traefik (`ops/traefik/sence-cb-ratelimit.yaml` → `/data/coolify/proxy/dynamic/`; la UI de
> Coolify 4.1.2 no expone labels). Ráfaga → 429; `/api/health` intacto.
> Q-06/08/09/10 = doc/sin cambio. Follow-up de UX pendiente: H4-R-010/012 (mensaje es-CL al alumno).
> **Follow-ups (informe H4):** UX del mensaje es-CL al alumno (H4-R-010/012), reconciliación evento↔estado
> en el worker (H4-R-006), scoping del rol `company` (H4-R-008), alerta de vida del tick (H4-R-013).

---

## HITO 5 — De producto a SaaS vendible 🔶 (10/13 ✅, 3/13 🔶 parcial — ninguna ⬜)

- ✅ **5.1** Reproductor SCORM (spike con paquete Storyline real → `scorm-again`) — ADR-006.
  **Motor hecho 2026-07-17** (ingesta #103, player #104): extracción en el worker con presupuesto
  de bytes REAL en streaming (`readEntryBytes` sobre `internalStream`, no el tamaño declarado del
  zip — el mismo patrón se reusó, con el mismo cuidado, en el descriptor `.docx` de 5.10), proxy
  same-origin `GET /api/scorm/[packageId]/[...path]` con CSP enforcing propia (D-052 — un SCO busca
  `window.API` en la cadena de frames padres, signed URLs de Storage habrían roto SCORM),
  `scorm-again` 1.2/2004, autosave con cola que serializa escrituras concurrentes, score SIEMPRE
  informativo (NUNCA a `grades`, D-050). Verificado contra un fixture SCORM sintético generado por
  código (manifiesto + SCO que llama `LMSInitialize`/`SetValue`/`Commit`). **🔒 No pasa a "cerrado
  operativo":** el spike con un paquete Storyline **real** — parte literal de esta tarea — sigue
  siendo handoff a Edu (necesita un paquete real y verificación manual).
- ✅ **5.2** Portal empresa cliente + resumen semanal — HU-8.1/8.2. **Hecho 2026-07-17** (#99):
  `companies`/`company_members` con 1 empresa activa por usuario por tenant (índice único parcial,
  D-062); la rama `company` se RETIRÓ de las 2 policies RLS vivas (`enrollments_select`,
  `sence_sessions_select_staff`) — el acceso pasa 100% por `company-portal-service.ts`, cada consulta
  auditada, RUN SIEMPRE enmascarado (D-061, deliberadamente más estricto que el acceso del
  supervisor/D-044, que sí tiene rama RLS con vigencia/alcance). El resumen semanal con redacción IA
  (HU-8.2) se completó después, en la task 5.9.
- ✅ **5.3** Onboarding de tenant nuevo **sin tocar código** (criterio de éxito #4) + suspensión —
  HU-1.1/1.4. **Hecho 2026-07-17** (#94): RPC `tenant_status_by_slug` (security definer,
  anon-executable) + Auth Hook endurecido (join `tenants.status='active'` en las 3 consultas de
  membership — tenant suspendido ⇒ claims con `roles: []`, falla cerrado); flags por feature
  (`scorm`/`ai_tutor`/`whatsapp`, deny-by-default) que habilitaron el gating de TODO lo que vino
  después en el hito (5.1, 5.8, 5.11). Middleware exime explícitamente `/api/sence/*`,
  `/api/health`, `/verificar` de la redirección por suspensión (fix propio: la versión original
  habría tragado callbacks SENCE de un tenant suspendido y perdido evidencia de asistencia para
  siempre).
- ✅ **5.4** Sincrónico en vivo (videoconferencia + asistencia RCE por sesión ⚠ validar norma) —
  spec §7-R3. **Hecho 2026-07-17** (#102), **alcance seguro aprobado por Edu en la planeación de
  esta sesión**: `live_sessions`/`live_session_attendance` por ACCIÓN, asistencia 100% INTERNA
  (enlace externo Zoom/Meet/Teams), regla "manual gana sobre self" resuelta ATÓMICAMENTE en una
  sola sentencia SQL (`write_live_attendance`, `ON CONFLICT ... DO UPDATE ... WHERE NOT (...)`, no
  en lógica de aplicación), banner permanente ("asistencia interna, no reemplaza el RCE") en toda
  vista/export. **Cero imports de `src/modules/sence/`, cero tablas `sence_*` tocadas** (regla de
  re-entrada del piloto respetada). Fix propio detectado tras el merge: el calendario filtraba mal
  las sesiones del alumno por acción cuando tenía más de una inscripción — corregido para resolver
  primero `enrollments.action_id` del propio alumno antes de listar. La "asistencia RCE por sesión"
  del texto original de la tarea queda EXPLÍCITAMENTE fuera de alcance hasta que SENCE confirme la
  norma (D-051) — documentado en `docs/sence/SINCRONICO-PENDIENTE-NORMA.md`.
- ✅ **5.5** Tablero superadmin + métricas de negocio — HU-10.3. **Hecho 2026-07-17** (#95): RPC
  `platform_tenant_stats()` — se corrigió en el propio desarrollo de SECURITY DEFINER a SECURITY
  INVOKER tras descubrir que en Supabase cloud (RLS forzada) el rol `postgres` NO bypassa RLS como
  en local; una versión DEFINER habría mostrado el tablero completamente en ceros en producción sin
  que ningún test local lo detectara. `probeDb()` del healthcheck se cambió de un `select` directo
  (dependía de grants que solo existían en cloud por drift) a la misma RPC de status del tenant, ya
  verificada contra ambos entornos.
- 🔶 **5.6** Marca/dominio definitivos, landing comercial, privacidad y contrato de encargo
  (abogado) — Plan §13.3/§9. **Hecho 2026-07-17** (#97/#98): landing provisional "Chilearning" con
  un párrafo de transparencia explícito (protegido con comentario "NO BORRAR"): el motor RCE nunca
  ha corrido contra SENCE real, solo contra el simulador — evita prometer al OTEC algo que, si el
  primer curso en producción falla, le cuesta plata real. `/privacidad` con banner "BORRADOR —
  pendiente revisión legal" (incluye el riesgo de transferencia internacional São Paulo, S2, aún sin
  resolver); `docs/legal/CONTRATO-ENCARGO-BORRADOR.md` con los campos legales alemanes de Edu
  (Handelsregister/HRB, USt-IdNr, no RUT). **🔒 No pasa a "cerrado":** la revisión por **abogado**
  (parte literal de la tarea) NO ocurrió — handoff a Edu; "Chilearning" es marca de trabajo, no la
  decisión de marca definitiva (Plan §13.3).
- ✅ **5.7** Documentación de venta (demo ficticia + one-pager cumplimiento) — **hecho 2026-07-18**:
  tenant demo `demo` (3er tenant, aditivo, 100% ficticio) + `docs/venta/GUION-DEMO.md` +
  `docs/venta/ONE-PAGER.md`. Revisión adversarial cazó y corrigió un HIGH real: el certificado
  emitido por el seed usaba un snapshot inventado (100% asistencia, nota 6.5) que contradecía los
  propios datos sembrados (3/5 lecciones, ~3% asistencia) — bajo las reglas reales de
  `evaluateEligibility` la alumna NUNCA habría calificado. Fix: la alumna featured ahora SÍ cumple
  las reglas reales (5/5 lecciones, 13/15 días hábiles con sesión SENCE cerrada = 87%, dentro del
  rango de fechas de la acción acotado al pasado para que el cálculo sea estable) y el snapshot del
  certificado cita esos mismos números — nunca inventados.
- ✅ **5.8** Tutor IA (M11): RAG con pgvector, chat streaming, límites, derivación a humano —
  ADR-007. ⚠ RNF-10. **Hecho 2026-07-18** (esquema+retrieval #107, chat+UI+panel #108):
  - **Retrieval híbrido** (D-055, amplía ADR-007): FTS spanish nativo SIEMPRE disponible (base y
    fallback); embeddings OpenRouter (pgvector/HNSW) como retrieval PRIMARIO solo cuando hay
    `OPENROUTER_API_KEY`, con fallback automático ante cualquier fallo del proveedor — el tutor
    nunca "desaparece" por un hiccup transitorio, y CI/staging quedan verdes sin ninguna key.
  - **Minimización por construcción** (D-056): `buildTutorPrompt` tiene firma LISTA BLANCA de
    primitivas (courseName, firstName, fragments, avance agregado, historial, pregunta) —
    estructuralmente no puede aceptar un `Principal`/enrollment completo, verificado con un test
    estrella que envenena cada campo con RUN/apellido/correo/empresa falsos. Staff académico
    (otec_admin/coordinator/instructor/tutor) SIN rama de lectura sobre `tutor_conversations`/
    `tutor_messages` — más estricto que certificados/SCORM, verificado con su propio test RLS
    adversarial. Retención de 180 días, purga diaria automática (D-057).
  - **Revisión adversarial cazó y corrigió 3 hallazgos reales en 5.8b**, ninguno llegó a producción:
    (1) condición de carrera (TOCTOU) real y trivialmente explotable en el límite diario de
    mensajes — el chequeo (SELECTs) y el incremento real estaban separados sin lock, permitiendo
    que una ráfaga de requests concurrentes rompiera por diseño el "corte automático al llegar al
    tope" de HU-11.2; fix: RPC atómica `tutor_try_reserve_message` con `pg_advisory_xact_lock` por
    tenant, llamada ANTES de invocar al proveedor de IA (D-058), con 2 tests de ráfaga real
    (`Promise.all`) que habrían fallado con el código anterior; (2) fuga de conexión en el reader
    del stream de OpenRouter — ocurría en el 100% de las respuestas exitosas (el camino feliz nunca
    llegaba a leer `data: [DONE]`, y el `break` del consumidor disparaba `IteratorClose` sin
    `finally`) — fix: `finally { reader.cancel() }`; (3) costo real de OpenRouter (`usage.cost` del
    chunk final del streaming, antes descartado silenciosamente porque el parser ignoraba chunks
    sin `choices`) ahora se captura y se acumula vía una RPC NUEVA y separada
    (`tutor_add_usage_cost`) para no arriesgar un overload duplicado en Postgres tocando la firma
    de las RPCs de uso ya probadas (D-059 — el mismo tipo de bug de `CREATE OR REPLACE FUNCTION`
    que ya se había corregido en 5.12).
  - Panel admin `/admin/tutor-ia` (toggle + límite diario por curso, presupuesto/costo real
    mensual, temas frecuentes); UI alumno `/mi-curso/tutor` con citas a lecciones y "derivar a
    tutor humano" (reusa `message-service.startThread`, copiando SOLO la última pregunta).
- ✅ **5.9** IA por lotes (resúmenes de empresa, borradores human-in-the-loop, recordatorios) —
  HU-8.2/9.5/5.9 — **hecho 2026-07-18** (rama `feat/h5-5.9-ia-lotes`):
  - **HU-8.2 (digest semanal de empresa):** narrativa generada por IA en el worker
    (`company-digest-service.ts`), minimizada por diseño — `DigestNarrativeInput` es una lista
    blanca de 6 conteos que NO admite `razonSocial`/`companyId` (verificado: no compila si se
    cuelan). Ledger de idempotencia `(tenant_id, company_id, week_start)` insert-first (antes de
    tocar IA/correo). Opt-out por `(tenant_id, user_id, channel)`. Correo va directo por
    `EmailSender`, no por n8n — decisión documentada en `docs/n8n/WORKFLOWS.md` con el mismo
    criterio ya aceptado en 3.9/PR #66 (lógica crítica y envío de PII SIEMPRE en el worker,
    testeable/auditable por P3/P6; n8n solo para eventos periféricos agregados). El título de la
    tarea dice "en n8n" pero la implementación real vive en el worker — nota para no confundir a
    futuro.
  - **HU-9.5 (borrador de respuesta para staff):** efímero (no se persiste), gate doble
    (rol staff + `aiClient.configured`, revalidado server-side), botón desaparece por completo
    (no deshabilitado) sin `OPENROUTER_API_KEY`.
  - **Ruling "recordatorios sin IA" respetado:** `reminders.ts` no importa IA en ningún punto;
    la personalización nueva es interpolación pura de un dato ya calculado.
  - **Revisión adversarial (3 lentes + verificación independiente) cazó y corrigió 1 HIGH real**
    en `pii-strip.ts` (saneo de PII para el borrador de HU-9.5): el regex de RUN/teléfono usaba
    `\b` (no distingue letra de dígito) con separadores todos opcionales — esto causaba (a) fuga
    real hacia el modelo cuando el RUN/teléfono venía pegado sin espacio a la palabra vecina
    (ej. `"rut12345678-9tengounaduda"` no se redactaba, bypass de minimización RNF-10), y (b)
    sobre-redacción de números legítimos sin relación con un RUN (fechas, folios, teléfonos
    fijos de 8 dígitos). Fix: lookaround de dígito (`(?<!\d)`/`(?!\d)`) en los bordes + exigir
    que al menos uno de los tres separadores del RUN esté presente. 8 tests adversariales nuevos
    en `pii-strip.test.ts` cubren ambos casos. Gates re-corridos tras el fix: lint/typecheck OK,
    900/900 unit, 455/455 rls, build + build:worker OK (sin fuga de `server-only`/`draft-service`
    al bundle del worker), 359/359 integration.
- ✅ **5.10** Creación asistida de cursos (desde cero o desde descriptor SENCE .docx) — HU-3.5/4.5.
  **Hecho 2026-07-17** (#105): asistente guiado de 7 pasos, plantillas por tipo
  (elearning_sence_estandar/libre, blended_sence), extracción determinista del descriptor `.docx`
  (SIN IA, heurísticas del Anexo 4), módulos materializados como lección-cabecera (D-053) — reusa
  `createCourse`/`createLesson`/`createQuiz`/`createSurvey` TAL CUAL, nada se publica hasta pasar por
  el constructor normal. **Segundo hallazgo real, cazado por mí mismo tras el cierre del ciclo
  automatizado de la task:** el "anti zip-bomb" del descriptor `.docx` reusaba el mismo patrón
  insuficiente (chequeo del tamaño DECLARADO del zip) que ya se había corregido en SCORM — y el test
  que decía cubrirlo solo probaba un zip honestamente declarado, nunca uno mintiendo su tamaño (el
  vector de ataque real). Se rechazó explícitamente subir el PR con esa vulnerabilidad sin corregir;
  se lanzó un segundo ciclo Implement→Review→Fix→Gates que movió el procesamiento al worker con
  streaming REAL de bytes (`readEntryBytes`, el mismo mecanismo de SCORM), con un test que construye
  un zip mintiendo su tamaño declarado y confirma que el streaming real (no el campo declarado) lo
  detiene.
- ✅ **5.11** Canal WhatsApp operativo (plantillas aprobadas; envío directo worker→Meta, no en n8n,
  D-049) — M9. **Hecho 2026-07-18** (#110): sender fetch-directo (espejo de `email-sender.ts`),
  degradación total sin credenciales de Meta (no-op, nunca toca red), gate deny-by-default por
  tenant (`flags.whatsapp`), minimización RNF-10 (solo primer nombre + curso, `maskPhone` en todo
  log), n8n JAMÁS ve un teléfono (bloque hermano al de correo, verificado: `buildN8nEvent` no admite
  estructuralmente ese campo). Revisión adversarial (3 lentes + verificación independiente) cazó y
  corrigió 1 MED real: el opt-out de WhatsApp NO era realmente independiente del de email en la
  práctica (un alumno dado de baja SOLO de email nunca llegaba a evaluarse para WhatsApp, porque el
  filtro de opt-out de email se aplicaba ANTES en la selección) — fix de raíz: el filtro se sacó de
  `eligible()`/la selección y se movió a `dispatch()` para AMBOS canales de forma simétrica; la
  independencia es ahora real en las dos direcciones (test de integración nuevo cubre la que
  faltaba). **🔒 No pasa a "canal operativo con clientes reales":** la verificación Meta Business
  (trámite externo, task 3.10) sigue pendiente de Edu, y HOY ningún flujo puebla
  `user_metadata.phone` — el canal queda completamente cableado, probado y listo, pero inalcanzable
  en la práctica hasta cerrar cualquiera de los dos puntos (plan concreto en
  `docs/whatsapp/ACTIVATION.md`).
- ✅ **5.12** Vencimientos y recertificación (alertas 90/60/30) — HU-7.3. **Hecho 2026-07-17**
  (#100): `certificates.expires_at` (fuera del snapshot congelado), offsets configurables por
  tenant con regla anti-ráfaga (D-064 — si el tick se atrasó y ya pasaron 2 offsets, solo notifica
  el menor, sin spamear). **Bug real corregido en el propio desarrollo:** `clone_course` no copiaba
  `courses.validity_months` — un curso clonado desde uno con vigencia perdía la vigencia silenciosamente;
  se recreó el RPC para copiarlo también, verificado que solo existe 1 overload tras el `drop
  function` + `create` explícito (evita el mismo riesgo de duplicado que D-059 documenta para el
  Tutor IA).
- ✅ **5.13** Export completo del tenant en formatos abiertos — HU-1.5. **Hecho 2026-07-17** (#101):
  ~30 tablas vía un registro data-driven (`EXPORT_DATASETS`), CSV con la misma protección
  anti-inyección ya usada en otros exports (D-021), tope de 300MB con archivos omitidos
  MANIFESTADOS, nunca truncados en silencio (D-063). Verificado con una prueba de integración
  adversarial: el ZIP de un tenant NUNCA contiene ni una fila del otro tenant sembrado.

**Backlog v2 (no ahora):** pasarela de pago chilena · LCE presencial · API LMS↔SIC + líneas 1/6 ·
migrador Moodle · custom domains · app móvil · gamificación · marketplace · alta disponibilidad.

---

## HITO 6 — Overhaul visual UX/UI ⬜ (0/17, en curso — abierto 2026-07-19)

**Por qué existe:** con el código funcionalmente completo (Hitos 0–3 y 5 ✅), Edu pidió mejorar
la UI — hoy es el gris por defecto de shadcn, sin color de marca, sin fuente, sin app shell
(el dashboard era una lista plana de links), 1 solo primitivo (`Button`) infrautilizado, y
branding por tenant guardado en BD pero nunca aplicado a la app. Ejecución **autónoma
end-to-end**: serie de 17 PRs pequeños por área, CI verde y merge por PR, revisión adversarial
visual al cierre de cada área. Plan completo + decisiones técnicas: sesión del 2026-07-19
(ver también D-065, D-066).

**Alcance del hito:** presentación y experiencia — CERO cambios a lógica de negocio, actions,
RLS o `src/modules/sence/` (salvo su chrome visual). Guía de diseño:
[`docs/design/MASTER.md`](../docs/design/MASTER.md) (generado con la skill `ui-ux-pro-max`,
instalada global, curado a mano — su output crudo quedó archivado en
`docs/design/ui-ux-pro-max-raw-output.md`) + [`docs/design/UX-STANDARDS.md`](../docs/design/UX-STANDARDS.md)
(4 estados de pantalla, loaders estratégicos, errores comprensibles, reglas de formulario —
pedido explícito de Edu, se aplica a toda pantalla migrada).

Secuencia (rama `feat/h6-6.X-*`, ver `specs/03-tareas.md` para el detalle de cada tarea):

- 6.0 ⬜ Spec + `MASTER.md` + `UX-STANDARDS.md`
- 6.1 ⬜ Design tokens oklch + Inter + fix escala táctil del Button
- 6.2 ⬜ Primitivos estáticos + `phone.ts`
- 6.3 ⬜ Primitivos interactivos
- 6.4 ⬜ Tabla responsive (probada en gradebook real)
- 6.5 ⬜ Dark mode completo
- 6.6 ⬜ Branding por tenant en runtime
- 6.7 ⬜ App shell + layouts por rol + error/loading + dashboard rediseñado
- 6.8 ⬜ Migración: área pública
- 6.9 ⬜ Migración: área alumno
- 6.10 ⬜ Migración: área tablero
- 6.11 ⬜ Migración: admin cursos
- 6.12 ⬜ Migración: admin acciones + inscripciones
- 6.13 ⬜ Migración: resto de admin
- 6.14 ⬜ Migración: portales
- 6.15 ⬜ Polish + motion + regla ESLint anti-regresión
- 6.16 ⬜ Cierre: revisión adversarial visual global + snapshot final

---

## 🔁 Follow-ups técnicos / deuda conocida (no bloquea, pero anotado)

- **Worker de expiración SENCE**: implementado en PR #31 (2.6). Follow-ups que dejó: alerta de
  spike de eventos `unmatched` (hoy fuera del cálculo de tasa) · conectar correo de alertas al
  EmailSender (PR de Resend de este hito) · desplegar Redis+worker en staging y prod.
- **Envío real de correos** (1.6): `EmailSender` (Resend por REST, D-019) implementado en el
  PR de Hito 2 — la bienvenida se envía al inscribir (best-effort, auditado). Solo falta que
  Edu configure `RESEND_API_KEY` + dominio verificado (hasta entonces: skipped, visible en el
  resultado del import). Envíos masivos por cola BullMQ = follow-up.
- **Subida de logos a Storage** (1.10): hoy se pega una URL https.
- **Asignación relator↔curso** (1.8/1.4): sin ella, "sus cursos" = todo el tenant para relator/tutor.
- **Tracking de migraciones en cloud:** `supabase_migrations` no existe como tabla en el cloud;
  las migraciones se aplican por Management API a mano en cada merge (documentado arriba).
- **`resolvePublicOrigin` fallback** (revisión de #20, R1): la rama de respaldo no valida el host
  contra el root domain; acotado por el enrutamiento de Traefik. Endurecimiento opcional.
- **Reactivar proxy Cloudflare (naranja) + SSL "Full"** para ocultar la IP del VPS (opcional).
- **⚠ CI no corre `next build`** (2026-07-15): el fix del #41 introdujo un conflicto de slug de
  rutas (`/admin/acciones/[actionId]/activar` vs las hermanas `[id]/…`) que Next.js lanza en
  RUNTIME ("different slug names for the same dynamic path") — 500 en TODA la app. typecheck,
  lint y vitest NO lo cazan, y el CI tampoco (jobs `checks`/`rls`/`integration`, ninguno buildea).
  El auto-deploy lo publicó → **staging estuvo caído hasta el hotfix #43**. **Follow-up: agregar
  un paso `pnpm build` al job `checks`** (necesita env placeholders porque el build evalúa
  `env.server.ts`). Regla interina: correr `next build` local antes de mergear rutas nuevas.

---

## 🛡️ Hallazgos de seguridad (registro — todos corregidos)

1. **Escalada de privilegios en `memberships`** (0.2): un coordinator podía ponerse
   `roles={superadmin}`. Fijo: constraint + trigger. Ver DECISIONES **D-006**.
2. **Open-redirect del callback SENCE** (#20): `x-forwarded-host` sin allowlist podía desviar el
   `IdSesionSence`. Fijo: validar host contra `TENANT_ROOT_DOMAIN` + forzar https. Revisión 4-ojos.
3. **Fuga de `token_encrypted`** (1.7, #22): el `revoke select(columna)` no anulaba el `grant` de
   tabla → el token cifrado era legible por el cliente. Fijo: grant acotado a columnas.

Decisiones ADR-lite completas en `specs/DECISIONES.md` (D-001..D-009+).

---

## ✅ Definición de Hecho (recordatorio — toda tarea la cumple para ser ✅)

1. Trazable a una HU o sección del plan. 2. Tests que cubren el criterio de aceptación.
3. RLS/permisos verificados si toca datos. 4. Auditoría si la acción es sensible.
5. Pasó por staging. 6. Sin secretos ni RUNs en logs. 7. Doc mínima actualizada.
8. Si toca UI: verificada en 360 px y 1440 px sin scroll horizontal (RNF-6).
9. **Cambio en `src/modules/sence/`, RLS o auth → revisión adversarial por OTRO agente (4-ojos).**
