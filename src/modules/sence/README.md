# Motor SENCE — CONTRATO CONGELADO

> **Este documento es el contrato del módulo `src/modules/sence/`.** Los tests de las tareas
> 0.6 (mock RCE) y 0.7 (motor) se derivan LITERALMENTE de él. Cambiar este archivo exige:
> diff contra el manual oficial vigente + checklist en `rcetest` + aprobación de Edu (P1)
> + anotación en `docs/sence/CHANGELOG.md`. Ningún código de este módulo puede contradecirlo.

- **Estado:** CONGELADO el **2026-07-14**; **enmendado el 2026-07-16** (ver §Enmiendas).
- **Alcance:** protocolo RCE (Registro de Asistencia E-Learning) con Clave Única, líneas 1, 3 y 6.
- **Manual normativo:** sigue siendo **v1.1.6** (las enmiendas afinan la INTERPRETACIÓN del motor
  sobre casos que el manual deja sub-especificados; no cambian lo que el motor envía a SENCE).

---

## Enmiendas (posteriores al congelamiento)

> Donde una enmienda contradiga el texto original de una cláusula, **manda la enmienda**. Cada una
> nace de una decisión registrada en `specs/DECISIONES.md` con aprobación de Edu (P1).
>
> **Versionado:** esta sección constituye la **revisión interna del CONTRATO** que D-048 denomina
> «v1.1.7». El **manual normativo de SENCE sigue siendo v1.1.6** (no se re-publica): las enmiendas
> afinan la INTERPRETACIÓN del motor en casos que el manual deja sub-especificados, no cambian los
> campos/formatos/endpoints que el motor ENVÍA a SENCE (por eso no exigen re-certificación de envío,
> aunque sí verificación de comportamiento en el primer curso real).

### 2026-07-16 — Rulings de la revisión adversarial H4 ([D-048](../../../specs/DECISIONES.md))

- **E-1 (Q-01, transiciones T5/T7):** el cierre sobre una sesión `iniciada` **NO tiene puerta
  temporal**. Un callback de cierre (`close_ok` → T5, `close_error` → T7) que llega tras `expires_at`
  pero **antes** de que el worker ejecute T6 **aplica su transición** (no queda `late`). La puerta
  temporal ("mientras no se supere `expires_at`") aplica **solo a T8** (reintento de cierre sobre
  `error(close)`). Motivo: un cierre confirmado por SENCE es la evidencia más fuerte; descartarlo
  creaba falsos `expirada` (no-asistencia falsa). La carrera callback-vs-worker la resuelve el CAS.
- **E-2 (Q-05, transición T8):** el reintento de cierre T8 es **alcanzable**: `buildCloseForm`
  (y `/api/sence/close`) aceptan una sesión en `error(close)` con `IdSesionSence` (antes solo
  aceptaban `iniciada`, dejando T8 muerto y la sesión colgada ante SENCE hasta T9). El alumno puede
  además reiniciar una sesión nueva (el índice `one_open_per_enrollment` no cuenta `error(close)`);
  ambas vías coexisten. ⚠ Verificar contra el manual/SENCE si tolera la doble sesión simultánea de la
  misma acción/alumno.
