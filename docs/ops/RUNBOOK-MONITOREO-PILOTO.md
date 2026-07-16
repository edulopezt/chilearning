# RUNBOOK-MONITOREO-PILOTO.md — Monitoreo diario durante el piloto

> **Runbook del piloto real (Hito 4, tarea 4.3).** Rutina de vigilancia mientras corre una acción
> real con alumnos. Complementa [`PLAN-B-CONTINGENCIA.md`](PLAN-B-CONTINGENCIA.md) (qué hacer si
> algo falla). En modo soporte esta rutina es **innegociable**: se corre cada día que haya
> actividad de alumnos, hasta cerrar el piloto.

## Filosofía

La observabilidad v1 es deliberadamente simple y suficiente para un piloto de un tenant:
Uptime Kuma (arriba/abajo + alerta), Sentry (errores de la app), la tabla `alerts` (señales de
negocio SENCE que el worker calcula), los **logs del worker** en Coolify (una línea JSON por
tick) y el **panel de cumplimiento** (la verdad del registro de asistencia). No hace falta un
dashboard sofisticado: hace falta **mirar estas cinco cosas todos los días** y saber a qué
escenario del Plan B saltar cuando algo se sale de rango.

Cadencia sugerida: un chequeo **en la mañana** (antes de la primera sesión), uno **al mediodía/
tarde** (durante la actividad) y un **cierre** al final del día.

---

## ☀️ Chequeo de la mañana (~10 min, antes de la 1ª sesión)

| # | Qué mirar | Dónde | Verde si… |
|---|---|---|---|
| 1 | **Uptime Kuma 3/3** | Kuma (Coolify) | health, landing y callback sintético en verde; sin caídas nocturnas |
| 2 | **Salud de la app** | `GET https://seminarea.chilearning.cl/api/health` | `{"status":"ok","checks":{"db":"ok"}}` |
| 3 | **Sentry** | Sentry (proyecto app + worker) | sin *issues* nuevos desde ayer; ninguno en rutas `sence`/`evaluacion`/`certificados` |
| 4 | **Tabla `alerts`** | SQL (abajo) | sin filas nuevas `sence_error_rate` ni `sence_day1_low_attendance` sin reconocer |
| 5 | **Worker vivo** | Logs del contenedor worker (Coolify) | líneas `[worker][tick] {...}` cada ~5 min durante la noche; sin `error de conexión Redis` |
| 6 | **Backup de anoche** | R2 (abajo) | existe `db/<año>/<mes>/db-<AYER>T*.sql.gz.age` con tamaño > 0 |

**SQL — alertas sin reconocer del tenant del piloto:**
```sql
select kind, severity, message, action_id, created_at
from public.alerts
where acknowledged_at is null
order by created_at desc
limit 20;
```
(Ejecutar por el panel de Supabase con el rol adecuado, o por la vista de admin. `kind` es
`sence_error_rate` o `sence_day1_low_attendance`; `tenant_id NULL` = alerta de plataforma.)

**Backup en R2 (desde el contenedor de backup, sin exponer secretos):**
```sh
ssh clawbot 'docker exec <contenedor-backup> sh -c ". /ops/r2-env.sh; rclone lsl \"r2:\$R2_BUCKET/db/\" | tail"'
```
Debe aparecer el dump de la fecha de ayer (el cron corre 06:00 UTC). Si falta → el backup falló:
revisar los logs del contenedor de backup (`[backup] OK`/`ERROR`) → si es persistente, Plan B
Escenario F + revisar credenciales R2.

> Si el monitor #3 (callback SENCE sintético) aún no está creado en Kuma, créalo hoy (ver
> [`../observability/UPTIME-KUMA.md`](../observability/UPTIME-KUMA.md) §3) — es la señal de que el
> pipeline del callback está vivo sin gastar PII.

---

## 🌤️ Chequeo del mediodía / tarde (durante la actividad)

Foco: **el registro de asistencia SENCE está fluyendo**.

