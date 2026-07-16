# Revisión adversarial del módulo SENCE — Hito 4, tarea 4.1b

> **Qué es:** la revisión adversarial completa de `src/modules/sence/` exigida por la tarea 4.1
> del Hito 4 (checklist pre-producción) y por la Definición de Hecho §9 ("cambio en `sence/`, RLS
> o auth → revisión por OTRO agente"). La ejecutó un panel multi-agente distinto del implementador,
> el 2026-07-16, contra el contrato congelado `src/modules/sence/README.md` (v1.1.6).
>
> **Para qué:** es el gate de código antes del piloto real con alumnos de franquicia (4.2). El
> registro de asistencia SENCE tiene valor legal/tributario: un fallo aquí puede costar la
> franquicia de un curso. Este documento es la evidencia auditable de que el motor se revisó a
> fondo, qué se encontró, qué se corrige y qué queda pendiente de decisión de Edu.

## Metodología

Panel de **26 agentes** (Workflow multi-agente), en tres fases:

1. **6 lentes independientes en paralelo**, cada uno con scope y prompt propios:
   - **L1** Contrato ↔ código (cada invariante I-x / transición T-x del README vs. la implementación).
   - **L2** Ciclo del token / cripto / PII (cifrado, stripping, fugas a logs/audit/payload/Sentry).
   - **L3** Máquina de estados / concurrencia / tiempo (CAS, carreras callback-vs-worker, relojes).
   - **L4** RLS / migraciones / service-role (policies, grants por columna, INSERT-only, aislamiento).
   - **L5** Superficie HTTP / callback (rutas, parsing, `resolvePublicOrigin`, rate-limit del callback).
   - **L6** Tabla de errores vs. manual (completitud/clasificación de códigos 100–313, textos es-CL).
2. **Consolidación**: dedupe de 25 hallazgos brutos → **19 únicos**; 14 rulings brutos → **10**.
3. **Refutación adversarial**: un agente fresco por hallazgo, con mandato de **demolerlo** leyendo el
   código real. Veredictos: `CONFIRMED` (traza de fallo reproducida file:line) / `REFUTED` (evidencia
   que lo desmiente) / `PLAUSIBLE` (no decidible sin infra externa o ruling de Edu).

A cada lente se le sembró la lista de hallazgos **ya corregidos** (open-redirect #20, fuga
`token_encrypted` #22, D-012/D-013/D-014, rate-limit por-usuario 3.6, scrubber Sentry F1) para no
re-reportarlos, y la regla "si el fix altera el contrato congelado → marcar `spec-P1`, no improvisar".

**Resultado:** 19 hallazgos — **16 CONFIRMED, 2 PLAUSIBLE, 1 REFUTED** — + **10 rulings** para Edu.

## Veredicto global — **SHIP CON FIXES + rulings de Edu**

El motor está fundamentalmente sano: la refutación **descartó** las regresiones de los controles ya
endurecidos (INSERT-only resiste al `service_role`, sin cruce de tenants, aislamiento del service-role
a 3 vías sancionadas, endurecimiento supervisor 3.11 intacto, dedupe no-único D-012 correcto — ver
§Candidatos verificados). Pero la revisión encontró **1 HIGH de seguridad real** y varios defectos de
robustez que hay que atender antes del piloto:

- **Bloqueante duro (fix obligatorio antes del piloto):** `H4-R-002` — el `callback_nonce` (secreto
  anti-falsificación H-2) es legible por cualquier cuenta de staff del tenant vía PostgREST → un
  insider puede **falsificar callbacks y alterar la asistencia con valor legal de otro alumno**.
- **Fixes de robustez de alto valor (este mismo lote):** `H4-R-001`, `H4-R-005`, `H4-R-007`,
  `H4-R-015`, `H4-R-016` — cierran rutas concretas de pérdida de asistencia o 500 crudo al alumno.
- **Rulings que Edu debe decidir antes de operar** (tocan el flujo SENCE / el contrato): sobre todo
  `H4-Q-01` (cierre tras `expires_at`), `H4-Q-04` (desbrickeo de la sesión pendiente), `H4-Q-02`
  (gate M-4 vs. I-1) y `H4-Q-03` (anti-DoS del callback en el edge).
- **Follow-ups de UX antes de exponer alumnos reales:** `H4-R-010`/`H4-R-012` (hoy el alumno puede
  ver JSON técnico en inglés en vez del mensaje es-CL que I-9 exige).

Con el lote de fixes aplicado (PR de fixes H4) y las decisiones de Edu tomadas sobre los rulings, el
módulo queda apto para el piloto controlado (grupo pequeño, Edu monitoreando, Plan B a mano).

---

## Hallazgos (19)

Severidad = tras refutación (puede haber bajado/subido respecto de la del lente). **Disposición:**
`FIX` = va en el PR de fixes H4 · `RULING` = decisión de Edu (§Rulings) · `FOLLOW-UP` = deuda anotada
que no bloquea el piloto · `REFUTED` = descartado.

| ID | Sev | Veredicto | Área | Archivo | Defecto (resumen) | Disposición |
|---|---|---|---|---|---|---|
| **H4-R-002** | **HIGH** | CONFIRMED | RLS | `…220251_sence_config…sql:159` | `callback_nonce` legible por staff del tenant (grant de tabla sin revoke de columna) → falsificación de callbacks | **FIX** (migración) |
| **H4-R-003** | HIGH | CONFIRMED | Estados | `engine.ts:425` | T8 (reintento de cierre tras `close_error`) es inalcanzable desde el servicio/UI | **RULING** (H4-Q-05) |
| **H4-R-004** | HIGH | CONFIRMED | Estados | `engine.ts:168` | Sesión `iniciada_pendiente` abandonada brickea al alumno hasta 60 min, sin salida | **RULING** (H4-Q-04) |
| **H4-R-001** | MED | CONFIRMED | Contrato | `engine.ts:224` | Nombres de campo con espacio colgante no se toleran → callback real se descarta en silencio (I-1) | **FIX** |
| **H4-R-005** | MED | CONFIRMED | Token/I-1 | `server-deps.ts:21` | El receptor parsea la clave de cifrado antes de persistir → clave rota = callback perdido (500) | **FIX** |
| **H4-R-006** | MED | CONFIRMED | Estados | `engine.ts:314` | Insert de evento y update de sesión no atómicos → crash entre ambos = transición perdida | FOLLOW-UP (reconciliación worker; nota README → Edu) |
| **H4-R-007** | MED | CONFIRMED | Correlación | `engine.ts:242` | Error del SELECT de correlación descartado en silencio → callback real cae `unmatched` sin señal | **FIX** |
| **H4-R-008** | MED | CONFIRMED | RLS/PII | `…supervisor_grants.sql:182` | Rol `company` ve asistencia (RUN) de TODO el tenant, no solo de sus trabajadores | FOLLOW-UP (falta modelo company↔trabajadores; sin usuarios `company` en el piloto) |
| **H4-R-009** | MED | CONFIRMED | Errores | `engine.ts:302` | El motor nunca consulta `errors.ts` en el callback → las "acciones del sistema" §5 (audit_log, alerta admin) no se ejecutan | FOLLOW-UP (alto valor; diseñar con Edu) |
| **H4-R-010** | MED | CONFIRMED | UX/I-9 | `cb/[nonce]/route.ts:27` | El mensaje es-CL de la tabla §5 nunca se muestra al alumno (redirige a `/dashboard` sin contexto) | FOLLOW-UP UX (antes de alumnos reales) |
| **H4-R-011** | MED | PLAUSIBLE | RLS/I-12 | `…demo_lessons.sql:29` | El candado de contenido I-12 se aplica solo al render; PostgREST deja leer la lección sin sesión SENCE | **RULING** |
| **H4-R-012** | MED | CONFIRMED | UX/I-9 | `start/route.ts:52` | `/start` y `/close` devuelven JSON crudo (inglés) que el navegador muestra al alumno tras un form submit | FOLLOW-UP UX (con R-010) |
| **H4-R-013** | MED | CONFIRMED | Operación | `worker/index.ts:164` | El worker es el único desbrickeador/expirador y su healthcheck siempre pasa; muerte silenciosa = expiraciones congeladas | FOLLOW-UP (infra: alerta de vida del tick) |
| **H4-R-014** | LOW | **REFUTED** | HTTP | `engine.ts:444` | `buildCloseForm` no re-corre el pre-vuelo I-8 en el cierre | REFUTED (I-8 ya validó en start; el cierre no re-arma URLs de usuario) |
| **H4-R-015** | MED | PLAUSIBLE | HTTP | `protocol.ts:57` | La rama fallback de `resolvePublicOrigin` no valida host ni fuerza https (no fail-closed) | **FIX** (cierra el follow-up R1) |
| **H4-R-016** | MED | CONFIRMED | HTTP | `engine.ts:182` | Doble-click / sesión vencida en ventana del tick → violación de índice único → **500 crudo** al alumno | **FIX** |
| **H4-R-017** | LOW | CONFIRMED | Estados | `engine.ts:253` | Una fila con `callback_nonce` NULL transiciona por la ruta sin nonce (`null === null`) | FOLLOW-UP (defensa en profundidad; sin filas NULL en prod) |
| **H4-R-018** | LOW | CONFIRMED | Operación | `expiry.ts:376` | Cooldown de alertas es check-then-insert sin unicidad → dos ticks pueden duplicar alertas | FOLLOW-UP |
| **H4-R-019** | LOW | CONFIRMED | Contrato | `errors.ts:449` | Discrepancia documental: §2 promete Zod en el callback, pero el receptor no usa Zod | FOLLOW-UP (corregir comentario/§2, spec-P1 menor) |

### Detalle de los HIGH

**H4-R-002 — `callback_nonce` legible por staff del tenant (fix obligatorio).**
`sence_sessions` tiene un `grant select` de **tabla completa** a `authenticated` (`…192729:144`); la
columna `callback_nonce` se añadió después (`…220251:159`) sin revoke de columna. En PostgreSQL el
revoke de columna **no** anula un grant de tabla (lección ya aprendida con `token_encrypted`, #22),
así que el nonce es legible por PostgREST para todo el staff del tenant (la policy `select_staff` no
restringe por usuario). Con `(id_sesion_alumno, callback_nonce)` de una víctima, un insider hace
`POST /api/sence/cb/{nonce}` y el motor transiciona la sesión de la víctima (nonce válido → forja un
`close_ok` sobre `iniciada` → `cerrada`, o un `start_ok` sobre `iniciada_pendiente`). Anula la premisa
de D-013 (H-2) y **altera asistencia con valor legal**. *Fix:* replicar el patrón final de
`token_encrypted` — `revoke select on sence_sessions from authenticated` + `grant select` de todas las
columnas **menos** `callback_nonce`; el motor la lee vía service-role (inmune a los grants de
`authenticated`). + test RLS que afirme que un cliente `authenticated` no puede leerla.

**H4-R-003 — T8 inalcanzable → RULING H4-Q-05.** El contrato promete que tras un `close_error` la
sesión puede reintentar el cierre (T8, "mientras no se supere `expires_at`"), pero `buildCloseForm`
rechaza todo status ≠ `iniciada` → tras un `close_error` la sesión solo sale por expiración (T9).
El dominio y `errors.ts` (código 313) sí soportan T8; ningún camino de servicio lo gatilla. Como
arreglarlo cambia el flujo de cierre SENCE (sagrado, P3), **se eleva como ruling a Edu**, no se
auto-corrige.

**H4-R-004 — Brick de la sesión pendiente → RULING H4-Q-04.** Una `iniciada_pendiente` abandonada
(el alumno no completó Clave Única) deja al alumno sin salida hasta que el worker la expira (default
60 min): la UI muestra "esperando" y un nuevo `start` viola el índice único → 500. Es un dolor real y
seguro con alumnos reales. El fix recomendado (que `/start` re-emita el form de la pendiente vigente)
toca el flujo → **ruling a Edu** (H4-Q-04), con bajar `SENCE_PENDING_TIMEOUT_MINUTES` a ~15 min.

### Hallazgos que se corrigen en el PR de fixes H4

`H4-R-001` (lector tolerante a nombres de campo con espacios, preservando el payload crudo, +
tests de integración con el quirk `trailingSpaceFieldNames` del mock para los 4 tipos de callback) ·
`H4-R-002` (migración del grant de `callback_nonce` + test RLS) · `H4-R-005` (clave de cifrado
perezosa / deps mínimos para el callback + try/catch que garantice persistir; el callback nunca
necesita la clave) · `H4-R-007` (capturar y loguear el error del SELECT de correlación con
`idSesionAlumno` + `error.code`, sin payload ni token; opcional un reintento) · `H4-R-015`
(`resolvePublicOrigin` fail-closed: anclar el fallback a un origin canónico pasado por parámetro,
nunca reflejar `request.url` ni emitir no-https) · `H4-R-016` (detectar `23505` en `startSession` →
resultado tipado `already_open` → redirect 303 amable, en vez de 500).

Todos son fixes que **implementan el contrato** o refuerzan la defensa en profundidad; ninguno cambia
una transición T1–T9 ni requiere tocar el README congelado.

### Follow-ups (deuda anotada, no bloquea el piloto)

- **H4-R-006** (atomicidad evento↔estado): añadir un barrido de reconciliación al tick del worker
  (re-aplica vía la máquina pura + CAS, **antes** del barrido de expiración) + `try/catch` alrededor
  de `persistState`. Requiere una nota en README §3 que Edu debe aprobar. Severidad MED (la evidencia
  no se pierde; el estado inconsistente se resuelve por T4 en ≤60 min).
- **H4-R-008** (rol `company` ve todo el tenant): no hay hoy modelo `company`↔trabajadores (no existe
  `company_id`), así que no es un filtro faltante sino una feature ausente. **No bloquea el piloto**
  (la OTEC de Edu no usa el rol `company`). Diseñar el scoping cuando entre el portal empresa (Hito 5).
- **H4-R-009** (acciones del sistema §5 no se ejecutan): cablear al menos `audit_log` en callbacks de
  error + alerta al admin por códigos críticos (211/212/303). Alto valor operativo; diseñar con Edu.
- **H4-R-010 / H4-R-012** (UX I-9): el alumno debe ver el mensaje es-CL de la tabla §5, no JSON crudo
  ni un redirect mudo. Fix de UI (con verificación RNF-6 360/1440) **antes de exponer alumnos reales**.
- **H4-R-013** (vida del worker): añadir una alerta de "sin tick en N min" (el healthcheck trivial no
  detecta una muerte silenciosa). Ya está reflejado en el Plan B (Escenario D) y el runbook de monitoreo.
- **H4-R-017 / H4-R-018 / H4-R-019** (LOW): exigir nonce no-nulo para correlacionar (+ simplificar el
  fallback de `buildCloseForm`); deduplicar alertas (lock Redis o índice único por ventana); alinear
  el comentario de `errors.ts`/§2 sobre Zod en el callback.

### Refutado

**H4-R-014** — se planteó que `buildCloseForm` no re-corre el pre-vuelo I-8. La refutación lo bajó a
LOW/descartado: I-8 ya validó en `startSession`, y el cierre no re-arma URLs bajo control del usuario
que justifiquen re-validar; sin escenario de fallo concreto.

---

## Rulings — requieren decisión de Edu

Estas NO son defectos de implementación: son interpretaciones deliberadas del contrato (varias ya
anotadas como preguntas abiertas Q1–Q3 en `session.ts`) o posturas de infraestructura. Cada una tiene
comportamiento actual, alternativa literal del contrato, recomendación y una pregunta cerrada.

| ID | Tema | Recomendación | Pregunta para Edu |
|---|---|---|---|
| **H4-Q-01** | `close_ok` que llega tras `expires_at` pero antes de que el worker expire la fila → hoy queda `late` y la sesión termina `expirada` aunque SENCE la cerró | Adoptar la lectura literal (el cierre gana hasta que el worker ejecute T6): un cierre confirmado por SENCE es la evidencia más fuerte, descartarlo crea falsos `expirada` | ¿El `close_ok` post-`expires_at` pero pre-worker debe **cerrar** (literal, recomendado) o quedar `late` (actual)? |
| **H4-Q-02** | El gate M-4 descarta POSTs sin `IdSesionAlumno` usable, pero I-1 del README dice "todo POST se persiste" sin excepción | Enmendar I-1 (P1) para consagrar M-4, **condicionado** al trim de nombres de campo (H4-R-001) + un contador de descartes | ¿Apruebas enmendar I-1 para consagrar M-4, condicionado al trim de claves y a un contador de descartes? |
| **H4-Q-03** | El callback público no tiene rate-limit (por diseño: I-1 exige persistir). Un bot puede inflar `sence_events` (INSERT-only) | Confirmar y documentar un rate-limit en Traefik/Coolify sobre `/api/sence/cb/*` + priorizar la alerta de crecimiento de `unmatched` antes del piloto | ¿Confirmas rate-limit + alerta de `unmatched` en el edge antes del piloto, y con qué herramienta? |
| **H4-Q-04** | Sesión `iniciada_pendiente` abandonada brickea al alumno 60 min (deriva de H4-R-004) | Aprobar que `/start` re-emita el form de la pendiente existente (misma sesión y nonce; no toca §3) + bajar el timeout a ~15 min | ¿`/start` re-emite el form de la pendiente en vez de fallar con 500, dejando T4 al worker? |
| **H4-Q-05** | El índice único excluye `error(close)` → posible doble sesión simultánea del mismo alumno tras un `close_error` (ligado a T8, H4-R-003) | Mantener la exclusión (no bloquear al alumno mientras T8 no exista) y arreglar T8 aparte; verificar si SENCE tolera la doble sesión | ¿Aceptas la posible doble sesión tras `error(close)`, o el motor debe impedir la 2ª apertura? |
| **H4-Q-06** | El alumno puede auto-falsificar SU propia sesión (conoce su nonce e `IdSesionAlumno`); límite inherente del protocolo RCE (browser-mediado, sin firma) | Aceptar como límite del protocolo; la asistencia legal vive en SENCE, la mitigación real es reconciliar en la DJ/liquidación | ¿Aceptas la auto-falsificación de la sesión propia como límite inherente, o quieres defensa extra? |
| **H4-Q-07** | Código dominante en `GlosaError` multi-código: hoy gana el más severo; puede ocultar al alumno el accionable (311/312) | Mantener "más severo" para alerting, pero que el **mensaje al alumno** prefiera un código accionable (311/312) si aparece; congelar en §5 | ¿El mensaje al alumno debe ser el del código MÁS SEVERO (actual) o el ACCIONABLE por él (311/312) si está? |
| **H4-Q-08** | Un `close_error` con `GlosaError` presente-pero-vacía es indistinguible de un cierre exitoso (misma URL para `UrlRetoma`/`UrlError`) | Mantener I-4; evaluar un discriminador en `UrlError` como defensa en profundidad (cambio de contrato → spec-P1) | ¿Agregamos un marcador a `UrlError` para detectar el error con `GlosaError` vacía? |
| **H4-Q-09** | Q1: frontera `>=` vs `>` en `now === expires_at` (hoy `>=`, expira en el instante exacto) | Ratificar `>=` (determinista, ya testeado, diferencia de 1 ms) y ajustar la letra del contrato ("al alcanzar o superar") | ¿Ratificas `now >= expires_at` como vencimiento, ajustando la letra del contrato? |
| **H4-Q-10** | Q3: `start_ok` tardío no está gateado por tiempo; la carrera T2-vs-T4 la decide el CAS | Mantener como está (la llegada del callback prueba que no hubo abandono); guardrail: no bajar el pending-timeout de ~15 min | (Sin acción de código; ratificar el comportamiento y el guardrail del timeout) |

> Nota: `H4-Q-01`, `H4-Q-02` y `H4-Q-04` son las de mayor impacto operativo para el piloto. `H4-Q-01`
> puede estar creando falsos `expirada` (no-asistencia falsa) en cierres cercanos al límite de 3 h.

---

## Candidatos verificados y descartados (defensa que SÍ funciona)

La refutación confirmó que estos controles están correctos — **no** son defectos (útil para no
re-flaggearlos en futuras revisiones):

- **INSERT-only resiste al `service_role`:** `sence_events` y `audit_log` revocan update/delete/truncate
  a anon/authenticated/**service_role** + triggers de fila y de sentencia (incl. TRUNCATE); la suite RLS
  verifica que ni el `service_role` puede modificarlas.
- **Sin cruce de tenants:** todas las policies de `sence_sessions`/`sence_events` y las funciones
  `SECURITY DEFINER` del supervisor anclan por `tenant_id = jwt_tenant_id()` (o superadmin).
- **Aislamiento del service-role:** las únicas 3 vías (tenant-guard, worker, callback) están acotadas por
  `service-role-isolation.test.ts`; no apareció una 4ª vía.
- **Endurecimiento supervisor 3.11 intacto:** las policies endurecidas mantienen el contrato (supervisor
  con grant activo y en alcance ve; el resto no).
- **`token_encrypted` sigue cerrado** (#22): grant acotado a columnas no sensibles; el token no llega a
  `authenticated`.
- **Dedupe no-único (D-012) correcto:** el re-envío legítimo persiste un 2º evento (I-1); la idempotencia
  de la *transición* la garantiza la máquina de estados, no la BD.

## Cobertura y límites de la revisión

- La revisión es **estática** (lectura de código + migraciones + contrato + mock, sin ejecutar la suite);
  los hallazgos `CONFIRMED` traen traza file:line reproducible. Los 2 `PLAUSIBLE` (`H4-R-011`,
  `H4-R-015`) dependen de comportamiento no decidible desde el repo (config de Traefik / si Next refleja
  el Host del cliente en `request.url`).
- Los 3 servidores MCP (Supabase/Stripe/Tavily) requerían autorización y no se usaron; no eran necesarios
  (revisión de código local).
- **No sustituye la certificación `rcetest`**, que sigue parqueada por el bloqueo del lado de SENCE
  (Clave SENCE deprecada); la validación end-to-end contra `rce` se hará en el primer curso real
  (condiciones controladas — ver `CHECKLIST-PREPRODUCCION.md`).

---

*Panel multi-agente · 2026-07-16 · contrato de referencia `src/modules/sence/README.md` v1.1.6 ·
decisión de registro: [D-047](../../specs/DECISIONES.md).*
