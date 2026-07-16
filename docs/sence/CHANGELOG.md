# Changelog — módulo SENCE (`src/modules/sence/`)

Registro de cambios del contrato de integración con el Registro Centralizado
E-learning (RCE) de SENCE. Regla del proyecto (ver `CLAUDE.md`): todo cambio que
toque `src/modules/sence/` se anota aquí, y cualquier cambio al contrato SENCE
exige diff contra el manual oficial + checklist en `rcetest` antes del release.

---

## 2026-07-16 — Rulings H4 (D-048), parte II — robustez/UX (Q-04, Q-07, Q-02)

**Enmienda del contrato (E-4, E-5, E-6; manual sigue v1.1.6).** Implementa tres
rulings de `REVISION-ADVERSARIAL-H4.md` decididos por Edu ([D-048](../../specs/DECISIONES.md)).

- **Q-04 (E-6) — re-emisión de la sesión pendiente:** `startSession`, ante el 23505 del índice
  único, si la sesión viva es `iniciada_pendiente` RE-EMITE su MISMO form (mismo `IdSesionAlumno`
  + nonce) en vez de bloquear/`already_open` → el alumno reintenta Clave Única al instante y ya no
  queda "brickeado" hasta el worker. `SENCE_PENDING_TIMEOUT_MINUTES` por defecto 60 → **15 min**.
  Una sesión ACTIVA (`iniciada`) sigue devolviendo `already_open` (redirect al curso).
- **Q-07 (E-5) — mensaje accionable al alumno:** `resolveGlosaError` — con `GlosaError` multi-código,
  el `studentMessage` prefiere un código `StudentRecoverable` (311/312) si aparece; el
  `dominantCode`/`severity` del alerting siguen mandados por el más severo.
- **Q-02 (E-4) — contador del gate M-4:** `handleCallback` registra cada descarte por M-4 (sin PII:
  razón + largo) para detectar patrones anómalos (monitor de logs + rate-limit del edge, Q-03; el
  descarte NO persiste fila, así que no alimenta la alerta de spike de `unmatched`).
- Tests: integración de re-emit vs `already_open` (Q-04), `errors.test.ts` (Q-07 accionable vs
  dominante), `timing.test.ts` (default 15 min). Suites de estados/expiry actualizadas al re-emit.

## 2026-07-16 — Rulings H4 (D-048), parte I — máquina de estados de cierre (Q-01, Q-05)

**Enmienda del contrato (E-1, E-2, E-3; manual sigue v1.1.6).** Implementa dos
rulings de `REVISION-ADVERSARIAL-H4.md` decididos por Edu ([D-048](../../specs/DECISIONES.md)),
que refinan la INTERPRETACIÓN del cierre sin cambiar lo que el motor envía a SENCE.

- **Q-01 — cierre sobre `iniciada` sin puerta temporal (E-1):** en `domain/session.ts`,
  `isPastCloseDeadline` deja de gatear el estado `iniciada` (T5/T7); solo gatea T8
  (`error(close)`). Un `close_ok`/`close_error` que llega tras `expires_at` pero antes de
  que el worker corra T6 **aplica su transición** en vez de quedar `late` → se acaban los
  falsos `expirada` en cierres cerca del límite de 3 h. La carrera con el worker la resuelve
  el CAS.
- **Q-05 — T8 alcanzable (E-2):** `buildCloseForm` (motor) acepta una sesión en `error(close)`
  con `IdSesionSence` (antes exigía `iniciada`), y el candado (`domain/attendance-lock.ts`)
  ofrece **reintentar el cierre** para `error(close)` (antes: re-registrar). Así una sesión con
  cierre fallido no queda colgada ante SENCE. El alumno puede además reiniciar (el índice único
  no cuenta `error(close)`); ambas vías coexisten. Requiere leer `error_origin` en la vista del
  curso. ⚠ Verificar con SENCE la tolerancia a doble sesión simultánea de la misma acción/alumno.
- Tests: `session.test.ts` (T5/T7 sin puerta, T8 gated antes/después de `expires_at`),
  `attendance-lock.test.ts` (error(close)→cerrar, error(start)→registrar), integración
  (`buildCloseForm` sobre `error(close)`).

## 2026-07-16 — Fixes CONFIRMED de la revisión adversarial H4 (tarea 4.1b)

**Sin cambio de contrato SENCE.** Aplica los 6 hallazgos CONFIRMED seguros del
informe [`REVISION-ADVERSARIAL-H4.md`](REVISION-ADVERSARIAL-H4.md) (implementan el
contrato o refuerzan la defensa en profundidad; ninguno cambia una transición
T1–T9 ni el README congelado). Decisión de registro: `D-047`.

