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
| 0.2 ✅ | L | Proyecto Supabase (dev) + migración inicial: `tenants`, `memberships`, `audit_log` con RLS activada + seeds (tenant OTEC Edu + 8 roles de prueba) | Plan §3–4 | Test de aislamiento base pasa — hecho 2026-07-14: `pnpm test:rls` 64/64, job `rls` en CI |
| 0.3 ✅ | L | Coolify en VPS + deploy staging desde `main` + SSL | Plan §7 | **Hecho 2026-07-15:** app en Coolify (Dockerfile), backend en Supabase cloud (migraciones+seeds+Auth Hook), DNS chilearning.cl → VPS, SSL Let's Encrypt. Login verificado en https://otec-andes.chilearning.cl (dominio renombrado a seminarea.chilearning.cl en D-046) |
| 0.4 ✅ | M | Auth (Supabase) + middleware de tenant por subdominio + guard RBAC mínimo (admin/alumno) | HU-2.1, 2.3 | Login + rutas protegidas por rol — hecho 2026-07-14: Auth Hook (claims tenant_id/roles), login verificado en navegador, matriz de 8 roles con logins reales (80 RLS), revisión adversarial aplicada |
| 0.5 ✅ | M | ⚠ Descargar manual RCE v1.1.5/v1.1.6 y hacer **diff** contra SPEC portable; congelar contrato del motor | Plan §13.1 | Contrato SENCE escrito en `sence/README` — hecho 2026-07-14 contra manual **v1.1.6** (vigente); diff en `docs/sence/` |
| 0.6 ✅ | M–X | **Mock RCE local** (contenedor): IniciarSesion/CerrarSesion + callbacks + tabla completa de errores | Plan §5, §11 | Suite de integración corre sin internet — hecho 2026-07-14 (`pnpm test:integration` 7/7, mock con `/_mock/scenario`) |
| 0.7 ✅ | X–J | Motor SENCE núcleo: `/api/sence/start`, `/api/sence/cb`, `/api/sence/close`, tablas `sence_sessions`+`sence_events`, máquina de estados, cifrado del token, traducción de errores | HU-5.1, 5.3, 5.4 | **Hecho 2026-07-15:** dominio + cifrado AES-256-GCM + servicio con tenantGuard + rutas (Zod) + suite de integración con BD contra el mock (gate F0). Verificado en runtime real (login→start→mock→callback con nonce→sesión `iniciada`). Revisión adversarial aplicada (C-1, H-1, H-2, H-3, M-1..M-4). Falta solo la certificación en `rcetest` real (0.9, con Edu) |
| 0.8 ✅ | J | Curso demo mínimo (1 módulo, 2 lecciones de texto/video embed) + candado SENCE + contador 3 h | HU-5.2 | Alumno demo bloqueado hasta registrar — hecho 2026-07-15: página `/mi-curso` con candado (dominio unit-testeado), contador 3 h, registrar/cerrar; verificado en runtime real (bloqueado 360px → registrar → mock → desbloqueado 1440px con 2 lecciones) |
| 0.9 | V | **Certificación en `rcetest` real**: token del OTEC generado en `/rts`, ambiente test por acción, prueba con tu propio RUN | Plan §13.4 | Asistencia visible con `IdSesionSence` real de rcetest + evento en bitácora |
| 0.10 | V | Redactar y enviar consulta a `controlelearning@sence.cl` (obligatoriedad API SIC línea 3) + runbook `RESTORE.md` inicial | Plan §13.2, §8 | Correo enviado; restore de BD dev ensayado 1 vez |

**Riesgos del sprint:** acceso a `/rts` para generar token (verificar el lunes a primera hora);
`rcetest` caído o con mantenimiento (colchón: el mock cubre el desarrollo).

## Hito 1 — Gestión académica y contenido (semanas 2–3)

