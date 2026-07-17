# Chilearning — LMS con asistencia SENCE integrada

> Documento de venta (task 5.7). "Chilearning" es la marca de trabajo del producto — **aún
> no es la marca comercial definitiva** (decisión pendiente de Edu). Mismo criterio de
> honestidad que usa la landing (`src/i18n/es-CL.ts`, bloque `landing`): cada afirmación de
> abajo describe algo **ya construido**, no una promesa a futuro. Sin precios.

## El problema

Una OTEC chilena que dicta capacitación con franquicia SENCE hoy convive con esto:

- **Planillas manuales** para asistencia, notas y avance — Excel paralelo al LMS (si es que
  hay LMS), que alguien concilia a mano antes de cada declaración jurada.
- **Riesgo de fiscalización SENCE**: la evidencia (asistencia RCE, certificados, notas) se
  arma la noche antes de que llegue el fiscalizador, no mientras se dicta el curso.
- **DJ y GCA a mano**: perseguir el plazo de liquidación en un cuaderno o una planilla, sin
  alerta ni checklist, con el riesgo de que se pase la fecha.
- **Ley 21.719 (protección de datos personales)**: el RUN y otros datos sensibles del alumno
  circulan por correo, WhatsApp y planillas sin trazabilidad ni control de acceso — exactamente
  lo que la ley obliga a minimizar y auditar.

## La solución: Chilearning

Un LMS pensado desde el primer día para la operación real de una OTEC chilena: multi-tenant
(cada OTEC en su propio espacio, aislado por diseño en la base de datos), con el protocolo RCE
de asistencia SENCE **adentro** de la plataforma — no pegado por fuera con un script.

## Diferenciadores

**Asistencia SENCE integrada — el diferenciador central.** El alumno registra su asistencia
con Clave Única desde la misma lección; cada evento del RCE (inicio, cierre, error) queda
guardado y auditable, con los códigos de error traducidos a lenguaje humano en vez de mostrar
el JSON crudo de SENCE. El motor está construido y probado extremo a extremo contra el
simulador oficial del protocolo (`rcetest`). **Matiz honesto:** la validación contra el
ambiente **real** de SENCE (`rce`) todavía no ha ocurrido — la certificación `rcetest` quedó
parqueada por un bloqueo del lado de SENCE (su login de recuperación con Clave SENCE está
deprecado; la integración en sí quedó probada correcta). Esa validación final se completa en
el primer curso del cliente en producción, y se conversa con la OTEC antes de partir — mismo
criterio que ya usa la landing pública del producto.

Además, ya construido y funcionando:

- **Checklist DJ/GCA con plazo a la vista**: máquina de estados, liquidación calculada y
  nómina exportable — se deja de perseguir la fecha en un cuaderno.
- **Certificados con folio único y QR verificable públicamente**: quien recibe el certificado
  lo valida en una página pública, sin cuenta y sin exponer el RUN completo (enmascarado).
  Incluye vencimiento configurable y alertas de recertificación (90/60/30 días) a la OTEC y a
  la empresa cliente.
- **Expediente de fiscalización**: documentos por acción con checklist, inmutables una vez
  marcados definitivos, descargables en un ZIP con manifiesto cuando llega la fiscalización.
- **Evaluaciones y libro de notas**: cuestionarios autocorregidos, tareas con entrega de
  archivos y libro de notas por acción, exportable.
- **Portal para el fiscalizador**: SENCE, la OTIC o un auditor entran a un portal de solo
  lectura con alcance y vigencia definidos por la OTEC; cada consulta queda auditada.
- **Portal de la empresa cliente**: la empresa que envía trabajadores a capacitarse entra a
  ver SOLO a sus propios trabajadores — nunca a los de otra empresa del mismo cliente OTEC —
  con el RUN enmascarado y cada consulta auditada.
- **Sesiones sincrónicas con asistencia interna**: para el componente presencial o en vivo de
  un curso blended, con registro propio de asistencia (independiente del RCE).
- **Reproductor SCORM completo**: para contenido ya empaquetado en SCORM 1.2/2004, sin salir
  de la plataforma.
- **Asistente de creación de cursos**: arma un curso desde cero o a partir de un descriptor
  `.docx` ya existente, en vez de construir todo módulo por módulo a mano.
- **Onboarding self-service de OTECs**: una OTEC nueva se crea y opera sin que nadie toque
  código — tablero de superadmin para administrar todos los tenants de la plataforma.
- **Derechos del titular resueltos en la app (Ley 21.719)**: consentimiento registrado,
  exportación de datos del alumno y supresión que respeta lo que SENCE obliga a conservar.
  Son botones que funcionan, no un PDF de política. (La admisibilidad legal del tratamiento de
  datos sigue en revisión de Edu — esto describe mecanismos construidos, no una certificación
  de cumplimiento).
- **Export completo del tenant, asíncrono**: una OTEC que se va se lleva TODOS sus datos en
  un ZIP, sin depender de que alguien del equipo de Chilearning corra una consulta a mano.
- **Aislamiento multi-tenant real**: cada OTEC en su propio espacio, con permisos aplicados en
  la base de datos (no solo en la interfaz) y cubierto por una suite de tests dedicada.

## Lo que todavía NO está listo para prometer

- **Certificación SENCE contra el ambiente real (`rce`)**: probada contra el simulador, no
  contra producción — ver el matiz de arriba.
- **Tutor con IA**: en construcción; no forma parte de esta demo salvo que esté activo el día
  de la reunión.
- **WhatsApp operativo**: bloqueado por un trámite pendiente con Meta, no disponible aún.
- **IA por lotes / masiva**: no existe; la única IA interactiva de la plataforma es el tutor,
  y todavía en construcción.

## Sin precios

Este documento es para presentar el producto, no para cotizar. Los detalles comerciales se
conversan caso a caso con cada OTEC.
