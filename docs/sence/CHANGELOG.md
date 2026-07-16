# Changelog — módulo SENCE (`src/modules/sence/`)

Registro de cambios del contrato de integración con el Registro Centralizado
E-learning (RCE) de SENCE. Regla del proyecto (ver `CLAUDE.md`): todo cambio que
toque `src/modules/sence/` se anota aquí, y cualquier cambio al contrato SENCE
exige diff contra el manual oficial + checklist en `rcetest` antes del release.

---

## 2026-07-16 — Rate-limit + chequeo de origen en las rutas RCE (tarea 3.6, hardening)

**Sin cambio de contrato SENCE.** Endurecimiento de los route handlers propios;
no toca el protocolo, campos, endpoints ni la máquina de estados del motor.

- **`/api/sence/start` y `/api/sence/close`**: `assertSameOrigin` (rechaza un POST
  cross-site; el botón del curso es mismo-origen) + rate-limit de ventana fija en
  Redis (start 10/min·usuario + 30/min·IP; close 10/min·usuario). **Fail-open**
  sin Redis → comportamiento idéntico al previo cuando no hay `REDIS_URL`.
- **`/api/sence/cb/[nonce]`**: rate-limit 60/min·IP (generoso: IPs variadas de
  alumnos). **EXENTO** de `assertSameOrigin` a propósito (es un POST cross-origin
  legítimo desde SENCE, ya protegido por el nonce de sesión, H-2).
- CSP (`form-action`) incluye `sistemas.sence.cl` para no bloquear el auto-submit
  de asistencia. No requiere re-certificación rcetest (no cambia la petición a SENCE).

## 2026-07-15 — Pre-flight masivo de acción + alerta día-1 (tarea 2.7, HU-5.8)

Sin cambio de contrato: compone los validadores YA congelados. Ataca en origen
los errores 207/208 (RUN mal digitado) y la peor sorpresa operativa (nadie
registró asistencia el día 1).

- **Sub-validadores de `preflight.ts` exportados sin cambio de comportamiento**
  (`validateRunField` — antes `validateRun` privado —, `validateSenceCourseCode`,
  `validateActionCode`): una sola fuente de reglas para el pre-flight
  por-registro (I-8) y el masivo.
- **`domain/action-preflight.ts`**: checklist de 8 ítems (token/RUT del OTEC,
  CodSence, CodigoCurso, ambiente, fechas, RUNs del roster, guía CU) con
  estados ok/warning/error. Normaliza ANTES de validar (como el import CSV).
  RUN inválido en exento = warning (no viaja a SENCE, I-14). **Límite honesto
  documentado:** 207/208 por nómina SENCE no son verificables localmente.
- **El token nunca entra al dominio** (I-6/I-7): `preflight-service.ts` lo
  descifra UNA vez, deriva `tokenOk` (¿descifrable tras rotación de clave?
  ¿largo normativo?) y lo descarta. Como el motor, el servicio recibe un
  `TenantGuard` ya autorizado por la capa app (I-16).
- **Guía Clave Única**: el envío vive en `comunicacion/guide-service.ts` (este
  módulo NO importa de otros, I-16) y deja marca en `audit_log`
  (`sence.guide_sent` / `sence.guide_marked_sent`); el checklist solo la LEE.
