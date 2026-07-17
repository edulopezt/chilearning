# Contrato de encargo de tratamiento de datos personales — BORRADOR

> # ⚠ BORRADOR PARA REVISIÓN DE ABOGADO — NO FIRMAR NI ENVIAR A UN CLIENTE
>
> Este documento **no** es un contrato válido ni asesoría legal. Lo redactó un agente de IA a
> partir de cómo está construida la plataforma, para que un abogado chileno tenga un punto de
> partida técnico fiel en vez de una plantilla genérica. Todo lo que va entre `[corchetes]` está
> **sin definir**. Antes de usarse con un cliente real debe ser revisado, corregido y aprobado
> por un abogado (spec §9, riesgo **S2**; tarea 5.6 de `specs/03-tareas.md`).
>
> **Valor real de este borrador:** la §4 (medidas de seguridad), la §5 (subencargados) y
> la §6 (transferencia internacional) describen la infraestructura **verificada** contra el repo.
> Esa parte es la que un abogado no puede inventar y la que hay que mantener sincronizada.

- **Versión del borrador:** 2026-07 (alineada con `CURRENT_PRIVACY_POLICY_VERSION`)
- **Estado:** borrador técnico · pendiente de revisión legal
- **Documento hermano:** `/privacidad` (política de privacidad, también en borrador)
- **Principio que lo exige:** P4 de `specs/00-constitucion.md` — *"Cada OTEC firma un contrato de
  encargo de tratamiento; la plataforma es encargada, la OTEC es responsable de los datos de sus
  alumnos."*

---

## Comparecientes

**RESPONSABLE DEL TRATAMIENTO:** `[RAZÓN SOCIAL DE LA OTEC]`, RUT `[RUT]`, domicilio `[DOMICILIO]`,
representada por `[NOMBRE]` (en adelante, la **OTEC**).

**ENCARGADO DEL TRATAMIENTO:** `[RAZÓN SOCIAL + FORMA JURÍDICA — POR DEFINIR]`, inscrita en el
`[HANDELSREGISTER — POR DEFINIR]` bajo el `[Nº HRB — POR DEFINIR]`, `[USt-IdNr — POR DEFINIR]`,
domicilio `[DIRECCIÓN EN FRANKFURT — POR DEFINIR]`, Alemania, nombre de fantasía **Chilearning**
(en adelante, el **Encargado**).

> ⚠ **Pendiente de Edu:** faltan los datos registrales de la sociedad. Sin ellos no se firma.
>
> ⚠ **Para el abogado — el Encargado está establecido en la UE (Frankfurt).** Este borrador se
> redactó contra la Ley 21.719 chilena. Con un encargado alemán, al tratamiento le resulta aplicable
> **además el RGPD** (art. 3.1, por el establecimiento del encargado, con independencia de que los
> titulares estén en Chile). Consecuencias sobre ESTE contrato:
> - Debe cumplir el **contenido mínimo tasado del art. 28.3 del RGPD** (instrucciones documentadas,
>   confidencialidad, art. 32, subencargados con autorización, asistencia arts. 32-36, supresión o
>   devolución, auditorías). Revisar cláusula por cláusula contra esa lista.
> - El alojamiento en **Brasil (São Paulo)** pasa a ser transferencia a un tercer país **sin decisión
>   de adecuación de la UE** → exige instrumento del RGPD (cláusulas contractuales tipo + evaluación
>   de la transferencia), no solo salvaguardas contractuales genéricas. **Si esto no cuadra, la salida
>   es mover la BD a una región de la UE: es una decisión de ARQUITECTURA y conviene tomarla antes de
>   firmar clientes.**
> - Verificar si hace falta **registro de actividades de tratamiento (art. 30)**.
> Se recomienda asesoría que cubra el lado alemán, no solo el chileno.

