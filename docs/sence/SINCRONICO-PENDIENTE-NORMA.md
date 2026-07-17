# Sincrónico en vivo: qué está pendiente de norma y qué implementa Chilearning hoy

> Task 5.4 (Hito 5), spec `01-especificacion.md` §7-R3. Este documento vive en `docs/sence/`
> porque **habla sobre** SENCE (el vacío normativo, cómo se conectaría a futuro) — no porque el
> código al que se refiere importe o dependa de `src/modules/sence/`. La feature implementada
> (`src/modules/academico/domain/live-session.ts`, `src/modules/academico/live-session-service.ts`,
> y la UI bajo `/admin/acciones/[id]/sesiones` y `/mi-curso`) **NO toca, importa ni referencia**
> `src/modules/sence/` en ninguna forma: es asistencia interna, informativa, aislada del motor SENCE.

## 1. Qué está PENDIENTE de verificación normativa

La spec (§7-R3) deja explícito: *"Reglas exactas del sincrónico SENCE (registro por sesión en
vivo) — pendiente verificación normativa"*. Concretamente, no está confirmado con SENCE:

- Si el registro de asistencia de una sesión **sincrónica** (clase en vivo, no autoformativa)
  debe pasar por el protocolo RCE (redirección con Clave Única) igual que el resto del curso
  e-learning, o si sigue una regla distinta (p. ej. lista de asistencia declarada por el
  relator, como en presencial).
- Si existe una ventana de tiempo normada para "asistir" a una sesión en vivo (¿el alumno debe
  estar conectado todo el bloque? ¿basta un check-in?), análoga a la que sí existe para el
  RCE asíncrono (I-13, 3 h de sesión / 60 min de inactividad — pero esa regla es del RCE
  autoformativo, no necesariamente aplicable 1:1 al sincrónico).
- Cómo se declara esta modalidad en la DJ/GCA cuando el curso es mixto (sincrónico + e-learning).

Esta consulta **no se ha enviado todavía** a `controlelearning@sence.cl`. El borrador más cercano
que existe hoy es `docs/sence/BORRADOR-CORREO-SENCE.md` (tarea 0.10), que cubre la obligatoriedad
de la API LMS-SIC y la duración de sesión del RCE asíncrono (R2/D-003) — **no** cubre todavía la
pregunta específica del sincrónico (R3). Follow-up anotado: ampliar ese borrador (o redactar uno
nuevo) con una pregunta explícita sobre el registro de asistencia de sesiones en vivo antes de
construir cualquier integración real con SENCE para esta modalidad.

## 2. Qué implementa Chilearning HOY (este PR)

Mientras no haya norma confirmada, se implementó el **alcance seguro** acordado:

- **Programación de sesiones en vivo por acción**: título, plataforma (Zoom/Meet/Teams/otro),
  enlace **externo** a la videoconferencia, inicio/término y detalles. La videoconferencia
  propia queda fuera de alcance v1 (spec §6): el alumno se une a un enlace externo.
- **Asistencia INTERNA**, no SENCE: el staff (otec_admin/coordinator/instructor) puede marcar
  presente/ausente por inscrito con una nota; el propio alumno puede auto-marcar su asistencia
  dentro de una ventana (15 min antes del inicio hasta el fin de la sesión) — y si el staff ya
  la marcó manualmente, el auto-marca del alumno **no la pisa** ("manual gana").
- **Exportable**: CSV con BOM UTF-8, escape anti-inyección de fórmulas (mismo patrón que el
  export de cumplimiento SENCE, D-021, pero replicado — no importado — para no acoplar este
  módulo a `src/modules/sence/`), con un disclaimer **obligatorio** como primera línea:
  *"Asistencia interna — no reemplaza el registro de asistencia SENCE."* El mismo texto es
  visible de forma **permanente** en el roster de asistencia del staff y en la sección
  "Sesiones en vivo" del alumno.
- **Sin efecto en el candado de contenido**: la vista del alumno (`/mi-curso`) muestra las
  sesiones en vivo y el botón de auto-marca **siempre**, independiente del estado del candado
  SENCE (`computeLock`) — nunca lo abre ni lo cierra.
- **Sin efecto en DJ/GCA**: `live_session_attendance` no participa del checklist de DJ
  (`dj_checklist`) ni de ningún export SENCE existente.
- Aparece en el calendario del curso (`calendar-service.ts`) como una entrada más de tipo
  `"sesion"` (el enum `CALENDAR_KINDS` ya lo contemplaba desde task 3.4 — cero cambios ahí).

## 3. Cómo se conectaría CUANDO haya norma (NO implementado ahora)

Si SENCE confirma una regla oficial para el registro de asistencia sincrónica, la integración
se construiría como un **adaptador nuevo, DENTRO de `src/modules/sence/`**, que LEA
`live_session_attendance` como evidencia de origen (p. ej. para armar el payload de un futuro
endpoint RCE de sesión sincrónica, o para poblar un nuevo tipo de evento SENCE). La dirección de
dependencia sería **sence → academico** (el adaptador importa el dominio académico de solo
lectura), **nunca al revés**: `src/modules/academico/` seguiría sin saber que SENCE existe, igual
que hoy. Esto preserva la regla dura del proyecto (`src/modules/sence/` aislado, sin
dependencias hacia el resto) y evita que este PR (o cualquier feature futura de sesiones en
vivo) tenga que anticipar un contrato SENCE que todavía no existe.

Ese adaptador **no se implementa en esta tarea** — queda explícitamente fuera de alcance hasta
que exista la verificación normativa de la sección 1.

## 4. Qué NO se hizo a propósito (fuera de alcance v1)

- **Videoconferencia propia**: spec §6 la excluye explícitamente v1 ("el sincrónico usa
  Zoom/Meet/Teams enlazado + registro de asistencia"). Esta tarea solo agenda el enlace externo.
- **Reglas RCE sincrónicas**: ninguna lógica de Clave Única, protocolo RCE, `sence_sessions`,
  `sence_events` ni ningún candado de contenido se tocó o se referenció desde este PR.
- **Cualquier tabla, columna o import de `src/modules/sence/`**: verificado explícitamente
  (ver checklist de salida del PR). El único acoplamiento con "SENCE" en este PR es
  conceptual/documental (este archivo, y el disclaimer en la UI/CSV que menciona la palabra
  "SENCE" para dejar claro que esto NO es eso).