- 1.1 ✅ CRUD cursos con modalidad y reglas de completitud — HU-3.1, 4.4 — **hecho 2026-07-15** (modalidad/horas/reglas/estado, validación de dominio, CRUD vía tenantGuard solo admin/coord, UI /admin/cursos verificada en runtime)
- 1.2 ✅ Acciones SENCE + panel de configuración SENCE del tenant — HU-3.2, 5.4 — **hecho 2026-07-15**: panel /admin/sence (token cifrado write-only) + CRUD de acciones /admin/acciones (código/línea/ambiente por-acción, comodín -1 solo en rcetest, candado, fechas); verificado en runtime
- 1.3 ✅ Inscripciones + import CSV con validación RUN/DV + exentos — HU-2.2, 3.2, 3.3 — **hecho 2026-07-15** (parser+validador fila a fila, import idempotente vía tenantGuard, reporte fila a fila, plantilla; verificado en runtime 360/1440)
- 1.4 ✅ Constructor de lecciones — HU-4.1 — **hecho 2026-07-15**: tipos texto/video/archivo/embed, reordenar (↑↓), borrador/publicado; /admin/cursos/[id]/lecciones; el alumno solo ve publicadas; verificado en runtime
- 1.5 ✅ Progreso del alumno + "retomar donde quedé" — HU-4.3 — **hecho 2026-07-15**: tabla lesson_progress + RLS, marcar lección completada (verificando propiedad), barra de % y "retomar" en /mi-curso; verificado en runtime
- 1.6 ✅ Correos transaccionales (invitación, bienvenida con guía Clave Única) — HU-3.3 — **hecho 2026-07-15**: plantillas HTML con la marca del tenant (escape anti-inyección), la de bienvenida trae la guía paso a paso de Clave Única; vista previa en /admin/correos. (Envío real vía proveedor = follow-up)
- 1.7 ✅ Roles restantes en RBAC + tests matriz completa — HU-2.3 — **hecho 2026-07-15**: suite data-driven de los 8 roles × tablas de negocio (deny-by-default verificado); cazó y corrigió una fuga: token_encrypted era legible por el cliente (grant de columna arreglado)
- 1.8 ✅ Tablero relator con avance y semáforo — HU-3.4 — **hecho 2026-07-15**: /tablero con avance promedio + asistencia SENCE + semáforo (verde/amarillo/rojo) por acción, ordenado por riesgo; verificado en runtime. (Acotado "sus cursos" del relator = follow-up con asignación por curso)
- 1.9 ✅ Magic links de acceso para alumnos (Supabase Auth) — HU-2.1 — **hecho 2026-07-15**: login con pestaña "enlace por correo" (signInWithOtp) + ruta /auth/callback (exchange code, redirect relativo anti-open-redirect); verificado end-to-end con MailPit local
- 1.10 ✅ Editor de marca del tenant — HU-1.2 — **hecho 2026-07-15**: /admin/marca con colores + datos legales + URL de logo, **chequeo de contraste WCAG en vivo** con sugerencia de ajuste, y **vista previa en vivo** del portal; cambios en audit_log. (Subida de archivos de logo: follow-up)

## Hito 2 — Evaluación y panel SENCE (semana 4)