- **H4-R-002 (HIGH):** `callback_nonce` (secreto anti-falsificación H-2) era legible
  por cualquier cuenta de staff del tenant vía PostgREST (grant de tabla sin revoke
  de columna — mismo patrón que `token_encrypted` #22) → un insider podía forjar
  callbacks y alterar la asistencia de OTRO alumno. Migración
  `20260716120000_sence_sessions_hide_callback_nonce.sql`: revoca el grant de tabla
  y re-otorga SELECT solo en las columnas no sensibles. El motor lee el nonce vía
  service-role. + test RLS que afirma que el cliente no puede leerlo.
- **H4-R-001:** `pickField` (en `domain/protocol.ts`) tolera nombres de campo con
  espacio colgante (`"IdSesionAlumno "`, errata del manual §1.2/Anexo 3) en la
  correlación/clasificación de `handleCallback`; el payload CRUDO se persiste
  intacto (I-1). + tests de integración de los 4 tipos de callback con claves
  espaciadas (cumple la promesa de `SPEC_INTEGRACION_SENCE §5.2`).
- **H4-R-005:** el receptor de callbacks usa `buildCallbackDeps` (solo
  `now`+`sessionMaxMs`), NUNCA parsea la clave de cifrado — una
  `SENCE_TOKEN_ENCRYPTION_KEY` ausente/rota ya no tumba el callback con 500 ni pierde
  la asistencia (I-1). `handleCallback` acepta el tipo estrecho `CallbackDeps`.
- **H4-R-007:** el error del SELECT de correlación se registra (sin PII ni token) y
  se reintenta una vez, en vez de degradar a `unmatched` en silencio.
- **H4-R-015:** `resolvePublicOrigin` fail-closed — si el host reenviado no valida,
  ancla al origin CANÓNICO de config (`APP_BASE_URL`/https del dominio raíz), nunca
  refleja `request.url` (que sale http tras el proxy y es influenciable por el cliente).
- **H4-R-016:** un segundo `start` sobre la misma inscripción (doble-click, o la de
  3 h vencida que el worker aún no barrió) devuelve un resultado tipado
  `already_open` → la ruta redirige 303 a `/mi-curso`, en vez de un 500 crudo (I-9).

Los rulings (T8, restart de la pendiente, gate M-4, etc.) y los follow-ups quedan en
el informe para decisión de Edu.

## 2026-07-16 — Revisión adversarial pre-piloto del módulo (tarea 4.1b)

**Sin cambio de contrato SENCE.** Auditoría multi-agente (26 agentes: 6 lentes →
consolidación → refutación) de todo `src/modules/sence/` contra el contrato
congelado v1.1.6, como gate del Hito 4 antes del piloto real. Informe completo:
`docs/sence/REVISION-ADVERSARIAL-H4.md`; decisión de registro: `D-047`.

- **19 hallazgos** (16 CONFIRMED, 2 PLAUSIBLE, 1 REFUTED) + **10 rulings** para Edu.
- **1 HIGH de seguridad:** el `callback_nonce` era legible por staff del tenant
  (grant de tabla sin revoke de columna, el mismo patrón del bug de `token_encrypted`
  #22) → un insider podía falsificar callbacks y alterar la asistencia de otro alumno.
- Se corrige en el PR de fixes H4 (ver la próxima entrada). Los hallazgos que tocan
  el flujo SENCE (T8 inalcanzable, restart de la pendiente, atomicidad) quedan como
  **rulings** que Edu decide antes de tocar código. Follow-ups y candidatos verificados
  (INSERT-only, aislamiento de tenant/service-role, endurecimiento 3.11) en el informe.

## 2026-07-16 — Rate-limit + chequeo de origen en las rutas RCE (tarea 3.6, hardening)

**Sin cambio de contrato SENCE.** Endurecimiento de los route handlers propios;
no toca el protocolo, campos, endpoints ni la máquina de estados del motor.

- **`/api/sence/start` y `/api/sence/close`**: `assertSameOrigin` (rechaza un POST
  cross-site; el botón del curso es mismo-origen) + rate-limit **por USUARIO**
  (10/min). **Fail-open** sin Redis → idéntico al previo sin `REDIS_URL`. NO se
  limita por IP: una cohorte tras NAT compartido (empresa/laboratorio) colapsaría
  en una IP y bloquearía alumnos reales (4-ojos H1).
- **`/api/sence/cb/[nonce]`**: SIN rate-limit y EXENTO de `assertSameOrigin` (POST
  cross-origin legítimo de SENCE, protegido por el nonce, H-2). I-1 exige
  PERSISTIR SIEMPRE → no se limita antes de `handleCallback` para no perder la
  marca de asistencia. El anti-DoS del callback va en el edge/proxy.
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
