# DECISIONES.md — Registro de decisiones del proyecto (ADR-lite)

**Qué es este archivo:** registro liviano de decisiones de arquitectura y de
protocolo del proyecto Chilearning, en formato ADR-lite. Captura decisiones que no
ameritan un ADR formal en `specs/02-plan-tecnico.md` §12, pero que deben quedar
documentadas y ser auditables (especialmente las relativas a la integración
SENCE). Las decisiones son inmutables: si una decisión cambia, se agrega una
entrada nueva que la supersede y se anota la referencia cruzada — no se edita la
entrada original.

**Formato por entrada:**

- **ID:** correlativo `D-NNN`.
- **Fecha:** fecha de la decisión (AAAA-MM-DD).
- **Decisión:** qué se decidió, en una o dos frases accionables.
- **Por qué:** evidencia y razonamiento que la sustentan.
- **Alternativas descartadas:** qué otras opciones se evaluaron y por qué se
  rechazaron.

---

## D-001 — Congelar el contrato del motor contra el manual v1.1.6 (no v1.1.5)

- **ID:** D-001
- **Fecha:** 2026-07-14
- **Decisión:** el contrato del motor SENCE se congela contra el manual oficial
  *Integración Registro Asistencia SENCE* **v1.1.6**, y no contra v1.1.5 como
  estaba planificado.
- **Por qué:** el hub oficial de SENCE publica **v1.1.6 como la versión
  vigente**. Congelar contra v1.1.5 habría significado congelar contra un manual
  ya reemplazado. El diff v1.1.5 → v1.1.6 es acotado: redacción en glosas 304,
  305, 306 y 309, más la formalización de la línea **`6 = FPT`** en los valores
  de `LineaCapacitacion` (v1.1.5 solo listaba `3 = Impulsa Personas` en sus
  tablas de parámetros; v1.1.6 lista `1 = Programas Sociales / 3 = Franquicia
  Tributaria / 6 = FPT`, renombrando la línea 3) y la excepción **"excepto
  cursos FPT"** al mínimo de 7 caracteres de `CodigoCurso` (ausente en v1.1.5).
  **Sin códigos de error nuevos** (311, 312 y 313 ya existen en v1.1.5) ni
  cambios en la tabla de errores más allá de la redacción. Por eso el costo de
  adoptar v1.1.6 fue marginal y el beneficio es cumplir la regla del proyecto
  de validar contra el manual vigente.
- **Alternativas descartadas:**
  - *Congelar contra v1.1.5 (plan original):* descartada — dejaría el contrato
    referenciando un documento no vigente, debilitando la defensa ante
    fiscalización.
  - *Esperar una eventual v1.1.7:* descartada — no hay anuncio de nueva versión
    y bloquear el hito por un documento hipotético viola el principio de
    avanzar contra lo publicado (con auditabilidad vía D-004).

## D-002 — `GlosaError` se parsea como lista separada por `;`

- **ID:** D-002
- **Fecha:** 2026-07-14
- **Decisión:** el motor parsea `GlosaError` como **texto** y hace split por
  `;`, traduciendo cada código con la tabla de `src/modules/sence/errors.ts`,
  aunque el manual v1.1.6 lo tipifica **Entero** y en singular ("Identificador
  del error").
- **Por qué:** evidencia del plugin `block_sence` en producción: el callback de
  error puede traer varios códigos en un solo `GlosaError` separados por punto y
  coma (ejemplo documentado: `211;204`). El manual no menciona el separador `;`
  en ninguna de sus versiones, así que el comportamiento es extra-manual;
  parsear como lista es **parsing defensivo** — el caso de un solo código es un
  subconjunto trivial, de modo que la decisión no contradice lo que el motor
  promete ni envía (regla de precedencia: el manual manda para lo que se envía;
  el comportamiento observado manda para el parsing defensivo de lo recibido).
- **Alternativas descartadas:**
  - *Parsear como entero estricto según el manual:* descartada — rompería en
    producción ante callbacks multi-código reales ya observados.
  - *Rechazar/loggear como error los callbacks con `;`:* descartada — castigaría
    al alumno por un quirk del emisor SENCE y perdería información de
    diagnóstico.

## D-003 — Regla de 3 h de sesión / 60 min de inactividad como parámetro operativo

- **ID:** D-003
- **Fecha:** 2026-07-14
- **Decisión:** la regla "sesión SENCE dura máx. 3 horas / inactividad de app
  60 minutos" se implementa como **parámetro operativo configurable** (no como
  constante normativa del protocolo), con los valores 3 h / 60 min como default.
  La pregunta por su fuente normativa se añade al correo de la tarea 0.10
  dirigido a `controlelearning@sence.cl`.