- 2.1 ✅ Quizzes autocorregidos (3 tipos, intentos, banco, escala 1.0–7.0) — HU-6.1 — **hecho 2026-07-15** (PR #37 esquema/dominio/servicios + #38 UI + intento del alumno): pauta sin grant a authenticated, finalización perezosa del intento vencido, defaults D-022 S1–S7
- 2.2 ✅ Tareas con entrega y corrección (relator/tutor) — HU-6.2 — **hecho 2026-07-15** (PR #39): `assignments`/`submissions` INSERT-only + bucket privado + `notifications`; revisión adversarial 4-ojos aplicada (D-023): nota publicada blindada (trigger + guardias), cambio de nota + auditoría atómicos vía RPC `write_assignment_grade`, cola paginada, sin huérfanos en Storage. M2+M3 aplicadas al cloud
- 2.3 Libro de notas por acción + auditoría de cambios — HU-6.4 — **(SIGUIENTE — GATE del hito)**
- 2.4 ✅ Panel de cumplimiento SENCE + export Excel (columnas del plugin verbatim + `ID SESION SENCE`) — HU-5.5 — **hecho 2026-07-15** (PR #34 nombres + #35 panel/export xlsx, D-021)
- 2.5 ✅ Portal Supervisor v1: rol de solo lectura para fiscalizador SENCE — HU-5.5, M12 — **hecho 2026-07-15** (PR #36): reusa compliance-panel; suites de NO-escritura (RLS + servicios)
- 2.6 ✅ Cron: expiración 3 h, inactividad 60 min, alertas tasa de error — Plan §5.6 — **hecho 2026-07-15** (PR #31): worker BullMQ+Redis (proceso aparte, misma imagen) dispara T4/T6/T9 con CAS estrecho + auditoría (`sence.session_expired`); desbloquea el "brick" del índice único parcial; alertas de tasa de error por tenant (tabla `alerts` + política D-017); knobs I-13 cableados. Verificado end-to-end con worker real contra Redis local. ⚠ Post-merge: desplegar Redis + app worker en Coolify staging
- 2.7 ✅ Pre-flight de acción SENCE (validación masiva RUN/DV, guía Clave Única, check de configuración, alerta día 1) — HU-5.8 — **hecho 2026-07-15** (PR #33): checklist de 8 ítems reusando validadores congelados de `preflight.ts`, envío real de guía + marca manual de respaldo, alerta día-1 en el tick del worker (D-020)
- 2.8 ✅ Clonado de cursos y re-ejecución de acciones — HU-3.6 — **hecho 2026-07-15** (PR #41): RPC transaccional `clone_course` (copia curso+lecciones+quizzes(+preguntas)+tareas a borrador, nunca runtime), estado `action_status` draft/active + CHECK, `reexecuteAction` + activación por UI; revisión 4-ojos aplicada (D-025). **HITO 2 COMPLETO (9/9).**

## Hito 3 — Cierre del ciclo formativo + endurecimiento (semanas 5–6)

- 3.1 ✅ Encuesta de satisfacción (plantilla, requisito de completitud, agregados) — HU-6.3 — **hecho 2026-07-16** (#45): anonimato estructural (2 tablas + RPC atómico), agregados por acción, `hasCompletedSurvey` para el gate de certificados; revisión 4-ojos (HIGH de re-identificación corregido)
- 3.2 ✅ Certificados PDF con plantilla SENCE (folio, QR, verificación pública, revocación, umbral de asistencia SENCE) — HU-7.1, 7.2 — **hecho 2026-07-16** (#46): snapshot §7-R7 congelado, RPCs issue/revoke/verify (público, RUN enmascarado), pdf-lib/qrcode (ADR-009); revisión 4-ojos (HIGH de descarga corregido). Handoff: confirmar campos §7-R7 + firma real
- 3.3 ✅ Checklist DJ/GCA con máquina de estados + liquidación 60d + nómina exportable — HU-5.6 — **hecho 2026-07-16** (#62): `dj_checklist` + enum `dj_state` con transiciones legales puras, deadline `ends_on+60`, `ensureChecklist` idempotente (excluye exentos), RPC atómico `dj_set_state` (estado+audit en una transacción, TOCTOU cerrado), nómina xlsx/csv; staff-only (sin supervisor, cumplimiento SENCE interno); 4-ojos SHIP (F1 MED→RPC atómico, F2/F4 corregidos). Recordatorios n8n = follow-up en 3.9
- 3.4 ✅ Anuncios + foro de consultas + mensajería + calendario (mínimos SENCE) — M9 — **hecho 2026-07-16** (#47): canal nativo; mensajería asincrónica exigible SENCE (HU-9.3); RLS de privacidad; SLA visible; 4-ojos sin HIGH/MED
- 3.5 ✅ Derechos Ley 21.719 en UI (export/supresión con retenciones) + consentimiento — HU-2.4, RNF-3 — **hecho 2026-07-16** (#59): consentimiento (gate) + export JSON + supresión que conserva SENCE y redacta perfil/foro/mensajes; 4-ojos (HIGH de supresión falsa corregido). Handoff: revisión legal
- 3.6 🔶 Hardening: rate limits, headers, 2FA obligatorio admins, revisión OWASP — Plan §9 — **hecho parcial 2026-07-16** (#48): cabeceras + CSP report-only, rate-limit por-usuario en rutas SENCE, CSRF, Dependabot, OWASP doc, 2FA config+policy; 4-ojos (HIGH corregido). Handoff: Supabase Pro (2FA enforcement/UI), CSP enforcing
- 3.7 🔶 Backups off-site completos + **ensayo de restauración 1** + Uptime Kuma + Sentry — Plan §8, §10 — **hecho parcial 2026-07-16** (#57): /api/health + HEALTHCHECK, scrubber de PII/token de Sentry (puro, 4-ojos F1 cazó fuga de token descifrado), pipeline ops/backup + ensayo #3 real, docs. Handoff: SDK Sentry+DSN, cuenta R2+age, Uptime Kuma
- 3.8 ✅ E2E Playwright de los 3 flujos críticos — Plan §11 — **hecho 2026-07-16** (#68): harness real (app + Supabase local + login real por UI con Auth Hook + tenant por subdominio vía `localtest.me`), desktop 1440 + móvil Pixel 5; **3 flujos verdes en CI**: (1) alumno responde encuesta, (2) subrutas de acción cargan (**guardia anti-#41**), (3) verificación pública de certificado con RUN enmascarado (el RUN completo nunca aparece, P4); job `e2e` en CI + smoke por rol sin scroll horizontal a 360px. **HITO 3 COMPLETO (12/12).**
- 3.9 ✅ Automatizaciones n8n por reglas: recordatorios de asistencia SENCE, correos a alumnos inactivos e informes automáticos de asistencia al coordinador — HU-5.9 — **hecho 2026-07-16** (#66): worker `reminders-tick`; dominio puro (seudónimo HMAC, firma webhook, reglas); **RNF-10 por construcción** (a n8n solo agregado seudonimizado, correo PII por EmailSender); opt-out del alumno + config por acción; dedup diario. 4-ojos SHIP (MED de link relativo → URL absoluta corregido; LOW documentados). Categoría B: degrada a no-op sin n8n (handoff `docs/n8n/WORKFLOWS.md`)
- 3.10 ✅ Iniciar verificación Meta Business para WhatsApp (trámite lento; el canal opera en Hito 5) — M9 — **hecho 2026-07-16** (#58): checklist producido (`docs/whatsapp/META-BUSINESS-VERIFICATION.md`); el trámite lo ejecuta Edu (handoff)
- 3.11 ✅ Portal Supervisor completo: invitaciones OTIC/externos, alcance por acción, vigencia y auditoría de consultas — HU-12.1, 12.2 — **hecho 2026-07-16** (#64): `supervisor_grants` + `grant_actions`, helpers `SECURITY DEFINER` de vigencia/alcance, **endurece 6 policies vivas** (enrollments/sence_sessions/sence_events/grades/lesson_progress/alerts: `has_role('supervisor')` → `+ grant activo y en alcance`), backfill de supervisores existentes; portal GATED que audita cada consulta (`cumplimiento-service` staff-only + builders `*Unchecked`); invitación con link copiable (degrada sin RESEND). Revisión **4-ojos multi-agente** (4 lentes + verificación): 1 MED confirmado (alerts sin escopar → escopado con `supervisor_has_tenant_grant`), resto refutado. Migración aplicada al cloud (backfill 2)
- 3.12 ✅ Expediente digital de fiscalización por acción (documentos, estados, ZIP) — HU-5.10 — **hecho 2026-07-16** (#60): `action_documents` + definitivos inmutables + bucket + checklist + ZIP con manifiesto; staff-only admin/coordinador; jszip; 4-ojos (MED corregido)

## Hito 4 — PILOTO REAL (semanas 6–8) 🎯

- 4.1 🔶 Checklist pre-producción SENCE: certificación `rcetest` completa firmada + revisión adversarial del módulo `sence/` — **revisión adversarial ✅ hecha 2026-07-16** (#80, D-047: panel multi-agente, 19 hallazgos, 1 HIGH `callback_nonce` corregido en #81 con 4-ojos + migración al cloud) + **checklist pre-producción ✅** (#82). Certificación `rcetest` 🔒 PARQUEADA (bloqueo del lado de SENCE; validación diferida al primer curso real)
- 4.2 🔒 **PARQUEADA (2026-07-17, decisión de Edu)** Acción real de franquicia con grupo pequeño en producción SENCE — espera **mundo real**: curso de Seminarea codificado en SENCE + grupo de alumnos. Todo lo demás está listo: rulings D-048 ✅, checklist 4.1a con gates técnicos verificados ✅, token real cargado + ambiente `rce` ✅, grupos operativos de planilla (Sence-XXXX/Becario) ✅ (#93). **Regla de re-entrada:** antes de activar, re-verificar los gates del checklist (~30 min: worker/Kuma/Sentry/backup/staging) — pueden derivar en semanas
- 4.3 ✅ Monitoreo intensivo diario del piloto + canal de soporte a alumnos + plan B documentado — **hecho 2026-07-16** (#78): `docs/ops/` con Plan B de contingencia (6 escenarios: VPS/Supabase/SENCE/worker/bug/periféricos), runbook de monitoreo diario y runbook de rotación de secretos (cierra RNF-8). Contacto SENCE: `controlelearning@sence.cl`
- 4.4 ✅ **Ensayo de restauración 2** (criterio spec §8.3) — **hecho 2026-07-16** (#89, ensayo #4 en `docs/RESTORE.md`): end-to-end REAL con Edu (dump cifrado de R2 → SHA-256 → descifrado `age` → restore en BD limpia → integridad verificada) en ~49 s. **§8.3 CUMPLIDO**
- 4.5 🔒 PARQUEADA (sigue a 4.2) Retro del piloto → ajustes al spec (P1) → segunda acción real (post-piloto)

## Hito 5 — De producto propio a SaaS vendible (semanas 9–14)

- 5.1 Reproductor SCORM (spike con paquete Storyline real → integración scorm-again) — HU-4.2, ADR-006
- 5.2 Portal empresa cliente + resumen semanal — HU-8.1, 8.2
- 5.3 Onboarding de tenant nuevo sin tocar código (criterio spec §8.4) + suspensión — HU-1.1, 1.4
- 5.4 Sincrónico en vivo (lección tipo videoconferencia + asistencia RCE por sesión ⚠ validar norma) — spec §7-R3
- 5.5 Tablero superadmin + métricas de negocio — HU-10.3
- 5.6 Marca definitiva, dominio, landing comercial, política de privacidad y contrato de encargo revisados por abogado — Plan §13.3, §9
- 5.7 ✅ Documentación de venta: demo con datos ficticios + one-pager "cumplimiento SENCE + Ley 21.719" — **hecho 2026-07-18**: tenant demo `demo` (3er tenant, 100% ficticio, aditivo) sembrado con curso/SENCE/evaluaciones/encuesta/certificado/foro coherentes entre sí (certificado emitido solo con datos que sí cumplen las reglas reales de elegibilidad — `evaluateEligibility`/`attendancePctFromCells` — nunca un snapshot inventado), `docs/venta/GUION-DEMO.md` (guion 15-20 min) y `docs/venta/ONE-PAGER.md`
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
