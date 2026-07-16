# Automatizaciones n8n — handoff (task 3.9, HU-5.9)

n8n es **periferia** (P3, ADR-004): la lógica crítica (asistencia, notas, SENCE) vive en el
worker. n8n solo recibe **eventos agregados y seudonimizados** para disparar flujos secundarios
(paneles, alertas a un canal de equipo, etc.). El correo al alumno lo envía la plataforma por
Resend — n8n **nunca** recibe RUN, nombre ni correo (RNF-10).

## Qué hace la plataforma (ya construido, degrada sin infra)

- **Job `reminders-tick`** en el worker (cadencia `REMINDERS_EVERY_MS`, default 1 h). Por cada
  acción con automatización habilitada calcula:
  - `no_attendance`: alumnos SENCE sin asistencia hoy.
  - `inactive`: alumnos inactivos ≥ N días (`inactiveDays`, default 7).
  - `coordinator_report`: agregado diario.
- Envía el **correo PII** al destinatario real por `EmailSender` (Resend), honrando el **opt-out**
  del alumno (`/preferencias`) y con **dedup diario** (outbox `notifications`).
- Emite a n8n **solo** `{ type, kind, tenant, action, recipients[], count, at }` donde `tenant`,
  `action` y `recipients` son **seudónimos HMAC-SHA256** (irreversibles). Firma el cuerpo con
  `X-Chilearning-Signature` (HMAC del secreto compartido).

Sin `N8N_WEBHOOK_URL`/`N8N_WEBHOOK_SECRET` el emisor es **no-op** (verde en dev/CI/staging).

## Handoff a Edu (para activar en Hito 5)

1. Levantar **n8n** en Coolify (segunda app del repo o imagen oficial).
2. Crear un **Webhook** node (POST) y copiar su URL → `N8N_WEBHOOK_URL`.
3. Definir un secreto compartido → `N8N_WEBHOOK_SECRET` (mismo valor en el worker y en n8n).
4. En n8n, **validar la firma**: recomputar `HMAC-SHA256(secret, rawBody)` y comparar con el
   header `X-Chilearning-Signature` (rechazar si no coincide).
5. Configurar por acción en `/admin/acciones/[id]/automatizaciones` qué recordatorios se activan.
6. (Opcional) knobs del worker: `REMINDERS_EVERY_MS`, `REMINDERS_INACTIVE_DAYS`.

## Variables de entorno

| Variable | Dónde | Efecto |
|---|---|---|
| `N8N_WEBHOOK_URL` | worker | destino de los eventos; sin ella, no-op |
| `N8N_WEBHOOK_SECRET` | worker + n8n | firma HMAC + seudónimo |
| `REMINDERS_EVERY_MS` | worker | cadencia del job (default 3600000) |
| `REMINDERS_INACTIVE_DAYS` | worker | umbral por defecto de inactividad |

## Contrato del evento (lo único que ve n8n)

```json
{ "type": "reminder", "kind": "no_attendance",
  "tenant": "<hmac>", "action": "<hmac>",
  "recipients": ["<hmac>", "..."], "count": 12, "at": "2026-07-16T15:00:00.000Z" }
```

Nunca contiene RUN, nombre, correo ni el `user_id` crudo. Verificado por
`src/modules/comunicacion/domain/automation.test.ts` y `reminders.integration.test.ts`.
