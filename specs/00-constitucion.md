# Constitución del Proyecto — "Chilearning"

> **Qué es este documento:** los principios innegociables que gobiernan TODAS las decisiones
> del proyecto. Cualquier spec, plan, tarea o línea de código que contradiga esta constitución
> está mal, aunque funcione. Se modifica solo con decisión explícita de Edu, registrando el porqué.
>
> Proyecto: LMS SaaS multi-tenant para OTECs en Chile con integración de asistencia SENCE.
> Fecha: 2026-07-13 · Estado: v1.0 aprobada en entrevista SDD.

## P1 — El spec manda
El código se deriva de la especificación, nunca al revés. Si la realidad exige un cambio,
primero se actualiza el spec (y se registra la decisión), después se toca el código.

## P2 — Aislamiento total entre tenants
Cada OTEC es un tenant con aislamiento estricto de datos. Ninguna consulta, reporte, archivo,
log o pantalla puede exponer datos de un tenant a otro. El aislamiento se garantiza en la capa
de base de datos (Row-Level Security), no solo en la aplicación. Toda tabla de negocio lleva
`tenant_id`. Los tests de aislamiento son obligatorios y bloquean el deploy si fallan.

## P3 — La integración SENCE es sagrada
Es la ruta crítica legal y la razón de compra del producto.
- Vive en el código de la plataforma: versionada en Git, testeada, con revisión antes de cada cambio.
- **Nunca** depende de n8n ni de herramientas no versionadas.
- Todo evento SENCE (intento, éxito, error, cierre) queda en un registro de auditoría inmutable
  (se inserta, jamás se edita ni borra).
- Nada llega a producción SENCE sin pasar primero por el ambiente oficial de pruebas (`rcetest`).
- Los tokens SENCE de cada OTEC se guardan cifrados y jamás aparecen en logs.

## P4 — Privacidad desde el diseño (Ley 21.719)
La plataforma trata RUNs, historiales de capacitación y datos de trabajadores de terceros.
- Minimización: solo se piden y guardan los datos necesarios para operar y cumplir con SENCE.
- Cifrado en tránsito (TLS) y en reposo (disco cifrado + cifrado a nivel de aplicación para
  campos sensibles como tokens).
- Derechos de los titulares (acceso, rectificación, supresión, portabilidad) resolubles sin
  tocar la base de datos a mano.
- Cada OTEC firma un contrato de encargo de tratamiento; la plataforma es encargada, la OTEC
  es responsable de los datos de sus alumnos.
- Políticas de retención definidas por tipo de dato (los registros SENCE se conservan según
  exigencia normativa aunque el alumno pida supresión — obligación legal prima).

## P5 — Operable por una persona
Edu desarrolla y opera solo, con IA como copiloto. Por lo tanto:
- Stack aburrido, popular y probado. Monolito modular; nada de microservicios.
- Pocas piezas móviles: si una herramienta se puede evitar, se evita.
- Todo automatizado: deploy, backups, migraciones, monitoreo. Nada manual en producción.
- Documentación operativa (runbooks) para: restaurar backup, rotar secretos, caída de VPS,
  incidente SENCE. Escritos ANTES de necesitarlos.

## P6 — Git es la única puerta a producción
Todo cambio pasa por Git + CI (lint, tests, migraciones). Prohibido editar en el servidor.
Staging y producción separados; lo que no pasó por staging no entra a producción.

## P7 — Seguridad por defecto
- RBAC con denegación por defecto: lo que no está explícitamente permitido, está prohibido.
- Secretos fuera del código (variables de entorno / vault de Coolify), rotables.
- 2FA obligatorio para superadmin y admins de OTEC.
- Validación de toda entrada externa (usuarios y callbacks SENCE) en el borde.
- Dependencias auditadas (npm audit / Dependabot); parches de seguridad tienen prioridad
  sobre features, siempre.

## P8 — Todo deja rastro
Toda acción sensible (cambio de notas, emisión de certificado, cambio de configuración SENCE,
acceso a datos personales, inicio de sesión) queda en un log de auditoría con: quién, qué,
cuándo, desde dónde y en qué tenant. Los logs de auditoría son de solo inserción.

## P9 — El negocio es recuperable
- Backup diario cifrado FUERA del proveedor del VPS (mínimo: base de datos + archivos + configuración).
- Restauración documentada y **ensayada una vez al mes** (un backup que no se probó restaurar
  no existe). Objetivos: RTO ≤ 4 horas, RPO ≤ 24 horas.
- La infraestructura es agnóstica del proveedor (Docker + Coolify): migrar de VPS debe ser
  cuestión de horas, no un proyecto.

## P10 — La experiencia del alumno primero
El alumno es quien menos eligió estar aquí y quien valida el negocio ante SENCE.
- El flujo de asistencia SENCE debe ser lo más simple que la norma permita, con errores
  traducidos a lenguaje humano y con instrucciones para recuperar la Clave Única.
- Funciona en móvil. Accesibilidad razonable según WCAG 2.1 (SENCE la recomienda).
- El contenido del curso carga rápido: video por CDN, nunca desde el VPS.

---
*Cambios a esta constitución: proponerlos como PR sobre este archivo, con justificación,
y aprobación explícita de Edu.*
