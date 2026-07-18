# Activación del canal WhatsApp — handoff (task 5.11, HU-5.9)

> Continuación de `docs/whatsapp/META-BUSINESS-VERIFICATION.md` (el trámite con
> Meta). Este documento es el lado TÉCNICO/OPERATIVO: qué hacer UNA VEZ Meta
> apruebe el Business Verification y las plantillas. El código del canal ya
> está completo y cableado en modo degradado desde la task 5.11 — no falta
> desarrollar nada más para que funcione, solo completar estos pasos.

## Qué hace la plataforma hoy (ya construido, degrada sin credenciales)

- **`whatsapp-sender.ts`** (`src/modules/comunicacion/whatsapp-sender.ts`):
  envía plantillas vía Meta Cloud API por `fetch` directo (sin SDK). Sin
  `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN`, degrada a un sender
  no-op (loguea y reporta `not_configured`; nunca toca red) — mismo patrón que
  `email-sender.ts`/Resend.
- **Envío DIRECTO desde el worker** (D-049, extiende a Meta el mismo
  principio que D-042 sentó para el correo): dentro de `reminders-tick`
  (`src/modules/comunicacion/reminders.ts`), como bloque hermano al correo.
  n8n **nunca** ve un teléfono — ver la corrección en
  `META-BUSINESS-VERIFICATION.md`.
- **Gate por tenant**: el flag `whatsapp` de `tenants.flags` (deny-by-default,
  task 5.3) debe estar en `true` para que el tenant reciba WhatsApp — se
  consulta una vez por tenant por tick (cacheado), no por alumno.
- **Gate por alumno**: requiere teléfono en `user_metadata.phone` (E.164) Y no
  haberse dado de baja del canal `whatsapp` en `/preferencias` (independiente
  del opt-out de email — filas separadas en `communication_opt_outs`, y
  filtradas cada una en su propia rama de `dispatch()` — ver `reminders.ts` —
  para que la independencia sea real en AMBAS direcciones: opt-out solo de
  WhatsApp sigue recibiendo correo, y opt-out solo de email sigue recibiendo
  WhatsApp; ambos casos cubiertos por test de integración).
