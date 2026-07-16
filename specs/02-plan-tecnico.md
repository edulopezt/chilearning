# Plan Técnico v1 — "Chilearning"

> **Qué es este documento:** el CÓMO. Arquitectura, stack, modelo de datos, diseño del motor
> SENCE, infraestructura, seguridad y operación. Cada decisión se justifica contra la
> constitución (P1–P10) y la especificación. Las decisiones grandes quedan como ADRs (§12).
>
> Fecha: 2026-07-13 · Estado: v1 aprobable — los ítems marcados ⚠ requieren validación en Sprint 1.

## 1. Resumen de decisiones

| Capa | Elección | Principio que la sustenta |
|---|---|---|
| Lenguaje | TypeScript punta a punta | P5 (un solo lenguaje, máximo rendimiento con IA copiloto) |
| Framework | Next.js (App Router) — monolito modular | P5 |
| UI | Tailwind CSS + shadcn/ui (mobile-first, sobre Radix) | P5, RNF-6 (responsividad total) |
| Base de datos | **Supabase Cloud (Postgres) región São Paulo** + RLS | P2, P5, P9 (gestionada, PITR, Edu ya la conoce) |
| Auth | Supabase Auth (email+password, TOTP 2FA) + RBAC propio | P7 |
| Jobs/colas | Redis + BullMQ (contenedor en el VPS) | P5 |
| Archivos | Supabase Storage (SCORM, entregas, adjuntos) | P5 |
| Video | Bunny Stream (CDN con PoPs LatAm, URLs firmadas) | P10, RNF-5 |
| Correo | Resend (o SES) — transaccional | P5 |
| App hosting | VPS **V2Networks Santiago** con **Coolify** (Docker) | preferencia Edu + P9 (agnóstico) |
| Automatización periférica | n8n en el VPS (correos resumen, recordatorios DJ, alertas) | P3 (jamás ruta crítica) |
| Monitoreo | Sentry (errores) + Uptime Kuma (uptime) + logs Coolify | P5, RNF-8 |
| CI/CD | GitHub + Actions → deploy Coolify por webhook | P6 |

## 2. Arquitectura

```
                        Cloudflare (DNS wildcard *.dominio.cl, proxy, WAF)
                                          │
                     ┌────────────────────┴──────────────────────┐
                     │        VPS V2Networks Santiago (Coolify)  │
                     │  ┌──────────────┐  ┌───────┐  ┌────────┐  │
Alumno/OTEC ────────▶│  │ Next.js app  │  │ Redis │  │ worker │  │
                     │  │ (web + API)  │  │       │  │ BullMQ │  │
                     │  └──────┬───────┘  └───────┘  └────┬───┘  │
                     │         │      ┌──────┐  ┌───────┐ │      │
                     │         │      │ n8n  │  │Uptime │ │      │
                     │         │      └──────┘  │ Kuma  │ │      │
                     │         │                └───────┘ │      │
                     └─────────┼──────────────────────────┼──────┘
                               ▼                          ▼
                    Supabase Cloud São Paulo     Bunny Stream (video)
                    (Postgres+RLS, Auth,         Resend (correo)
                     Storage, backups PITR)      Sentry (errores)
                               ▲
   Navegador del alumno ──POST──▶ SENCE RCE (sistemas.sence.cl/rce|rcetest)
   (Clave Única)         ◀─callback POST── UrlRetoma/UrlError → /api/sence/cb
```

- **Monolito modular:** un solo repo/app con módulos internos (`core`, `academico`, `contenido`,
  `sence`, `evaluacion`, `certificados`, `portal-empresa`, `comunicacion`, `reportes`).
  El módulo `sence` es un paquete interno con contrato explícito, sin dependencias hacia el resto
  (puede testearse y auditarse aislado — P3). En Hito 5 se suma el módulo `tutor-ia` (ADR-007).
- **Worker separado** (mismo código, proceso aparte) para jobs: emisión masiva de certificados,
  imports CSV, correos, limpieza de sesiones.

## 3. Multi-tenancy

- Resolución del tenant por subdominio en middleware (`{otec}.dominio.cl` → `tenant_id`).
  ⚠ El dominio definitivo debe ser corto: `UrlRetoma`/`UrlError` de SENCE aceptan máx. 100
  caracteres → `https://{sub}.{dominio}/api/sence/cb` debe caber holgado.
