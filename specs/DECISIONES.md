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
