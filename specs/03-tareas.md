# Desglose de Tareas v1 — "Chilearning"

> **Qué es este documento:** el plan de ejecución. Cada tarea es pequeña, verificable y
> trazable al spec (HU-x.y) o al plan (§). Se trabaja hito por hito; dentro de cada hito,
> cada módulo repite el microciclo SDD: spec detallada → plan → implementar → verificar.
>
> Con IA como copiloto, la unidad de trabajo ideal es una tarea de esta lista = una sesión
> de trabajo con contexto acotado.
>
> Fecha: 2026-07-13. Duraciones estimadas para UNA persona con IA, con margen realista.

## Sobre la meta "esta semana"

**Compromiso honesto:** el primer curso REAL con alumnos de franquicia NO debe correr esta
semana — arriesgar la franquicia de una empresa cliente en una plataforma sin certificar viola
la constitución (P3) y el spec (§7-R5). **Lo que SÍ logramos esta semana (Hito 0):** la
plataforma naciendo con el corazón funcionando — asistencia SENCE registrada de verdad en el
ambiente oficial de pruebas `rcetest`, con token real de tu OTEC. El piloto real llega en el
Hito 4 (≈ semanas 6–8), con red de seguridad completa.

---

## Hito 0 — Sprint Fundación (ESTA SEMANA, 5 días)

**Objetivo demostrable:** un curso demo en staging donde un alumno de prueba registra su
asistencia en `rcetest` de punta a punta, con bitácora auditable.

| # | Día | Tarea | Trazabilidad | Hecho cuando… |
|---|---|---|---|---|
| 0.1 ✅ | L | Crear repo GitHub + Next.js/TS + estructura modular + lint/typecheck/Vitest en CI | Plan §2, §11 | CI verde en el primer PR — hecho 2026-07-14 |
| 0.2 | L | Proyecto Supabase (dev) + migración inicial: `tenants`, `memberships`, `audit_log` con RLS activada + seeds (tenant OTEC Edu + 8 roles de prueba) | Plan §3–4 | Test de aislamiento base pasa |
| 0.3 | L | Coolify en VPS V2Networks + deploy staging automático desde `main` + SSL wildcard | Plan §7 | Hello-tenant visible en `demo.<dominio-temporal>` |
| 0.4 | M | Auth (Supabase) + middleware de tenant por subdominio + guard RBAC mínimo (admin/alumno) | HU-2.1, 2.3 | Login + rutas protegidas por rol |
| 0.5 ✅ | M | ⚠ Descargar manual RCE v1.1.5/v1.1.6 y hacer **diff** contra SPEC portable; congelar contrato del motor | Plan §13.1 | Contrato SENCE escrito en `sence/README` — hecho 2026-07-14 contra manual **v1.1.6** (vigente); diff en `docs/sence/` |
| 0.6 | M–X | **Mock RCE local** (contenedor): IniciarSesion/CerrarSesion + callbacks + tabla completa de errores | Plan §5, §11 | Suite de integración corre sin internet |
| 0.7 | X–J | Motor SENCE núcleo: `/api/sence/start`, `/api/sence/cb`, `/api/sence/close`, tablas `sence_sessions`+`sence_events`, máquina de estados, cifrado del token, traducción de errores | HU-5.1, 5.3, 5.4 | Todos los casos del mock pasan (éxito, 100–310, replay, callback tardío, cierre) |
| 0.8 | J | Curso demo mínimo (1 módulo, 2 lecciones de texto/video embed) + candado SENCE + contador 3 h | HU-5.2 | Alumno demo bloqueado hasta registrar |
| 0.9 | V | **Certificación en `rcetest` real**: token del OTEC generado en `/rts`, ambiente test por acción, prueba con tu propio RUN | Plan §13.4 | Asistencia visible con `IdSesionSence` real de rcetest + evento en bitácora |
| 0.10 | V | Redactar y enviar consulta a `controlelearning@sence.cl` (obligatoriedad API SIC línea 3) + runbook `RESTORE.md` inicial | Plan §13.2, §8 | Correo enviado; restore de BD dev ensayado 1 vez |

**Riesgos del sprint:** acceso a `/rts` para generar token (verificar el lunes a primera hora);
`rcetest` caído o con mantenimiento (colchón: el mock cubre el desarrollo).

## Hito 1 — Gestión académica y contenido (semanas 2–3)

- 1.1 CRUD cursos con modalidad y reglas de completitud — HU-3.1, 4.4
- 1.2 Acciones SENCE (código, línea, fechas, ambiente, candado, cierre opcional) + panel de configuración SENCE del tenant (RUT y token cifrado write-only, probar en rcetest) — HU-3.2, 5.4
- 1.3 Inscripciones + import CSV/Excel con validación RUN/DV + exentos — HU-2.2, 3.2, 3.3
- 1.4 Constructor nativo v1 (módulos/lecciones: texto, video Bunny, archivo, embed; reordenar; borrador/publicado) — HU-4.1
- 1.5 Progreso del alumno + "retomar donde quedé" — HU-4.3
- 1.6 Correos transaccionales (invitación, bienvenida con guía Clave Única) — HU-3.3
- 1.7 Roles restantes en RBAC (coordinador, relator, tutor) + tests matriz completa — HU-2.3
- 1.8 Tablero relator con avance y semáforo — HU-3.4
- 1.9 Magic links de acceso para alumnos (Supabase Auth) — HU-2.1
- 1.10 Editor de marca del tenant: logos, colores con chequeo de contraste y vista previa en vivo — HU-1.2

## Hito 2 — Evaluación y panel SENCE (semana 4)