- **Alta de subdominios sin tocar infraestructura:** un único registro DNS comodín
  (`*.dominio.cl` → IP del VPS, gestionado en Cloudflare con proxy) + certificado SSL wildcard
  automático (ACME DNS-01 con API token de Cloudflare, gestionado por Coolify/Traefik).
  Crear una OTEC = insertar su fila en `tenants` con el `slug`; el subdominio queda operativo
  en el mismo segundo. El middleware valida el slug contra la BD (con caché) y los slugs
  reservados nunca se asignan. Staging usa su propio comodín `*.staging.dominio.cl`
  (un wildcard NO cubre dos niveles: requiere registro DNS y certificado propios).
- `tenant_id` en TODAS las tablas de negocio + **RLS activada en todas** (P2):
  - JWT de Supabase Auth con claims personalizados (`tenant_id`, `roles`) vía Auth Hook.
  - Política tipo: `USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)` + funciones
    `has_role()` para la matriz del spec §3.
  - El **service role** (bypassa RLS) solo se usa en el worker y en el callback SENCE, siempre
    a través de una capa `tenantGuard()` que fija y verifica el tenant explícitamente.
- Tests de aislamiento en CI: suite que intenta leer/escribir cruzado entre dos tenants semilla
  con cada rol; cualquier fuga rompe el build (RNF-1).
- Usuarios multi-tenant: tabla `memberships` (user ↔ tenant ↔ roles[]); un mismo correo puede
  ser relator en dos OTECs con contextos separados.
- Branding por tenant (HU-1.2): `tenants.branding` jsonb → design tokens (variables CSS)
  inyectados por el middleware según el subdominio; logos en Supabase Storage tras CDN;
  validación de contraste WCAG al guardar; correos y PDFs leen los MISMOS tokens para que
  la marca sea consistente en todos los canales.

## 4. Modelo de datos (núcleo, nivel entidad)

`tenants` (id, slug, nombre, rut, plan, branding jsonb, flags jsonb, estado) ·
`memberships` (user_id, tenant_id, roles[], estado) ·
`companies` (tenant_id, rut, razón social) · `company_members` (portal empresa) ·
`courses` (tenant_id, nombre, horas, modalidad, sence bool, cod_sence, reglas_completitud jsonb) ·
`course_modules` / `lessons` (tipo: video|texto|archivo|embed|quiz|scorm, orden, contenido jsonb) ·
`scorm_packages` (storage_path, versión, manifiesto jsonb) · `scorm_cmi` (enrollment_id, datos jsonb) ·
`actions` (tenant_id, course_id, codigo_accion, linea_capacitacion, empresa_id, fechas, ambiente sence: test|prod, candado bool, cierre_sesion bool) ·
`enrollments` (action_id, user_id, run, exento bool, estado, progreso) ·
`lesson_progress` (enrollment_id, lesson_id, estado, segundos) ·
`quizzes`/`questions`/`attempts` · `assignments`/`submissions`/`grades` ·
`surveys`/`survey_responses` · `certificates` (folio único, qr, estado, revocado_motivo) ·
`sence_sessions` (enrollment_id, id_sesion_alumno UNIQUE, id_sesion_sence, run, cod_sence,
codigo_accion, linea, fecha_hora, zona_horaria, estado: iniciada|cerrada|expirada|error,
glosa_error, creado_en, cerrado_en) — equivalente ampliado de la tabla del plugin ·
`sence_events` (bitácora INSERT-only de todo intento/callback crudo) ·
`audit_log` (INSERT-only: actor, tenant, acción, entidad, ip, ts, detalle jsonb) ·
`announcements` · `forum_threads`/`forum_posts` · `messages` · `calendar_items` ·
`dj_checklist` (action_id, enrollment_id, estado DJ, recordatorios) ·
`action_documents` (expediente de fiscalización por acción: tipo, archivo, estado, inmutable al marcarse definitivo) ·
`supervisor_grants` (invitaciones de supervisores externos: alcance, vigencia, revocación) ·
`certificate_validity` (vencimiento y alertas de recertificación).

Reglas duras: FKs con `ON DELETE RESTRICT` en datos SENCE/certificados; `audit_log` y
`sence_events` sin UPDATE/DELETE (permisos revocados a nivel de rol de BD).

## 5. Motor SENCE (diseño)

Flujo (según SPEC portable de `lms-marca/` + manual vigente ⚠ diff v1.1.3→v1.1.5/v1.1.6 en Sprint 1):