Ambas partes reconocen que, conforme a la **Ley 21.719** sobre protección y tratamiento de datos
personales —y, en lo que resulte aplicable por el establecimiento del Encargado en la Unión Europea,
al **Reglamento (UE) 2016/679 (RGPD)**—, la OTEC determina los fines y medios del tratamiento de los
datos de sus alumnos y trabajadores capacitados, y el Encargado los trata **exclusivamente por cuenta
de la OTEC**.

---

## 1. Objeto

El Encargado provee a la OTEC una plataforma SaaS multi-tenant de formación e-learning con
validación de asistencia ante SENCE (protocolo RCE), y trata por cuenta de la OTEC los datos
personales necesarios para prestar ese servicio.

**Duración:** mientras esté vigente el contrato de servicio, más los plazos de conservación de la §9.

**Categorías de titulares:** alumnos y trabajadores capacitados; personal de la OTEC (administradores,
coordinadores, relatores, tutores); contrapartes de las empresas capacitadas; supervisores externos
(SENCE, OTIC, auditores).

**Categorías de datos:** identificación (nombre, apellidos, correo); **RUN** (exigido por el registro
de asistencia del RCE de SENCE); progreso, evaluaciones y calificaciones; asistencia y eventos SENCE;
certificados emitidos; comunicaciones del curso (mensajería, foros); datos técnicos y de auditoría
(identificador de usuario, IP, acciones).

**Naturaleza y finalidad:** ejecución de cursos e-learning, registro y validación de asistencia ante
SENCE, evaluación, certificación, comunicación con los alumnos, reportería y evidencia de
fiscalización.

**Sin datos sensibles:** el servicio no está diseñado para tratar datos sensibles (salud, afiliación
sindical, biometría). La OTEC se obliga a no cargarlos.

## 2. Instrucciones documentadas

El Encargado trata los datos **únicamente** siguiendo instrucciones documentadas de la OTEC. Son
instrucciones documentadas: este contrato, el contrato de servicio, la configuración que la OTEC
realiza en la plataforma (acciones, inscripciones, alcances de acceso, activación de módulos
opcionales) y las instrucciones adicionales que consten por escrito.

- El Encargado **no** trata los datos para fines propios, no los cede ni los vende, y no los usa
  para entrenar modelos de inteligencia artificial.
- El Encargado informará a la OTEC si, a su juicio, una instrucción infringe la Ley 21.719.
- El personal del Encargado accede a datos de la OTEC solo para soporte, con registro en la bitácora
  de auditoría (`audit_log`).
- Si el Encargado quedara obligado por ley a un tratamiento distinto, lo informará previamente a la
  OTEC, salvo prohibición legal.

## 3. Confidencialidad

El Encargado mantiene en estricta confidencialidad los datos tratados y garantiza que toda persona
autorizada a acceder a ellos se ha comprometido a la confidencialidad por escrito o está sujeta a un
deber legal equivalente. La obligación subsiste indefinidamente tras el término del contrato.

## 4. Medidas de seguridad

El Encargado aplica las medidas técnicas y organizativas descritas a continuación. Su implementación
está documentada en el repositorio del producto (`docs/security/OWASP-REVIEW.md`, `docs/RESTORE.md`,
`docs/ops/RUNBOOK-ROTACION-SECRETOS.md`, `docs/ops/PLAN-B-CONTINGENCIA.md`).

