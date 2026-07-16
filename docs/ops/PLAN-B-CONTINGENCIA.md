# PLAN-B-CONTINGENCIA.md — Qué hacer si algo falla durante el piloto

> **Runbook del piloto real (Hito 4, tarea 4.3).** Cubre RNF-8 (runbooks para caída de VPS
> e incidente SENCE, escritos ANTES de necesitarlos) y P9 (el negocio es recuperable).
> Compañeros: [`RUNBOOK-MONITOREO-PILOTO.md`](RUNBOOK-MONITOREO-PILOTO.md) (cómo detectar),
> [`RUNBOOK-ROTACION-SECRETOS.md`](RUNBOOK-ROTACION-SECRETOS.md), [`../RESTORE.md`](../RESTORE.md)
> (restaurar BD) y [`../sence/RUNBOOK-CERTIFICACION-RCETEST-STAGING.md`](../sence/RUNBOOK-CERTIFICACION-RCETEST-STAGING.md)
> (rollback a mock, familias de error SENCE §5).

## Principio rector (léelo antes que nada)

Durante el piloto lo que **no se puede perder** es el **registro de asistencia SENCE**: en
franquicia tributaria (línea 3), una sesión de clase cuyo registro no llega a SENCE es una
sesión que **el OTEC no puede cobrar** y que puede comprometer la rendición del curso completo.
Por eso el motor está diseñado para que **el callback jamás se descarte** (invariante I-1: todo
callback se persiste, aun sin correlacionar) y las tablas `sence_events`/`audit_log` sean
**INSERT-only** (I-2). La regla de contingencia se deriva de ahí:

> **Ante cualquier duda sobre si una asistencia quedó registrada: NO se improvisa. Se documenta
> la evidencia (hora, alumno, qué pasó) y se resuelve el mismo día — con Edu y, si toca, con
> SENCE.** Un alumno puede repetir una lección; una asistencia SENCE mal registrada arriesga
> plata real.

Y las dos reglas duras que no se rompen ni en incidente (constitución P3/P6):

- **Nunca** se apunta el motor a producción SENCE (`SENCE_ENV=prod`, `action.environment=rce`)
  para "probar" un arreglo. Producción es irreversible.
- **Nunca** se toca producción a mano (BD, servidor, migraciones) fuera de Git y de estos
  runbooks. Si el arreglo exige código, va por PR con CI verde (aunque sea un hotfix urgente).

Durante el piloto el agente está en **modo soporte**: cero features nuevas, fixes con prioridad
máxima, y este documento manda.

---

## Árbol de decisión (primeros 60 segundos)

Cuando algo se ve mal, ubícate rápido antes de actuar:

```
¿La app responde? (abrir https://seminarea.chilearning.cl/api/health)
│
├─ NO responde / timeout / 5xx ....................... → Escenario A (VPS/Coolify/app caídos)
│
└─ SÍ responde ("ok")
   │
   ├─ status = "degraded" (checks.db = "fail") ........ → Escenario B (Supabase / BD)
   │
   └─ status = "ok", pero…
      │
      ├─ el alumno pulsa "Registrar asistencia" y falla → Escenario C (SENCE) — mirar el código
      │                                                     de error; familias en el runbook rcetest §5
      │
      ├─ la asistencia se inicia pero nunca "cierra" /   → Escenario D (worker / Redis:
      │  las sesiones no expiran / no llegan callbacks      expiración + correlación) o C (callback)
      │
      ├─ datos raros: nota/certificado/panel inconsistente → Escenario E (bug del motor / dominio)
      │
      └─ no llega un correo (invitación, alerta) ......... → Escenario F (Resend / periférico)
```

En todos los casos, lo primero que se hace es **abrir la bitácora del día**
([`RUNBOOK-MONITOREO-PILOTO.md`](RUNBOOK-MONITOREO-PILOTO.md) §Bitácora) y anotar hora + síntoma.

---

## Escenario A — VPS / Coolify / app web caídos

La app entera no responde (Traefik, el contenedor de la app, o el VPS `clawbot` = 216.185.51.57).

- **Detección:** Uptime Kuma monitor #1 (health) y #2 (landing) en rojo + alerta por correo;
  `https://seminarea.chilearning.cl/api/health` da timeout o error de Traefik; `ssh clawbot` no
  entra (VPS caído) o sí entra pero `docker ps` muestra el contenedor de la app reiniciándose.
