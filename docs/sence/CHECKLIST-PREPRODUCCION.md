# Checklist pre-producción SENCE — Hito 4, tarea 4.1a

> **Qué es:** el checklist go/no-go que Edu firma ANTES de correr la primera acción real de
> franquicia contra producción SENCE (`rce`) con alumnos (tarea 4.2). Cada ítem se marca
> `[x]` solo cuando está verificado. Ningún ítem se da por hecho. Complementa —no reemplaza— el
> [`RUNBOOK-CERTIFICACION-RCETEST-STAGING.md`](RUNBOOK-CERTIFICACION-RCETEST-STAGING.md).

## Decisión marco (leer antes de firmar)

La certificación `rcetest` quedó **parqueada** por un bloqueo del lado de SENCE (su `rcetest` usa
la Clave SENCE deprecada; error 210). Edu decidió **diferir la validación end-to-end al primer
curso real** en producción (`rce` con Clave Única), en **condiciones controladas**: grupo pequeño,
Edu monitoreando en vivo, Plan B a mano y criterios de aborto definidos (abajo). Este checklist
existe para que ese primer curso real sea lo más seguro posible pese a saltarse la certificación
formal. Registro de la decisión: memoria `rcetest-clave-sence-bloqueo` + `ESTADO-PROYECTO §Bloqueos`.

## Gate del piloto (constitución P3): esto lo ejecuta y firma Edu

- El agente **prepara**; Edu **dispara** contra `sistemas.sence.cl`. Nada apunta a `rce` sin Edu presente.
- El token real del OTEC jamás va a chat/commit/log/captura: solo se ingresa por `/admin/sence`.

---

## 1. Gates técnicos (código + infra)