| Qué mirar | Cómo | Bandera roja |
|---|---|---|
| Sesiones del día en el **panel de cumplimiento** | `/admin/acciones/[id]/cumplimiento` (o `/supervisor` en solo lectura) | sesiones que no avanzan de `iniciada_pendiente`; muchas `error`/`expirada` |
| **Tasa de error SENCE** | tabla `alerts` (`sence_error_rate`) + logs | aparece una alerta nueva → Plan B Escenario C |
| Eventos **`unmatched`** | `sence_events` con sesión NULL (callbacks sin correlacionar) | un salto de `unmatched` → nonce mal construido, ataque, o SENCE reenviando raro |
| Callbacks **tardíos** (`late = true`) | `sence_events.late` | muchos `late` → sesiones expirando antes de que llegue el cierre (revisar timing/latencia) |

**SQL — foto de las sesiones SENCE de hoy (tenant del piloto):**
```sql
select status, count(*)
from public.sence_sessions
where tenant_id = '<tenant-del-piloto>'
  and created_at >= date_trunc('day', now() at time zone 'America/Santiago')
group by status
order by status;
```

**SQL — eventos sin correlacionar y tardíos de hoy:**
```sql
select
  count(*) filter (where session_id is null) as unmatched,
  count(*) filter (where late)               as late,
  count(*)                                    as total
from public.sence_events
where received_at >= date_trunc('day', now() at time zone 'America/Santiago');
```

Si algún alumno reporta un problema al registrar asistencia, cruzarlo con su sesión y con la
familia de error correspondiente (Plan B Escenario C).

---

## 🌙 Cierre del día

1. **Conciliación de asistencia:** para cada alumno que tenía sesión hoy, confirmar que su
   asistencia quedó registrada (`sence_sessions` en `cerrada`, o el estado que corresponda). Las
   que no cuadren → Plan B Escenario C (documentar + contactar SENCE el mismo día si fue por causa
   de SENCE). **No dejar una asistencia dudosa para mañana.**
2. **Bandeja de soporte a alumnos:** revisar el canal de mensajería nativo (tarea 3.4) y
   responder dentro del **SLA visible**. El SLA es parte del canal oficial exigible por SENCE.
3. **Alertas:** reconocer (`acknowledged_at`) las alertas de `alerts` ya atendidas, dejando las
   pendientes visibles.
4. **Bitácora del día** (abajo): dejar registrada la jornada aunque no haya pasado nada — "sin
   novedad" también es dato.

---

## Umbrales de escalamiento (cuándo saltar al Plan B)

| Señal | Umbral | Acción |
|---|---|---|
| health `degraded` (db fail) | cualquier ocurrencia | **Plan B — B** (Supabase/BD), crítico |
| App/landing caídas en Kuma | > 2 min | **Plan B — A** (VPS/app) |
| Error de sistema de SENCE (timeout/5xx) | ≥ 2 intentos seguidos, alumnos distintos | **Plan B — C** + criterio de aborto de la sesión |
| Alerta `sence_error_rate` | 1 alerta nueva | **Plan B — C**: revisar familia de error |
| Sin `[worker][tick]` en los logs | > 15 min | **Plan B — D** (worker/Redis) |
| Alumno bloqueado por sesión colgada | inmediato | **Plan B — D** (paso 5, con Edu) |
| *Issue* nuevo en Sentry en rutas `sence` | inmediato | triage; **Plan B — E** si es bug del motor |
| Backup de ayer ausente en R2 | 1 día | revisar contenedor de backup; **Plan B — F** |
| Alerta `sence_day1_low_attendance` | 1 alerta | avisar/recordar a los alumnos de esa acción (canal 3.4) |

> Regla de oro (principio rector del Plan B): ante **cualquier duda de si una asistencia quedó
> registrada**, se documenta y se resuelve el mismo día. Un alumno repite una lección; una
> asistencia SENCE perdida arriesga la franquicia del curso.

---

## Bitácora del piloto (plantilla — copiar una fila por día)

| Fecha | Kuma | health | Alertas nuevas | Sesiones SENCE (OK / error / expiradas) | Incidentes (→ escenario Plan B) | Soporte (mensajes / dentro de SLA) | Backup anoche | Notas |
|---|---|---|---|---|---|---|---|---|
| 2026-__-__ | 3/3 ✅ | ok | 0 | _ / _ / _ | ninguno | _ / sí | ✅ | sin novedad |

> Guardar esta bitácora junto al expediente digital de la acción (tarea 3.12) al cerrar el piloto:
> es parte de la evidencia de operación para la retro (tarea 4.5) y para una eventual fiscalización.