- **Impacto en alumnos:** no pueden entrar a cursar **ni registrar asistencia**. Si es en medio
  de una sesión SENCE ya iniciada, la sesión seguirá viva en BD (el candado de 3 h corre en el
  reloj de SENCE) — cuando la app vuelva, el alumno puede reintentar; si no alcanza, cae a
  expiración y hay que reagendar esa asistencia.
- **Acción inmediata (Edu / agente en modo soporte):**
  1. `ssh clawbot` → `docker ps` (¿está el proxy? ¿el contenedor `jrhorroii…` de la app?).
  2. Coolify UI (`http://localhost:8000` vía túnel SSH) → app `chilearning-staging` → **Logs**.
     Si el contenedor crashea en loop, mirar el último deploy: ¿un merge reciente lo rompió?
  3. Si fue el **último deploy**: revertir en Coolify al deployment anterior sano
     (**Rollback**), o `git revert` del commit culpable + merge (auto-deploy). NO editar a mano.
  4. Si es el **VPS** (no entra por SSH): revisar el panel del proveedor; si no vuelve pronto,
     ejecutar el plan de recuperación completa ([`../RESTORE.md`](../RESTORE.md) — la app es
     reproducible desde Git; los datos viven en Supabase Cloud, que es independiente del VPS).
  5. Confirmar la vuelta: health `"ok"` + un login de prueba + Kuma verde.
- **Comunicación (es-CL):** si la caída solapa una sesión agendada, avisar por el canal de
  mensajería nativo (tarea 3.4) y/o correo:
  > *"Hola: estamos con una intermitencia técnica en la plataforma. La estamos resolviendo y te
  > avisamos apenas esté disponible para que registres tu asistencia. Tu avance no se pierde.
  > Gracias por la paciencia. — Equipo Seminarea"*
- **Registro para fiscalización:** anotar en la bitácora ventana de caída (inicio/fin), alumnos
  afectados y si alguna asistencia debió reagendarse. Los `sence_events` NO se ven afectados por
  la caída de la app (viven en Supabase). Guardar captura de Kuma con timestamps.

---

## Escenario B — Supabase / base de datos caídos o degradados

La app responde pero `health` da `degraded` (`checks.db = "fail"`), o los errores en pantalla
apuntan a la BD.

- **Detección:** health `"degraded"`; Sentry con errores de conexión/timeout a Postgres;
  el panel de Supabase (`nnrlvprndsxcnyljccso`) muestra el proyecto no `ACTIVE_HEALTHY`.
- **Impacto en alumnos:** login y cursado fallan; **crítico**: si un callback de SENCE llega
  mientras la BD está caída, el `INSERT` en `sence_events` falla → **riesgo real de perder ese
  registro** (SENCE reintenta un número limitado de veces). Es el peor escenario para la
  asistencia.
- **Acción inmediata:**
  1. Panel de Supabase → estado del proyecto y del pooler. ¿Incidente del proveedor
     (status.supabase.com) o algo nuestro (agotamos conexiones, una query pesada)?
  2. Si es saturación de conexiones: identificar en Logs la query/proceso; el worker y la app
     usan pooling — revisar que no haya un loop. NO reiniciar a ciegas.
  3. Si es **caída del proveedor**: no hay acción de código; se espera y se comunica. Anotar en
     bitácora **cada sesión SENCE que estaba en curso** para conciliar después (paso 5).
  4. Si el proyecto quedó corrupto/irrecuperable: restaurar desde el backup off-site
     ([`../RESTORE.md`](../RESTORE.md)) — RTO objetivo ≤ 4 h, RPO ≤ 24 h. **Con Edu** (P6).
  5. **Conciliación post-incidente (obligatoria):** para cada asistencia que ocurrió durante la
     ventana, verificar en `sence_sessions`/`sence_events` que quedó registrada. Las que no →
     tratar como asistencia no registrada: contactar a SENCE el mismo día (ver Escenario C).
- **Comunicación (es-CL):** igual que Escenario A (intermitencia técnica). Si hubo pérdida de un
  registro de asistencia, además el correo a SENCE del Escenario C.
- **Registro para fiscalización:** ventana del incidente, lista de sesiones en curso durante la
  caída, resultado de la conciliación (cuáles quedaron OK, cuáles hubo que reagendar/reportar).

---

## Escenario C — SENCE caído o errores masivos en el registro

La app y la BD están bien, pero al pulsar **"Registrar asistencia"** SENCE rechaza o no responde.