- **Plantillas** (`src/modules/comunicacion/domain/whatsapp-templates.ts`,
  dominio puro): `recordatorio_asistencia_v1` y `aviso_inactivo_v1` tienen
  llamador real en `reminders.ts` (mismos dos `kind` que ya dispara el correo:
  `no_attendance`/`inactive`). `certificado_disponible_v1` está declarada y
  lista, pero SIN llamador todavía (no existe hoy un tick de "certificado
  emitido" con canal WhatsApp).
- **Minimización (RNF-10)**: cada plantilla recibe SOLO el primer nombre del
  alumno + el nombre del curso — nunca apellido, RUN, correo ni empresa.

## Pasos para activar (una vez Meta aprueba)

1. **Credenciales en Coolify — AMBAS apps** (la web Y el worker corren
   procesos separados, cada uno necesita sus propias env vars):
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_ACCESS_TOKEN`
   (ya como placeholders `[H5]` en `.env.example`, con comentario de
   degradación).
2. **Verificar que las plantillas aprobadas por Meta coinciden EXACTO** con
   `approvedBodyEs` de `whatsapp-templates.ts` (`recordatorio_asistencia_v1`,
   `aviso_inactivo_v1`):
   - Si Meta las aprobó SIN cambios → no hay que tocar código, solo las
     credenciales del paso 1.
   - Si Meta exigió cambios de copy → **nunca editar la constante `_v1`
     existente in place**. Crear una constante nueva `_v2` (mismo archivo,
     mismo patrón) con el nombre de plantilla que Meta aprobó
     (`recordatorio_asistencia_v2`, etc.), actualizar el llamador en
     `reminders.ts` para usar la `_v2`, y dejar la `_v1` como referencia
     histórica (o borrarla si ya no aplica a ningún tenant activo).
3. **Activar el flag por tenant**: `UPDATE tenants SET flags = flags ||
   '{"whatsapp": true}'::jsonb WHERE id = '<tenant-id>';` (o desde el panel de
   superadmin si ya existe una UI para flags — revisar
   `src/app/superadmin/tenants/page.tsx`). Activar SOLO para el tenant que
   completó el trámite de Meta; el resto queda apagado (deny-by-default).
4. **Confirmar el opt-in del alumno**: el alumno puede darse de baja del canal
   en `/preferencias` en cualquier momento (`channel = "whatsapp"` en
   `communication_opt_outs`, independiente del de email) — no requiere trabajo
   adicional, ya funciona.
5. **Verificar en Meta Business Manager** que el número emisor y la revisión
   de nombre para mostrar quedaron aprobados (paso 5 de
   `META-BUSINESS-VERIFICATION.md`).

## El gap real: cómo llega el teléfono del alumno al sistema

**Hallazgo de la task 5.11**: hoy NO existe ningún flujo que escriba un
teléfono en `user_metadata.phone`. Ni el import CSV de inscripciones
(`src/modules/academico/domain/enrollment-import.ts`, columnas
`nombre/apellidos/email/run/exento/grupo` — sin teléfono) ni ningún otro punto
del sistema lo puebla. Sin esto, **el canal queda cableado pero
INALCANZABLE en la práctica**: `resolveRecipientsFactory` (worker/index.ts) sí
lee `user_metadata?.phone`, pero ese campo siempre es `null` hoy.

**Decisión de esta task: NO se tocó el import CSV.** Se evaluó agregar una
columna opcional `celular`/`telefono` (mismo mecanismo que ya usa
`nombre`/`apellidos` para escribir a `user_metadata` vía la Admin API en
`enrollment-service.ts::ensureUser`) pero se decidió posponerlo por:

- El canal completo sigue bloqueado por el trámite de Meta (semanas) — no hay
  urgencia real de cerrar este gap ahora; hacerlo cuando haya un tenant real
  con Meta aprobado y un caso de uso concreto evita adivinar el formato de
  columna sin datos reales de OTEC.
- El import CSV es una ruta de código sensible y bien cubierta de tests
  (`enrollment-import.test.ts`, validación fila a fila que alimenta reportes
  SENCE) — agregar una columna con su propia validación de formato (E.164 vs.
  celular chileno de 9 dígitos, normalización, mensajes de error fila a fila)
  es una pieza de alcance propio, mejor development junto con el primer tenant
  que efectivamente la necesite, con su formato real de planilla a la vista.
- `ensureUser` (`enrollment-service.ts`) solo escribe `user_metadata` al CREAR
  el usuario (no en un re-import de un usuario ya existente) — el mismo
  patrón que hoy ya limita la actualización de `full_name`. Agregar teléfono
  ahí replicaría esa misma limitación conocida, no la resolvería; vale la pena
  decidir junto con si eso también se corrige, no por separado.

### Camino más simple para cerrarlo (cuando corresponda)

1. Agregar `"telefono"` (o `"celular"`) a `IMPORT_COLUMNS` en
   `enrollment-import.ts` como columna OPCIONAL (igual que `apellidos`/`grupo`
   hoy — su ausencia no rompe imports existentes).
2. Validar el formato en `validateEnrollmentCsv` (fila a fila, mismo patrón
   que el RUN): aceptar E.164 (`+56912345678`) o celular chileno de 9 dígitos
   y normalizar a E.164 anteponiendo `+56`; fila con formato irreconocible →
   error de fila (no bloquea el resto del lote).
3. Agregar `telefono: string | null` a `ValidEnrollmentRow`.
4. En `enrollment-service.ts::ensureUser`, agregar
   `phone: row.telefono ?? undefined` a `user_metadata` al crear el usuario
   (mismo `user_metadata: { full_name: ... }` de hoy).
5. Decidir en ese momento si también vale la pena actualizar `user_metadata`
   en un RE-import de un usuario existente (hoy ni `full_name` lo hace) —
   probablemente sí, dado que el teléfono es más propenso a cambiar que el
   nombre.
6. Correr `enrollment-import.test.ts` + `enrollment-service.integration.test.ts`
   actualizados y el checklist de este mismo documento para confirmar que el
   alumno importado con teléfono recibe el WhatsApp en un tenant con el flag
   encendido.

## Variables de entorno

| Variable | Dónde | Efecto |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | app + worker | id del número emisor en la Graph API; sin ella, no-op |
| `WHATSAPP_ACCESS_TOKEN` | app + worker | token de acceso de la app de Meta; sin él, no-op |

## Checklist rápido antes de dar por activado un tenant

- [ ] Meta Business Verification aprobado (documento hermano).
- [ ] Plantillas aprobadas por Meta calzan EXACTO con `whatsapp-templates.ts` (o se subió `_v2`).
- [ ] `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN` cargadas en Coolify (app Y worker).
- [ ] `tenants.flags.whatsapp = true` SOLO para el tenant que completó el trámite.
- [ ] Al menos un alumno de ese tenant tiene `user_metadata.phone` poblado (ver el gap arriba).
- [ ] Prueba real: un alumno sin asistencia hoy recibe el WhatsApp de `recordatorio_asistencia_v1`.
