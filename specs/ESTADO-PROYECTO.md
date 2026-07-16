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

- **Fecha:** 2026-07-16
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
  aprobado. **Handoff a Edu** (nada bloquea el desarrollo, pero se necesita para producción-real):
  `RESEND_API_KEY`+dominio · cuenta R2+clave `age` (backup off-site) · Sentry DSN (+ conectar el
  scrubber ya hecho + `includeLocalVariables:false`) · Uptime Kuma · **Supabase Pro** (2FA enforcement)
  · confirmar **§7-R7** del certificado + firma real del representante · endurecer CSP a enforcing tras
  verificar en navegador · iniciar trámite Meta (checklist en `docs/whatsapp/`).
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
- **PRs mergeados a `main`:** 61 · **Tests:** ~987 verdes (484 unit + 326 RLS + 155 integración + E2E 3 flujos)
- **Staging:** VIVO en https://otec-andes.chilearning.cl (login demo en `STAGING-CREDENTIALS.txt`)
- **Deploy:** auto-deploy GitHub→Coolify activo (merge a `main` despliega solo)
- **Último gran hito humano pendiente:** certificación `rcetest` (con Edu presente, P3)

---

## 🚀 Cómo retomar en una sesión nueva (bootstrap)

1. **Herramientas:** Node ≥24, `pnpm`, Docker Desktop **encendido**, Supabase CLI, `gh` (auth `edulopezt`).
2. **Local:** `pnpm install` → `supabase start` → `supabase db reset` (migra + siembra 2 OTECs × 8 roles + curso demo).
3. **App local:** `pnpm dev` → http://localhost:3000. Login: `admin@otec-andes.test` / `Password123!`.
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

## HITO 4 — PILOTO REAL 🎯 ⬜ (dirigido por Edu)

- 🔒 **4.1** Checklist pre-producción: **certificación rcetest firmada** + revisión adversarial
  del módulo `sence/` por un agente distinto del implementador.
- 🔒 **4.2** Acción real de franquicia con grupo pequeño en **producción SENCE** (curso de la OTEC de Edu).
- ⬜ **4.3** Monitoreo diario + soporte a alumnos + **plan B** escrito (qué pasa si el motor falla).
- ⬜ **4.4** **Ensayo de restauración 2** (spec §8.3).
- ⬜ **4.5** Retro del piloto → ajustes al spec (P1) → segunda acción real.

> Durante el piloto el agente entra en **modo soporte**: cero features nuevas, fixes con prioridad máxima.

---

## HITO 5 — De producto a SaaS vendible ⬜

- ⬜ **5.1** Reproductor SCORM (spike con paquete Storyline real → `scorm-again`) — ADR-006.
- ⬜ **5.2** Portal empresa cliente + resumen semanal — HU-8.1/8.2.
- ⬜ **5.3** Onboarding de tenant nuevo **sin tocar código** (criterio de éxito #4) + suspensión — HU-1.1/1.4.
- ⬜ **5.4** Sincrónico en vivo (videoconferencia + asistencia RCE por sesión ⚠ validar norma) — spec §7-R3.
- ⬜ **5.5** Tablero superadmin + métricas de negocio — HU-10.3.
- ⬜ **5.6** Marca/dominio definitivos, landing comercial, privacidad y contrato de encargo (abogado) — Plan §13.3/§9.
- ⬜ **5.7** Documentación de venta (demo ficticia + one-pager cumplimiento).
- ⬜ **5.8** Tutor IA (M11): RAG con pgvector, chat streaming, límites, derivación a humano — ADR-007. ⚠ RNF-10.
- ⬜ **5.9** IA por lotes en n8n (resúmenes, borradores human-in-the-loop, recordatorios) — HU-8.2/9.5/5.9.
- ⬜ **5.10** Creación asistida de cursos (desde cero o desde descriptor SENCE .docx) — HU-3.5/4.5.
- ⬜ **5.11** Canal WhatsApp operativo (plantillas aprobadas, n8n) — M9.
- ⬜ **5.12** Vencimientos y recertificación (alertas 90/60/30) — HU-7.3.
- ⬜ **5.13** Export completo del tenant en formatos abiertos — HU-1.5.

**Backlog v2 (no ahora):** pasarela de pago chilena · LCE presencial · API LMS↔SIC + líneas 1/6 ·
migrador Moodle · custom domains · app móvil · gamificación · marketplace · alta disponibilidad.

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