- **Detección:** el alumno ve un mensaje de error traducido (nunca el código crudo — regla del
  proyecto); en la tabla `alerts` aparece `sence_error_rate` para el tenant; Sentry/logs muestran
  respuestas de error de SENCE; el monitor sintético del callback (Kuma #3) puede seguir verde
  (el pipeline nuestro está vivo) aunque SENCE rechace por parámetros.
- **Cómo leer el error:** el motor traduce toda `GlosaError` con la tabla de
  [`errors.ts`](../../src/modules/sence/errors.ts) (códigos 100–313). Diagnóstico por familia en
  el runbook de certificación §5 ([`../sence/RUNBOOK-CERTIFICACION-RCETEST-STAGING.md`](../sence/RUNBOOK-CERTIFICACION-RCETEST-STAGING.md)).
  Los más probables en el piloto real:
  - **311 / 312** (Clave Única): fallo o mismatch del RUN al autenticar. **Reintento inmediato**
    (nueva sesión); si el RUN de login ≠ el inscrito, corregir la inscripción. No es caída de SENCE.
  - **207 / 208** (RUN del alumno): formato/DV o RUN no autorizado en esa acción → corregir la
    inscripción; el pre-vuelo I-8 debería haberlo cazado antes.
  - **211 / 212 / 303** (token del OTEC): token no vigente/incorrecto → regenerar en
    `sistemas.sence.cl/rts` y recargar por `/admin/sence`. **NO** tocar `SENCE_TOKEN_ENCRYPTION_KEY`.
  - **300–310** (curso/acción): la acción real ante SENCE (fechas, e-learning, RUT OTEC) — es
    configuración de la acción, no un bug.
  - **Timeout / 5xx de SENCE** (SENCE realmente caído): no hay error de negocio, SENCE no responde.
- **Impacto en alumnos:** no pueden registrar asistencia AHORA. La lección/curso siguen
  disponibles; lo que se bloquea es la asistencia SENCE de esa sesión.
- **Acción inmediata:**
  1. Distinguir **error de negocio** (código 2xx/3xx → se corrige el dato/config y el alumno
     reintenta) de **caída de SENCE** (timeout/5xx → esperar; no hay arreglo nuestro).
  2. Error de negocio puntual de un alumno: corregir su inscripción/token según la familia y
     pedirle reintentar. Verificar en `sence_sessions` que la nueva sesión sí registró.
  3. Si una sesión quedó **colgada** (`iniciada_pendiente`/`iniciada` sin cierre) tras varios
     intentos: el worker la expira automáticamente al vencer el pending-timeout (60 min) o las
     3 h; no forzar cierres a mano.
  4. **SENCE caído (masivo):** suspender los registros de asistencia hasta que responda. Avisar a
     los alumnos que la sesión se reagenda o que registren cuando SENCE vuelva (dentro de la
     ventana de la acción). Vigilar `status.sence` / reintentar cada cierto rato.
  5. **Contacto SENCE** para asistencias que no se pudieron registrar por causa de SENCE:
     `controlelearning@sence.cl` (control e-learning). Enviar el mismo día, con evidencia.
- **Comunicación (es-CL):**
  - A alumnos (error puntual):
    > *"Hola: hubo un problema al registrar tu asistencia y ya lo estamos corrigiendo. En unos
    > minutos te pediremos que vuelvas a ingresar con tu Clave Única para dejarla registrada. No
    > pierdes tu avance. — Equipo Seminarea"*
  - A alumnos (SENCE caído):
    > *"Hola: el sistema de asistencia de SENCE está temporalmente no disponible (es externo a
    > nosotros). Apenas se restablezca te avisamos para que registres tu asistencia dentro del
    > plazo del curso. — Equipo Seminarea"*
  - A SENCE (`controlelearning@sence.cl`) — tono formal, reusar el estilo de
    [`../sence/BORRADOR-CORREO-SENCE.md`](../sence/BORRADOR-CORREO-SENCE.md):
    > *"Estimados: durante la ejecución del curso [nombre] (CodSence [____], acción [____]) el día
    > [fecha] entre las [hh:mm] y [hh:mm] no fue posible registrar la asistencia de [N] participante(s)
    > debido a [indisponibilidad del servicio RCE / error código NNN]. Adjuntamos el detalle
    > (RUN, hora del intento, mensaje recibido) y solicitamos orientación para regularizar el
    > registro. Quedamos atentos. Atte., [OTEC]."* (El RUN va solo en el adjunto formal a SENCE,
    > nunca en logs ni en el chat.)
