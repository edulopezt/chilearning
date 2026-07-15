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

- **Fecha:** 2026-07-15
- **Hitos cerrados:** Hito 0 ✅ · Hito 1 ✅ (10/10)
- **Hito en curso:** ninguno — **siguiente = Hito 2**
- **PRs mergeados a `main`:** 28 · **Tests:** ~500 verdes (unit + integración + RLS)
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

- 🔒 **Certificación rcetest (0.9):** todo listo. Requiere a Edu presente con su token de
  `https://sistemas.sence.cl/rts` (P3). Guía: `docs/sence/RUNBOOK-CERTIFICACION-RCETEST-STAGING.md`.
  Pasos: cargar token en `/admin/sence` → poner la acción demo en `rcetest` con código `-1`
  (por `/admin/acciones`) → `SENCE_ENV=test` en Coolify → correr el flujo con el RUN de Edu.
- 🔒 **Correo a `controlelearning@sence.cl` (0.10):** borrador en `docs/sence/BORRADOR-CORREO-SENCE.md`.
  Edu lo envía (pregunta obligatoriedad API LMS-SIC línea 3 + fuente normativa de la regla 3h/60min).
- 🔒 **Proveedor de correo (para 1.6 real):** falta elegir SMTP/Resend y sus credenciales.
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

## HITO 2 — Evaluación y panel SENCE ⬜ (siguiente)

- ⬜ **2.1** Quizzes autocorregidos: 3 tipos (opción múltiple, V/F, ...), intentos, banco de
  preguntas, escala 1.0–7.0 — HU-6.1. *(Nuevas tablas: `quizzes`/`questions`/`attempts`.)*
- ⬜ **2.2** Tareas con entrega y corrección (relator/tutor) — HU-6.2. *(`assignments`/`submissions`/`grades`.)*
- ⬜ **2.3** Libro de notas por acción + **auditoría de cambios de nota** — HU-6.4.
- ⬜ **2.4** Panel de cumplimiento SENCE + **export Excel** (columnas del reporte del plugin actual) — HU-5.5.
- ⬜ **2.5** Portal Supervisor v1: rol de **solo lectura** para fiscalizador SENCE (tests de que NO escribe) — HU-5.5, M12.
- ⬜ **2.6** **Cron/worker**: expiración 3 h, inactividad 60 min, alertas de tasa de error — Plan §5.6.
  ⚠ **CIERRA UN GAP CONOCIDO:** hoy NO hay worker que expire sesiones SENCE (T4/T6/T9 muertos);
  una Clave Única abandonada deja la sesión colgada y puede brickear el enrollment (índice único
  parcial). Es lo primero a hacer del Hito 2 si se va a certificar/pilotear.
- ⬜ **2.7** Pre-flight de acción SENCE: validación masiva RUN/DV, guía Clave Única, check de
  configuración, alerta día 1 — HU-5.8. *(Reusa `preflight.ts` del motor.)*
- ⬜ **2.8** Clonado de cursos y re-ejecución de acciones (exige fechas y código nuevos) — HU-3.6.

**Gate del Hito 2:** libro de notas con auditoría · export Excel del panel SENCE · pre-flight
detecta RUN inválidos plantados · clonado exige fechas/código nuevos · portal supervisor v1
solo-lectura verificado.

---

## HITO 3 — Cierre del ciclo + endurecimiento ⬜

- ⬜ **3.1** Encuesta de satisfacción (requisito de completitud, agregados) — HU-6.3.
- ⬜ **3.2** **Certificados PDF** con plantilla SENCE (folio, QR, verificación pública, revocación,
  umbral de asistencia) — HU-7.1/7.2. *(Verificar campos normados, spec §7-R7.)*
- ⬜ **3.3** Checklist DJ/GCA con recordatorios (n8n) + nómina exportable — HU-5.6.
- ⬜ **3.4** Anuncios + foro + mensajería + calendario (mínimos SENCE) — M9.
- ⬜ **3.5** Derechos Ley 21.719 en UI (export/supresión con retenciones) + consentimiento — HU-2.4, RNF-3.
- ⬜ **3.6** Hardening: rate limits, headers, **2FA obligatorio admins**, revisión OWASP — Plan §9.
- ⬜ **3.7** Backups off-site + **ensayo de restauración 1** + Uptime Kuma + Sentry — Plan §8/§10.
- ⬜ **3.8** E2E Playwright de los 3 flujos críticos — Plan §11.
- ⬜ **3.9** Automatizaciones n8n (recordatorios asistencia, correos a inactivos, informes al coordinador) — HU-5.9.
- ⬜ **3.10** Iniciar verificación Meta Business para WhatsApp (trámite lento) — M9.
- ⬜ **3.11** Portal Supervisor completo (invitaciones, alcance por acción, vigencia, auditoría) — HU-12.1/12.2.
- ⬜ **3.12** Expediente digital de fiscalización por acción (documentos, estados, ZIP) — HU-5.10.

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

- **Worker de expiración de sesiones SENCE** (T4/T6/T9): no existe → Hito 2 tarea 2.6. Crítico antes del piloto.
- **Envío real de correos** (1.6): plantillas listas, falta proveedor + `EmailSender`.
- **Subida de logos a Storage** (1.10): hoy se pega una URL https.
- **Asignación relator↔curso** (1.8/1.4): sin ella, "sus cursos" = todo el tenant para relator/tutor.
- **Tracking de migraciones en cloud:** `supabase_migrations` no existe como tabla en el cloud;
  las migraciones se aplican por Management API a mano en cada merge (documentado arriba).
- **`resolvePublicOrigin` fallback** (revisión de #20, R1): la rama de respaldo no valida el host
  contra el root domain; acotado por el enrutamiento de Traefik. Endurecimiento opcional.
- **Reactivar proxy Cloudflare (naranja) + SSL "Full"** para ocultar la IP del VPS (opcional).

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