- 2.1 Quizzes autocorregidos (3 tipos, intentos, banco, escala 1.0–7.0) — HU-6.1
- 2.2 Tareas con entrega y corrección (relator/tutor) — HU-6.2
- 2.3 Libro de notas por acción + auditoría de cambios — HU-6.4
- 2.4 Panel de cumplimiento SENCE + export Excel (columnas del reporte del plugin) — HU-5.5
- 2.5 Portal Supervisor v1: rol de solo lectura para fiscalizador SENCE — HU-5.5, M12
- 2.6 Cron: expiración 3 h, inactividad 60 min, alertas tasa de error — Plan §5.6
- 2.7 Pre-flight de acción SENCE (validación masiva RUN/DV, guía Clave Única, check de configuración, alerta día 1) — HU-5.8
- 2.8 Clonado de cursos y re-ejecución de acciones — HU-3.6

## Hito 3 — Cierre del ciclo formativo + endurecimiento (semanas 5–6)

- 3.1 Encuesta de satisfacción (plantilla, requisito de completitud, agregados) — HU-6.3
- 3.2 Certificados PDF con plantilla SENCE (folio, QR, verificación pública, revocación, umbral de asistencia SENCE) — HU-7.1, 7.2 (+ verificar campos normados, spec §7-R7)
- 3.3 Checklist DJ/GCA con recordatorios (n8n) + nómina exportable — HU-5.6
- 3.4 Anuncios + foro de consultas + mensajería + calendario (mínimos SENCE) — M9
- 3.5 Derechos Ley 21.719 en UI (export/supresión con retenciones) + consentimiento — HU-2.4, RNF-3
- 3.6 Hardening: rate limits, headers, 2FA obligatorio admins, revisión OWASP — Plan §9
- 3.7 Backups off-site completos + **ensayo de restauración 1** + Uptime Kuma + Sentry — Plan §8, §10
- 3.8 E2E Playwright de los 3 flujos críticos — Plan §11
- 3.9 Automatizaciones n8n por reglas: recordatorios de asistencia SENCE, correos a alumnos inactivos e informes automáticos de asistencia al coordinador — HU-5.9
- 3.10 Iniciar verificación Meta Business para WhatsApp (trámite lento; el canal opera en Hito 5) — M9
- 3.11 Portal Supervisor completo: invitaciones OTIC/externos, alcance por acción, vigencia y auditoría de consultas — HU-12.1, 12.2
- 3.12 Expediente digital de fiscalización por acción (documentos, estados, ZIP) — HU-5.10

## Hito 4 — PILOTO REAL (semanas 6–8) 🎯

- 4.1 Checklist pre-producción SENCE: certificación `rcetest` completa firmada + revisión adversarial del módulo `sence/`
- 4.2 Acción real de franquicia con grupo pequeño (curso de la OTEC de Edu) en ambiente producción SENCE
- 4.3 Monitoreo intensivo diario del piloto + canal de soporte a alumnos + plan B documentado (si el motor falla: procedimiento de contingencia y contacto SENCE)
- 4.4 **Ensayo de restauración 2** (criterio spec §8.3)
- 4.5 Retro del piloto → ajustes al spec (P1) → segunda acción real

## Hito 5 — De producto propio a SaaS vendible (semanas 9–14)

- 5.1 Reproductor SCORM (spike con paquete Storyline real → integración scorm-again) — HU-4.2, ADR-006
- 5.2 Portal empresa cliente + resumen semanal — HU-8.1, 8.2
- 5.3 Onboarding de tenant nuevo sin tocar código (criterio spec §8.4) + suspensión — HU-1.1, 1.4
- 5.4 Sincrónico en vivo (lección tipo videoconferencia + asistencia RCE por sesión ⚠ validar norma) — spec §7-R3
- 5.5 Tablero superadmin + métricas de negocio — HU-10.3
- 5.6 Marca definitiva, dominio, landing comercial, política de privacidad y contrato de encargo revisados por abogado — Plan §13.3, §9
- 5.7 Documentación de venta: demo con datos ficticios + one-pager "cumplimiento SENCE + Ley 21.719"
- 5.8 Tutor IA (M11): RAG con pgvector, chat streaming, límites y panel de uso, derivación a humano — ADR-007
- 5.9 IA por lotes en n8n: resúmenes ejecutivos para empresas, borradores human-in-the-loop para tutores, recordatorios personalizados (upgrade de 3.9) — HU-8.2, 9.5, 5.9
- 5.10 Creación asistida de cursos: asistente guiado paso a paso con dos entradas (desde cero o desde descriptor SENCE .docx) + plantillas por tipo — HU-3.5, 4.5
- 5.11 Canal WhatsApp operativo (plantillas aprobadas, orquestado en n8n) — M9
- 5.12 Vencimientos y recertificación de certificados (alertas 90/60/30, listado por empresa) — HU-7.3
- 5.13 Export completo del tenant en formatos abiertos — HU-1.5

## Backlog v2 (no ahora — anotado para no perderlo)

Checkout con pasarela chilena · LCE presencial · API LMS↔SIC operativa + activación líneas 1 y 6 ·
migrador desde Moodle · custom domains por tenant · app móvil · gamificación ·
marketplace de contenidos entre OTECs · alta disponibilidad (réplica BD).

## Definición de Hecho (toda tarea)

1. Trazable a una HU o sección del plan. 2. Tests que cubren el criterio de aceptación.
3. RLS/permisos verificados si toca datos. 4. Auditoría si la acción es sensible.
5. Pasó por staging. 6. Sin secretos ni RUNs en logs. 7. Documentación mínima actualizada
(runbook o README del módulo si cambió el comportamiento). 8. Si toca UI: verificada en
360 px y 1440 px sin scroll horizontal, tablas colapsan a tarjetas en móvil (RNF-6).