- **Por qué:** la regla **no tiene fuente en el manual RCE**: v1.1.6 no fija
  duración de sesión ni tiempo de inactividad en ninguna parte (solo recomienda
  cronómetro en pantalla y alerta a 10 minutos del término, sin cuantificar el
  tiempo del curso). El límite de 3 h proviene del comportamiento heredado del
  plugin `block_sence`, donde vive en `engine.php` (comentario "Tiempo de
  Sesión (3 Horas)", `$tiempoSesion = 3600 * 3`) y en
  `classes/hook_callbacks.php` (`const TIEMPO_SESION = 10800`); `js/timer.js`
  es solo un contador ascendente de UI, sin límite alguno. Ante una regla sin
  respaldo documental, lo
  correcto es hacerla configurable y pedir la fuente al organismo, no
  hardcodearla como si fuera norma.
- **Alternativas descartadas:**
  - *Hardcodear 3 h / 60 min como regla del protocolo:* descartada — atribuiría
    al manual algo que no dice; si SENCE informa otro valor habría que tocar
    código en vez de configuración.
  - *Eliminar el límite hasta tener la fuente:* descartada — el plugin en
    producción lo aplica hace años y quitarlo podría generar sesiones abiertas
    indefinidas ante callbacks que nunca llegan (login de Clave Única no
    completado no genera callback en v1.1.6).

## D-004 — Commitear los PDFs oficiales en `docs/sence/manuales/` con SHA256SUMS

- **ID:** D-004
- **Fecha:** 2026-07-14
- **Decisión:** los PDFs oficiales de SENCE (manuales RCE v1.1.3, v1.1.5 y
  v1.1.6, guía GCA e instructivo LMS-SIC) se commitean en
  `docs/sence/manuales/` acompañados de un archivo `SHA256SUMS` con el hash de
  cada documento.
- **Estado (2026-07-14):** los 5 PDFs y el `SHA256SUMS` ya están copiados en
  `docs/sence/manuales/` con sus hashes verificados contra la tabla del
  [CHANGELOG](./CHANGELOG.md); el **commit está pendiente** y debe hacerse por
  el flujo normal del repo (rama + CI verde), junto con el resto de `docs/`.
- **Por qué:** **auditabilidad ante fiscalización** — el contrato del motor cita
  versiones y páginas concretas de los manuales, y SENCE **republica documentos
  silenciosamente** en las mismas URLs (sin changelog público). Con los PDFs
  versionados y sus hashes, siempre se puede demostrar contra qué documento
  exacto se congeló el contrato, y detectar una republicación comparando el hash
  del PDF descargado contra el registrado.
- **Alternativas descartadas:**
  - *Guardar solo los enlaces a sence.gob.cl:* descartada — los enlaces no
    garantizan contenido estable (republicación silenciosa) y pueden romperse.
  - *Guardar solo las extracciones de texto (.txt):* descartada — el texto
    extraído pierde tablas y formato, y no sirve como evidencia del documento
    oficial; los .txt son artefactos de trabajo, el PDF es la fuente.

## D-005 — Mantener los códigos 100 y 210 en `errors.ts` como `deprecated`

- **ID:** D-005
- **Fecha:** 2026-07-14
- **Decisión:** los códigos de error **100** ("Contraseña incorrecta o el
  usuario no tiene Clave SENCE.") y **210** ("Expiró el tiempo disponible para
  el ingreso de RUT y Contraseña…"), eliminados de los manuales vigentes (desde
  v1.1.5), **se mantienen** en la tabla de `src/modules/sence/errors.ts`
  marcados como `deprecated`, con su glosa según v1.1.3 (última versión donde
  existen).
- **Por qué:** costo cero (dos entradas en una tabla) y cubre **emisores
  legacy**: si algún componente del lado SENCE aún emitiera esos códigos, el
  motor los traduciría a un mensaje comprensible en vez de caer al genérico
  "error desconocido". Coherente con D-002 (parsing defensivo de lo recibido):
  la tabla de errores es superficie de *recepción*, no de *emisión*, por lo que
  mantenerlos no contradice el contrato congelado contra v1.1.6.
- **Alternativas descartadas:**
  - *Retirarlos de la tabla por no existir en v1.1.6:* descartada — ganancia
    nula y pérdida de robustez ante emisores legacy; un código no mapeado
    terminaría mostrado como error genérico al alumno.
  - *Mantenerlos sin marca:* descartada — sin la marca `deprecated` un futuro
    diff contra el manual vigente los reportaría como discrepancia inexplicada.

---

## D-006 — `superadmin` jamás es una membership: vive solo en el claim del JWT

- **ID:** D-006
- **Fecha:** 2026-07-14
- **Decisión:** la tabla `memberships` **prohíbe por constraint** el rol
  `superadmin`, y un trigger impide que un `coordinator` otorgue `otec_admin`
  (solo un `otec_admin` o el superadmin de plataforma pueden hacerlo).
- **Por qué:** la revisión adversarial de la tarea 0.2 (agente distinto del
  implementador, regla de 4 ojos) encontró una **escalada de privilegios
  crítica**: las policies de `memberships` validaban el `tenant_id` pero no el
  CONTENIDO de la columna `roles`, así que un `coordinator` podía ejecutar
  `update memberships set roles = '{superadmin}'` sobre su propia fila; en el
  siguiente login el Auth Hook (tarea 0.4) habría inyectado ese rol en el JWT y
  `is_superadmin()` le habría abierto TODOS los tenants. La defensa vive en la
  capa de datos, no en el Hook: el Hook puede tener bugs, el constraint no.
- **Alternativas descartadas:**
  - *Filtrar el rol en el Auth Hook:* descartada — deja la BD en un estado
    inválido y la seguridad dependiendo de una sola capa (viola P2/P7).
  - *Resolver el techo de roles solo con RLS:* imposible — una policy no puede
    comparar el rol del actor contra el valor que está asignando; requiere
    trigger.

## D-007 — Las escrituras de plataforma (crear/editar tenants) van por el servidor

- **ID:** D-007
- **Fecha:** 2026-07-14
- **Decisión:** el rol `authenticated` solo tiene `select` sobre `tenants`. Crear,
  editar o suspender un tenant (HU-1.1, HU-1.4) se hace desde el servidor con el
  `service_role` a través de `tenantGuard()`, no por PostgREST desde el navegador.
- **Por qué:** reduce la superficie de escritura del cliente a lo estrictamente
  necesario (mínimo privilegio, P7). Las acciones de plataforma son pocas,
  auditadas y siempre pasan por código propio.
- **Alternativas descartadas:**
  - *Otorgar `insert/update/delete` sobre `tenants` a `authenticated` y confiar
    en la policy de superadmin:* descartada — un bug en la policy (o un claim
    `roles` mal emitido) se convertiría en escritura directa a la tabla raíz del
    multi-tenancy.

## D-008 — Los helpers de claims degradan a "deniega", nunca a "revienta"

- **ID:** D-008
- **Fecha:** 2026-07-14
- **Decisión:** `jwt_tenant_id()` valida el formato UUID del claim antes de
  castear y devuelve `NULL` si no calza; `jwt_roles()` devuelve `{}` si el claim
  `roles` no es un array.
- **Por qué:** con el cast directo, un claim malformado lanzaba `22P02` y
  abortaba TODA consulta que evaluara la policy (superficie de caída, no de
  fuga). Deny-by-default limpio (P7) es preferible a un error 500 en cascada.
- **Alternativas descartadas:**
  - *Confiar en que el Auth Hook siempre emite claims válidos:* descartada — la
    BD es la última línea de defensa y no debe asumir corrección aguas arriba.

---

## D-009 — Dominio raíz: `chilearning.cl` (Cloudflare)

- **ID:** D-009
- **Fecha:** 2026-07-14
- **Decisión:** el dominio raíz del producto es **`chilearning.cl`**, con DNS en
  Cloudflare. Cada OTEC vive en `{slug}.chilearning.cl`.
- **Por qué:** resuelve el riesgo **R6** del spec. Verificada la restricción
  crítica de SENCE (`UrlRetoma`/`UrlError` ≤ 100 caracteres): el peor caso
  `https://{slug-de-30}.chilearning.cl/api/sence/cb` = 66 caracteres, con 34 de
  holgura. El nombre es corto y soporta el comodín por tenant.
- **Alternativas descartadas:** dominios más largos (arriesgaban el límite de
  100 chars del callback SENCE) y dominios sin subdominio por tenant (rompían el
  modelo multi-tenant white-label).

## D-010 — Auth Hook con `SECURITY INVOKER`, no `DEFINER`

- **ID:** D-010
- **Fecha:** 2026-07-14
- **Decisión:** `custom_access_token_hook` se declara **`SECURITY INVOKER`**;
  lee `memberships`/`platform_admins` como el rol `supabase_auth_admin` que lo
  invoca, autorizado por GRANT + policies `_select_auth_admin`.
- **Por qué:** la revisión adversarial de la tarea 0.4 detectó que un hook
  `SECURITY DEFINER` (dueño `postgres`) sobre tablas con `force row level
  security` leería **0 filas en Supabase cloud** (donde `postgres` NO bypassa
  RLS), rompiendo el login en producción aunque funcione en local. INVOKER es el
  patrón oficial de Supabase y hace que los grants/policies sean significativos,
  no código muerto.
- **Alternativas descartadas:** *DEFINER + quitar `force RLS`* (reabriría el
  bypass-por-owner para toda función del dueño); *DEFINER + policy explícita al
  dueño* (más frágil y no documentado).

## D-011 — Config de Auth: dev abierto, producción cerrado

- **ID:** D-011
- **Fecha:** 2026-07-14
- **Decisión:** en producción/staging el `config.toml` de Supabase debe usar
  `enable_signup = false` (el alta la hace el OTEC por invitación),
  `enable_confirmations = true` y `minimum_password_length >= 8` + 2FA para roles
  administrativos (RNF-2). El config local (dev) queda abierto por comodidad.
- **Por qué:** un LMS B2B no permite auto-registro público; sin membership el
  RLS igual niega todo, pero el signup abierto habilita creación masiva de
  cuentas y enumeración de correos. Hallazgo LOW-5 de la revisión de 0.4.
- **Alternativas descartadas:** dejar el signup abierto en prod (riesgo de abuso).

---

## D-012 — El `dedupe_hash` de sence_events NO es único (persistir todo callback)

- **ID:** D-012
- **Fecha:** 2026-07-15
- **Decisión:** el índice `sence_events_dedupe_idx` es NO-único. Un callback
  repetido (replay) persiste un SEGUNDO evento; la idempotencia de la TRANSICIÓN
  la garantiza la máquina de estados (re-leer la fila → `applyCallback` no-op).
- **Por qué:** la revisión adversarial del motor (hallazgo C-1) mostró que un
  índice único DESCARTABA el 2º evento y —peor— el código tragaba cualquier
  error de insert, violando I-1 ("perder un callback es perder evidencia
  irrecuperable"). El contrato (I-1, I-3, §8 caso 5) exige DOS filas, UNA
  transición.
- **Alternativas descartadas:** índice único + ignorar el error de choque
  (descartada: pierde evidencia y enmascara errores reales de persistencia).

## D-013 — Nonce por sesión en la URL de callback (anti-falsificación)

- **ID:** D-013
- **Fecha:** 2026-07-15
- **Decisión:** cada sesión SENCE genera un `callback_nonce` corto que viaja en
  `UrlRetoma`/`UrlError` (`/api/sence/cb/{nonce}`). El callback solo transiciona
  la sesión si el nonce coincide; si no, se persiste como `unmatched` sin
  transicionar.
- **Por qué:** hallazgo H-2. Sin el nonce, cualquiera que conozca el
  `IdSesionAlumno` de una víctima (viaja por su navegador) podía forjar un
  callback y forzar el cierre o error de su sesión (falsificación cross-sesión).
  El nonce solo lo conoce el navegador de la sesión legítima. La auto-
  falsificación (el propio alumno) es inherente al protocolo browser-mediated y
  queda documentada como límite (§7); no se deriva "asistencia" solo del estado
  puesto por el callback sin corroboración.
- **Alternativas descartadas:** HMAC del cuerpo (SENCE no firma sus callbacks);
  confiar solo en `IdSesionAlumno` (descartada: adivinable/expuesto por el
  navegador).

## D-014 — `expires_at` se ancla a la hora de RECEPCIÓN, no a la FechaHora de SENCE

- **ID:** D-014
- **Fecha:** 2026-07-15
- **Decisión:** la ventana de 3 h (`expires_at`) se calcula desde la hora de
  recepción del servidor (`now`), no desde la `FechaHora` del callback.
  `opened_at` guarda la `FechaHora` acotada a no ser futura.
- **Por qué:** hallazgo M-1. Anclar el deadline a un timestamp controlado por
  SENCE/el cliente permitía extenderlo con una `FechaHora` futura, y el parseo
  en la zona del servidor (UTC en el VPS vs hora de Chile) podía "nacer
  expirada" una sesión legítima. Anclar a la recepción hace el deadline inmune a
  manipulación y a desfases de zona horaria.
- **Alternativas descartadas:** `expires_at = FechaHora + 3h` literal
  (descartada por lo anterior; se preserva `opened_at` para el registro).

## D-015 — Las expiraciones del worker van a `audit_log`, no a `sence_events`

- **ID:** D-015
- **Fecha:** 2026-07-15
- **Decisión:** el worker de expiración (task 2.6) registra T4/T6/T9 en
  `audit_log` (`action: sence.session_expired`, actor NULL = sistema, con
  transición/enrollment/ambiente en `details`). El enum `sence_event_kind` NO
  gana un kind nuevo.
- **Por qué:** los kinds de `sence_events` derivan del invariante I-4 =
  clasificación de callbacks RECIBIDOS de SENCE. Una expiración es una decisión
  100% local sin callback; meterla ahí contamina la tabla de evidencia y
  obligaría a inventar semántica de `dedupe_hash`/`payload` para algo que no es
  un POST. `audit_log` existe exactamente para esto (INSERT-only, P8).
- **Alternativas descartadas:** kind `expired` en `sence_events` (descartada:
  toca el contrato congelado §6/I-4 con costo de revisión alto y semántica
  forzada); no registrar nada (descartada: P8 — todo deja rastro).

## D-016 — Topología del worker: BullMQ + Redis, 2ª app Coolify con la misma imagen

- **ID:** D-016
- **Fecha:** 2026-07-15
- **Decisión:** el worker (plan §5.6) corre como proceso aparte del mismo repo:
  entry `src/worker/index.ts` (BullMQ, job repetible `sence-tick` cada 5 min),
  bundle único con esbuild (`pnpm build:worker` → `dist/worker/index.js`,
  incluido en la imagen Docker), desplegado en Coolify como segunda app con
  start command `node dist/worker/index.js` + servicio Redis. Decidido por Edu
  el 2026-07-15 (se ofreció la alternativa cron-HTTP; eligió fidelidad al plan).
  `ioredis` se fija a la versión exacta que pinnea bullmq (los tipos de
  `connection` chocan entre instancias distintas). El wiring BullMQ es fino:
  la lógica vive en `expiry.ts` y se testea sin Redis.
- **Por qué:** es la topología comprometida en el plan técnico (§2, §5.6, §7);
  deja lista la cola para los jobs reales del Hito 3/5 (certificados masivos,
  correos, imports). El worker construye su propio client service-role (no
  puede importar `tenant-guard`, que es `server-only`); el guardarraíl
  `service-role-isolation.test.ts` lo reconoce como 2ª excepción sancionada.
- **Alternativas descartadas:** route handler cron + secret (cero infra, pero
  desvía del plan; Edu la descartó); `setInterval` in-process (invisible,
  frágil con réplicas/redeploys).

## D-017 — Política de la alerta de tasa de error SENCE

- **ID:** D-017
- **Fecha:** 2026-07-15
- **Decisión:** por tenant, sobre los callbacks de una ventana móvil:
  ventana 60 min · umbral 20% (borde INCLUSIVO: `rate >= threshold`) · mínimo
  5 eventos · cooldown = ventana. Todo configurable por env
  (`SENCE_ALERT_*`), valores inválidos caen al default con warning. Canal v1:
  fila en `alerts` (la leen otec_admin/supervisor del tenant) + log
  estructurado en Coolify; el correo al operador se conecta cuando exista el
  EmailSender (mismo hito). Los eventos `unmatched` (tenant NULL) quedan FUERA
  del cálculo; un spike de unmatched merece alerta propia (follow-up).
- **Por qué:** P:136-137 exige "alertas si tasa de errores > umbral" sin
  cuantificar; estos defaults son conservadores (5 eventos evita alertar por 1
  error aislado) y el cooldown evita spam con tick de 5 min. Pendiente de
  ratificación fina por Edu con datos reales del piloto.
- **Alternativas descartadas:** alerta global de plataforma (v1 es por tenant;
  la global puede derivarse de las filas); umbral estricto `>` (con muestras
  chicas 1/5 = 20% exacto debe alertar).

## D-017b — Ajustes a la política de alerta tras la revisión adversarial del PR #31

- **ID:** D-017b (enmienda a D-017)
- **Fecha:** 2026-07-15
- **Decisión:** (1) la tasa se agrega y alerta por **tenant×ambiente** (join a
  `sence_sessions.environment`): rcetest y rce no se mezclan ni se silencian
  mutuamente (cooldown por grupo); el ambiente va en `alerts.details` y en el
  mensaje. (2) La lectura de la ventana se **pagina** (1000/página, tope 20
  páginas con warning): PostgREST trunca en `max_rows` en silencio y la tasa se
  calculaba sobre una muestra arbitraria bajo carga.
- **Por qué:** hallazgos R-1/R-2 de la revisión adversarial (panel multi-agente
  con refutación cruzada). I-11 sanciona ambientes conviviendo por tenant; el
  checklist obligatorio en rcetest fabrica errores a propósito.
- **Alternativas descartadas:** excluir rcetest del cálculo (descartada: deja
  ciega la operación durante certificación/pruebas, que es cuando más se mira);
  RPC SQL con GROUP BY (válida, se difiere: la paginación basta al volumen
  actual y no agrega superficie SQL).

## D-019 — Correo transaccional: Resend por REST, sin SDK, con no-op fallback

- **ID:** D-019
- **Fecha:** 2026-07-15
- **Decisión:** el proveedor de correo es **Resend** (decidido por Edu
  2026-07-15). La integración es un `EmailSender` propio
  (`src/modules/comunicacion/email-sender.ts`) que llama la REST API con
  `fetch` — sin SDK: una dependencia menos. Sin `RESEND_API_KEY`, degrada a un
  sender no-op (`not_configured`): ningún flujo se bloquea por falta de
  proveedor. Los servicios reciben el sender INYECTADO (tests con fake; la API
  real jamás se llama en CI). En logs solo direcciones enmascaradas
  (`maskEmail`, Ley 21.719). Envíos masivos futuros → cola BullMQ (follow-up).
- **Por qué:** cierra el follow-up de 1.6 y habilita 2.2 (notificación de
  corrección), 2.7 (guía Clave Única) y 2.6 (alertas al operador). La API de
  Resend es un POST simple; el SDK no aporta nada que justifique la dependencia.
- **Alternativas descartadas:** SDK oficial `resend` (innecesario); SMTP
  genérico con nodemailer (más config y otra dependencia; Resend da API key +
  dominio verificado en minutos); esperar al Hito 3 (descartado por Edu:
  quiere envío real ya).

## D-020 — Política de la alerta día-1 y envío de guía Clave Única (task 2.7)

- **ID:** D-020
- **Fecha:** 2026-07-15
- **Decisión:** (1) **Día-1**: para toda acción cuyo `starts_on` es HOY
  (America/Santiago), el worker evalúa desde las 13:00 locales el ratio de
  inscritos no exentos con sesión `iniciada|cerrada` ese día; si
  `ratio < 0.5` (borde exclusivo) inserta una alerta
  `sence_day1_low_attendance` con cooldown de 24 h por acción. Umbral y hora
  por env (`SENCE_DAY1_*`), defaults pendientes de ratificación fina de Edu
  con datos del piloto. (2) **Guía Clave Única**: el envío usa la plantilla de
  bienvenida (que ya trae la guía paso a paso) vía EmailSender a los inscritos
  NO exentos; queda marca auditada (`sence.guide_sent` con conteos). Sin
  proveedor: marca manual auditada (`sence.guide_marked_sent`). El checklist
  del pre-flight LEE la última marca desde `audit_log`.
- **Por qué:** HU-5.8 pide "alerta temprana el día 1 bajo el umbral" sin
  cuantificar. 13:00 da media jornada de margen (evita falsos positivos de la
  mañana); 50% es conservador. La marca en `audit_log` evita una tabla nueva y
  respeta el aislamiento del módulo SENCE (I-16): quien envía es
  `comunicacion`, quien lee es `sence`.
- **Alternativas descartadas:** evaluar a cualquier hora (falso positivo
  matinal garantizado); tabla propia de marcas de guía (audit_log ya es
  INSERT-only y auditable por diseño); plantilla de correo separada para la
  guía (la de bienvenida ya la contiene; duplicarla = divergencia).

## D-021 — Export de cumplimiento: columnas del plugin VERBATIM + ID SESION SENCE; definición de "huecos"

- **ID:** D-021
- **Fecha:** 2026-07-15
- **Decisión:** (1) el export Excel/CSV del panel (HU-5.5) replica las 7
  columnas del plugin Moodle original con sus rótulos y CONTENIDO históricos —
  incluido el quirk I-10: "CODIGO CURSO" = CodSence del curso e "ID SENCE" =
  código de la ACCIÓN — y AGREGA la columna "ID SESION SENCE" con el id real.
  Decidido por Edu (2026-07-15): compatibilidad de fiscalización + el dato que
  la HU pide. Fila = sesión con inicio confirmado (`opened_at` no nulo, incluye
  `iniciada` y `cerrada`), orden `opened_at` DESC, fechas d-m-Y H:i:s
  América/Santiago (todo como el plugin). (2) **"Huecos"** = días hábiles L–V
  dentro de [starts_on, min(ends_on, hoy)] sin ninguna sesión CERRADA del
  alumno; exentos sin huecos (I-14). Sin feriados chilenos en v1 (follow-up).
  (3) Librería: exceljs solo-escritura (ADR-008).
- **Por qué:** la HU dice "columnas del reporte del plugin actual (…
  IdSesionSence …)" pero el plugin JAMÁS exportó IdSesionSence — su columna
  "ID SENCE" trae el código de acción. Mantener el formato conocido y sumar la
  columna extra satisface ambas lecturas sin romper la que usan los
  fiscalizadores hace años.
- **Alternativas descartadas:** replicar el plugin sin la columna extra
  (pierde el dato pedido); corregir los rótulos según la semántica real
  (rompe el formato que fiscalización reconoce).

## D-022 — Spec del módulo de evaluación (Hito 2: 2.1/2.2/2.3) — defaults S1–S13

- **ID:** D-022
- **Fecha:** 2026-07-15
- **Decisión:** los vacíos de HU-6.1/6.2/6.4 se cierran con estos defaults,
  aprobados por Edu junto con el plan del Hito 2 (P1 satisfecho):
  - **S1 Nota:** escala chilena lineal por tramos con exigencia configurable
    (`passing_pct`, default 60): si `p ≥ E·pmax` → `nota = 4 + 3·(p−E·pmax)/(pmax−E·pmax)`;
    si no → `nota = 1 + 3·p/(E·pmax)`. Redondeo a 1 decimal, clamp [1.0, 7.0].
  - **S2 Intentos:** cuenta la MEJOR (`attempt_scoring: best|last|average`,
    default best). `max_attempts` default 1; NULL = ilimitados.
  - **S3 Banco:** todas las preguntas del quiz; `pool_size` NULL = todas, N =
    submuestra aleatoria por intento. `shuffle_questions`/`shuffle_choices`
    default true. La selección/orden quedan CONGELADOS en el snapshot del intento.
  - **S4 Puntaje:** pareados proporcional (pares buenos / total × puntos);
    alternativas y V/F todo-o-nada. **S5:** alternativas v1 con UNA correcta.
  - **S6 Tiempo:** `expires_at = started_at + time_limit` (+60 s de gracia);
    vencido → finalización PEREZOSA server-side con lo autosalvado (sin cron).
  - **S7 Revisión:** `review_policy: never|after_submit|after_close` (default
    after_submit); la pauta jamás viaja al cliente antes de tiempo.
  - **S8 Rúbrica:** jsonb `{criteria:[{id,title,levels:[{id,label,points}]}]}`
    o nota directa 1.0–7.0. **S9 Fechas:** `due_at` + `grace_hours` (default 0);
    dentro de gracia = aceptada con `late=true`; después, rechazada; historial
    de entregas INSERT-only con `version` incremental.
  - **S10 Ponderación:** `weight` por instrumento (nivel curso); nota final de
    la acción = Σ(nota·peso)/Σ(peso) sobre instrumentos CON nota publicada;
    fila marcada "incompleta" mientras falten (decisión explícita de Edu:
    promedio parcial, NO castigar con 1.0 durante el curso).
  - **S11 Cambio de nota:** editar una nota `published` exige MOTIVO y escribe
    `audit_log` (`grade.updated {old,new,motivo}`); solo el relator (la publica
    él, matriz §3). **S12 Notificación:** outbox `notifications` + aviso in-app
    + correo real vía EmailSender. **S13:** `completion_rules.minGrade`
    (default 4.0) para HU-4.4/certificados.
- **Por qué:** HU-6.x fija el QUÉ (3 tipos, intentos, banco, escala 1.0–7.0,
  ponderaciones, auditoría con motivo) sin cuantificar el CÓMO; estos son los
  usos estándar en OTECs chilenas y todos los parámetros quedan configurables.
- **Alternativas descartadas:** exigencia fija 60% sin knob (hay cursos al
  70%); "último intento cuenta" como default (castiga reintentos legítimos);
  pendientes = 1.0 durante el curso (descartada por Edu).


## D-023 — Integridad del registro de notas: RPC atómico + trigger anti-despublicación (revisión 4-ojos del PR #39)

- **ID:** D-023
- **Fecha:** 2026-07-15
- **Contexto:** la revisión adversarial 4-ojos del PR #39 (task 2.2) confirmó
  **3 hallazgos HIGH** en la máquina de estados de `grades` — el gate del hito —
  y 2 menores (1 MED, 1 LOW); refutó 6 (ver abajo).
- **Hallazgos HIGH confirmados y su corrección:**
  - **R#39-1** — `saveDraftGrade` pisaba una nota PUBLICADA y la revertía a
    borrador (alcanzable por un tutor): pérdida silenciosa del registro oficial
    (desaparece de la vista del alumno por RLS `status='published'`), sin motivo
    ni auditoría. *Fix:* la ruta de borrador rechaza con `already_published` si
    la nota ya está publicada; **trigger de BD `grades_no_unpublish`** que aborta
    cualquier transición `published → draft` en cualquier ruta de escritura.
  - **R#39-2** — `publishGrade` re-publicaba una nota ya publicada con otro
    valor saltándose el gate de motivo; `updatePublishedGrade` (el gate real)
    era código muerto: la UI nunca lo cableaba. *Fix:* `publishGrade` rechaza
    `already_published`; la fila de corrección, cuando la nota está publicada,
    muestra el formulario de edición con MOTIVO obligatorio cableado a
    `updateGradeAction` (solo el relator; el tutor la ve bloqueada). La BD además
    solo permite mutar una publicada cuando la auditoría es `grade.updated`.
  - **R#39-3** — el cambio de nota y su auditoría NO eran atómicos (dos
    statements HTTP separados vía PostgREST): un fallo del insert de auditoría
    dejaba la nota cambiada SIN rastro y devolvía `ok:true`. *Fix:* toda
    escritura de nota de tarea pasa por el **RPC transaccional
    `write_assignment_grade`** (SECURITY DEFINER, `search_path=''`, EXECUTE solo
    service_role) que hace el upsert de la nota + el insert de auditoría en UNA
    transacción; si la auditoría falla, el cambio se revierte. La lógica de
    estado y la validación del motivo siguen en dominio/servicio; la BD es el
    cinturón. También MED (paginación de la cola de corrección para no truncar
    en `max_rows=1000`, con JOIN embebido en vez de `.in()`) y LOW (limpieza del
    objeto huérfano en Storage si el INSERT de la entrega falla tras subir).