- **Alerta día-1** (`domain/day1.ts` + `runDay1Check` en el tick del worker):
  acciones que parten HOY (America/Santiago) evaluadas desde la hora de corte;
  ratio de inscritos no exentos con sesión `iniciada|cerrada` hoy < umbral →
  fila en `alerts` (`sence_day1_low_attendance`, cooldown 24 h por acción).
  Knobs `SENCE_DAY1_*` (D-020). Join embebido a `enrollments` (jamás `.in()`
  con listas de ids — lección del PR #32).
- UI: `/admin/acciones/[id]/preflight` (checklist, tabla de RUN inválidos,
  guía, día-1) + enlace por fila en `/admin/acciones`.

**Revisión adversarial (4 ojos, panel multi-agente con refutación cruzada) —
6 hallazgos confirmados, 4 refutados; correcciones aplicadas:**
- **R-1 (medium):** el checklist validaba el RUN NORMALIZADO pero el motor
  valida el ALMACENADO crudo → un RUN sin normalizar en BD daba "falso verde"
  y bloqueaba al alumno en cada intento. Fijo: el checklist valida EXACTAMENTE
  lo que el motor consumirá (crudo), espejo fiel del pre-flight I-8.
- **R-2 (low):** una acción TERMINADA (`ends_on` < hoy) caía en el warning
  "ya comenzó". Fijo: rama `datesEnded` con error y texto honesto (309).
- **R-3 (low):** la auditoría de la guía era best-effort silenciosa. Fijo: la
  marca manual FALLA si no se puede auditar (`audit_failed`); el envío real
  reporta `audited:false` y la UI lo dice (evita re-envíos duplicados).
- **R-4 (low):** el índice `listUsers` (precedente del import 1.3) trunca en
  10.000 usuarios en silencio → warning explícito; follow-up: profiles/RLS.
- **R-5 (medium):** la query de sesiones del día-1 usaba `.limit(10_000)` que
  PostgREST capa en 1000 EN SILENCIO → subconteo y falsa alerta justo en las
  cohortes grandes (misma clase que R-1 del PR #31 — reincidencia cazada).
  Fijo: paginación con orden estable + warning al tope.
- **R-6 (low):** la ventana de 24 h perdía sesiones de la madrugada en el día
  de 25 h del cambio de hora chileno → ventana de 26 h (el filtro fino por día
  local ya lo hace `localIsoDate`).

Refutados (documentados en el journal del panel): subconteo por expiración
previa del mismo tick (T4 no implica asistencia) · "falso rojo" de línea 1 con
cod_sence (by-design: higiene de datos pineada por test) · phishing por host
header (Server Action autenticada + ingress de Traefik acotan el vector; el
href además va escapado) · día-1 sin ambiente (la página ya muestra el ítem de
ambiente encima de la tarjeta día-1).

---

## 2026-07-15 — Worker de expiración T4/T6/T9 + alertas de tasa de error (tarea 2.6, Hito 2)

Cierra el pendiente anotado el 2026-07-15 ("worker de expiración") y el gap
crítico del índice único parcial: una sesión `iniciada_pendiente` abandonada en
Clave Única (SENCE no envía callback) bloqueaba para siempre nuevos inicios del
enrollment. Sin cambio de contrato: el worker solo ORQUESTA la función pura ya
congelada `expireSession` (T4/T6/T9, §3).

- **Tick idempotente `runExpiryTick`** (`expiry.ts`, sin `server-only`: lo
  ejecuta el proceso worker): barre candidatas T4 (índice parcial nuevo por
  `created_at`) y T6/T9 (`sence_sessions_expiry_idx`), decide con
  `expireSession` y persiste con **compare-and-set ESTRECHO solo-`status`**.
  Deliberadamente NO reusa `persistState`: reescribir todas las columnas podía
  pisar `error_codes` refrescados por un `close_error` concurrente (§6). Un
  callback tardío no revive una expirada (I-15) y queda `late=true` (verificado
  en integración, incl. doble tick concurrente).
- **Expiraciones se registran en `audit_log`** (`sence.session_expired`, actor
  NULL = sistema), NO como kind nuevo de `sence_events`: I-4 clasifica callbacks
  RECIBIDOS y la expiración es una decisión local ([D-015](../../specs/DECISIONES.md)).
- **Knobs I-13/D-003 cableados** (`domain/timing.ts`): `SENCE_SESSION_MAX_HOURS`
  ahora llega al motor (`EngineDeps.sessionMaxMs`; antes hardcode) y
  `SENCE_PENDING_TIMEOUT_MINUTES` al worker. Defaults del contrato si faltan o
  son inválidas.
- **Alerta de tasa de error por tenant** (`runErrorRateCheck` + dominio puro
  `domain/alerts.ts`): ventana/umbral/mínimo configurables, cooldown, fila en la
  tabla nueva `alerts` + log estructurado ([D-017](../../specs/DECISIONES.md)).
  Los eventos `unmatched` (tenant NULL) quedan fuera del cálculo v1.
- **Proceso worker** (`src/worker/index.ts`, BullMQ + Redis, plan §5.6): job
  repetible cada 5 min; 2ª app en Coolify con la misma imagen
  ([D-016](../../specs/DECISIONES.md)). `rowToState` se movió al dominio
  (compartido motor/worker), sin cambio de comportamiento.
- El guardarraíl `service-role-isolation.test.ts` reconoce `src/worker/index.ts`
  como la 2ª excepción sancionada por CLAUDE.md ("service-role SOLO en worker y
  callbacks SENCE") — revisar en el 4-ojos.

**Revisión adversarial (4 ojos, panel multi-agente con refutación cruzada) —
11 hallazgos confirmados (5 únicos), 3 refutados; correcciones aplicadas:**
- **R-1 (medium):** la tasa de error leía la ventana SIN paginar → PostgREST
  truncaba en `max_rows=1000` en silencio y la tasa se calculaba sobre una
  muestra arbitraria justo bajo carga. Fijo: paginación con orden estable +
  warning al tope.
- **R-2 (low):** la tasa mezclaba callbacks de `rcetest` y `rce` (I-11 sanciona
  ambos ambientes conviviendo) → el tráfico de prueba disparaba alertas
  "reales". Fijo: agregación y cooldown por tenant×ambiente (join a la sesión),
  ambiente en mensaje y `details`.
- **R-3 (low):** `SENCE_TICK_EVERY_MS` era el único knob sin defensa; un
  negativo llegaba crudo a BullMQ (que no valida `every`) y rompía el
  scheduling en silencio. Fijo: entra a `senceTimingFromEnv`.
- **R-4 (medium):** la excepción del guardarraíl service-role usaba `endsWith`
  → cualquier `src/**/worker/index.ts` futuro quedaba exento (reproducido por
  el refutador). Fijo: ruta absoluta exacta.
- **R-5 (low):** si el CAS commiteaba y la auditoría fallaba, el summary
  reportaba `failed` (la expiración SÍ ocurrió) y un fallo sistemático de
  audit_log cortaba el barrido como "sin progreso". Fijo: outcome
  `expired_unaudited` (cuenta como expirada + progreso, contador propio).
- **R-6 (low):** jobs BullMQ sin `removeOnComplete/removeOnFail` (288/día para
  siempre en un Redis noeviction) → poda configurada. Y CI ahora construye y
  smoke-testea el bundle del worker (antes la primera detección era el deploy).

Pendiente (Hito 2): alerta de spike de `unmatched` · canal de correo de alertas
(llega con el EmailSender de este hito) · alerta día-1 (tarea 2.7, mismo tick).

---

## 2026-07-15 — Cableado del motor (tarea 0.7) + endurecimiento por revisión adversarial

Implementación del motor sobre el contrato congelado: cifrado AES-256-GCM del
token (I-6/I-7), servicio `startSession`/`handleCallback`/`buildCloseForm` con
`tenantGuard`, rutas `/api/sence/start|cb/{nonce}|close` (Zod en el borde),
tablas `sence_otec_config` (token cifrado por tenant) y subconjunto académico
mínimo (`courses`/`actions`/`enrollments`). Suite de integración con BD contra el
mock cubre el gate F0 (apertura, error mono/multi, cierre, replay, exento,
abandono de Clave Única, aislamiento, token nunca persistido).

**Revisión adversarial (4 ojos, agente distinto) — correcciones aplicadas:**
- **C-1 (crítico):** `dedupe_hash` pasa a índice NO-único; se persiste todo
  callback (I-1) y se chequea el error de insert (ver [D-012](../../specs/DECISIONES.md)).
- **H-1 (alto):** `/api/sence/close` ahora verifica que la sesión pertenece al
  alumno (antes filtraba el token del OTEC a cualquier usuario del tenant).
- **H-2 (alto):** nonce por sesión en la URL de callback contra falsificación
  cross-sesión ([D-013](../../specs/DECISIONES.md)).
- **H-3 (alto):** compare-and-set en la transición (evita que una carrera pise
  una transición legítima).
- **M-1:** `expires_at` anclado a la hora de recepción ([D-014](../../specs/DECISIONES.md)).
- **M-2:** `Cache-Control: no-store` en las respuestas con el token.
- **M-3/M-4:** logging de callbacks de error y gate anti-basura en el receptor.

Pendiente (Hito 1/3): worker de expiración (T4/T6/T9), alerting completo (I-9),
rate-limiting del callback público. Sigue faltando la certificación en `rcetest`
con token real (tarea 0.9, con Edu).

---

## 2026-07-14 — Contrato del motor congelado contra manual oficial *Integración Registro Asistencia SENCE* v1.1.6

El contrato del motor SENCE queda **congelado contra el manual oficial
"Integración Registro Asistencia SENCE" v1.1.6**, versión publicada como vigente
en el hub oficial de SENCE. No se congeló contra v1.1.5, que era lo planificado
(ver [D-001 en DECISIONES.md](../../specs/DECISIONES.md)).

Puntos clave del congelamiento (detalle completo en el
[DIFF](./DIFF-SPEC-v1.1.3-a-manual-v1.1.6.md)):

- `UrlRetoma` / `UrlError`: largo máximo **100 caracteres** (v1.1.3 permitía 200).
- Líneas de capacitación vigentes: `1 = Programas Sociales`,
  `3 = Franquicia Tributaria` y **`6 = FPT` (nueva)**. `CodigoCurso` mantiene el
  mínimo de 7 caracteres **excepto** para cursos FPT.
- Tabla de errores (Anexo 2): se agregan **311, 312 y 313** (Clave Única y URL de
  cierre de sesión); los códigos **100 y 210 desaparecen** de los manuales
  vigentes — se mantienen en `errors.ts` marcados `deprecated`
  (ver [D-005](../../specs/DECISIONES.md)).
- Autenticación del alumno con **Clave Única**: si el alumno no completa el
  login, SENCE **no envía callback alguno** (ni de éxito ni de error) — el motor
  debe expirar localmente las sesiones "en tránsito".
- `GlosaError`: el manual lo tipifica **Entero** (singular), pero el motor lo
  parsea defensivamente como **lista separada por `;`**
  (ver [D-002](../../specs/DECISIONES.md)).
- La regla "sesión máx. 3 h / inactividad 60 min" **no proviene de este manual**:
  se implementa como parámetro operativo configurable
  (ver [D-003](../../specs/DECISIONES.md)).

### Manuales oficiales de referencia (SHA256)

PDFs oficiales guardados en `docs/sence/manuales/` junto a su archivo
`SHA256SUMS`, con hashes verificados contra esta tabla (ver
[D-004](../../specs/DECISIONES.md)). Commiteados al repositorio por el flujo normal (rama + PR con CI):

| SHA256 | Archivo |
| --- | --- |
| `1d8a415559fda281c0ab4c7cfbe67e79021c504ceb7ce9c806bc7c63307692d4` | `guia_de_uso_gca_e-learning_otec_v1.3_0.pdf` |
| `7724337078c18e7598043c204cc3cf65114c92ef135aad64c28d4f125b12fe0d` | `instructivo_tecnico_de_integracion_entre_lms_y_sic_v2.0_0.pdf` |
| `2b9284afa33bea0252744c6bf41040aaf490504dc97d5847fcb4aa65cd3dc04f` | `integracion_registro_asistencia_sence_v1.1.3.pdf` |
| `bcc174a5a980fea65119633e132fcb2d1ce16e16932a1ca9d746125b2033121f` | `integracion_registro_asistencia_sence_v1.1.5_0.pdf` |
| `e9435a9e9b95985b81e5ecc9696e42a1c7d7521c838b2217999f05636f8eac4c` | `integracion_registro_asistencia_sence_v1.1.6.pdf` |

### Referencias

- Diff normativo v1.1.3 → v1.1.6:
  [`DIFF-SPEC-v1.1.3-a-manual-v1.1.6.md`](./DIFF-SPEC-v1.1.3-a-manual-v1.1.6.md)
- Especificación de integración actualizada:
  [`SPEC_INTEGRACION_SENCE.md`](./SPEC_INTEGRACION_SENCE.md)
- Contrato del motor:
  [`src/modules/sence/README.md`](../../src/modules/sence/README.md)
- Registro de decisiones: [`specs/DECISIONES.md`](../../specs/DECISIONES.md)