| Medida | Implementación |
|---|---|
| Aislamiento entre OTECs | *Row Level Security* en todas las tablas de negocio; toda consulta pasa por `tenantGuard()`. Suite de tests de aislamiento multi-tenant ejecutada en cada cambio. |
| Cifrado en tránsito | TLS en todas las conexiones. |
| Cifrado en reposo | Cifrado de disco del proveedor de base de datos. |
| Cifrado a nivel de aplicación | El token SENCE de la OTEC se cifra con AES-256-GCM; nunca aparece en logs, respuestas ni reportes de error. |
| Integridad de la evidencia | `sence_events` y `audit_log` son *INSERT-only* por *trigger*: no se pueden alterar ni borrar. Los documentos definitivos del expediente de fiscalización son inmutables. |
| Control de acceso | Ocho roles con permisos diferenciados; el acceso de supervisores externos es de solo lectura, acotado en alcance y vigencia, y cada consulta queda auditada. |
| Trazabilidad | Bitácora de auditoría de toda acción sensible. |
| Respaldos | Respaldo diario cifrado (`age`) fuera del proveedor principal, con verificación de integridad y ensayos de restauración documentados (objetivo de recuperación < 4 h; último ensayo real: ~49 s). |
| Monitoreo | Monitoreo de disponibilidad y de errores, con depuración automática de datos personales y secretos antes de enviar cualquier reporte. |
| Gestión de secretos | Procedimiento de rotación documentado por secreto. |
| Desarrollo seguro | Revisión de dependencias automatizada; cabeceras de seguridad; validación de todo borde de entrada. |

> ⚠ **Pendientes conocidos que el abogado debe conocer antes de comprometer estas cláusulas:**
> la política de contenido (CSP) está en modo *report-only*, y la autenticación de doble factor está
> configurada pero no exigida (requiere plan de pago del proveedor). Ver `specs/ESTADO-PROYECTO.md`.

## 5. Subencargados autorizados

La OTEC **autoriza expresamente** a los siguientes subencargados. El Encargado mantiene con cada uno
un contrato con obligaciones de protección no menos exigentes que las de este contrato.

| Subencargado | Servicio | Datos que trata | Ubicación |
|---|---|---|---|
| **Supabase** | Base de datos, autenticación y almacenamiento | Todos los datos de la plataforma | **Brasil (São Paulo)** → ver §6 |
| **`[PROVEEDOR DE VPS — POR CONFIRMAR]`** | Ejecución de la aplicación y del worker | Datos en tránsito y en memoria | `[REGIÓN — POR CONFIRMAR]` |
| **Cloudflare** | DNS, protección de la conexión y almacenamiento de respaldos (R2) | Datos técnicos (IP); respaldos **cifrados** con clave que Cloudflare no posee | Red global |
| **Resend** | Correo transaccional | Nombre y correo del destinatario, contenido del mensaje | Estados Unidos |
| **Bunny Stream** | Alojamiento y reproducción de video | Datos técnicos de reproducción | Unión Europea / red global |
| **Sentry** | Monitoreo de errores | Datos técnicos; PII y secretos **depurados** antes del envío | Estados Unidos / Unión Europea |

**Subencargados condicionales** — no activos hoy; se activan solo si la OTEC habilita el módulo:

| Subencargado | Servicio | Condiciones especiales |
|---|---|---|
| **n8n** (autoinstalado) | Automatizaciones periféricas | **Aún no desplegado** (pendiente de instalación en Coolify); el código degrada a no-op mientras tanto. Recibe **solo agregados seudonimizados** (HMAC); sin datos personales por construcción (RNF-10). Infraestructura del Encargado. |
| **OpenRouter** | Tutor con inteligencia artificial | **Cláusula de no-entrenamiento y retención cero.** Al modelo **nunca** se envían RUN, apellidos, correo, empresa ni datos SENCE (RNF-10). |
| **Meta Platforms** | Notificaciones por WhatsApp | Requiere activación por la OTEC y aceptación del alumno. |

**Cláusula de no-entrenamiento (general):** ningún subencargado está autorizado a usar los datos de la
OTEC para entrenar, ajustar o evaluar modelos de inteligencia artificial, ni para fines propios.

**Cambios:** el Encargado informará a la OTEC con **`[30]` días** de antelación cualquier alta o
sustitución de subencargado. La OTEC podrá oponerse por motivos razonables y fundados dentro de ese
plazo; de mantenerse el desacuerdo, podrá terminar el contrato sin costo, con derecho a la
devolución de sus datos conforme a la §9.