- **Por qué así:** supabase-js no tiene transacciones multi-statement en el
  cliente; la ÚNICA forma de garantizar atomicidad nota+auditoría (Ley 21.719 /
  P8, "las notas no se borran" y "todo cambio deja rastro") es un RPC de Postgres.
  El trigger da defensa en profundidad independiente de la capa app.
- **Hallazgos refutados (6, con razón):** predicado tenant en `notifications`
  (el scoping por `user_id` es completo — es un outbox por-usuario); FKs
  `grades→assignments/submissions` sin tenant compuesto (patrón de todo el repo:
  aislamiento por RLS, inalcanzable cross-tenant); rúbrica siempre 1.0 por UI
  (no hay UI que cree tareas con rúbrica — feature intencionalmente incompleto);
  `notifyStudent` marca todas las pendientes (mejorado igual a marcar por id, sin
  worker de reintento que lo haga dañino); MIME del cliente sin sniffing (la
  allowlist del bucket excluye tipos ejecutables; defensa en profundidad real).
- **Regresiones que lo fijan:** `assignment-service.integration.test.ts` —
  `already_published` por borrador y por re-publicación, trigger de BD aborta la
  reversión por SQL directo, la cola expone `gradeId`+estado, y el cambio con
  motivo mantiene `published` + audit `grade.updated`.


## D-024 — Resolución de la revisión 4-ojos del PR #40 (libro de notas 2.3)

- **ID:** D-024
- **Fecha:** 2026-07-15
- **Contexto:** la revisión adversarial del PR #40 (task 2.3, el GATE del hito)
  confirmó 3 defectos y refutó 2.
