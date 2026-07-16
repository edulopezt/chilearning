# Verificación Meta Business para WhatsApp — checklist (task 3.10, M9)

> **Naturaleza:** trámite externo, NO código. El canal WhatsApp **opera en el
> Hito 5** (tarea 5.11: plantillas aprobadas, orquestado en n8n). Aquí solo se
> **inicia** la verificación porque es lenta (días–semanas). WhatsApp es
> **opcional por tenant**; el canal oficial de comunicación de M9 es 100% nativo
> (task 3.4) y NO depende de esto. **Solo Edu puede ejecutar este trámite.**

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
6. **Plantillas** (categoría *utility*): preparar recordatorio de asistencia y
   aviso a inactivos, alineadas con la copy es-CL del i18n; enviar a aprobación de
   Meta (proceso lento).
7. **Credenciales** (para el Hito 5, en Coolify secrets): `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_ACCESS_TOKEN` (ya como placeholders `[H5]` en `.env.example`).
8. **Seguimiento.** La verificación puede tardar días–semanas → por eso se inicia
   ahora.

## Ley 21.719 / RNF-3
- Archivar el **DPA (contrato de encargo)** con Meta.
- El **opt-in de WhatsApp** por alumno se registra con el modelo
  `communication_opt_outs` (`channel = whatsapp`) que construye la task 3.9.
- Solo datos mínimos/seudonimizados en las plantillas (RNF-10).

## Estado
- **Checklist listo** (este documento). La ejecución del trámite es **handoff a
  Edu**; el canal opera en el Hito 5. No bloquea nada del Hito 3.