- **E-3 (Q-09, frontera de expiración):** el vencimiento es `now >= expires_at` ("al **alcanzar o**
  superar" `expires_at`); la diferencia con la lectura estrictamente-mayor es de 1 ms.
- **E-4 (Q-02, gate M-4 sobre I-1):** I-1 se enmienda para consagrar el gate M-4: un POST a
  `/api/sence/cb` **sin `IdSesionAlumno` usable** (vacío o >149 chars) **NO es un callback** de SENCE
  (un callback real siempre lo trae) y **no se persiste** — evita inflar la tabla INSERT-only que no
  se puede podar. Condicionado a que el borde tolere nombres de campo con espacios ANTES del filtro
  (ya implementado, H4-R-001) y a **registrar cada descarte** (sin PII: razón + largo) para detectar
  patrones anómalos. Todo callback CON `IdSesionAlumno` usable se sigue persistiendo siempre (I-1).
- **E-5 (Q-07, §5 código dominante para el alumno):** cuando `GlosaError` trae varios códigos, el
  **mensaje que ve el alumno** prioriza un código **accionable por él** (`StudentRecoverable`, ej.
  311/312 de Clave Única) si aparece en la lista; el `dominantCode`/`severity` que gobiernan el
  **alerting interno** siguen siendo los del código más severo. Antes, `300;311` mostraba "problema
  temporal de SENCE" y ocultaba el accionable "ingresa con TU Clave Única".
- **E-6 (Q-04, re-emisión de la sesión pendiente):** `/api/sence/start`, ante una sesión
  `iniciada_pendiente` viva de la misma inscripción (el alumno abandonó Clave Única), **re-emite el
  MISMO form** (mismo `IdSesionAlumno` y nonce) en vez de bloquear — SENCE reprocesa el mismo
  `IniciarSesion` e I-3 absorbe el callback duplicado; no crea sesión ni transición nuevas. El
  `SENCE_PENDING_TIMEOUT_MINUTES` por defecto baja a **15 min** (antes 60; parámetro operativo I-13).

---

## 1. Fuentes normativas

Fuente primaria (única normativa para lo que el motor **promete y envía**):

| # | Documento | SHA256 |
|---|---|---|
| 1 | `integracion_registro_asistencia_sence_v1.1.6.pdf` — **Manual VIGENTE** | `e9435a9e9b95985b81e5ecc9696e42a1c7d7521c838b2217999f05636f8eac4c` |
| 2 | `integracion_registro_asistencia_sence_v1.1.5_0.pdf` (comparación) | `bcc174a5a980fea65119633e132fcb2d1ce16e16932a1ca9d746125b2033121f` |
| 3 | `integracion_registro_asistencia_sence_v1.1.3.pdf` (comparación / arqueología) | `2b9284afa33bea0252744c6bf41040aaf490504dc97d5847fcb4aa65cd3dc04f` |
| 4 | `instructivo_tecnico_de_integracion_entre_lms_y_sic_v2.0_0.pdf` (fuera de alcance F0; ver §7) | `7724337078c18e7598043c204cc3cf65114c92ef135aad64c28d4f125b12fe0d` |
| 5 | `guia_de_uso_gca_e-learning_otec_v1.3_0.pdf` (contexto administrativo) | `1d8a415559fda281c0ab4c7cfbe67e79021c504ceb7ce9c806bc7c63307692d4` |

Fuentes secundarias (solo evidencia de comportamiento en terreno):
`integracion-sence-portable/SPEC_INTEGRACION_SENCE.md` (basada en v1.1.3) y
`block_sence/ANALISIS_PLUGIN_SENCE.md` (plugin Moodle v3.2 en producción).

**Regla de precedencia (innegociable):**

1. Ante cualquier discrepancia, **EL MANUAL v1.1.6 GANA** para todo lo que el motor
   *promete, valida o envía* a SENCE (campos, largos, formatos, endpoints, obligatoriedad).
2. El comportamiento observado del plugin/SPEC portable gana **únicamente para parsing
   defensivo de lo que se RECIBE** (ej.: `GlosaError` como lista separada por `;` aunque el
   manual lo tipifique `Entero`; tolerar nombres de campo con espacios colgantes como
   `"LineaCapacitacion "`). Nunca justifica enviar algo que el manual no permita.
3. Lo que no está en el manual ni en evidencia de terreno es **parámetro operativo** y debe
   declararse configurable y citado como tal (ej.: expiración a 3 h, ver I-13).

---

## 2. Superficie del módulo

El módulo expone exactamente **tres rutas HTTP** y un dominio puro:

| Ruta | Método | Rol |
|---|---|---|
| `/api/sence/start` | POST (app → app) | Pre-vuelo (I-8) + creación de `sence_sessions` en `iniciada_pendiente` + render/redirect del form POST del alumno hacia `.../Registro/IniciarSesion`. |
| `/api/sence/cb` | POST (navegador del alumno, origin SENCE) | Receptor ÚNICO de los 4 callbacks (`UrlRetoma` y `UrlError` de inicio y cierre apuntan aquí). Discrimina por I-4, persiste SIEMPRE (I-1), transiciona la sesión. |
| `/api/sence/close` | POST (app → app) | Render/redirect del form POST del alumno hacia `.../Registro/CerrarSesion` con `IdSesionSence`. |

Reglas estructurales:

- **Dominio puro en `domain/`**: máquina de estados, validadores pre-vuelo (RUN/DV, largos,
  URLs), discriminador de callbacks, parser de `GlosaError` y tabla de errores viven en
  `src/modules/sence/domain/` sin IO — testeables con Vitest sin red ni BD.
- **El módulo NO importa de otros módulos** (`src/modules/*`). Es SAGRADO y aislado: solo
  depende de `domain/` propio, utilidades genéricas (`src/lib`), `src/i18n/es-CL.ts` y el
  cliente de datos vía `tenantGuard()`. El resto de la app importa DE él, nunca al revés (I-16).
- Los callbacks usan service-role (llegan sin JWT del alumno) SIEMPRE a través de `tenantGuard()`.
- Todo borde valida con Zod (requests propios y callbacks de SENCE).

---

## 3. Máquina de estados de `sence_sessions`

Estados: `iniciada_pendiente` → `iniciada` → `cerrada` | `expirada` | `error`.

```
                 ┌──────────────────────┐
  (start) T1 ───►│  iniciada_pendiente  │
                 └──────────┬───────────┘
     T2 cb inicio OK        │       T3 cb inicio ERROR             T4 timeout abandono
   (sin GlosaError,         │  (con GlosaError; IdSesionSence      Clave Única (SIN callback;
    con IdSesionSence)      │   puede venir vacío — I-4)            expiración local)
            ┌───────────────┴─────────────────────┐                 │
            ▼                                     ▼                 ▼
           ┌──────────┐   T7 cb cierre ERROR ┌─────────┐       ┌───────────┐
           │ iniciada │─────────────────────►│  error  │       │ expirada  │
           └──┬───┬───┘   (con GlosaError,   └──┬───┬──┘       └───────────┘
              │   │        sin IdSesionSence)   │   │
              │   │                             │   │  (error de T3: terminal,
T5 cb cierre  │   │ T6 supera expires_at        │   │   nueva sesión → T1)
OK (sin       │   │ (3 h sin cierre,            │   │
GlosaError,   │   │  job del worker)         T8 │   │ T9 supera expires_at
sin           │   │                             │   │ (job del worker,
IdSesionSence)│   │      T8 reintento de        │   │  como T6)
              │   │      cierre OK              │   │
              │   │      (≤ expires_at)         │   │
              │   │  ┌──────────────────────────┘   │
              │   └──┼─────────────────────────┐    │
              ▼      ▼                         ▼    ▼
           ┌──────────┐                      ┌───────────┐
           │ cerrada  │                      │ expirada  │
           └──────────┘                      └───────────┘
```

Transiciones y su evento gatillante (EXHAUSTIVO — cualquier otra transición es un bug):

| # | De → A | Evento que la gatilla |
|---|---|---|
| T1 | *(no existe)* → `iniciada_pendiente` | `POST /api/sence/start` pasa el pre-vuelo (I-8): se genera `id_sesion_alumno` único y se redirige al alumno a `IniciarSesion`. |
| T2 | `iniciada_pendiente` → `iniciada` | Callback de **inicio exitoso**: sin `GlosaError` y con `IdSesionSence`, correlacionado por `id_sesion_alumno`. Se persiste `id_sesion_sence`, `FechaHora`, `ZonaHoraria`; se fija `expires_at = opened_at + duración operativa (3 h, I-13)`. |
| T3 | `iniciada_pendiente` → `error` | Callback de **inicio con error**: `GlosaError` presente (la tabla del callback de error de inicio incluye `IdSesionSence`; puede venir vacío — el discriminador manda `GlosaError`, I-4). Se parsean y persisten los códigos (I-5), se traduce al alumno (I-9). |
| T4 | `iniciada_pendiente` → `expirada` | **Timeout por abandono en Clave Única.** El manual v1.1.6 §2 es explícito: si el alumno no completa el login de Clave Única, SENCE "no retornara parámetros de éxito ni parámetros de fracaso" — **NO HAY CALLBACK**. La expiración es 100% local (job del worker), umbral configurable `SENCE_PENDING_TIMEOUT_MINUTES` (default operativo: 60). |
| T5 | `iniciada` → `cerrada` | Callback de **cierre exitoso**: sin `GlosaError` y sin `IdSesionSence`, correlacionado por `id_sesion_alumno`. Se persiste `closed_at` con la `FechaHora` recibida. ⚠ Errata probable del manual: v1.1.3–v1.1.6 describen `FechaHora` de este callback como «fecha y hora del **inicio** de sesión» (mientras `ZonaHoraria`, en la misma tabla, sí dice «del cierre»); el evento en `sence_events` conserva además su propio timestamp de recepción (I-1) y el punto se verifica en `rcetest` (checklist 0.9). |
| T6 | `iniciada` → `expirada` | Transcurre la **duración operativa de 3 h** (I-13) sin cierre exitoso: job del worker marca `expirada` al superar `expires_at`. |
| T7 | `iniciada` → `error` | Callback de **cierre con error**: `GlosaError` presente y sin `IdSesionSence`. |
| T8 | `error` (proveniente de T7) → `cerrada` | Reintento de cierre (`/api/sence/close` re-envía con el mismo `IdSesionSence`) seguido de callback de cierre exitoso, mientras no se supere `expires_at`. |
| T9 | `error` (proveniente de T7) → `expirada` | Se supera `expires_at` sin que un reintento de cierre (T8) haya prosperado: el mismo job del worker de T6 marca `expirada`. Cierra el ciclo de vida — `error` nunca queda congelado post-`expires_at`; un callback posterior cae en I-15 (`late = true`). |

`cerrada` y `expirada` son **terminales**: ningún callback posterior las modifica (I-15).
`error` proveniente de T3 (inicio) es terminal (no tiene `expires_at`; el alumno debe iniciar
una sesión NUEVA, T1). `error` proveniente de T7 NO es terminal: sale SIEMPRE por T8
(reintento de cierre a tiempo) o T9 (expiración del worker al superar `expires_at`).

---

## 4. Invariantes del motor (I-1 … I-16)

Cada invariante es testeable y tiene al menos un caso en la suite (§8). Formato:
enunciado normativo + justificación de una línea.

- **I-1 — Persistencia total de callbacks.** Todo POST recibido en `/api/sence/cb` se
  persiste en `sence_events` (INSERT-only) con su payload crudo ANTES de cualquier lógica,
  incluso si la correlación por `id_sesion_alumno` falla (`session_id = NULL`,
  `kind = 'unmatched'`). *Justificación: la asistencia SENCE tiene efectos administrativos y
  legales; perder un callback es perder evidencia irrecuperable (el manual §5: "Esta
  información no podrá ser eliminada").*

- **I-2 — INSERT-only.** `sence_events` (y `audit_log`) no admiten UPDATE ni DELETE, ni
  siquiera vía service-role: se garantiza con policies/triggers en BD, no por convención.
  *Justificación: un registro de asistencia auditable no puede ser reescribible (regla dura
  del proyecto).*

- **I-3 — Idempotencia ante replay.** Re-recibir un callback idéntico (mismo
  `dedupe_hash` = hash del payload normalizado + `id_sesion_alumno`) inserta un nuevo evento
  (I-1) pero NO produce una segunda transición de estado, ni duplica asistencia, ni re-notifica
  al alumno. *Justificación: el callback viaja por el navegador del alumno — refresh/re-POST
  del form es un escenario cotidiano, no excepcional.*

- **I-4 — Discriminación de callbacks.** La CLASE del callback se decide por presencia de
  campos, en este orden: `GlosaError` presente y no vacío → **error**; sin `GlosaError` y con
  `IdSesionSence` → **inicio exitoso**; sin `GlosaError` y sin `IdSesionSence` → **cierre
  exitoso**. El SUBTIPO de un error (inicio vs cierre) NO se decide por `IdSesionSence` — en
  errores pre-sesión (ej. 211/204/303) el callback de error de INICIO puede traerlo vacío
  (T3) — sino por el ESTADO de la sesión correlacionada por `id_sesion_alumno`:
  `iniciada_pendiente` → `start_error`; `iniciada` → `close_error`; `error` proveniente de
  T7 (un reintento de cierre T8 que vuelve a fallar) → `close_error`; estados terminales
  (`expirada`, `cerrada`) → el evento se marca `late = true` (I-15) y su subtipo se resuelve
  por la heurística de `IdSesionSence` (no vacío → `start_error`; vacío → `close_error`).
  La presencia de `IdSesionSence` queda SOLO como heurística para clasificar eventos
  `unmatched` (sin correlación posible) y los tardíos recién descritos.
  *Justificación: SENCE postea los 4 casos a URLs que pueden ser la misma; la composición de
  las 4 tablas del manual (§3.2/§3.3) distingue éxito/error/cierre, pero solo el estado local
  de la sesión distingue con certeza un error de inicio de uno de cierre.*

- **I-5 — `GlosaError` es lista.** `GlosaError` se parsea SIEMPRE como texto y se hace split
  por `;` (trim de cada token, descarte de vacíos), aunque el manual lo tipifique `Entero`
  singular. Cada código se traduce por separado (I-9). Payload de terreno documentado: `211;204`.
  *Justificación: parsing defensivo (regla de precedencia §1.2) — el comportamiento
  multi-código está verificado en producción con el plugin `block_sence`, y parsear como texto
  también acepta el caso singular del manual.*

- **I-6 — El token del OTEC es secreto.** El token JAMÁS aparece en logs, respuestas al
  cliente, mensajes de error, `sence_events.payload`, fixtures ni tests; en reposo va cifrado
  con **AES-256-GCM** y solo se descifra en memoria al construir el form POST hacia SENCE.
  *Justificación: el token identifica al OTEC ante SENCE sin segundo factor; el plugin legado
  lo expone en el DOM (anti-patrón documentado) y este motor corrige eso.*

- **I-7 — El token solo viaja hacia SENCE.** El único lugar donde el token sale del servidor
  es el form auto-submit del navegador del alumno hacia `IniciarSesion`/`CerrarSesion`
  (mecanismo impuesto por el protocolo, sin alternativa server-to-server, §7). Los callbacks
  de SENCE NO traen token, por lo que persistir el payload crudo (I-1) no lo expone.
  *Justificación: minimiza la superficie de exposición al único punto que el protocolo obliga.*

- **I-8 — Validación pre-vuelo.** ANTES de redirigir al alumno a SENCE, `/api/sence/start`
  (y `/close`) valida y rechaza localmente: RUN del alumno (formato `xxxxxxxx-x` sin puntos,
  DV módulo 11 correcto, `k` normalizada a minúscula), RUT OTEC (ídem), largos máximos de
  campo del manual (`RutOtec`/`RunAlumno` 10, `Token` 36, `CodSence` 10, `CodigoCurso` 50,
  `IdSesionAlumno`/`IdSesionSence` 149), `CodigoCurso` mínimo 7 caracteres (EXCEPTO línea 6
  FPT; EXCEPCIÓN adicional: `CodigoCurso = "-1"` — y `CodSence = "-1"` donde aplique; en
  línea 1 `CodSence` sigue VACÍO, Anexo 5 — se aceptan SOLO cuando el `environment` de la
  acción es `rcetest` (I-11), pues el manual §4/Anexo 5 permite `-1` en Ambiente Test para
  deshabilitar las verificaciones de códigos cuando no hay código vigente; en `rce` se
  rechaza), `LineaCapacitacion ∈ {1, 3, 6}` y **`UrlRetoma`/`UrlError` ≤ 100 caracteres**
  (límite v1.1.6; v1.1.3 permitía 200 — no confiar en specs viejas). *Justificación: cada
  rechazo local evita un viaje del alumno a SENCE que terminaría en 200/204/205/206/207/209
  y quema su paciencia; los largos de URL rompen con subdominios por tenant; sin la
  excepción `-1` el pre-vuelo bloquearía el flujo de prueba sancionado por el manual (y el
  checklist en `rcetest` que exige la cabecera de este contrato).*

- **I-9 — Traducción TOTAL de errores.** Todo código recibido en `GlosaError` se traduce a
  español de Chile con la tabla de §5 (fuente única de `errors.ts`, códigos 100–313).
  Código no presente en la tabla → **mensaje fallback genérico** + log `WARN` + alerta
  interna. **NUNCA se muestra un código crudo, glosa oficial ni texto técnico al alumno.**
  *Justificación: el manual exige "interprete el error […] y muestre un mensaje adecuado al
  participante"; SENCE puede agregar códigos nuevos sin aviso (311–313 aparecieron en v1.1.5).*

- **I-10 — Quirk `CodSence`/`CodigoCurso`.** `CodSence` lleva SIEMPRE el **código SENCE del
  CURSO** (10 dígitos) y `CodigoCurso` lleva SIEMPRE el **código de la ACCIÓN** (ID acción /
  Folio SENCE / SENCENET; formato SIC en línea 1, ej. `RLAB-19-02-08-0071-1`). En **línea 1
  (Programas Sociales) `CodSence` va VACÍO**. El dominio usa nombres internos inequívocos
  (`senceCourseCode`, `actionCode`) y solo el adaptador de borde mapea a los nombres del
  protocolo. *Justificación: es el error de integración más costoso del protocolo — los
  nombres oficiales significan lo contrario de lo que sugieren (manual, Anexos 4 y 5).*

- **I-11 — Ambiente por ACCIÓN.** El ambiente (`rcetest` ↔ `rce`) es un atributo de cada
  acción/curso en BD, jamás una constante, variable global de build ni flag de tenant. Las
  URLs base viven en configuración y el motor las resuelve por acción en cada envío.
  *Justificación: un mismo tenant opera acciones de prueba y productivas a la vez; hardcodear
  produjo históricamente asistencias de prueba en producción (irreversibles, manual §5).*

- **I-12 — Candado de contenido server-side.** Si la acción tiene `attendance_lock`
  activado, el contenido del curso se bloquea EN SERVIDOR mientras no exista una sesión
  `iniciada` vigente (no expirada) para ese alumno y acción; con candado liberado (o sesión
  vigente) el contenido se sirve. El bloqueo jamás es solo JS del cliente.
  *Justificación: el candado `locker.js` del plugin legado se salta deshabilitando JS —
  defecto documentado que este motor corrige.*

- **I-13 — Expiración a 3 horas (parámetro operativo).** Una sesión `iniciada` expira a las
  **3 horas** de `opened_at` si no llegó cierre exitoso. Este límite **NO tiene fuente en el
  manual RCE v1.1.6** (que no fija duración alguna): es regla operativa heredada del
  ecosistema SENCE/plugin en producción, por lo que se implementa como parámetro configurable
  (`SENCE_SESSION_MAX_HOURS`, default 3), nunca como constante enterrada.
  *Justificación: si SENCE cambia el límite por instructivo administrativo, debe bastar un
  cambio de configuración, no un release.*

- **I-14 — Alumno exento salta SENCE.** Un alumno marcado exento (becario/sin franquicia) en
  su inscripción NO pasa por SENCE: no ve el botón de inicio de sesión SENCE, no se le crean
  `sence_sessions` y el candado (I-12) NUNCA lo bloquea. *Justificación: los becarios no
  registran asistencia vía RCE (regla operativa validada en producción por el grupo
  "Becarios" del plugin legado).*

- **I-15 — Callback tardío no revive sesiones.** Un callback que correlaciona con una sesión
  en estado terminal (`expirada` o `cerrada`) se persiste en `sence_events` (I-1) marcado
  `late = true`, pero NO cambia el estado de la sesión ni crea asistencia nueva.
  *Justificación: revivir una sesión expirada falsearía el registro de asistencia; el evento
  queda como evidencia para revisión administrativa manual.*

- **I-16 — Aislamiento del módulo.** `src/modules/sence/` no importa de ningún otro
  `src/modules/*`; se verifica con regla de lint/dependencias en CI. *Justificación: el
  módulo es SAGRADO — debe poder testearse, auditarse y certificarse contra el mock sin
  arrastrar el resto del sistema.*

---

## 5. Tabla de errores (fuente ÚNICA de `errors.ts` y de los fixtures del mock — tarea 0.6)

Glosas oficiales VERBATIM del manual v1.1.6, Anexo 2 (para los DEPRECATED, de v1.1.3, última
versión donde existen — eliminados desde v1.1.5, confirmado por doble extracción del PDF).
Los mensajes es-CL se centralizan en `src/i18n/es-CL.ts`; esta tabla es su fuente.

| Código | Glosa oficial (verbatim) | Mensaje es-CL para el alumno | Acción del sistema |
|---|---|---|---|
| **100** `DEPRECATED` | Contraseña incorrecta o el usuario no tiene Clave SENCE. *(v1.1.3; eliminado desde v1.1.5)* | *(fallback genérico)* No pudimos registrar tu asistencia en SENCE. Intenta nuevamente; si el problema continúa, avisa a tu OTEC. | Tratar como código desconocido (I-9): persistir, log `WARN` + alerta — no debería llegar con Clave Única. |
| 200 | El POST tiene uno o más parámetros mandatorios sin información. Esto también ocurre cuando un parámetro está mal escrito (por ejemplo, RutAlumno en lugar de RunAlumno), o cuando se ingresan sólo espacios en blanco en un parámetro obligatorio. | Hubo un problema técnico al conectar con SENCE. Ya avisamos al equipo; intenta más tarde. | Bug de integración propio: log `ERROR` + alerta interna al equipo. No reintentar automático. |
| 201 | La URL de Retoma y/o URL de Error no tienen información. Ambos parámetros son obligatorios en todos los POST. | Hubo un problema técnico al conectar con SENCE. Ya avisamos al equipo; intenta más tarde. | Bug de integración propio (pre-vuelo I-8 falló): log `ERROR` + alerta interna. |
| 202 | La URL de Retoma tiene formato incorrecto. | Hubo un problema técnico al conectar con SENCE. Ya avisamos al equipo; intenta más tarde. | Bug de configuración de URLs del tenant: alerta al admin del tenant + equipo. Revisar límite 100 chars (I-8). |
| 203 | La URL de Error tiene formato incorrecto. | Hubo un problema técnico al conectar con SENCE. Ya avisamos al equipo; intenta más tarde. | Ídem 202. |
| 204 | El Código SENCE tiene menos de 10 caracteres y/o no es código válido. | El curso tiene un problema de configuración con SENCE. Avisa al administrador de tu curso. | Marcar la acción como mal configurada; alerta al admin del tenant (revisar `CodSence`, I-10). |
| 205 | El Código Curso tiene menos de 7 caracteres y/o no es código válido. | El curso tiene un problema de configuración con SENCE. Avisa al administrador de tu curso. | Ídem 204, revisar código de ACCIÓN (`CodigoCurso`, I-10; excepción FPT en I-8). |
| 206 | La línea de capacitación es incorrecta. | El curso tiene un problema de configuración con SENCE. Avisa al administrador de tu curso. | Alerta al admin del tenant: revisar `LineaCapacitacion` de la acción. |
| 207 | El Run Alumno tiene formato incorrecto, o tiene el dígito verificador incorrecto. | Tu RUN registrado en la plataforma parece incorrecto. Pide a tu OTEC que lo corrija antes de reintentar. | No debería ocurrir (pre-vuelo I-8): log `ERROR` + alerta; marcar el perfil del alumno para corrección. |
| 208 | El Run Alumno no está autorizado para realizar el curso. | Tu RUN no aparece inscrito ante SENCE para este curso. Contacta a tu OTEC para verificar tu inscripción. | Alerta al admin del tenant: verificar nómina/comunicación de participantes ante SENCE. |
| 209 | El Rut OTEC tiene formato incorrecto, o tiene el dígito verificador incorrecto. | Hubo un problema técnico al conectar con SENCE. Ya avisamos al equipo; intenta más tarde. | Configuración crítica del OTEC rota: alerta crítica al equipo + admin del tenant. |
| **210** `DEPRECATED` | Expiró el tiempo disponible para el ingreso de RUT y Contraseña. El tiempo disponible es de tres minutos. *(v1.1.3; eliminado desde v1.1.5)* | *(fallback genérico)* No pudimos registrar tu asistencia en SENCE. Intenta nuevamente; si el problema continúa, avisa a tu OTEC. | Tratar como código desconocido (I-9): con Clave Única el login abandonado NO genera callback (T4). |
| 211 | El Token no pertenece al OTEC. | No pudimos validar la conexión con SENCE. Avisa al administrador de tu curso e intenta más tarde. | Alerta crítica al admin del tenant: token no corresponde al `RutOtec` configurado. |
| 212 | El Token no está vigente. | No pudimos validar la conexión con SENCE. Avisa al administrador de tu curso e intenta más tarde. | Alerta crítica al admin del tenant: regenerar token en `https://sistemas.sence.cl/rts` y actualizarlo (cifrado, I-6). |
| 300 | Error interno no clasificado, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles. | SENCE presentó un problema temporal. Intenta nuevamente en unos minutos. | Permitir reintento del alumno; si persiste, escalar a SENCE adjuntando los `sence_events` (I-1). |
| 301 | No se pudo registrar el ingreso o cierre de sesión. Esto ocurre cuando la Línea de Capacitación es incorrecta, o el Código de Curso es incorrecto. | No se pudo registrar tu sesión en SENCE. Avisa al administrador de tu curso. | Alerta al admin del tenant: revisar `LineaCapacitacion` y código de acción; permitir reintento tras corrección. |
| 302 | No se pudo validar la información del Organismo, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles. | SENCE presentó un problema al validar los datos del organismo. Intenta más tarde. | Escalar a SENCE con antecedentes; alerta al equipo. |
| 303 | El Token no existe, o su formato es incorrecto. | No pudimos validar la conexión con SENCE. Avisa al administrador de tu curso e intenta más tarde. | Alerta crítica: token corrupto o mal migrado; verificar descifrado AES-256-GCM y largo 36 (I-6, I-8). |
| 304 | No se pudieron verificar los datos enviados, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles (ej. enviar parámetros de inicio o cierre de sesión según corresponda) | SENCE presentó un problema temporal. Intenta nuevamente en unos minutos. | Permitir reintento; si persiste, escalar a SENCE con los parámetros enviados (sin token en el reporte, I-6). |
| 305 | No se pudo registrar la información, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles. (ej. enviar parámetros de inicio o cierre de sesión según corresponda) | SENCE presentó un problema temporal. Intenta nuevamente en unos minutos. | Ídem 304. |
| 306 | El Código Curso no corresponde al código SENCE. | El curso tiene un problema de configuración con SENCE. Avisa al administrador de tu curso. | Alerta al admin del tenant: el par curso/acción no calza — sospechar inversión del quirk I-10. |
| 307 | El Código Curso no tiene modalidad E-learning. | Este curso no está habilitado como e-learning ante SENCE. Avisa al administrador de tu curso. | Alerta al admin del tenant: la acción no está comunicada como e-learning; bloquear nuevos intentos hasta corregir. |
| 308 | El Código Curso no corresponde al RUT OTEC | El curso tiene un problema de configuración con SENCE. Avisa al administrador de tu curso. | Alerta al admin del tenant: la acción pertenece a otro OTEC o el `RutOtec` está mal configurado. |
| 309 | Las fechas de ejecución comunicadas para el Código Curso no corresponden a la fecha actual. | El curso no está en su período de ejecución ante SENCE, por lo que hoy no se puede registrar asistencia. Consulta a tu OTEC. | Bloquear nuevos intentos para la acción + alerta al admin del tenant (revisar fechas comunicadas). |
| 310 | El Código Curso está en estado Terminado o Anulado. | Este curso figura terminado o anulado ante SENCE. Consulta a tu OTEC. | Bloquear nuevos intentos para la acción + alerta al admin del tenant. |
| 311 | Run ingresado en el Login de Clave Única no corresponde con Run alumno informado por el ejecutor. | Iniciaste sesión en Clave Única con un RUN distinto al tuyo inscrito en el curso. Ingresa con TU propia Clave Única e intenta de nuevo. | Permitir reintento inmediato (nueva sesión T1); contar reintentos para detectar suplantación y registrar en `audit_log`. |
| 312 | No se pudo completar la autenticación con Clave Única. | No pudimos validar tu identidad con Clave Única. Intenta nuevamente; si el problema continúa, recupera tu Clave Única en claveunica.gob.cl. | Permitir reintento inmediato (nueva sesión T1). |
| 313 | URL de Cierre de sesión Incorrecta. | Hubo un problema técnico al cerrar tu sesión SENCE. Ya avisamos al equipo; intenta cerrar nuevamente. | Bug de integración propio en `/api/sence/close`: log `ERROR` + alerta interna; habilitar reintento de cierre (T8). |
| *(desconocido)* | — | No pudimos registrar tu asistencia en SENCE. Intenta nuevamente; si el problema continúa, avisa a tu OTEC. | Fallback obligatorio (I-9): persistir evento, log `WARN` "unknown SENCE error code", alerta interna. |

Notas normativas de la tabla:

- Los códigos **100 y 210 están DEPRECATED**: existen en v1.1.3 y desaparecen del Anexo 2 en
  v1.1.5 y v1.1.6 (confirmado por doble extracción independiente de los tres PDFs). Se
  mantienen en `errors.ts` SOLO como entradas marcadas `deprecated: true` que resuelven al
  fallback — el mock (tarea 0.6) NO los emite.
- El mock (tarea 0.6) debe poder emitir **todos** los códigos no-deprecated (200–212 sin 210,
  300–313), tanto solos como en combinación multi-código (`"211;204"`), en callbacks de
  inicio y de cierre según corresponda.
- La glosa 308 no lleva punto final y la 313 escribe "Incorrecta" con mayúscula: son así en
  el original — no "corregir" los fixtures.

---

## 6. Datos (shape resumido — las migraciones SQL son la fuente de verdad)

Ambas tablas llevan `tenant_id` + política RLS (regla dura del proyecto).

### `sence_sessions` (mutable, una fila por apertura)

| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid | RLS |
| `enrollment_id` | uuid | inscripción alumno↔acción (de ella salen RUN, exención y código de acción) |
| `sence_course_code` | text nullable | `CodSence` — VACÍO/NULL en línea 1 (I-10) |
| `action_code` | text | `CodigoCurso` (código de ACCIÓN; formato SIC en línea 1) |
| `training_line` | smallint | 1, 3 o 6 |
| `run_alumno` | text | snapshot al momento del envío, formato `xxxxxxxx-x` |
| `id_sesion_alumno` | text UNIQUE | correlador generado por el motor (≤149), indexado |
| `id_sesion_sence` | text nullable | llega en T2; requerido para cerrar |
| `status` | enum | `iniciada_pendiente` \| `iniciada` \| `cerrada` \| `expirada` \| `error` (§3) |
| `environment` | enum | `rcetest` \| `rce` — copiado de la ACCIÓN al crear (I-11) |
| `opened_at` / `closed_at` | timestamptz nullable | `FechaHora` de callbacks T2 / T5 |
| `zona_horaria` | text nullable | puede NO venir en el callback (visto en terreno) — tolerar ausencia |
| `expires_at` | timestamptz nullable | `opened_at + SENCE_SESSION_MAX_HOURS` (I-13) |
| `error_codes` | text[] | códigos parseados del último `GlosaError` (I-5) |
| `created_at` / `updated_at` | timestamptz | |

### `sence_events` (INSERT-only — sin UPDATE/DELETE, I-2)

| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid nullable | NULL si la correlación falla y no se puede atribuir (I-1) |
| `session_id` | uuid nullable FK | NULL si `id_sesion_alumno` no correlaciona |
| `kind` | enum | `start_ok` \| `start_error` \| `close_ok` \| `close_error` \| `unmatched` (I-4) |
| `payload` | jsonb | POST crudo completo del callback — nunca contiene el token (I-7) |
| `glosa_error_raw` | text nullable | valor crudo recibido |
| `error_codes` | text[] | resultado del split por `;` (I-5) |
| `late` | boolean | `true` si la sesión ya estaba en estado terminal (I-15) |
| `dedupe_hash` | text indexed | base de la idempotencia (I-3) |
| `received_at` | timestamptz | |

---

## 7. Lo que el motor NO promete

- **No hay API server-to-server.** El protocolo RCE opera exclusivamente con POSTs del
  navegador del alumno (form `application/x-www-form-urlencoded`). El motor no puede
  consultar, corregir ni reintentar nada contra SENCE sin el navegador del alumno de por medio.
- **No garantiza que llegue un callback.** Si el alumno abandona en el login de Clave Única,
  SENCE no retorna éxito NI fracaso (manual v1.1.6 §2): solo existe la expiración local T4.
- **No responde por la disponibilidad de SENCE.** Caídas, lentitud o errores 30x de la
  plataforma SENCE se registran y traducen, pero no hay SLA posible sobre un tercero.
- **API LMS-SIC fuera de alcance** hasta que se active la línea 1 en producción (instructivo
  LMS-SIC v2.0 listado en §1 solo como referencia futura).
- **No valida nóminas ante SENCE.** Que el RUN esté autorizado (208), la acción vigente
  (309/310) o comunicada como e-learning (307) solo se conoce cuando SENCE responde.
- **No promete `ZonaHoraria`.** En terreno el campo puede faltar; se persiste si viene.
- **`rcetest` no valida códigos** (`-1` deshabilita verificaciones): un verde en test NO
  certifica la configuración productiva de la acción.
- **No convierte sesiones en horas de asistencia liquidables**: la interpretación
  administrativa (DJ, liquidaciones) pertenece a otros módulos/procesos.

---

## 8. Derivación de tests (gate F0)

**Convención innegociable:** cada invariante **I-n** tiene AL MENOS un caso que lo referencia
por nombre (`describe('I-5 ...')`) en `engine.test.ts` (dominio puro, sin IO) **y/o** en la
suite de integración contra el mock RCE local (`pnpm sence:mock`, puerto 4010, tarea 0.6).
Un PR que toque el motor sin mantener esa correspondencia se rechaza.

Casos mínimos del gate F0 (tarea 0.7) y los invariantes que cubren:

| # | Caso | Invariantes / transiciones |
|---|---|---|
| 1 | **Apertura exitosa**: start → redirect → callback inicio OK → `iniciada`, `id_sesion_sence` y `expires_at` persistidos | T1, T2, I-1, I-4, I-10, I-11 |
| 2 | **TODOS los códigos de error** (200–212 sin 210, 300–313) emitidos por el mock, uno a uno y en combinación `;` — cada uno verifica su mensaje es-CL exacto de §5 y que el código crudo NO llega al alumno | T3, T7, I-4, I-5, I-9 |
| 3 | **Callback de cierre**: close → callback cierre OK → `cerrada`, `closed_at` persistido | T5, I-4 |
| 4 | **Callback tardío**: sesión `expirada`, llega callback de cierre → evento persistido con `late = true`, estado NO cambia | I-1, I-15 |
| 5 | **Replay/duplicado**: mismo callback dos veces → dos filas en `sence_events`, UNA transición, cero efectos duplicados | I-1, I-2, I-3 |
| 6 | **Expiración a 3 h**: sesión `iniciada` supera `expires_at` (reloj simulado y parámetro configurable) → `expirada`; y `iniciada_pendiente` supera timeout de abandono → `expirada` sin callback alguno | T4, T6, I-13 |
| 7 | **RUN inválido**: DV incorrecto, con puntos, o largo excedido → rechazo pre-vuelo SIN redirigir a SENCE; ídem URL > 100 chars y `CodigoCurso` < 7 (salvo línea 6 y salvo `-1` con `environment = rcetest`; `-1` en `rce` se rechaza) | I-8 |
| 8 | **Candado activado/liberado**: con `attendance_lock` y sin sesión vigente el contenido responde bloqueado EN SERVIDOR; con sesión `iniciada` vigente (o candado liberado) se sirve | I-12 |
| 9 | **Alumno exento**: inscripción exenta → sin botón SENCE, sin `sence_sessions`, contenido nunca bloqueado | I-14 |

Casos adicionales exigidos por invariantes no cubiertos arriba: token jamás en logs/fixtures
ni en `payload` de eventos + cifrado AES-256-GCM en reposo (I-6, I-7); línea 1 con `CodSence`
vacío y código de acción SIC (I-10); ausencia de imports cruzados verificada en CI (I-16);
reintento de cierre tras error de cierre (T7 → T8) y expiración de `error` sin reintento
exitoso (T7 → T9); error de INICIO con `IdSesionSence` vacío clasificado `start_error` por
estado de la sesión (I-4).

Los fixtures del mock (tarea 0.6) se generan DESDE la tabla de §5 — nunca a mano — y usan
exclusivamente datos ficticios (generador del proyecto; jamás RUN reales).