- **Confirmados y corregidos:**
  - **MED** — `loadPublishedGrades` paginaba con orden NO único (`enrollment_id`),
    sin desempate `id`: en acciones con >1000 notas publicadas, la paginación
    OFFSET puede saltarse una nota en el borde de página → promedio corrupto +
    fila marcada incompleta en silencio. *Fix:* `.order("id")` como desempate
    (convención del resto del archivo).
  - **MED** — inyección de fórmulas en el CSV (CWE-1236): `csvCell` no
    neutralizaba valores que empiezan con `=,+,-,@,TAB,CR`. Los nombres provienen
    del roster importado (menor confianza) y el staff abre el CSV en Excel.
    *Fix:* anteponer `'` a esas celdas, en el libro de notas Y en el export de
    cumplimiento (mismo patrón heredado, #35).
  - **LOW** — libro completo con TODOS los pesos en 0 → `finalGrade` null →
    `rowStatus` devolvía "failed" ("Reprobado"). *Fix:* estado neutral cuando no
    hay promedio computable (nunca reprobar sin nota final).
- **Refutados (2, tradeoff by-design):** `getGradeHistory` lee todos los
  `grade.updated` del tenant y filtra en memoria por la acción. Es correcto y es
  la opción óptima-restringida: `audit_log.entity_id` es `text` SIN FK, así que
  PostgREST no puede hacer join embebido por acción; `.in(gradeIds)` cae en el
  "URI too long" documentado; y acotar por ventana de fecha rompería la semántica
  del historial. El volumen es bajo (grade.updated solo se emite en correcciones
  de nota publicada con motivo, evento raro) y el acceso es solo otec_admin. Se
  acepta el tradeoff; no re-flaggear.


## D-025 — Estado de la acción (draft/active) y clonado de curso (task 2.8)

- **ID:** D-025
- **Fecha:** 2026-07-15
- **Decisión:**
  - **Estado de la acción:** enum `action_status` (draft/active). Una acción NACE
    en borrador (o activa si `createAction` ya recibe ambas fechas). Solo pasa a
    activa por `activateAction`, que exige fechas y, si es re-ejecución
    (`cloned_from` no nulo), un código DISTINTO al de origen. Gate a nivel BD:
    CHECK `actions_active_needs_dates` (una activa siempre tiene fechas). El
    "código nuevo ≠ origen" no es expresable como CHECK entre filas → se valida
    en el servicio (`validateActivation`) + test.
  - **Diente:** `importEnrollmentsFromCsv` rechaza acciones en borrador
    (`action_not_active`): no se inscribe hasta activar.
  - **Clonado de curso:** RPC transaccional `clone_course(tenant, course)`
    SECURITY DEFINER + `search_path=''` + EXECUTE solo service_role (invocado vía
    `guard.db.rpc`). Copia courses (→ draft, nombre + " (copia)") + lessons +
    quizzes(+questions) + assignments al MISMO tenant. NUNCA copia actions,
    enrollments, grades, submissions ni sesiones SENCE. El curso draft sin
    acciones deja el contenido inalcanzable hasta re-ejecutar.
  - **Re-ejecución de acción:** INSERT simple vía guard (sin RPC): copia config,
    `attendance_lock=true`, fechas NULL, status draft, `cloned_from`=origen.
- **Por qué:** re-usar un curso/acción es lo normal en OTECs (misma malla, nueva
  cohorte), pero SENCE exige código y fechas nuevos por ejecución; el estado
  draft evita inscribir/operar una acción a medio configurar. Auditoría:
  `course.cloned`, `action.reexecuted`, `action.activated`.
- **Backfill:** las acciones existentes CON fechas → active (ya operaban); las
  demás quedan draft.

---

> **Nota de numeración (back-fill Hito 3):** las entradas D-026–D-045 son
> reconstrucción del 2026-07-16. El ledger quedó congelado en D-025 (fin del Hito
> 2) mientras el Hito 3 (tareas 3.1–3.12, PRs #45–#68) avanzó en un turno autónomo:
> sus decisiones se registraron en `ESTADO-PROYECTO.md` y en las descripciones de
> los PRs con etiquetas ad-hoc (HIGH/MED, F1/L1), no como entradas `D-NNN`. Este
> back-fill las formaliza. Dos números quedaron FIJADOS por citas ya shipeadas en
> el código y el ledger se alinea a ellas: **D-034 = scrubber de PII/token de
> Sentry** (`src/lib/observability/scrub.ts:2`, `sentry.server.config.ts:8`) y
> **D-035 = healthcheck `/api/health`** (`src/lib/observability/health.ts:2`,
> `src/app/api/health/route.ts:10`), ambas de la tarea 3.7. Por eso, alrededor de
> las tareas 3.5–3.7, el orden numérico NO es estrictamente secuencial por número
> de tarea. El campo **Origen** de cada entrada deja la trazabilidad exacta.

## D-026 — Anonimato estructural de la encuesta de satisfacción (ledger + respuestas separados + RPC `submit_survey`)

- **ID:** D-026
- **Fecha:** 2026-07-16
- **Decisión:** la encuesta de cierre separa el ledger de "quién respondió" (`survey_submissions`, con `enrollment_id`) del contenido de las respuestas (`survey_responses`, con `enrollment_id` NULL en modo anónimo), ambas INSERT-only, y un RPC SECURITY DEFINER `submit_survey` inserta ledger + respuesta atómicamente (el `unique` del ledger corta el doble envío). El staff no puede mapear respuesta↔alumno.
- **Por qué:** HU-6.3 exige que la encuesta pueda ser anónima y a la vez exigible como requisito de completitud; separar "constancia de haber respondido" de "contenido de la respuesta" logra ambas cosas sin que el contenido quede re-vinculable a un alumno. `hasCompletedSurvey` alimenta el gate de certificados (3.2).
- **Alternativas descartadas:** guardar `enrollment_id` en las respuestas y ocultar la identidad solo por policy/UI (descartada: el dato sigue en BD, anonimato frágil dependiente de una sola capa — se optó por anonimato *estructural*).
- **Origen:** reconstrucción 2026-07-16 · PR #45 · tarea 3.1 (03-tareas.md L70) / ESTADO-PROYECTO §Hito 3 (L264-268)

## D-027 — Eliminar `survey_responses.submitted_at` y suprimir muestras anónimas <3 (4-ojos 3.1)

- **ID:** D-027
- **Fecha:** 2026-07-16
- **Decisión:** la revisión adversarial 4-ojos del PR #45 eliminó la columna `survey_responses.submitted_at` y agregó supresión del detalle cuando una encuesta anónima tiene menos de 3 respuestas.
- **Por qué:** HIGH — ledger y respuesta se insertan en la MISMA transacción del RPC, así que un `now()` compartido era idéntico byte-a-byte entre ambas filas y servía de clave de join para re-vincular cada respuesta anónima con su alumno (rompe P4). La agregación no usa la marca de tiempo (el ledger ya la registra), así que quitarla no cuesta nada. MEDIUM — con <3 respuestas el detalle sería atribuible al único que respondió.
- **Alternativas descartadas:** conservar `submitted_at` argumentando que "el ledger ya identifica" (descartada: la simultaneidad transaccional la convertía en clave de re-identificación de las respuestas anónimas).
- **Origen:** reconstrucción 2026-07-16 · PR #45 (fix 4-ojos) · tarea 3.1

## D-028 — Folio atómico y snapshot §7-R7 congelado e inmutable del certificado

- **ID:** D-028
- **Fecha:** 2026-07-16
- **Decisión:** el certificado asigna su folio con una tabla contador `certificate_counters` (por tenant × año) dentro del RPC `issue_certificate` (folios únicos bajo emisión concurrente/masiva), y en la emisión guarda un snapshot §7-R7 de sus datos que queda CONGELADO: el PDF es determinista sobre ese snapshot y regenerable on-demand, y un trigger de BD rechaza cualquier cambio al snapshot tras la emisión (inmutable incluso ante `service_role`).
- **Por qué:** el folio de un certificado debe ser único e irrepetible por tenant → un contador transaccional en el mismo RPC que emite evita colisiones. Y el certificado es evidencia oficial: su contenido no puede variar aunque después cambien los datos del alumno o de la acción; la inmutabilidad en la capa de datos (trigger) es defensa independiente del código. *(El commit del PR #46 etiquetó este snapshot con un "D-112" ad-hoc, número que nunca se asignó en el ledger — precisamente el hueco que este back-fill cierra, materializándolo aquí como D-028.)*
- **Alternativas descartadas:** inmutabilidad del snapshot solo por convención en código (descartada: un bug o el `service_role` la saltarían; el trigger es el cinturón, además de la convención). Para el folio: No registradas en el material fuente (reconstrucción).
- **Origen:** reconstrucción 2026-07-16 · PR #46 (diseño + fix 4-ojos L2) · tarea 3.2 / ESTADO-PROYECTO §Hito 3 (L269-274)

## D-029 — Verificación pública de certificado con RUN enmascarado (RPC `anon`)

- **ID:** D-029
- **Fecha:** 2026-07-16
- **Decisión:** la verificación de autenticidad es pública (`/verificar/[token]`, en `PUBLIC_PATHS`) vía RPC `verify_certificate` ejecutable por `anon`; devuelve el RUN SIEMPRE enmascarado, nunca el completo. QR + folio la alimentan.
- **Por qué:** HU-7.2 exige verificación pública; exponerla como RPC `anon` con RUN enmascarado permite validar la autenticidad sin autenticación y sin filtrar el RUN completo (P4).
- **Alternativas descartadas:** mostrar el RUN completo en la página pública de verificación (descartada: fuga de dato personal, P4).
- **Origen:** reconstrucción 2026-07-16 · PR #46 · tarea 3.2

## D-030 — Blindaje de descarga y lectura del certificado (4-ojos 3.2)

- **ID:** D-030
- **Fecha:** 2026-07-16
- **Decisión:** la descarga del PDF (`getCertificateDownloadUrl`) exige explícitamente ser staff O el alumno dueño de la inscripción y rechaza descargar certificados con `status != 'issued'`; además se quita `supervisor` de la policy `certificates_select`.
- **Por qué:** HIGH-1 — la descarga usaba el cliente service-role (bypassa RLS) filtrando solo `tenant_id + id`, así que cualquier usuario autenticado del tenant podía bajar el PDF (con RUN completo) de otro. MEDIUM-2 — un certificado revocado seguía descargable sin marca de revocación. MEDIUM-3 — la policy daba a instructor/supervisor el RUN completo vía snapshot; el fiscalizador debe ver la lista curada sin RUN y verificar por `/verificar` (enmascarado).
- **Alternativas descartadas:** descarga service-role filtrando solo tenant+id (descartada: fuga cross-alumno del RUN); dejar al `supervisor` en `certificates_select` (descartada: fuga cross-company del RUN vía snapshot).
- **Origen:** reconstrucción 2026-07-16 · PR #46 (fix 4-ojos) · tarea 3.2

## D-031 — Máquina de estados DJ/GCA con RPC atómico `dj_set_state` (staff-only, liquidación +60d)

- **ID:** D-031
- **Fecha:** 2026-07-16
- **Decisión:** el checklist de Declaración Jurada por acción (`dj_checklist`) usa un enum `dj_state` con una máquina de transiciones legales PURA; el deadline de liquidación = `action.ends_on + DJ_SETTLEMENT_DAYS` (default 60); `ensureChecklist` es idempotente y excluye exentos; el cambio de estado + su auditoría pasan por un RPC SECURITY DEFINER `dj_set_state` en UNA transacción, con `p_from` verificado bajo `for update` (cierra el TOCTOU entre dos gestores). Es STAFF-ONLY (sin supervisor).
- **Por qué:** la DJ es cumplimiento SENCE interno de la OTEC (no dato de empresa) → sin supervisor, mismo criterio que el expediente (3.12). F1 (MED) del 4-ojos: el estado y su auditoría no eran atómicos → un estado sin rastro; el RPC (espejo de `write_assignment_grade`, D-023) lo hace atómico mientras la máquina de dominio sigue siendo la única fuente de legalidad de la transición. Recordatorios n8n → follow-up en 3.9.
- **Alternativas descartadas:** persistir estado y auditoría en dos statements separados (descartada por F1: estado sin rastro); dar al supervisor lectura de la DJ (descartada: la DJ es liquidación interna OTEC, no dato fiscalizable de empresa; acceso gated se difirió a 3.11).
- **Origen:** reconstrucción 2026-07-16 · PR #62 (diseño + fix 4-ojos F1/F2/F4) · tarea 3.3 / ESTADO-PROYECTO §Hito 3 (L86-90)

## D-032 — Canal de comunicación oficial 100% nativo (6 tablas + RLS de privacidad + SLA visible)

- **ID:** D-032
- **Fecha:** 2026-07-16
- **Decisión:** anuncios, foro de consultas, mensajería asincrónica (exigible SENCE, HU-9.3) y calendario se implementan nativos (sin n8n/terceros) en 6 tablas con RLS de privacidad: el alumno solo ve sus propios mensajes (nunca los de otro alumno) y el supervisor no accede a mensajería. SLA de respuesta visible (semáforo). Notificaciones in-app + correo best-effort vía EmailSender (no-op sin RESEND). La publicación de anuncio hace la transición draft→published atómica con fan-out único.
- **Por qué:** M9 — la comunicación oficial del curso debe ser trazable dentro del LMS y la mensajería alumno↔relator es exigible por SENCE; hacerla nativa evita depender de canales externos para lo crítico (P3). WhatsApp queda para el Hito 5.
- **Alternativas descartadas:** delegar la comunicación oficial a n8n/terceros (descartada: P3/ADR-004, n8n es solo periferia); dar al supervisor acceso a mensajería (descartada: privacidad del alumno).
- **Origen:** reconstrucción 2026-07-16 · PR #47 (diseño + fix 4-ojos L1-L3) · tarea 3.4 / ESTADO-PROYECTO §Hito 3 (L276-280)

## D-033 — Derechos Ley 21.719: `consents` INSERT-only + supresión que CONSERVA SENCE y REDACTA perfil/comunicación

- **ID:** D-033
- **Fecha:** 2026-07-16
- **Decisión:** `consents` (INSERT-only, un registro por versión de política, inmutable por trigger) + `dsr_requests`; consentimiento como gate al primer ingreso; export JSON del titular (acceso + portabilidad); y una supresión que, vía `classifyForErasure`, CONSERVA los registros SENCE/certificados/notas/auditoría (retención legal) y suprime/redacta el perfil y la comunicación.
- **Por qué:** RNF-3 / HU-2.4 — los derechos deben operarse desde la UI sin tocar la BD a mano (P4), pero la Ley 21.719 y las obligaciones de retención SENCE conviven: ciertos registros deben conservarse. `classifyForErasure` codifica esa frontera. Los catálogos de retención/tratamientos quedan flagged para revisión legal (abogado, Hito 5). La ejecución real de la redacción se endurece en D-036 (fix 4-ojos).
- **Alternativas descartadas:** borrado duro total del titular (descartada: destruiría evidencia SENCE de retención obligatoria; el borrado del usuario auth queda diferido/manual).
- **Origen:** reconstrucción 2026-07-16 · PR #59 · tarea 3.5 / ESTADO-PROYECTO §Hito 3 (L281-285)

## D-034 — Scrubber de PII/token de Sentry por predicado de clave + `includeLocalVariables:false`

- **ID:** D-034
- **Fecha:** 2026-07-16
- **Decisión:** un scrubber puro (`src/lib/observability/scrub.ts`) actúa como `beforeSend` de Sentry en los 3 runtimes: redacta RUN, correo, el token SENCE cifrado y secretos por PREDICADO de clave (`token`/`key`/`secret`/`bearer`/…, no solo por regex de valor), quita cookies/headers de auth y el body de `/api/sence/*`; el SDK se cablea con `includeLocalVariables:false`, `sendDefaultPii:false`, sin Session Replay ni Logs, y gated por DSN (no-op sin DSN). *(Número FIJADO por la cita en `scrub.ts:2` y `sentry.server.config.ts:8`.)*
- **Por qué:** F1 (HIGH) del 4-ojos — el token SENCE DESCIFRADO vive en una var de stack con forma UUID que NINGÚN regex de valor reconoce y cuya clave `token` no estaba en la lista; sin `includeLocalVariables:false` Sentry lo capturaría. El predicado por clave + esa opción son la red doble que impide que el token SENCE salga del proceso (RNF-10 / I-6). Session Replay y Logs quedan fuera por incompatibles con Ley 21.719 (grabarían PII en pantalla / logs con RUN).
- **Alternativas descartadas:** redactar solo por regex de valor (descartada por F1: no reconoce el token descifrado); dejar `includeLocalVariables` en el default del SDK (`true`) (descartada: capturaría el token en la traza); habilitar Session Replay/Logs (descartada: grabaría PII, viola Ley 21.719/RNF-10).
- **Origen:** reconstrucción 2026-07-16 · PR #57 (scrubber + fix 4-ojos F1) y PR #71 (wiring del SDK) · tarea 3.7 · citado por `scrub.ts:2` / `sentry.server.config.ts:8` / ESTADO-PROYECTO §Hito 3 (L291-295)

## D-035 — Healthcheck `/api/health` con payload puro para Uptime Kuma

- **ID:** D-035
- **Fecha:** 2026-07-16
- **Decisión:** `/api/health` (público, en `PUBLIC_PATHS`) expone un payload derivado por `buildHealthPayload` (puro): `status = "degraded"` solo si `checks.db === "fail"`, si no `"ok"`; incluye `version` (desde `SENTRY_RELEASE`/`APP_VERSION`), `checks` y `time`. La ruta hace un chequeo barato de BD (anon, timeout ~800 ms) → 200 ok / 503 degraded, cachea el resultado unos segundos y reutiliza el cliente anon. El contenedor web declara un `HEALTHCHECK` en el Dockerfile. Lo consume Uptime Kuma como monitor de disponibilidad. *(Número FIJADO por la cita en `health.ts:2` y `api/health/route.ts:10`.)*
- **Por qué:** Plan §8/§10 exige monitoreo externo; un endpoint de salud con lógica PURA y testeable (status derivado solo del resultado de los chequeos) permite que Uptime Kuma y el `HEALTHCHECK` del contenedor decidan sin ambigüedad, y el caché + la reutilización del cliente anon evitan que un monitor frecuente amplifique carga contra la BD (F3/F4 del 4-ojos).
- **Alternativas descartadas:** golpear la BD en cada request sin caché (descartada por F3/F4: amplifica carga); responder siempre 200 sin chequeo real de BD (descartada: no distingue "app viva" de "BD caída").
- **Origen:** reconstrucción 2026-07-16 · PR #57 · tarea 3.7 · citado por `health.ts:2` / `api/health/route.ts:10` / ESTADO-PROYECTO §Hito 3 (L291-295)

## D-036 — La supresión debe REDACTAR de verdad la comunicación, no solo el nombre (4-ojos 3.5)

- **ID:** D-036
- **Fecha:** 2026-07-16
- **Decisión:** `applyErasure` redacta realmente el perfil de auth (nombre + correo tombstone), `forum_posts.body`, `messages.body` y `message_threads.subject` del titular (bajo tenantGuard); se agrega el grant `update on forum_posts to service_role` SOLO para esta supresión. `resolveDsr` ya no puede cerrar como "completed" una solicitud de tipo erasure sin pasar por la anonimización real. (Endurece la supresión definida en D-033.)
- **Por qué:** HIGH — `applyErasure` AFIRMABA suprimir foro/mensajes/perfil pero solo anulaba `full_name`: un registro de cumplimiento FALSO, peor que no hacer nada (la ley se incumple mientras el sistema declara que se cumplió).
- **Alternativas descartadas:** anular solo `full_name` y reportar la supresión como completa (descartada: cumplimiento falso).
- **Origen:** reconstrucción 2026-07-16 · PR #59 (fix 4-ojos) · tarea 3.5

## D-037 — Rate-limit POR-USUARIO (no por IP) en rutas SENCE, fail-open + CSRF

- **ID:** D-037
- **Fecha:** 2026-07-16
- **Decisión:** `/api/sence/{start,close}` limitan por USUARIO (10/min) con ventana fija en Redis, FAIL-OPEN sin `REDIS_URL`, y aplican `assertSameOrigin` (CSRF); `/api/sence/cb/[nonce]` queda SIN rate-limit y EXENTO de same-origin (callback cross-origin legítimo de SENCE, protegido por el nonce). La resolución del backend Redis va dentro del try/catch (fail-open ante un throw del import dinámico).
- **Por qué:** HIGH del 4-ojos — un rate-limit por IP tumbaba cohortes tras NAT compartido (empresa/laboratorio: >30 alumnos en una IP recibían 429 al registrar asistencia) y, en el callback, correr el límite ANTES de `handleCallback` violaba I-1 (persistir SIEMPRE), perdiendo la marca de asistencia sin reintento de SENCE. El anti-DoS del callback va en el edge/proxy. Sin cambio de contrato → no requiere re-certificación rcetest.
- **Alternativas descartadas:** rate-limit por IP (descartada: colapsa cohortes tras NAT); limitar el callback antes de persistir (descartada: viola I-1, pierde evidencia); fail-closed sin Redis (descartada: rompería SENCE si falta el backend).
- **Origen:** reconstrucción 2026-07-16 · PR #48 (fix 4-ojos H1/M2) · tarea 3.6 / docs/sence/CHANGELOG.md (2026-07-16)

## D-038 — Cabeceras de seguridad enforcing + CSP en report-only (enforcing parqueado)

- **ID:** D-038
- **Fecha:** 2026-07-16
- **Decisión:** se emiten HSTS (sin preload), X-Content-Type-Options, X-Frame-Options, Referrer-Policy y Permissions-Policy en modo ENFORCING; la CSP va en REPORT-ONLY (con `form-action` incluyendo `sistemas.sence.cl` — load-bearing del auto-submit de asistencia — más Bunny/YouTube-nocookie/Supabase/Sentry). Endurecer la CSP a enforcing queda parqueado hasta verificar en navegador. Se agrega Dependabot semanal + `docs/security/OWASP-REVIEW.md`.
- **Por qué:** en un despliegue no supervisado de cara al piloto, una CSP enforcing mal calibrada rompería el auto-submit SENCE o el video; report-only recoge violaciones reales sin romper producción y se endurece cuando esté verificado.
- **Alternativas descartadas:** CSP enforcing desde ya (descartada: riesgo de romper el auto-submit SENCE / el video sin verificación previa en navegador).
- **Origen:** reconstrucción 2026-07-16 · PR #48 · tarea 3.6 / ESTADO-PROYECTO §Hito 3 (L286-290)

## D-039 — Pipeline de backup off-site pg_dump→age→R2 en contenedor cron propio

- **ID:** D-039
- **Fecha:** 2026-07-16
- **Decisión:** los backups off-site corren en `ops/backup/`: `backup.sh` hace `pg_dump` (v17, el server es PG 17.6) → cifra con `age` (clave privada OFFLINE, fuera del servidor) → sube a R2 con rclone; `prune.sh` aplica retención (comparte `r2-env.sh`). El contenedor es long-running con `crond` interno + backup inicial de validación al arrancar (sin depender de las Scheduled Tasks de Coolify). El pipeline aborta si el dump falla (dump a archivo + chequeo `-s`, en vez de `pg_dump|gzip` que ocultaba el fallo) y usa `RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true` para tokens R2 scoped al bucket.
- **Por qué:** cumplir §8/§10 (backups cifrados off-site + ensayo de restauración). Cifrar con `age` de clave offline garantiza que un compromiso de R2 no exponga los datos. Los fixes salieron del primer despliegue real: `pg_dump` v16 rechaza el server PG 17, un pipe ocultaba el fallo de conexión cifrando un dump vacío, y un token R2 scoped moría con 403 al intentar `CreateBucket`.
- **Alternativas descartadas:** `pg_dump | gzip` en pipe (descartada: enmascara el fallo de `pg_dump` y cifra un dump vacío); depender de las Scheduled Tasks de Coolify (descartada: se optó por `crond` interno en un contenedor long-running); `pg_dump` v16 (descartada: incompatible con el server PG 17.6).
- **Origen:** reconstrucción 2026-07-16 · PR #57 (diseño) + PR #70/#74/#75 (fixes de despliegue real) · tarea 3.7

## D-040 — El contenedor worker declara un HEALTHCHECK trivial que siempre pasa

- **ID:** D-040
- **Fecha:** 2026-07-16
- **Decisión:** el stage worker del Dockerfile declara `HEALTHCHECK CMD true` (siempre healthy); el worker es un proceso de fondo sin HTTP. Además se pasa `ARG NEXT_PUBLIC_SENTRY_DSN` al build del cliente.
- **Por qué:** Coolify parsea el Dockerfile completo (ve el HEALTHCHECK del stage runner web) y exige estado de salud del contenedor worker; sin estado, `docker inspect .State.Health` queda vacío y el rolling update aborta. `HEALTHCHECK NONE` no basta porque Coolify igual espera estado. Un check trivial lo deja healthy sin inventar un endpoint HTTP en un proceso que no lo tiene.
- **Alternativas descartadas:** `HEALTHCHECK NONE` en el stage worker (descartada: Coolify igual exige estado y el rolling update aborta). Otras no registradas en la fuente.
- **Origen:** reconstrucción 2026-07-16 · PR #72/#73 (fixes de infra Docker/Coolify)

## D-041 — E2E Playwright con harness real: tenant por subdominio (`localtest.me`) + login por UI

- **ID:** D-041
- **Fecha:** 2026-07-16
- **Decisión:** los E2E corren contra la app real (`next start`) + Supabase local, con login REAL por UI y `storageState` por rol (ejercita `@supabase/ssr` + el Auth Hook `custom_access_token`, no un JWT falso), y el tenant se resuelve por subdominio vía `localtest.me` (DNS público → 127.0.0.1). Proyectos desktop (1440×900) + móvil (Pixel 5), nuevo job `e2e` en CI. Los 3 flujos del gate: encuesta, subrutas de acción (guardia anti-#41) y verificación pública de certificado con RUN enmascarado.
- **Por qué:** el bug #41 fue un conflicto de slug de rutas — error de RUNTIME que `next build` no caza; hacía falta un E2E que arranque la app real y navegue por subdominio para atraparlo (guardia anti-#41). Un login por UI real (no JWT mockeado) valida el Auth Hook y el multi-tenant por subdominio de punta a punta (P4: el RUN completo nunca aparece en la verificación pública).
- **Alternativas descartadas:** inyectar un JWT falso en vez de login por UI (descartada: no ejercita el Auth Hook ni `@supabase/ssr`); confiar en `next build` para cazar conflictos de rutas (descartada: es error de runtime invisible al build — lección del #41).
- **Origen:** reconstrucción 2026-07-16 · PR #68 · tarea 3.8 / ESTADO-PROYECTO §Hito 3 (L102-105)

## D-042 — n8n reminders-tick RNF-10 por construcción: a n8n solo agregado seudonimizado (HMAC)

- **ID:** D-042
- **Fecha:** 2026-07-16
- **Decisión:** los recordatorios (asistencia SENCE, inactivos, informe al coordinador) los computa y ENVÍA el worker (`reminders-tick`, horario), mandando el correo PII al destinatario real vía EmailSender; a n8n solo viaja un evento AGREGADO y seudonimizado por HMAC-SHA256 (POST firmado) — nunca RUN, nombre ni correo. Opt-out del alumno (`communication_opt_outs`) + config por acción (`automation_config`) + dedup diario vía el outbox de notificaciones. No-op sin `N8N_WEBHOOK_URL/SECRET`.
- **Por qué:** RNF-10 exige que al procesamiento por lotes (n8n) jamás vayan datos personales; separar "quién manda el PII" (worker/EmailSender) de "qué ve n8n" (agregado seudonimizado) hace el cumplimiento estructural, no dependiente de configuración. n8n es periferia (P3/ADR-004). MED del 4-ojos: el worker no tiene origin de request, así que el link `/mi-curso` relativo era no-clickeable en el correo → `APP_BASE_URL` para construir la URL absoluta.
- **Alternativas descartadas:** pasar datos del alumno a n8n para que arme el correo (descartada: viola RNF-10); poner la lógica de recordatorios en n8n (descartada: P3/ADR-004, n8n solo periferia); link relativo en el correo (descartada por el MED: no resuelve en clientes de correo).
- **Origen:** reconstrucción 2026-07-16 · PR #66 (diseño + fix 4-ojos MED) · tarea 3.9 / ESTADO-PROYECTO §Hito 3 (L98-101)

## D-043 — Verificación Meta Business como trámite externo documentado (canal WhatsApp en Hito 5)

- **ID:** D-043
- **Fecha:** 2026-07-16
- **Decisión:** la tarea 3.10 entrega un checklist documentado (`docs/whatsapp/META-BUSINESS-VERIFICATION.md`) para iniciar la verificación Meta Business; el trámite (no-código) lo ejecuta Edu y el canal WhatsApp recién opera en el Hito 5 (5.11). No bloquea nada del Hito 3.
- **Por qué:** M9 — la verificación Meta es un trámite externo lento; arrancarlo temprano y por escrito evita que bloquee el canal cuando se necesite, sin introducir código de canal que aún no se usará.
- **Alternativas descartadas:** No registradas en el material fuente (reconstrucción).
- **Origen:** reconstrucción 2026-07-16 · PR #58 · tarea 3.10 / ESTADO-PROYECTO §Hito 3 (L296-298, L305-307)

## D-044 — Portal supervisor: grants con vigencia/alcance que endurecen 6 policies vivas + auditoría por consulta

- **ID:** D-044
- **Fecha:** 2026-07-16
- **Decisión:** el acceso de solo-lectura del supervisor pasa a estar gobernado por un GRANT con vigencia (expiry), revocación y alcance (todo el tenant o un set de acciones): `supervisor_grants` + `supervisor_grant_actions` + helpers SECURITY DEFINER (`supervisor_has_active_grant`/`_action_in_scope`/`_enrollment_in_scope`/`_session_in_scope`, `search_path=''`). Se endurecen 6 policies vivas (enrollments, sence_sessions, sence_events, grades, lesson_progress, alerts): la rama `has_role('supervisor')` ahora exige además grant activo Y en alcance (las tablas SENCE mantienen su contrato INSERT-only; solo se acota el SELECT). El portal usa service-role (bypassa RLS) → re-verifica en código y AUDITA cada lectura/descarga; `cumplimiento-service` pasa a staff-only con builders `*Unchecked` que solo el portal gated delega. Backfill de supervisores existentes.
- **Por qué:** HU-12.1/12.2 — el fiscalizador OTIC/externo necesita acceso acotado y revocable, no permanente; el grant con alcance limita qué ve y la auditoría por consulta deja rastro de cada acceso. Defensa en profundidad: como el portal usa service-role, el chequeo en código complementa la RLS endurecida. MED del 4-ojos multi-agente: `alerts_select_admin` gateaba al supervisor solo por vigencia, no por alcance → un supervisor `scope='actions'` leía TODA alerta del tenant (incl. `sence_day1_low_attendance` con `action_id`/`codigo_accion`/cifras de asistencia de acciones fuera de alcance) → se escopa con `supervisor_action_in_scope` (alertas con acción) y el nuevo `supervisor_has_tenant_grant` (alertas tenant-wide).
- **Alternativas descartadas:** acceso de supervisor permanente sin vigencia/alcance (descartada: el fiscalizador no debe ver todo el tenant para siempre); confiar solo en RLS sin re-chequeo en el portal (descartada: el portal usa service-role que bypassa RLS); gatear `alerts` solo por vigencia (descartada por el MED: filtra alertas fuera de alcance).
- **Origen:** reconstrucción 2026-07-16 · PR #64 (diseño + fix 4-ojos MED) · tarea 3.11 / ESTADO-PROYECTO §Hito 3 (L91-97)

## D-045 — Expediente de fiscalización: documentos definitivos INMUTABLES + ZIP, staff-only admin/coordinador

- **ID:** D-045
- **Fecha:** 2026-07-16
- **Decisión:** el expediente por acción (`action_documents`, bucket privado con allowlist MIME) permite subir documentos con tipo/estado/fecha, marcar definitivos (borrador→definitivo) y descargar un ZIP con `MANIFIESTO.csv`; un trigger `action_documents_lock_definitive` impide modificar o borrar un documento definitivo, incluso con `service_role`. Es STAFF-ONLY restringido a otec_admin/coordinator (sin instructor, sin supervisor).
- **Por qué:** HU-5.10 — el expediente contiene la OC OTIC con montos comerciales, por eso se acota a admin/coordinador (least-privilege; el 4-ojos quitó instructor) y sin supervisor. Los documentos definitivos son evidencia de fiscalización: su inmutabilidad en la capa de datos (trigger, incluso ante `service_role`) impide alterarlos tras cerrarlos. MED del 4-ojos: `uploadDocument` valida que la acción sea del tenant ANTES de usar `actionId` como segmento de la clave de storage (evita inyección de ruta / acciones ajenas).
- **Alternativas descartadas:** incluir instructor/supervisor en el acceso (descartada: montos comerciales, least-privilege); inmutabilidad solo por convención de código (descartada: un `service_role` la saltaría; el trigger es el cinturón); usar `actionId` en la ruta sin validar pertenencia (descartada por el MED: inyección de ruta).
- **Origen:** reconstrucción 2026-07-16 · PR #60 (diseño + fix 4-ojos MED) · tarea 3.12 / ESTADO-PROYECTO §Hito 3 (L83-85, L309-312)

## D-046 — Renombrar el tenant demo `otec-andes` → `seminarea` (cliente real)

- **ID:** D-046
- **Fecha:** 2026-07-16
- **Decisión:** el tenant demo cambia de slug/nombre `otec-andes` → `seminarea` (cliente real del piloto) conservando el MISMO UUID; solo cambian slug, nombre y los correos semilla (`admin@seminarea.test`, …). El staging pasa a `seminarea.chilearning.cl` (el dominio viejo `otec-andes.chilearning.cl` responde en transición). `otec-pacifico` queda como tenant B de pruebas.
- **Por qué:** Seminarea es el cliente real con el que se ejecutará el piloto (Hito 4); renombrar el tenant demo in-place (mismo UUID) evita una migración/duplicación de datos y conserva el historial. Los datos del seed siguen siendo FICTICIOS (regla dura: nunca datos reales en fixtures); el RUT del tenant es placeholder hasta que Edu cargue el real por la app.
- **Alternativas descartadas:** crear un tenant nuevo para Seminarea (descartada: obligaría a migrar/duplicar el demo; el rename in-place conserva UUID e historial); cambiar los datos del seed a reales (descartada: viola la regla de no usar datos reales en fixtures).
- **Origen:** 2026-07-16 · PR #76 (rename) + #77 (corte de infra, staging verificado) / ESTADO-PROYECTO §Snapshot (L28-36)

---

## D-047 — Revisión adversarial del módulo SENCE antes del piloto (tarea 4.1b)

- **ID:** D-047
- **Fecha:** 2026-07-16
- **Decisión:** antes de habilitar el piloto real (4.2) se ejecuta una revisión adversarial
  completa de `src/modules/sence/` por un panel multi-agente distinto del implementador (26
  agentes: 6 lentes independientes → consolidación → refutación adversarial), contra el contrato
  congelado v1.1.6. Los hallazgos `CONFIRMED` seguros se corrigen en un PR de fixes; los que tocan
  el flujo SENCE o el contrato quedan como **rulings para Edu**; el resto como follow-ups anotados.
  El informe completo (19 hallazgos, 10 rulings, candidatos verificados) vive en
  `docs/sence/REVISION-ADVERSARIAL-H4.md`. **Veredicto: SHIP CON FIXES + rulings de Edu.**
- **Por qué:** el registro de asistencia SENCE tiene valor legal/tributario; la Definición de Hecho
  §9 exige revisión por otro agente para todo cambio en `sence/`, y el gate 4.1 del Hito 4 exige
  esta revisión antes de exponer alumnos reales. La revisión cazó **1 HIGH de seguridad real**
  (`H4-R-002`: el `callback_nonce` era legible por staff del tenant vía grant de tabla sin revoke
  de columna → falsificación de callbacks y alteración de asistencia ajena — el mismo patrón del
  bug de `token_encrypted` #22) + defectos de robustez (pérdida silenciosa de callbacks, 500 crudo
  al alumno), y confirmó que los controles ya endurecidos (INSERT-only, aislamiento de tenant y de
  service-role, endurecimiento supervisor 3.11) siguen sanos.
- **Fixes de este lote (PR de fixes H4):** `H4-R-002` (migración: revoke del grant de columna del
  nonce + test RLS), `H4-R-001` (lector tolerante a nombres de campo con espacios + tests contra el
  mock), `H4-R-005` (el callback nunca parsea la clave de cifrado → no se pierde por clave rota),
  `H4-R-007` (loguear el error del SELECT de correlación), `H4-R-015` (`resolvePublicOrigin`
  fail-closed), `H4-R-016` (doble start → resultado tipado, no 500). Ninguno toca una transición
  T1–T9 ni el README congelado.
- **Alternativas descartadas:** auto-corregir los hallazgos que cambian el flujo SENCE (T8, restart
  de la pendiente, atomicidad con nota en README) — descartada: `sence/` es sagrado (P3), esos van
  como rulings que Edu aprueba antes de tocar código; corregir todos los CONFIRMED en un solo PR
  gigante — descartada: los de UX y los feature-sized (scoping de `company`, acciones §5) se
  separan para no arriesgar regresiones en la ruta crítica justo antes del piloto.
- **Origen:** 2026-07-16 · revisión 4.1b · informe `docs/sence/REVISION-ADVERSARIAL-H4.md`

---

## D-048 — Resolución de los 10 rulings de la revisión adversarial H4 (Edu)

- **ID:** D-048
- **Fecha:** 2026-07-16
- **Decisión:** Edu resolvió los 10 rulings abiertos de `REVISION-ADVERSARIAL-H4.md`. Los que
  cambian el contrato congelado o la máquina de estados van a un **bump del contrato v1.1.6 → v1.1.7**
  + implementación en código con 4-ojos (P1/P3). Decisiones:
  - **H4-Q-01 (cierre tardío) → CERRAR (lectura literal).** Un `close_ok` recibido tras `expires_at`
    pero ANTES de que el worker ejecute T6 cierra la sesión (T5 no tiene puerta temporal; solo T8 la
    tiene). Hoy quedaba `late` → falsos `expirada` (no-asistencia falsa). *Cambia código + contrato.*
  - **H4-Q-02 (gate M-4) → FORMALIZAR en I-1.** Se enmienda I-1 para consagrar que un POST sin
    `IdSesionAlumno` usable (vacío o >149) NO es un callback y se descarta, condicionado a: (a) el
    borde ya tolera nombres con espacios (H4-R-001, hecho) y (b) un **contador/log de descartes** para
    detectar patrones anómalos. *Cambia contrato + agrega contador.*
  - **H4-Q-03 (anti-DoS del callback) → RATE-LIMIT EN EL EDGE.** Se configura rate-limit +
    alerta de crecimiento anómalo de `unmatched` en **Traefik/Coolify** (no en la app: I-1 exige
    persistir). *Config de infra + priorizar la alerta de `unmatched` (follow-up de `alerts.ts`).*
  - **H4-Q-04 (desbrickeo de la pendiente) → RE-EMITIR + timeout ~15 min.** `/api/sence/start`
    re-emite el form de la sesión `iniciada_pendiente` vigente (misma sesión y nonce, no toca §3) en
    vez de fallar con 500; y se baja `SENCE_PENDING_TIMEOUT_MINUTES` a ~15 min. *Cambia código.*
  - **H4-Q-05 (cierre con error) → ACEPTAR REINICIO + ARREGLAR T8.** Se mantiene la exclusión del
    índice `one_open_per_enrollment` (el alumno puede reiniciar tras un `close_error`) Y se hace
    ALCANZABLE el reintento de cierre T8 (`buildCloseForm`/`/close` para una sesión en `error` de
    origen `close`), para que la sesión no quede colgada ante SENCE. Verificar contra el manual si
    SENCE tolera la doble sesión simultánea de la misma acción/alumno. *Cambia código + contrato.*
  - **H4-Q-06 (auto-falsificación de la sesión propia) → ACEPTAR como límite del protocolo.** El
    RCE es 100% browser-mediado y sin firma; el nonce solo impide falsificar la sesión de OTRO
    (H-2, ya cerrado). La asistencia con valor legal vive en SENCE, no en el LMS, y se reconcilia en
    la DJ/liquidación. **Refuerzo:** ya existe una vía legítima de acceso sin SENCE — el flag
    `exento` (= **becario**, I-14): salta SENCE y el candado I-12 nunca lo bloquea. *Solo doc.*
  - **H4-Q-07 (error multi-código) → MENSAJE AL ALUMNO = CÓDIGO ACCIONABLE.** Cuando `GlosaError`
    trae varios códigos, el mensaje que ve el alumno prioriza un código accionable por él (311/312,
    Clave Única) si aparece; el alerting/severidad interno sigue con el más severo. *Cambia código
    (errors.ts + i18n) + congela la regla en §5 del contrato.*
  - **H4-Q-08 (GlosaError vacía en UrlError) → NO agregar marcador.** Sin evidencia de terreno; el
    discriminador cambiaría I-4/I-8 y exigiría re-certificar. *Sin cambio.*
  - **H4-Q-09 (frontera `>=` vs `>`) → RATIFICAR `>=`.** `now >= expires_at` (expira en el instante
    exacto); diferencia de 1 ms, ya testeado. Solo se ajusta la letra del contrato a "al alcanzar o
    superar". *Solo redacción del contrato.*
  - **H4-Q-10 (start_ok tardío vs T4) → RATIFICAR.** La llegada del callback prueba que no hubo
    abandono; el CAS resuelve la carrera. Guardrail: no bajar el pending-timeout de ~15 min (coincide
    con Q-04). *Sin cambio de código.*
- **Por qué:** los rulings eran interpretaciones deliberadas del contrato (varias ya anotadas como
  Q1–Q3 en `session.ts`) o posturas de infra que solo Edu podía decidir (P1: el spec manda; P3: SENCE
  es sagrado). Resolverlos desbloquea el gate 4.1a del piloto y elimina un riesgo real (Q-01 podía
  estar reportando no-asistencias falsas en cierres cerca del límite de 3 h).
- **Implementación:** las decisiones que tocan código/contrato (Q-01, Q-02, Q-04, Q-05, Q-07) van en
  un PR con **bump del contrato a v1.1.7** (spec primero, P1) + código + tests + **4-ojos** (regla dura
  DoD §9) + anotación en `docs/sence/CHANGELOG.md`. La validación end-to-end contra SENCE queda
  diferida al primer curso real (rcetest parqueado). Q-03 es config de Traefik/Coolify (handoff/infra).
- **Alternativas descartadas:** implementar los cambios sin bumpear el contrato (descartada: viola P1,
  el contrato es la vara de medir de la revisión); mantener el comportamiento actual de Q-01
  (descartada por Edu: crea no-asistencias falsas).
- **Origen:** 2026-07-16 · rulings de `REVISION-ADVERSARIAL-H4.md` resueltos por Edu

## D-049 — Canal WhatsApp (5.11): mismo principio de D-042 extendido a Meta — n8n nunca ve un teléfono

- **ID:** D-049
- **Fecha:** 2026-07-18
- **Decisión:** el envío de plantillas WhatsApp (task 5.11, HU-5.9) es DIRECTO desde el worker a la
  Graph API de Meta (`src/modules/comunicacion/whatsapp-sender.ts`), como bloque HERMANO al de
  correo dentro de `reminders-tick`; NUNCA se orquesta por n8n. Gateado por: feature `whatsapp` por
  tenant (deny-by-default, task 5.3), teléfono presente en `user_metadata.phone`, sender configurado
  (degrada a no-op sin credenciales de Meta) y opt-out específico del canal WhatsApp
  (`communication_opt_outs.channel = 'whatsapp'`, independiente del de email en AMBAS direcciones —
  fix de la asimetría cazada por la revisión adversarial de esta misma sesión: antes, un alumno dado
  de baja SOLO de email nunca llegaba a evaluarse para WhatsApp).
- **Por qué:** extiende a WhatsApp el mismo principio que D-042 sentó para el correo — la lógica
  crítica con PII (aquí, un número de teléfono) vive en código testeable/auditable (worker), nunca en
  n8n (P3/ADR-004); n8n solo automatización periférica. `specs/03-tareas.md` (5.11) seguía con el
  texto literal "orquestado en n8n" heredado de cuando se escribió la tarea, antes de que D-042
  sentara el precedente del correo — esta entrada corrige esa divergencia (P1: toda contradicción
  código↔spec debe quedar resuelta y trazada, no silenciada) y deja registrada la extensión
  específica del principio al canal WhatsApp, que D-042 no cubría (D-042 es 100% sobre correo,
  tarea 3.9/PR #66).
- **Alternativas descartadas:** pasar el teléfono a n8n para que dispare el WhatsApp (descartada:
  viola el mismo principio que D-042 protege para el correo — un teléfono es PII tan sensible como
  un correo); dejar el texto de `specs/03-tareas.md` sin corregir (descartada: P1 exige trazabilidad
  explícita de la divergencia, no solo que el código haga lo correcto).
- **Origen:** 2026-07-18 · revisión adversarial de `feat/h5-5.11-whatsapp` (3 lentes: seguridad,
  dominio, cumplimiento de spec + verificación independiente) · tarea 5.11 / `specs/03-tareas.md:103`

## D-050 — Score SCORM es informativo; NUNCA se convierte en nota (`grades`)

- **ID:** D-050
- **Fecha:** 2026-07-17
- **Decisión:** el resultado (`score_raw`) reportado por un paquete SCORM al terminar (vía `LMSSetValue`/`SetValue` de `cmi.core.score.raw`/`cmi.score.raw`) se guarda SOLO en `scorm_cmi.score_raw`, puramente informativo para staff. Nunca se escribe en `grades` ni se convierte a la escala chilena 1.0–7.0. Lo que SÍ mueve el progreso del alumno es `completed`/`passed` del CMI, que marca `lesson_progress.completed` igual que cualquier otra lección.
- **Por qué:** convertir un score 0-100 (o el criterio pass/fail de la herramienta de autor) a una nota 1.0–7.0 exigiría una política pedagógica (¿escala lineal? ¿umbral de aprobación?) que no está definida en ningún CA ni HU — inventarla en el código sería tomar una decisión de negocio no pedida. Queda como follow-up explícito si Edu la quiere (HU-6.1 ya cubre notas nativas del LMS vía quizzes/tareas).
- **Alternativas descartadas:** mapear linealmente 0-100 → 1.0-7.0 (descartada: política pedagógica inventada, sin CA que la respalde); ignorar el score completamente (descartada: sigue siendo información útil para el staff, solo no debe confundirse con una nota real).
- **Origen:** 2026-07-17 · task 5.1b (reproductor SCORM) · PR #104

## D-051 — Asistencia sincrónica es un registro INTERNO; nunca sustituye ni alimenta el RCE de SENCE

- **ID:** D-051
- **Fecha:** 2026-07-17
- **Decisión:** `live_sessions`/`live_session_attendance` (task 5.4) registran asistencia a sesiones sincrónicas (Zoom/Meet/Teams) de forma 100% interna a la OTEC. Cero imports de `src/modules/sence/`, cero tablas `sence_*` tocadas. Un banner permanente ("Asistencia interna — no reemplaza el registro SENCE") se muestra en toda vista y export. La dirección de dependencia, si algún día se conecta al RCE, sería `sence → academico` (SENCE leyendo/validando este dato), JAMÁS al revés.
- **Por qué:** la norma que regula si SENCE acepta asistencia sincrónica vía RCE por sesión sigue sin verificar oficialmente (spec §7-R3, marcado ⚠). Tocar `sence/` sin esa verificación arriesgaría el módulo más sensible/probado del sistema por una norma no confirmada, y violaría la regla de re-entrada del piloto (Hito 4: cero cambios en `sence/` durante todo el Hito 5).
- **Alternativas descartadas:** integrar directo con `sence_sessions`/RCE ahora, apostando a que la norma lo permite (descartada: riesgo alto sobre el módulo más crítico, sin confirmación oficial); esperar la confirmación de SENCE antes de construir nada (descartada: el registro interno ya tiene valor real para la OTEC hoy, con o sin esa confirmación).
- **Origen:** 2026-07-17 · task 5.4 (sesiones en vivo) · PR #102

## D-052 — Proxy same-origin para assets SCORM (no signed URLs de Storage)

- **ID:** D-052
- **Fecha:** 2026-07-17
- **Decisión:** los assets de un paquete SCORM (HTML/JS/CSS/imágenes extraídos) se sirven vía `GET /api/scorm/[packageId]/[...path]`, un proxy same-origin autenticado que siempre responde 404 (nunca 403) ante cualquier fallo de autorización. El iframe del reproductor usa `sandbox="allow-scripts allow-same-origin allow-forms"`.
- **Por qué:** un SCO (SCORM Content Object) busca `window.API`/`window.API_1484_11` en la cadena de frames padres para hablar con el LMS — si el contenido se sirviera desde un origen distinto (p.ej. una signed URL de `supabase.co`), esa búsqueda cross-origin fallaría y el paquete no podría reportar progreso/notas. Same-origin es un requisito funcional del estándar SCORM, no una preferencia. La compensación por el riesgo de correr JS same-origin (solo staff sube paquetes) es la CSP enforcing (`buildScormContentCsp`: `connect-src 'none'`, `object-src 'none'`, `form-action 'none'`) aplicada SOLO a las respuestas de este proxy.
- **Alternativas descartadas:** signed URLs directas de Storage (descartada: rompe la comunicación SCORM API por cross-origin, no es una opción funcional); confiar en sandboxing del iframe sin CSP adicional (descartada: capa de defensa insuficiente para contenido subido por terceros, aunque sea staff).
- **Origen:** 2026-07-17 · task 5.1b (reproductor SCORM) · PR #104

## D-053 — Módulos del asistente de creación de cursos se materializan como lección-cabecera

- **ID:** D-053
- **Fecha:** 2026-07-17
- **Decisión:** cuando el asistente guiado (task 5.10) genera el curso real desde un borrador, cada "módulo" definido en el wizard se materializa como una lección-cabecera ("Módulo N — título", con los aprendizajes esperados como contenido) seguida de sus lecciones reales, en vez de crear un concepto de "módulo" nuevo en el esquema de `courses`/`lessons`.
- **Por qué:** el esquema de contenido (HU-4.1, ya construido en Hito 1) no tiene noción de agrupación por módulo — agregarla exigiría migrar el constructor libre de cursos ya en producción. Una lección-cabecera reusa el modelo existente sin tocarlo, y resuelve el CA del wizard (mostrar la estructura por módulo) con el mínimo cambio de superficie.
- **Alternativas descartadas:** agregar una tabla `course_modules`/columna de agrupación a `lessons` (descartada: migración de un modelo en producción, fuera de alcance de esta task); generar el curso sin ninguna indicación visual de módulo (descartada: no cumple el CA del wizard de mostrar la estructura definida).
- **Origen:** 2026-07-17 · task 5.10 (asistente de creación de cursos) · PR #105

## D-054 — OpenRouter como gateway único de IA; ZDR es responsabilidad OPERATIVA de Edu

- **ID:** D-054
- **Fecha:** 2026-07-17/18
- **Decisión:** todo el Tutor IA (chat + embeddings) pasa por OpenRouter (`POST /api/v1/chat/completions`, `POST /api/v1/embeddings`), fetch-directo sin SDK (mismo patrón que `email-sender.ts`/Resend). La configuración de Zero Data Retention es un ajuste de cuenta OpenRouter (Settings → Privacy) — el código NO puede verificar en runtime que esté activada; es la base operativa de RNF-10, no algo forzable desde la app. Sin `OPENROUTER_API_KEY`, todo el módulo degrada a no-op (`noopAiClient`) sin romper CI/staging.
- **Por qué:** Edu pidió explícitamente OpenRouter (no Anthropic directo) tras investigación en vivo esa misma noche — permite elegir/cambiar de modelo por knob (`OPENROUTER_MODEL`) sin tocar código, y expone tanto chat como embeddings bajo una sola cuenta/facturación. Documentar la responsabilidad operativa de ZDR evita la falsa sensación de que el código "garantiza" algo que en realidad es un ajuste de cuenta externo.
- **Alternativas descartadas:** Anthropic API directa (descartada por decisión explícita de Edu); un proveedor de embeddings separado del de chat (descartada: complejidad de 2 cuentas/facturaciones para lo que OpenRouter resuelve con una).
- **Origen:** 2026-07-17/18 · tasks 5.8a/5.8b (Tutor IA) · PRs #107, #108

## D-055 — Retrieval híbrido: FTS lexical SIEMPRE disponible, vector como primario cuando hay key (amplía ADR-007)

- **ID:** D-055
- **Fecha:** 2026-07-17
- **Decisión:** el retrieval del Tutor IA (`searchChunks`) intenta primero similitud vectorial (pgvector/HNSW) cuando `aiClient.configured`, con fallback AUTOMÁTICO a full-text search nativo de Postgres (`tsvector`, config `spanish`) si no hay proveedor configurado o si la llamada de embeddings falla por cualquier motivo. El FTS nunca depende de un proveedor externo.
- **Por qué:** ADR-007 ya fijó "RAG sobre pgvector de Supabase" pero no especificaba qué pasa sin proveedor de embeddings — esta entrada amplía esa decisión: el sistema debe funcionar (aunque con retrieval más simple) con CERO llaves externas configuradas, para que CI/staging queden siempre verdes y el tutor nunca "desaparezca" solo porque OpenRouter tuvo un hiccup transitorio.
- **Alternativas descartadas:** retrieval vector-only, fallando duro sin key (descartada: rompe CI/staging sin credenciales y dejaría al tutor inoperante ante cualquier fallo transitorio del proveedor); FTS-only sin nunca intentar vector (descartada: no cumpliría la promesa real de ADR-007 de RAG sobre pgvector).
- **Origen:** 2026-07-17 · task 5.8a (Tutor IA, esquema RAG) · PR #107 · amplía ADR-007 (`specs/02-plan-tecnico.md §12`)

## D-056 — Staff académico NO lee conversaciones del Tutor IA (minimización más estricta que certificados/SCORM)

- **ID:** D-056
- **Fecha:** 2026-07-17
- **Decisión:** `tutor_conversations`/`tutor_messages` tienen RLS que permite lectura SOLO al propio alumno dueño (`user_id = auth.uid()`) o al superadmin (soporte de plataforma) — a diferencia de `certificates`/`scorm_cmi`, donde otec_admin/coordinator/instructor SÍ tienen una rama de lectura. El soporte al alumno llega exclusivamente por derivación explícita ("derivar a tutor humano", task 5.8b), nunca por acceso directo del staff a la conversación completa.
- **Por qué:** HU-11.3 pide minimización estricta: una conversación con un asistente de IA es un dato más sensible/personal que un certificado o un intento SCORM (puede incluir dudas, errores, frustración del alumno expresados en lenguaje natural) — exponerla por defecto a todo el staff académico del tenant excede lo necesario para operar el curso.
- **Alternativas descartadas:** mismo patrón que certificados/SCORM (staff con rama de lectura completa) (descartada: excede la minimización que amerita el contenido de una conversación con IA); ocultar también al superadmin (descartada: necesario para soporte de plataforma ante incidentes).
- **Origen:** 2026-07-17 · task 5.8a (Tutor IA, esquema RAG) · PR #107

## D-057 — Retención de conversaciones del Tutor IA: 180 días, purga diaria automática

- **ID:** D-057
- **Fecha:** 2026-07-17
- **Decisión:** `tutor-maintenance.ts` (`runTutorReconcile`, job diario del worker) purga conversaciones/mensajes con más de `TUTOR_RETENTION_DAYS` (default 180) de antigüedad. Configurable por env, sin UI de override por tenant en esta iteración.
- **Por qué:** Ley 21.719 (minimización/limitación de plazo) — no hay razón operativa para conservar indefinidamente el historial de chat de un alumno con el tutor, a diferencia de certificados/asistencia SENCE (que SÍ tienen obligación de conservación regulatoria). 180 días cubre holgadamente la duración de un curso típico más margen de soporte post-egreso.
- **Alternativas descartadas:** retención indefinida (descartada: viola minimización de la Ley 21.719 sin justificación regulatoria, a diferencia de los datos SENCE); retención configurable por tenant desde el día 1 (descartada: complejidad de UI no justificada todavía; el knob de env ya permite ajustarlo si hace falta).
- **Origen:** 2026-07-17 · task 5.8a (Tutor IA, esquema RAG) · PR #107

## D-058 — Reserva atómica del cupo de mensajes del Tutor IA (advisory lock por tenant) — fix de una condición de carrera real

- **ID:** D-058
- **Fecha:** 2026-07-18
- **Decisión:** el enforcement del límite diario de mensajes/presupuesto mensual del tutor pasó de "leer contadores, luego incrementar al final del streaming" (TOCTOU) a una RPC atómica (`tutor_try_reserve_message`) que hace chequeo + incremento del contador de MENSAJES en la misma transacción, serializada con `pg_advisory_xact_lock` por tenant, llamada ANTES de invocar al proveedor de IA.
- **Por qué:** la revisión adversarial de 5.8b encontró que el diseño original permitía que una ráfaga de requests concurrentes del mismo alumno (o de varios alumnos del mismo tenant) leyera el mismo contador "viejo", pasara TODAS el chequeo, e incurriera cada una en una llamada REAL y pagada a OpenRouter antes de que ninguna alcanzara a incrementar el contador — rompiendo por diseño (no por bug transitorio) el "corte automático al llegar al tope" de la CA de HU-11.2. Límite conocido y documentado: el presupuesto MENSUAL de tokens del tenant no se puede reservar exacto por adelantado (el conteo real de tokens solo se sabe al terminar el streaming) — el advisory lock acota esa ventana a "como mucho 1 request en vuelo por tenant sin sumar", no la elimina del todo.
- **Alternativas descartadas:** dejar el enforcement como estaba, aceptando el riesgo de ráfaga (descartada: viola la CA explícita de HU-11.2 y es trivialmente explotable por un alumno autenticado); reservar también el presupuesto de tokens por adelantado con una estimación (descartada por complejidad/alcance: el fix de mensajes ya cierra el vector de abuso más directo; queda como refinamiento futuro si hace falta).
- **Origen:** 2026-07-18 · revisión adversarial + fix de `feat/h5-5.8b-tutor-chat` · task 5.8b · PR #108

## D-059 — Costo real de OpenRouter vía RPC separada; NUNCA se toca la firma de `tutor_add_usage`/`tutor_add_usage_system`

- **ID:** D-059
- **Fecha:** 2026-07-18
- **Decisión:** el costo real en USD que reporta OpenRouter (chunk final de `usage.cost` del streaming) se acumula en `tutor_usage_daily.cost_usd` vía una RPC NUEVA y separada (`tutor_add_usage_cost`), en vez de agregar un parámetro a las RPCs existentes `tutor_add_usage`/`tutor_add_usage_system` mediante `CREATE OR REPLACE FUNCTION` con un parámetro adicional.
- **Por qué:** en Postgres, agregar un parámetro a una función cambia su firma (lista de tipos), y `CREATE OR REPLACE FUNCTION` con una firma distinta CREA UN OVERLOAD DUPLICADO en vez de reemplazar la función existente — un patrón de bug ya visto y corregido esta misma noche en otra tarea (recreación de `issue_certificate` vía drop+create explícito, task 5.12). Una RPC nueva, independiente, evita ese riesgo por completo sin tocar las 2 firmas que ya funcionan y ya están probadas.
- **Alternativas descartadas:** `CREATE OR REPLACE FUNCTION tutor_add_usage(..., p_cost_usd numeric default 0)` (descartada: riesgo real de overload duplicado, ya materializado en otra parte del código base esta misma sesión); `DROP FUNCTION` + recrear con el parámetro nuevo (descartada: viable pero innecesariamente arriesgada cuando una RPC nueva logra lo mismo con cero riesgo sobre las 2 firmas existentes).
- **Origen:** 2026-07-18 · task 5.8b (Tutor IA, chat streaming) · PR #108

## D-060 — Recordatorios automáticos de alumnos SIEMPRE deterministas; CERO IA en el envío automático

- **ID:** D-060
- **Fecha:** 2026-07-18
- **Decisión:** pese a que HU-5.9 dice literalmente "personalización con IA en Hito 5", el envío automático de recordatorios (`reminders-tick`) sigue siendo 100% plantilla determinista (interpolación de string), enriquecida con datos ya calculados (p.ej. `lastActivityDaysAgo`) pero JAMÁS redactada por un modelo. La IA generativa de la task 5.9 se usa SOLO en flujos con humano-en-el-loop (borrador de respuesta de foro/mensajería que el staff revisa antes de enviar; narrativa del digest semanal de empresa, un correo a RRHH no al alumno).
- **Por qué:** RNF-10 exige que ningún contenido dirigido automáticamente a un alumno salga generado por IA sin revisión humana — un recordatorio automático, por definición, no tiene ese humano en el medio. El texto literal de la HU quedó redactado antes de que este principio se aplicara con este nivel de estrictez; esta entrada deja explícito que el ruling gana sobre el texto literal de la HU, y por qué (verificado por 3 revisores independientes en la sesión de la task 5.9, ninguno encontró IA en el camino automático).
- **Alternativas descartadas:** redactar el recordatorio con IA como sugiere el texto literal de la HU (descartada: viola RNF-10 al no tener humano-en-el-loop en un envío 100% automático); no enriquecer el recordatorio en absoluto (descartada: pierde valor real — el dato de inactividad ya estaba calculado y disponible, ocultarlo sería desperdiciar información útil sin motivo).
- **Origen:** 2026-07-18 · task 5.9 (IA por lotes) · PR #109

## D-061 — Portal de empresa: RUN del trabajador SIEMPRE enmascarado; rama `company` retirada de las policies vivas

- **ID:** D-061
- **Fecha:** 2026-07-17
- **Decisión:** el rol `company` (RRHH de empresa cliente) NO tiene rama de acceso en las policies RLS vivas de `enrollments`/`sence_sessions` (a diferencia de `supervisor`, que sí la tiene con vigencia/alcance — D-044). Todo el acceso de `company` pasa por el servicio curado `company-portal-service.ts`, con cada consulta auditada y el RUN del trabajador SIEMPRE enmascarado antes de llegar a la respuesta.
- **Por qué:** a diferencia del fiscalizador (supervisor, con mandato legal de auditoría), RRHH de una empresa cliente no necesita ni debe ver el RUN completo de sus propios trabajadores para el caso de uso real (seguimiento de avance/asistencia/certificados) — enmascarar por defecto en el servicio, en vez de en la policy RLS, permite auditar cada acceso y mantener la superficie de RLS más simple (sin una tercera rama de rol con reglas de vigencia/alcance como la del supervisor).
- **Alternativas descartadas:** dar a `company` una rama de RLS con vigencia/alcance como `supervisor` (descartada: RRHH no tiene el mismo mandato legal que un fiscalizador OTIC, y el RUN completo no aporta valor a su caso de uso real); exponer el RUN completo confiando en que el frontend lo oculte (descartada: minimización real debe aplicarse en el servidor, no en la presentación).
- **Origen:** 2026-07-17 · task 5.2 (portal empresa) · PR #99

## D-062 — Un usuario `company` pertenece a UNA sola empresa activa por tenant

- **ID:** D-062
- **Fecha:** 2026-07-17
- **Decisión:** `company_members` tiene un índice único parcial que impide que un mismo `user_id` tenga más de una fila activa (`revoked_at is null`) por tenant — un usuario RRHH representa una sola empresa cliente a la vez dentro de una OTEC.
- **Por qué:** simplifica el modelo de autorización (el gate del portal resuelve "la empresa del usuario" sin ambigüedad) y refleja el caso de uso real: una persona de RRHH gestiona su propia empresa, no un portafolio de varias. Si una persona necesita representar 2 empresas, el modelo exige revocar la membresía anterior antes de crear la nueva — explícito y auditable, no implícito.
- **Alternativas descartadas:** permitir múltiples empresas activas por usuario con selector en la UI (descartada: complejidad no justificada por ningún caso de uso real identificado; el modelo simple cubre el 100% de los casos esperados).
- **Origen:** 2026-07-17 · task 5.2 (portal empresa) · PR #99

## D-063 — Export completo del tenant: tope de 300MB con archivos omitidos manifestados

- **ID:** D-063
- **Fecha:** 2026-07-17
- **Decisión:** el export asíncrono del tenant (task 5.13) tiene un presupuesto (`FileBudget`) de 300MB para los archivos de Storage incluidos en el ZIP (certificados PDF, evidencias, etc.); si se excede, los archivos restantes se OMITEN y quedan listados explícitamente en el manifiesto (`MANIFIESTO.csv`), nunca silenciosamente descartados.
- **Por qué:** un tenant con muchos años de operación podría generar un ZIP de tamaño impráctico (horas de generación, límites de memoria del worker) — un tope protege la operación del export sin bloquearlo por completo; manifestar lo omitido (en vez de solo truncar en silencio) mantiene la honestidad del export: quien lo recibe sabe exactamente qué NO está incluido y puede pedirlo aparte.
- **Alternativas descartadas:** sin tope, exportar todo siempre (descartada: riesgo real de agotar memoria/tiempo del worker con un tenant grande); truncar en silencio sin manifestar lo omitido (descartada: viola la honestidad esperada de un export completo — el usuario creería tener todo cuando no es así).
- **Origen:** 2026-07-17 · task 5.13 (export completo del tenant) · PR #101

## D-064 — Alertas de vencimiento de certificado: offsets configurables por tenant, regla anti-ráfaga

- **ID:** D-064
- **Fecha:** 2026-07-17
- **Decisión:** `certificate_expiry_config` permite a cada tenant configurar sus propios offsets de alerta (default 90/60/30 días antes del vencimiento). El worker (`expiry-alerts-tick`) aplica una regla anti-ráfaga: si una alerta "entra tarde" (p.ej. el tick no corrió por unos días y ya pasaron 2 offsets), SOLO notifica el offset MENOR alcanzado, marcando los offsets mayores como enviados sin notificarlos — el alumno nunca recibe 2-3 avisos idénticos de golpe.
- **Por qué:** HU-7.3 pide alertas configurables 90/60/30 pero no todos los tenants operan igual (algunos podrían preferir ventanas distintas); el ledger INSERT-only (`certificate_expiry_alerts`, único por cert×offset) da idempotencia real, y la regla anti-ráfaga evita que un tick con retraso genere una experiencia confusa/spam para el alumno.
- **Alternativas descartadas:** offsets fijos 90/60/30 sin configuración por tenant (descartada: menos flexible sin necesidad real de estar fijo); notificar TODOS los offsets alcanzados si el tick se atrasó (descartada: genera una ráfaga de correos idénticos de golpe, mala experiencia sin beneficio real).
- **Origen:** 2026-07-17 · task 5.12 (vencimientos de certificados) · PR #100

## D-065 — Paleta de marca del Hito 6: azul `#1e3a8a` + cyan `#0ea5e9`, tokens intercambiables

- **ID:** D-065
- **Fecha:** 2026-07-19
- **Decisión:** el overhaul visual (Hito 6) usa como paleta base azul `#1e3a8a` (primary) +
  cyan `#0ea5e9` (accent), expresados como variables oklch en `src/app/globals.css` (no como
  hex fijos en componentes) — decisión explícita de Edu al abrir el hito.
- **Por qué:** esos dos colores ya son los defaults reales de `branding-service.ts` (usados hoy
  en emails transaccionales y PDFs de certificados) — adoptarlos como base de la app evita una
  paleta nueva que contradiga lo que el alumno ya ve en su correo/certificado. Se expresan como
  tokens (no hardcodeados) porque "Chilearning" es marca de trabajo (ver D-046/5.6): el día que
  Edu defina la marca definitiva, el cambio es editar los tokens en un solo archivo, no una
  migración de 64 páginas.
- **Alternativas descartadas:** dejar que el generador de design system (`ui-ux-pro-max`)
  eligiera libremente de su base de datos de paletas (descartada: propuso teal/ámbar,
  desalineado con lo que ya existe en `branding-service.ts` y en producción); definir una
  paleta nueva sin relación con el branding actual (descartada: sin necesidad real, y rompería
  la coherencia visual entre app/email/certificado que ya existe).
- **Origen:** 2026-07-19 · task 6.0/6.1 (Hito 6, overhaul UX/UI)

## D-066 — La skill `ui-ux-pro-max` es tooling de desarrollo, no dependencia runtime; no amerita ADR

- **ID:** D-066
- **Fecha:** 2026-07-19
- **Decisión:** la skill de Claude Code `ui-ux-pro-max` (github.com/nextlevelbuilder/
  ui-ux-pro-max-skill, MIT) se instaló **global** (`~/.claude/skills/`, fuera del repo) y se usó
  una vez para generar `docs/design/MASTER.md` (curado a mano, ver el propio archivo). No se
  agrega como dependencia de `package.json`, no corre en build ni en runtime, y no aparece en
  ningún import de la app — es un script Python de solo lectura sobre CSVs locales, invocado
  manualmente por el agente/Edu al diseñar. Por eso **no** requiere un ADR formal en
  `specs/02-plan-tecnico.md §12` (reservado para dependencias significativas del producto) —
  esta entrada basta para dejar la decisión auditable.
- **Por qué:** CLAUDE.md exige registrar ADR para dependencias significativas; esta herramienta
  no lo es en el sentido que la regla protege (no hay riesgo de supply chain en producción, no
  hay superficie de ataque nueva en el LMS, no hay costo de mantenimiento continuo — es
  reemplazable o eliminable sin tocar una sola línea de `src/`).
- **Alternativas descartadas:** no usar ninguna herramienta de generación de design system y
  diseñar la paleta/tipografía/espaciado a mano desde cero (descartada: más lento y con más
  riesgo de inconsistencia que partir de una base curada y luego ajustarla — ver D-065 para el
  caso concreto en que se corrigió su output); instalarla local al proyecto en vez de global
  (descartada: Edu pidió explícitamente instalación global, y es tooling de tercero — no
  pertenece al repo del producto).
- **Origen:** 2026-07-19 · task 6.0 (Hito 6, overhaul UX/UI)