1. `GET /curso/...` con candado activo y sin sesión SENCE vigente → interstitial "Registrar asistencia".
2. `POST /api/sence/start` (server): valida inscripción/fechas/RUN, crea `sence_sessions`
   (estado `iniciada_pendiente`, `id_sesion_alumno` = UUID propio), registra en `sence_events`,
   y responde HTML autoenviable (form POST → `IniciarSesion` de SENCE con RutOtec, Token
   descifrado al vuelo, LineaCapacitacion, RunAlumno, IdSesionAlumno, CodSence, CodigoCurso,
   UrlRetoma=UrlError=`https://{sub}.{dom}/api/sence/cb`).
3. Alumno se autentica con Clave Única en SENCE.
4. `POST /api/sence/cb` (público, sin auth de app): parsea x-www-form-urlencoded;
   correlaciona por `IdSesionAlumno`; clasifica: `GlosaError` → error (traduce tabla completa
   100–310); `IdSesionSence` presente → apertura exitosa; ninguno → cierre. Transición de la
   máquina de estados + `sence_events` SIEMPRE (aunque la correlación falle). Idempotente ante
   replays (constraint UNIQUE + estado).
5. Candado se libera; contador visible (máx. 3 h por sesión SENCE); si `cierre_sesion` activo,
   botón "Cerrar sesión SENCE" (`POST /api/sence/close` → form a `CerrarSesion` con `IdSesionSence`).
6. Cron (worker): expira sesiones a las 3 h, marca inactividad 60 min (RNF-2), consolida
   panel de cumplimiento.

Decisiones de robustez: rate limit por IP+RUN en `/start`; validación estricta de formatos
(RUN con DV, CodSence 10 dígitos, línea ∈ {1,3,6}); los callbacks se aceptan aunque lleguen
tarde; alertas a Edu si tasa de errores SENCE > umbral; **mock local de RCE** (contenedor
Express que replica IniciarSesion/CerrarSesion/callbacks y toda la tabla de errores) para
tests automatizados sin depender de SENCE; certificación manual en `rcetest` antes de cada release
que toque el módulo (P3).

API LMS↔SIC: solo contratos e interfaces (`SicClient` con métodos tipados y tabla de mapeo)
— implementación diferida hasta activar línea 1 (spec §7-R2).

## 6. Contenido: nativo + SCORM

- Nativo: lecciones como bloques (`contenido jsonb` versionado), editor con vista previa.
- Video: subida a Bunny Stream (API) desde la UI; reproducción con URLs firmadas por sesión;
  prohibido servir video desde el VPS (P10).
- SCORM 1.2/2004: zip a Supabase Storage, extracción y validación de `imsmanifest.xml` en el
  worker; runtime **scorm-again** en iframe sandboxeado; persistencia CMI por enrollment con
  autosave; compatible móvil. ⚠ Spike en Sprint 2 con un paquete Storyline real de Edu.

## 7. Infraestructura y costos

**Proveedor elegido: V2Networks (Santiago, Tier III, KVM/EPYC/NVMe, 10+ años, SLA 99,98%,
factura en CLP).** El VPS de Edu ya está contratado (alias SSH en su equipo: `lms-white-label`,
antes `openclaw`; verificar qué servicios corren en él antes de instalar Coolify en la tarea 0.3).
Análisis honesto: excelente relación precio/specs y soporte local; sus
backups incluidos son semanales y no hay API de infraestructura como en Vultr — ambos puntos
los cubrimos nosotros (backups propios diarios P9; infra reproducible por Coolify+Git).
Alternativa documentada: Vultr Santiago (API, snapshots on-demand; ~30–40% más caro por GB de RAM).
Migrar entre ellos = restaurar compose+backups (P9).

| Ítem | Elección | Costo aprox./mes |
|---|---|---|
| VPS producción | V2Networks Cloud-3 (4 vCPU dedicados, 12 GB, 100 GB NVMe) | CLP 29.900 + IVA ≈ USD 37 |
| Staging | proyecto separado en el MISMO VPS al inicio; VPS propio (Cloud-1) al crecer | 0 → USD 25 |
| Base de datos | Supabase Pro (prod, São Paulo, backups diarios + PITR opcional) + proyecto Free (dev/staging) | USD 25 |
| Video | Bunny Stream (almacenamiento + tráfico) | ~USD 5–15 |
| Backups off-site | Cloudflare R2 (BD + storage + config) | ~USD 2 |
| Correo | Resend free → Pro según volumen | USD 0–20 |
| Dominio + Cloudflare | plan free | ~USD 2 |
| Sentry / Uptime Kuma | free tier / self-host | USD 0 |
| API de IA (tutor + lotes, desde Hito 5) | Anthropic/OpenAI, medido con tope por tenant | USD 0 hasta Hito 5; luego variable, trasladable al precio del add-on |
| **Total** | | **≈ USD 70–100** ✔ dentro de presupuesto (50–120) |