- **Registro para fiscalización:** por cada asistencia afectada: RUN, alumno, hora del intento,
  código/mensaje recibido, acción tomada, nº de ticket o correo a SENCE. Adjuntar al **expediente
  digital de la acción** (tarea 3.12). Los `sence_events` con el rechazo YA quedaron registrados
  (I-1) — son evidencia, no borrarlos.

---

## Escenario D — Worker / Redis caídos (expiración y alertas)

El worker BullMQ (proceso aparte, misma imagen) dejó de correr o Redis se cayó.

- **Detección:** en los logs del contenedor **worker** de Coolify dejan de aparecer las líneas
  `[worker][tick] {...}` (deberían salir cada 5 min); o aparece `[worker] error de conexión
  Redis`; o el arranque abortó con `[worker] falta la variable de entorno …`. Señal indirecta:
  sesiones que deberían haber expirado siguen `iniciada`/`iniciada_pendiente` pasadas las 3 h,
  y no aparecen alertas de `sence_error_rate` aunque haya errores.
- **Impacto en alumnos:** **bajo y no inmediato.** El registro de asistencia (start/callback) NO
  depende del worker: el alumno puede iniciar y SENCE puede confirmar aunque el worker esté
  caído. Lo que el worker hace es *housekeeping*: expirar sesiones vencidas (T4/T6/T9), calcular
  la tasa de error y la alerta día-1, y disparar recordatorios. Mientras esté caído, esas tareas
  simplemente no corren; se ponen al día cuando vuelve (el tick es idempotente).
  - ⚠ Efecto secundario a vigilar: una sesión colgada `iniciada_pendiente` mantiene el candado de
    "una sesión abierta por inscripción" (índice único parcial) → **el alumno no puede iniciar una
    nueva** hasta que el worker la expire. Con el worker caído, ese alumno queda bloqueado.
- **Acción inmediata:**
  1. Coolify → contenedor **worker** → Logs. ¿Crashea al arrancar (falta env) o perdió Redis?
  2. Redis (`chilearning-redis` en Coolify): ¿está `healthy`? Si no, reiniciarlo; el worker se
     reconecta solo (BullMQ reintenta).
  3. Si el worker aborta por env faltante (`REDIS_URL`, `SUPABASE_SERVICE_ROLE_KEY`, …):
     completar la variable en Coolify y redeploy. El aborto ruidoso es por diseño (mejor crash
     visible que proceso vivo que no expira nada).
  4. Al volver, confirmar en los logs un `[worker][tick]` con `expiry` procesando el atraso.
  5. Si un alumno quedó bloqueado por una sesión colgada y no puede esperar al tick: **con Edu**,
     verificar el caso y dejar que el worker la expire (no forzar UPDATE a mano sobre
     `sence_sessions` salvo decisión explícita de Edu; los estados son parte del contrato).
- **Comunicación (es-CL):** normalmente no requiere avisar a alumnos (impacto interno). Si un
  alumno quedó bloqueado: *"Hola: estamos habilitando tu registro de asistencia, dame unos
  minutos y te aviso para que ingreses. — Equipo Seminarea"*.
- **Registro para fiscalización:** anotar la ventana en que el worker estuvo caído y si alguna
  expiración quedó atrasada; no afecta registros ya hechos.

---

## Escenario E — Bug del motor / dominio (datos inconsistentes)

La infra está sana pero el comportamiento es incorrecto: una nota mal calculada, un certificado
que no debería emitirse, el panel de cumplimiento con un conteo que no cuadra, un estado de
sesión imposible.

- **Detección:** reporte de un alumno o de Edu; discrepancia entre el panel de cumplimiento y la
  realidad; una excepción en Sentry en rutas de `sence`/`evaluacion`/`certificados`.
- **Impacto en alumnos:** variable. Si toca **asistencia SENCE**, tratarlo como incidente crítico
  (principio rector). Si toca nota/certificado, es corregible sin urgencia legal.
- **Acción inmediata:**
  1. Reproducir en **local** (`supabase db reset` + datos ficticios) o en staging con un tenant de
     prueba — **jamás** depurar tocando datos de producción.
  2. Localizar la causa raíz. Si es lógica de dominio, hay tests que deberían cubrirla: escribir
     primero el test que reproduce el bug (falla), luego el fix (SDD).
  3. **Si el fix toca `src/modules/sence/`, RLS o auth → revisión adversarial 4-ojos por otro
     agente ANTES de mergear** (Definición de Hecho §9). Aunque sea urgente.
  4. Hotfix por PR con CI verde (checks/rls/integration/e2e) → merge → auto-deploy. Nunca a mano.
  5. Si hay datos ya escritos incorrectos: evaluar corrección con Edu. Recordar que `sence_events`
     y `audit_log` son INSERT-only (no se "corrigen" borrando: se documenta y, si aplica, se
     compensa con una nueva entrada auditada).