## 6. Transferencia internacional (⚠ cláusula crítica — riesgo S2)

**Hecho, sin adornos:** la base de datos de la plataforma —incluidos nombre, correo y **RUN** de los
alumnos— está alojada en **São Paulo, Brasil**. Otros subencargados operan en Estados Unidos y la
Unión Europea. Los datos personales de los titulares chilenos **salen de Chile**.

Garantías que el Encargado ofrece hoy:

1. Contratos de tratamiento con cada subencargado, con obligaciones de confidencialidad, seguridad y
   limitación de finalidad.
2. Cifrado en tránsito y en reposo; cifrado adicional a nivel de aplicación de los secretos críticos.
3. Respaldos cifrados con una clave controlada exclusivamente por el Encargado: el proveedor de
   almacenamiento no puede leerlos.
4. Compromiso de notificar a la OTEC cualquier requerimiento de una autoridad extranjera sobre datos
   de la OTEC, salvo prohibición legal.
5. `[POR DEFINIR CON EL ABOGADO: cláusulas contractuales tipo, mecanismo de transferencia admisible
   bajo la Ley 21.719 y su reglamento, y si corresponde alguna autorización o registro ante la
   Agencia de Protección de Datos Personales.]`

> ⚠ **Este es el punto que el abogado debe resolver primero.** La especificación registra como
> **supuesto no validado** (riesgo S2) que la transferencia internacional a una BD gestionada fuera
> de Chile es admisible bajo la Ley 21.719 con salvaguardas contractuales. **Nadie lo ha confirmado.**
> Si la respuesta fuera negativa, el impacto es de arquitectura (migrar la base de datos a Chile), no
> de redacción — y conviene saberlo **antes** de firmar con clientes.

## 7. Asistencia a la OTEC

El Encargado asiste a la OTEC, en la medida de lo posible y considerando la naturaleza del
tratamiento:

- **Derechos de los titulares:** la plataforma resuelve por sí sola los derechos de acceso,
  rectificación, supresión, oposición y portabilidad. El titular descarga sus datos en JSON y presenta
  solicitudes desde su portal; la OTEC las resuelve desde su consola de administración, **sin
  intervención del Encargado y sin tocar la base de datos a mano** (P4). Si un titular se dirige
  directamente al Encargado, este lo derivará a la OTEC sin demora.
- **Límite legal de la supresión:** los registros de asistencia SENCE, certificados, calificaciones y
  bitácora de auditoría **se conservan** aunque el titular pida su supresión, porque prima la
  obligación legal de fiscalización. La plataforma informa al titular qué se conservó y por qué.
- **Evaluaciones de impacto y consultas a la autoridad:** el Encargado entregará la información
  técnica que la OTEC requiera.
- **Seguridad:** ver §4.

## 8. Notificación de vulneraciones de seguridad

El Encargado notificará a la OTEC **sin demora indebida y a más tardar dentro de `[24]` horas** desde
que tome conocimiento de una vulneración de seguridad que afecte datos personales tratados por cuenta
de la OTEC.

La notificación incluirá, en la medida disponible: naturaleza de la vulneración, categorías y número
aproximado de titulares y registros afectados, consecuencias probables, medidas adoptadas o
propuestas, y datos de contacto para más información. Si la información no estuviera disponible de
una vez, se entregará por fases sin demora.

La notificación a los titulares y a la **Agencia de Protección de Datos Personales** corresponde a la
**OTEC** como responsable; el Encargado le prestará la asistencia y la evidencia técnica necesarias.

> ⚠ `[Plazo por confirmar con el abogado contra la Ley 21.719 y su reglamento.]`

## 9. Supresión o devolución al término

Al término del contrato, a elección de la OTEC:

- **Devolución:** el Encargado entrega los datos en formato estructurado y de uso común, dentro de
  `[30]` días desde la solicitud.