Topología Coolify: proyecto `prod` (app, worker, redis, n8n, uptime-kuma) y proyecto `staging`
(app+worker+redis compartiendo el Supabase Free). Deploy: push a `main` → webhook → build
Dockerfile (Next standalone) → healthcheck → swap. Rollback = redeploy del commit anterior.

**Latencia** ⚠: app Santiago ↔ BD São Paulo ≈ 30–40 ms por query. Mitigación: consultas por
página acotadas (dataloaders/joins, nada de N+1), caché Redis para catálogo/branding, y medición
real en Sprint 1 — si p95 > presupuesto, opciones: mover VPS a Vultr São Paulo o BD a
Postgres en el VPS (ADR-001 reversible).

## 8. Backups y recuperación (P9)

1. Supabase Pro: backups diarios gestionados (+ PITR si se contrata).
2. **Independiente del proveedor:** contenedor cron en el VPS ejecuta `pg_dump` nocturno →
   cifra (age) → sube a R2; `rclone sync` del Storage a R2; export semanal de configuración
   Coolify. Retención: 7 diarios, 4 semanales, 6 mensuales.
3. Runbook `RESTORE.md`: restaurar BD a Supabase nuevo o Postgres local, repuntar DNS,
   recuperar storage. **Ensayo mensual calendarizado** (criterio de éxito spec §8.3).

## 9. Seguridad y cumplimiento

- Headers (CSP, HSTS, frame-ancestors para el iframe SCORM), CSRF en mutaciones, rate limiting
  (Redis) en auth y endpoints SENCE, validación Zod en todo borde (incl. callback SENCE).
- Supabase Auth: contraseñas con política, TOTP 2FA obligatorio para superadmin/admin/coordinador,
  bloqueo por intentos, expiración de sesión por inactividad 60 min (SENCE).
- Tokens SENCE por tenant (HU-5.4): cifrado a nivel de aplicación (AES-256-GCM, clave maestra en
  Coolify secrets, rotable); patrón **write-only** — la UI solo muestra los últimos 4 caracteres y
  no existe endpoint que devuelva el valor completo; reautenticación (step-up) para modificarlo;
  jamás en logs ni respuestas de API; se materializa únicamente en la página de redirección a
  SENCE (renderizada en servidor, `Cache-Control: no-store`, autoenvío inmediato); monitoreo de
  errores 212 (token vencido) con alerta al admin y guía de renovación en /rts.
- Ley 21.719: banner+registro de consentimiento, página de derechos (HU-2.4), registro de
  actividades de tratamiento (doc vivo), plantilla de contrato de encargo por tenant ⚠ revisar
  con abogado antes del lanzamiento comercial, DPA de Supabase/Bunny/Resend archivados.
- Dependencias: Dependabot + `npm audit` en CI; imagen Docker distroless/slim; VPS endurecido
  (SSH solo llaves, ufw, fail2ban, actualizaciones automáticas de seguridad).

## 10. Observabilidad

Sentry (errores app+worker con release tracking) · Uptime Kuma (endpoints públicos + callback
SENCE sintético) · logs estructurados JSON (pino) visibles en Coolify · panel de métricas SENCE
propio (tasa éxito/error por tenant — es métrica de negocio, no solo técnica) · alertas → correo
+ Telegram vía n8n (periférico ✔).

## 11. Estrategia de testing

- Unit (Vitest): dominio puro (reglas completitud, notas, validadores RUN/DV, máquina de estados SENCE).
- Integración: RLS/aislamiento multi-tenant (supabase local + seeds 2 tenants × 8 roles);
  motor SENCE contra el **mock RCE** (éxitos, cada código de error, replays, callbacks tardíos, cierres).
- E2E (Playwright): flujos críticos — alumno completa curso con asistencia (mock), coordinador
  crea acción, certificado emitido y verificado.
- Manual normado: checklist de certificación en `rcetest` con token real (previo a todo release
  que toque `sence/`), y checklist WCAG básico.