- **Comunicación (es-CL):** solo si afectó a un alumno visible (ej. una nota mostrada mal):
  *"Hola: detectamos un ajuste en el cálculo de [nota/avance] y ya está corregido. Si tienes
  dudas con tu registro, escríbenos por aquí. — Equipo Seminarea"*.
- **Registro para fiscalización:** el PR del fix (traza en Git, P6), el test que lo cubre, y si
  tocó un dato SENCE, la nota en `docs/sence/CHANGELOG.md` + la entrada de compensación en
  `audit_log`.

---

## Escenario F — Fallos periféricos (correo, DNS/SSL)

No bloquean el registro de asistencia; se resuelven sin urgencia legal.

- **Resend (correo) caído / sin API key:** las invitaciones/alertas/recordatorios degradan a
  no-op auditado (por diseño). El alumno puede entrar igual por su enlace directo. Verificar
  `RESEND_API_KEY` + dominio verificado en Cloudflare; reintentar. Las alertas de Kuma también
  salen por SMTP de Resend → si Resend cae, vigilar por logs directamente.
- **DNS / SSL (Cloudflare / Let's Encrypt):** si un subdominio de tenant no resuelve o el cert no
  renovó, revisar Cloudflare (`*.chilearning.cl` → VPS, DNS-only) y Traefik. El wildcard resuelve
  DNS pero cada subdominio saca su cert HTTP-01 al visitarse. No afecta datos.

---

## Matriz de severidad y escalamiento

| Escenario | Afecta asistencia SENCE | Severidad | Quién resuelve | Contacto externo |
|---|---|---|---|---|
| A — VPS/app caídos | Sí, si hay sesión en curso | **Alta** | Edu + agente (modo soporte) | Proveedor VPS |
| B — Supabase/BD | Sí (riesgo de perder registro) | **Crítica** | Edu (P6 para restore) | Soporte Supabase |
| C — SENCE caído / errores | Sí (directo) | **Crítica** | Edu + agente | `controlelearning@sence.cl` |
| D — Worker/Redis | No inmediato (housekeeping) | Media | Agente (modo soporte) | — |
| E — Bug del motor | Depende (crítico si toca SENCE) | Alta/Media | Agente + 4-ojos + Edu | — |
| F — Correo / DNS-SSL | No | Baja | Agente | Resend / Cloudflare |

**Criterio de aborto de la sesión del día (go/no-go):** si durante una sesión agendada se cumple
alguno de estos, **suspender el registro de asistencia y reagendar** en vez de arriesgar registros
inconsistentes:

- SENCE devuelve error de sistema (timeout/5xx) en ≥ 2 intentos seguidos de alumnos distintos.
- La BD está `degraded` o Supabase reporta incidente.
- El motor está en un estado que no se entiende (sesiones en estados imposibles).

**Criterio de "vuelta a normal":** health `"ok"` + un registro de asistencia de prueba exitoso
(con un alumno real dentro de la ventana, o verificación equivalente) + Kuma 3/3 verde + sin
alertas nuevas en `alerts` por 30 min.

---

## Contactos y accesos rápidos

- **SENCE control e-learning:** `controlelearning@sence.cl` (borrador base:
  [`../sence/BORRADOR-CORREO-SENCE.md`](../sence/BORRADOR-CORREO-SENCE.md)).
- **VPS:** `ssh clawbot` (216.185.51.57); Coolify UI por túnel SSH a `localhost:8000`.
- **Supabase:** proyecto `lms-edulopezt` (`nnrlvprndsxcnyljccso`), panel web.
- **Monitoreo:** Uptime Kuma (Coolify), Sentry, tabla `alerts`, logs del worker en Coolify.
- **Restaurar BD:** [`../RESTORE.md`](../RESTORE.md).
- **Rotar un secreto comprometido:** [`RUNBOOK-ROTACION-SECRETOS.md`](RUNBOOK-ROTACION-SECRETOS.md).

> Los tokens, claves y secretos concretos viven en `.env.local` (gitignored) y
> `STAGING-CREDENTIALS.txt` (gitignored) — **jamás** en este documento ni en el chat.
