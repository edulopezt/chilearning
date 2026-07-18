# Verificación Meta Business para WhatsApp — checklist (task 3.10, M9)

> **Naturaleza:** trámite externo, NO código. El canal WhatsApp **opera en el
> Hito 5** (tarea 5.11: plantillas aprobadas, **envío DIRECTO desde el worker a
> Meta** — ver corrección abajo). Aquí solo se **inicia** la verificación
> porque es lenta (días–semanas). WhatsApp es **opcional por tenant**; el canal
> oficial de comunicación de M9 es 100% nativo (task 3.4) y NO depende de esto.
> **Solo Edu puede ejecutar este trámite.**
>
> ⚠ **Corrección (task 5.11, D-049):** este documento decía originalmente
> "orquestado en n8n" — quedó OBSOLETO y se corrige aquí. La decisión real
> (D-049, que extiende a WhatsApp/Meta el mismo principio que D-042 sentó para
> el correo — ver `specs/DECISIONES.md`) es que el **worker envía el WhatsApp
> DIRECTO a Meta** (`src/modules/comunicacion/whatsapp-sender.ts`), nunca vía
> n8n: n8n JAMÁS debe ver un número de teléfono, mismo principio que ya aplica
> a los correos transaccionales (la lógica crítica con PII vive en el worker
> testeable; n8n solo recibe eventos agregados/seudonimizados — RNF-10 — para
> automatización periférica, ADR-004). El código del canal está completo y
> cableado en modo degradado (no-op sin credenciales) desde la task 5.11; ver
> `docs/whatsapp/ACTIVATION.md` para lo que falta del lado operativo una vez
> Meta apruebe.

## Pasos (los ejecuta Edu con su cuenta Meta)

1. **Entidad legal.** Confirmar la razón social + RUT de la OTEC; deben coincidir
   con `tenants.rut` y con los datos legales del certificado (task 3.2).
2. **Meta Business Portfolio.** En `business.facebook.com`, crear/confirmar el
   portafolio con la OTEC como propietaria y la cuenta de Edu como admin.
3. **Business Verification** (Security Center): subir constitución/RUT/comprobante
   de domicilio; registrar teléfono de empresa y sitio (`chilearning.cl` o el
   dominio del tenant). Enviar a revisión de Meta.
4. **WhatsApp Business App** en `developers.facebook.com`: crear app, agregar el
   producto WhatsApp (requiere el portafolio verificado).
5. **Número emisor dedicado** (NO personal): reservar/verificar el número;
   completar la revisión de nombre para mostrar.
6. **Plantillas** (categoría *utility*): el copy EXACTO a enviar a aprobación
   ya está escrito y versionado en
   `src/modules/comunicacion/domain/whatsapp-templates.ts` (campo
   `approvedBodyEs` de cada constante `*_V1`) — recordatorio de asistencia
   (`recordatorio_asistencia_v1`) y aviso a inactivos (`aviso_inactivo_v1`),
   alineadas con la copy es-CL del i18n. Copiar ese texto literal al enviarlo a
   aprobación de Meta (proceso lento). Si Meta lo aprueba con cambios de copy,
   ver `docs/whatsapp/ACTIVATION.md` (hay que subir la versión a `_v2`).
7. **Credenciales** (para el Hito 5, en Coolify secrets — app Y worker):
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` (ya como placeholders
   `[H5]` en `.env.example`).
8. **Seguimiento.** La verificación puede tardar días–semanas → por eso se inicia
   ahora.

## Ley 21.719 / RNF-3
- Archivar el **DPA (contrato de encargo)** con Meta.
- El **opt-in de WhatsApp** por alumno se registra con el modelo
  `communication_opt_outs` (`channel = whatsapp`) que construye la task 3.9;
  es independiente del opt-out de email (task 5.11).
- Solo datos mínimos/seudonimizados en las plantillas (RNF-10): únicamente
  primer nombre + nombre del curso, nunca apellido/RUN/correo/empresa.

## Estado
- **Checklist listo** (este documento). La ejecución del trámite es **handoff a
  Edu**; el canal opera en el Hito 5. No bloquea nada del Hito 3.
- **Código del canal: COMPLETO y cableado en modo degradado** (task 5.11,
  sin credenciales de Meta = no-op, igual que Resend antes de tener API key).
  Falta EXCLUSIVAMENTE el trámite de este documento + los pasos operativos de
  `docs/whatsapp/ACTIVATION.md`.