- CI (GitHub Actions): lint + typecheck + unit + integración + e2e en PR; deploy solo con verde (P6).

## 12. ADRs (decisiones registradas)

| ADR | Decisión | Alternativas descartadas | Por qué | Reversibilidad |
|---|---|---|---|---|
| 001 | Supabase Cloud São Paulo (BD+Auth+Storage) | a) Postgres self-host en VPS: tú operas backups/PITR/auth; b) Supabase self-hosted: ~10 contenedores extra, viola P5; c) RDS/Neon: sin región cercana con auth integrada al mismo precio | Gestionada, RLS-first, PITR, Edu ya la usa; libera al único operador | Alta: es Postgres estándar; pg_dump diario propio (P9) |
| 002 | VPS V2Networks Santiago | Vultr Santiago (más caro, con API); Hetzner EU (mejor precio, lejos y sin factura CLP) | Preferencia Edu + latencia usuarios + factura local; riesgos cubiertos por backups propios | Alta: Docker+Coolify portable |
| 003 | Monolito modular Next.js + worker | Microservicios; backend separado (Nest) | P5: una persona; módulo `sence` aislado igual permite auditoría | Media |
| 004 | n8n solo periférico | Poner integraciones SENCE en n8n | P3: ruta crítica legal exige código versionado y testeado | — |
| 005 | Bunny Stream para video | Self-host (mata el VPS), Cloudflare Stream (más caro por minuto almacenado), Mux (premium) | Costo/PoPs LatAm/simplicidad | Alta |
| 006 | scorm-again como runtime SCORM | Rustici/SCORM Cloud (SaaS caro), implementar runtime propio | Open source probado; SCORM Cloud queda como plan B si el spike falla | Media |
| 007 | Tutor IA como módulo dentro de la app, con RAG sobre pgvector de Supabase; n8n solo para IA por lotes con datos seudonimizados/agregados | Chat interactivo orquestado en n8n: sin streaming, saca datos personales de la frontera de la app, difícil de testear y auditar | P3/P4/P6/P8: minimización aplicada en código, RLS, auditoría y CI; pgvector ya viene en el stack elegido | Alta: módulo interno; el proveedor de modelo es intercambiable |
| 008 | `exceljs` para ESCRIBIR el export .xlsx del panel de cumplimiento (Hito 2, HU-5.5); CSV nativo sin dependencia | a) SheetJS `xlsx` de npm: congelado en 0.18.5 con CVE-2023-30533 y CVE-2024-22363 corregidos solo en el CDN propio (cadena de suministro incómoda para lockfile/CI); b) XLSX minimal a mano: serializador casero de formato de borde, riesgo de incompatibilidades en el Excel del fiscalizador; c) CSV-only: el gate del hito exige Excel y el plugin histórico entregaba .xls real | MIT, sin CVEs abiertos, server-only (no toca el bundle cliente), API de escritura simple; superficie mínima (solo write) | Alta: aislado tras el wrapper `reportes/xlsx.ts` (un archivo) |
| 009 | `pdf-lib` (+ `qrcode`) para GENERAR el certificado PDF y su QR (Hito 3, HU-7.1) | a) `@react-pdf/renderer`: arrastra `yoga-layout` (WASM) → riesgo con `output:standalone` y peso; b) `puppeteer`/chromium: binario nativo pesado, viola el contenedor mínimo (P5); c) `pdfkit`: API de streams menos ergónica para un Buffer | Puro JS sin binarios/WASM, compatible con el build standalone de Coolify, MIT; `qrcode` genera PNG server-side; snapshot congelado (D-112) hace el PDF determinista/regenerable | Alta: aislado tras `certificados/domain/pdf.ts` (un archivo) |

## 13. Pendientes que bloquean partes del plan (van al Sprint 1)

1. ⚠ Descargar manuales oficiales v1.1.5 (+ confirmar v1.1.6) y hacer diff contra la SPEC
   portable; ajustar §5 si hay cambios de campos/endpoints.
2. ⚠ Consultar a `controlelearning@sence.cl` la obligatoriedad de la API LMS↔SIC para línea 3
   con plataforma propia (spec §7-R2) — redactaré el borrador del correo.
3. ⚠ Elegir dominio (corto — límite 100 chars de UrlRetoma) y nombre definitivo.
4. ⚠ Confirmar que la cuenta SENCE del OTEC de Edu puede generar tokens en `sistemas.sence.cl/rts`
   y operar `rcetest` esta semana (requisito del hito Sprint 1).