- **Supresión:** el Encargado suprime los datos y las copias existentes dentro de `[90]` días desde
  el término, salvo obligación legal de conservación.

**Excepciones y realidades operativas que el abogado debe conocer:**

- **Obligación SENCE:** los registros de asistencia, certificados y evidencia de fiscalización deben
  conservarse según la normativa aplicable (por defecto ≥ 5 años; plazo **flagged** para revisión
  legal). La OTEC define si los conserva ella tras la migración.
- **Respaldos:** los respaldos cifrados rotan según su ciclo de retención (`[por definir]`) y se
  suprimen al vencer, no de forma selectiva. Mientras tanto siguen cifrados e inaccesibles para
  terceros.
- El Encargado certificará por escrito la supresión cuando la OTEC lo solicite.

## 10. Auditorías

El Encargado pone a disposición de la OTEC la información necesaria para demostrar el cumplimiento de
este contrato y permite auditorías, incluidas inspecciones, realizadas por la OTEC o por un auditor
que ella mandate, en las siguientes condiciones:

- Con aviso previo de `[30]` días, en horario hábil, sin interrumpir la operación y `[una]` vez al
  año, salvo que exista un incidente de seguridad o una exigencia de la autoridad.
- El auditor deberá firmar un acuerdo de confidencialidad.
- La auditoría **no podrá comprometer** el aislamiento ni la confidencialidad de los datos de otras
  OTECs alojadas en la plataforma.
- El Encargado podrá satisfacer la solicitud mediante documentación técnica, certificaciones de sus
  subencargados e informes de sus propias revisiones de seguridad.
- Los costos de la auditoría son de cargo de la OTEC, salvo que se detecten incumplimientos
  relevantes imputables al Encargado.

## 11. Responsabilidad y ley aplicable

`[POR DEFINIR CON EL ABOGADO: régimen de responsabilidad, límites, indemnidad, seguros.]`

Este contrato se rige por la ley chilena. Toda controversia se someterá a `[jurisdicción / arbitraje
por definir]`.

---

## Anexo — Trazabilidad técnica de las afirmaciones

Para el abogado: cada afirmación técnica de este borrador tiene respaldo verificable en el
repositorio. No son promesas comerciales.

| Cláusula | Dónde se verifica |
|---|---|
| Aislamiento por RLS + `tenantGuard()` | `CLAUDE.md` §Reglas duras; suite `pnpm test:rls` |
| Token SENCE cifrado AES-256-GCM, nunca en logs | `CLAUDE.md` §Reglas duras; `src/modules/sence/` |
| `sence_events` / `audit_log` INSERT-only | `CLAUDE.md` §Reglas duras |
| Derechos del titular resolubles en la app | `src/app/mis-datos/`, `src/app/admin/derechos/` (tarea 3.5, HU-2.4) |
| Supresión que conserva lo exigido por SENCE | `src/modules/core/domain/privacy.ts`; decisión **D-033** |
| Catálogo de retención (plazos flagged) | `RETENTION_POLICIES` en `src/modules/core/domain/privacy.ts` |
| Respaldos cifrados + ensayo de restauración | `docs/RESTORE.md`; `specs/ESTADO-PROYECTO.md` (tarea 4.4) |
| Depuración de PII en reportes de error | `src/lib/observability/scrub.ts` (tarea 3.7) |
| Portal del fiscalizador auditado y acotado | `src/modules/portal-empresa/` (tarea 3.11, HU-12.1/12.2) |
| Expediente de fiscalización inmutable | tarea 3.12, HU-5.10 |
| BD en São Paulo (riesgo S2) | `specs/02-plan-tecnico.md` §Stack; `specs/01-especificacion.md` §Riesgos (S2) |
| A n8n solo agregados seudonimizados | `src/modules/comunicacion/domain/automation.ts` (RNF-10) |
| OTEC = responsable, Chilearning = encargado | `specs/00-constitucion.md` **P4** |