- [x] **CI verde en `main`** (jobs `checks`/`rls`/`integration`/`e2e`), incluido `pnpm build`.
  ✅ **2026-07-16:** última corrida sobre `main` (merge #91) = `success`.
- [x] **Revisión adversarial del módulo `sence/` cerrada SIN HIGH abiertos** (tarea 4.1b):
  informe [`REVISION-ADVERSARIAL-H4.md`](REVISION-ADVERSARIAL-H4.md); el único HIGH de seguridad
  (`H4-R-002`, `callback_nonce` legible por staff) **corregido y mergeado** (PR de fixes H4) con
  su revisión 4-ojos. ✅ **2026-07-16:** test RLS `H4-R-002` (staff recibe error al leer
  `callback_nonce`, columnas no sensibles legibles) presente y verde en el job `rls`.
- [x] **Migración `20260716120000_sence_sessions_hide_callback_nonce.sql` APLICADA al cloud**
  (Management API; la tabla `supabase_migrations` no existe en el cloud). ✅ **2026-07-16:** verificado
  con consulta de control (`nonce_granted=0`, 19 columnas no sensibles con grant a `authenticated`).
- [x] **Rulings de Edu resueltos** (los que afectan el flujo del piloto — ver §4): al menos
  `H4-Q-01` (cierre tras `expires_at`), `H4-Q-02` (gate M-4), `H4-Q-03` (rate-limit del callback
  en el edge) y `H4-Q-04` (desbrickeo de la sesión pendiente). ✅ **D-048**: todos implementados y
  mergeados (#85/#86 código, #91 rate-limit); contrato enmendado en README §Enmiendas E-1..E-6.
- [x] **Uptime Kuma** re-apuntado a `seminarea.chilearning.cl` (D-046) + **monitor #3 (callback
  SENCE sintético)** creado (ver [`../observability/UPTIME-KUMA.md`](../observability/UPTIME-KUMA.md)).
  ✅ **2026-07-16:** los 3 monitores en verde, verificado por latido de Kuma (health 200 / login 200 /
  callback 303) y por ground-truth de cada endpoint. **Falta confirmar** que la alerta por correo dispara.
- [x] **Sentry** activo en app y worker con el scrubber de PII/token (`includeLocalVariables:false`).
  ✅ **2026-07-16 — RESUELTO:** el hueco era que `SENTRY_DSN` de la app estaba marcada **build-time** en
  Coolify → no se inyectaba en runtime → `sentry.server.config.ts`/`edge` no inicializaban. Fix: desmarcar
  "Build Variable" en `SENTRY_DSN` (dejar `NEXT_PUBLIC_SENTRY_DSN` como build) + redeploy. Verificado:
  `SENTRY_DSN` ahora en runtime, app 200. **Prueba final pendiente:** confirmar un evento de test en el
  dashboard de Sentry.
- [x] **Backup off-site R2** funcionando (dump diario cifrado presente) **y ensayo de
  restauración #2 hecho** (tarea 4.4, criterio §8.3: 2 ensayos exitosos antes del piloto). ✅ **2026-07-16:**
  ensayo #4 end-to-end (descarga R2 → SHA-256 → descifrado `age` de Edu → restore → integridad) en ~49 s.
- [x] **Worker vivo** en staging/prod (tick cada 5 min visible en logs) — es el único expirador
  T4/T6/T9 y desbrickeador del índice único. Sin él, una sesión pendiente abandonada bloquea al alumno.
  ✅ **2026-07-16:** contenedor `cl8lhoig…` arriba (Coolify lo nombra por UUID), tick cada 5 min visible.
- [ ] **2FA** para admin/superadmin (requiere Supabase Pro; handoff de Edu). Deseable, no bloqueante
  para un piloto de un solo operador.

## 2. Gates SENCE (configuración de la acción real)

- [ ] **Token real del OTEC** cargado por `/admin/sence` (cifrado, write-only) y **descifrable**
  (pre-flight `tokenOk`).
- [ ] **Acción real** creada y **activada** con `environment = rce`, **código de acción** y
  **CodSence** reales, fechas correctas, **línea 3** (franquicia). NO wildcard `-1` (eso es solo rcetest).
- [ ] **Pre-flight de la acción en verde** (`/admin/acciones/[id]/preflight`): RUN/DV de todo el
  roster, token, códigos, ambiente, fechas. Sin RUN inválidos.
- [ ] **URLs de callback ≤ 100 chars** por tenant (I-8): verificar que `https://seminarea.chilearning.cl/api/sence/cb/{nonce}` cabe (el pre-flight lo valida; confirmar con el subdominio real del tenant).
- [ ] **Grupo pequeño** (N acotado, definir con Edu) para el primer curso.
- [ ] **Guía Clave Única** enviada a los alumnos (correo real, no no-op) y **respaldo manual** marcado.
- [ ] **Ventana horaria** acordada con Edu presente para las primeras sesiones de asistencia.
- [ ] **Contacto SENCE** a mano: `controlelearning@sence.cl` (para regularizar cualquier asistencia
  no registrada el mismo día — ver Plan B Escenario C).

## 3. Gates operativos (soporte y contingencia)

- [ ] **Plan B impreso / a mano**: [`../ops/PLAN-B-CONTINGENCIA.md`](../ops/PLAN-B-CONTINGENCIA.md).
- [ ] **Runbook de monitoreo diario activo desde el día -1**:
  [`../ops/RUNBOOK-MONITOREO-PILOTO.md`](../ops/RUNBOOK-MONITOREO-PILOTO.md) (Kuma, health, `alerts`,
  logs del worker, panel de cumplimiento).
- [ ] **Canal de soporte a alumnos probado**: la mensajería nativa (tarea 3.4) responde y el SLA es
  visible; enviar un mensaje de prueba y confirmar que llega la notificación.
- [ ] **Runbook de rotación de secretos** ubicado por si hay que rotar en caliente:
  [`../ops/RUNBOOK-ROTACION-SECRETOS.md`](../ops/RUNBOOK-ROTACION-SECRETOS.md).

## 4. Rulings de Edu pendientes de la revisión H4 (decidir antes del piloto)

De [`REVISION-ADVERSARIAL-H4.md §Rulings`](REVISION-ADVERSARIAL-H4.md). Los de mayor impacto operativo:

- [ ] **H4-Q-01** — ¿un `close_ok` que llega tras `expires_at` pero antes de que el worker expire la
  fila debe **cerrar** (literal, recomendado) o quedar `late` (actual, crea falsos `expirada`)?
- [ ] **H4-Q-02** — ¿enmendar I-1 para consagrar el gate M-4 (descartar POSTs sin `IdSesionAlumno`)?
- [ ] **H4-Q-03** — ¿rate-limit + alerta de `unmatched` del callback público **en el edge**
  (Traefik/Coolify) antes del piloto, y con qué herramienta?
- [ ] **H4-Q-04** — ¿`/api/sence/start` re-emite el form de la sesión pendiente en vez de fallar con
  500 (desbrickea al alumno al instante)? + bajar `SENCE_PENDING_TIMEOUT_MINUTES` a ~15 min.
- [ ] (menores) H4-Q-05..Q-10 — ver el informe.

## 5. Follow-ups de UX recomendados antes de exponer alumnos reales

- [ ] **H4-R-010 / H4-R-012** — hoy el alumno puede ver JSON técnico en inglés (o un redirect mudo)
  en vez del mensaje es-CL que I-9 exige. Fijar el render de `/start`, `/close` y del callback para
  mostrar siempre el mensaje traducido (verificar en 360 y 1440 px, RNF-6). No es pérdida de datos,
  pero degrada la experiencia del primer curso real (P10).

---

## 6. Criterios de aborto del día 1 (go/no-go en vivo)

Si durante una sesión agendada ocurre alguno, **suspender el registro de asistencia y reagendar**
en vez de arriesgar registros inconsistentes (detalle en Plan B §Matriz):

- SENCE devuelve error de **sistema** (timeout/5xx) en **≥ 2 intentos seguidos** de alumnos distintos.
- La BD está `degraded` (health) o Supabase reporta incidente.
- El motor queda en un **estado que no se entiende** (sesiones en estados imposibles).
- El **worker** no procesa ticks (sin `[worker][tick]` por > 15 min) y hay alumnos bloqueados.

**Vuelta a normal:** health `"ok"` + un registro de asistencia de prueba exitoso + Kuma 3/3 verde +
sin alertas nuevas en `alerts` por 30 min.

---

## Firmas (Edu)

| Sección | Verificado | Fecha | Firma |
|---|---|---|---|
| 1 — Gates técnicos | ☐ | | |
| 2 — Gates SENCE | ☐ | | |
| 3 — Gates operativos | ☐ | | |
| 4 — Rulings resueltos | ☐ | | |
| 5 — Follow-ups UX | ☐ | | |
| **GO para 4.2 (acción real en `rce`)** | ☐ | | |

> Regla de oro del piloto (Plan B): ante cualquier duda de si una asistencia quedó registrada, se
> documenta y se resuelve el mismo día. Un alumno repite una lección; una asistencia SENCE perdida
> arriesga la franquicia del curso.
