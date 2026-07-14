# INSTRUCCIONES-AGENTE.md — Misión: construir "Chilearning" de punta a punta

> **Qué es este documento:** el briefing de misión para el agente de IA orquestador (y sus
> subagentes) encargado de desarrollar esta plataforma end-to-end. Complementa — no reemplaza —
> a `CLAUDE.md` (reglas operativas de cada sesión) y a `/specs` (fuente de verdad del producto).
> Si algo aquí contradice la constitución o la especificación, ganan ellas y este documento
> debe corregirse.
>
> Fecha: 2026-07-13 · Origen: entrevista SDD completa entre Edu (dueño) y Claude (arquitecto).

---

## 1. El proyecto en una página

**Qué se construye:** un LMS SaaS **multi-tenant** para OTECs chilenas (organismos técnicos de
capacitación), cuyo diferenciador es la **integración nativa con SENCE**: registro de asistencia
e-learning vía redirección a Clave Única (protocolo RCE), gestión de acciones de capacitación,
panel de cumplimiento, expediente de fiscalización y certificados verificables — más cumplimiento
de la Ley 21.719 de protección de datos desde el diseño. Se vende por suscripción; cada OTEC
recibe un subdominio con su propia marca (white-label).

**Estado actual:** especificación completa (12 módulos, 8 roles), plan técnico con 7 ADRs,
desglose de tareas en 6 hitos. **Código: cero líneas.** La misión del agente es convertir los
specs en producto funcionando, hito por hito.

**Éxito de la v1** (spec §8): (1) un curso de franquicia ejecutado de punta a punta con la OTEC
de Edu — inscripción → asistencia SENCE real → evaluaciones → encuesta → certificado → reporte
para declaraciones juradas — sin planillas externas; (2) cero fugas de datos entre tenants;
(3) restauración de backup ensayada ≥2 veces antes del piloto; (4) un segundo tenant operable
sin tocar código.

**El humano:** Edu es el dueño, único humano del proyecto y primer cliente (su OTEC opera hoy
un Moodle 4.3.6 con el plugin block_sence; el nuevo LMS parte de cero, sin migración). No es
desarrollador senior: comunícate SIEMPRE en español claro, explica lo técnico en simple y nunca
asumas que una mecánica de desarrollo "se entiende sola". Revisa PRs por la mañana. Ya tiene:
VPS (V2Networks Santiago), proyecto Supabase y el token SENCE de su OTEC (que NUNCA se usa sin
él presente).

---

## 2. Mapa de documentos (léelos en este orden)

| # | Documento | Qué es | Cuándo consultarlo |
|---|---|---|---|
| 1 | `specs/00-constitucion.md` | Los 10 principios innegociables (P1–P10) | Ante CUALQUIER duda de diseño o conflicto. Es la ley suprema. |
| 2 | `specs/01-especificacion.md` | El QUÉ: glosario, 8 roles con matriz de permisos, 12 módulos (M1–M12) con historias de usuario (HU) y criterios de aceptación (CA), RNF-1..10, riesgos R1–R7 | Antes de implementar cada tarea: los CA son la fuente literal de los tests. |
| 3 | `specs/02-plan-tecnico.md` | El CÓMO: stack, arquitectura, multi-tenancy con RLS, modelo de datos, diseño del motor SENCE, infraestructura, seguridad, ADRs 001–007 | Antes de decidir cualquier cosa técnica: probablemente ya está decidido aquí. |
| 4 | `specs/03-tareas.md` | El plan de ejecución: Hito 0 (fundación) → Hito 5 (SaaS vendible), backlog v2 y la Definición de Hecho | Tu backlog de trabajo. Se ejecuta EN ORDEN salvo dependencias explícitas. |
| 5 | `CLAUDE.md` | Reglas operativas: comandos, estilo de código, reglas duras, checklist por tarea, trampas conocidas del protocolo SENCE | En cada sesión de trabajo, siempre cargado. |
| 6 | `.env.example` | Todas las variables de entorno, comentadas y etiquetadas por hito ([H0], [H1]…) | Al configurar entornos. Los valores reales los provee SOLO Edu. |
| 7 | `integracion-sence-portable/SPEC_INTEGRACION_SENCE.md` | Protocolo SENCE RCE agnóstico de stack: endpoints test/prod, campos del POST, tabla completa de errores (100–310), modelo de datos, casos borde | La biblia del motor SENCE. Leerla completa antes de tocar `src/modules/sence/`. |
| 8 | `block_sence/ANALISIS_PLUGIN_SENCE.md` + `integracion-sence-portable/referencia-node/` | Análisis del plugin Moodle que opera HOY en producción + implementación de referencia en Node/Express | Para entender el flujo probado en el mundo real y sus quirks. |
| 9 | Manuales oficiales SENCE (sence.gob.cl): *Integración Registro Asistencia v1.1.5* (PDF) y *Guía GCA e-learning v1.3* (PDF) | La norma oficial | Tarea 0.5: diff contra el documento #7 y congelar el contrato del motor. Ante discrepancia, **manda el manual oficial**. |

**Precedencia ante conflicto:** constitución > especificación > plan > tareas > CLAUDE.md > este
documento. Si detectas una contradicción: DETENTE en esa tarea, propone la corrección del
documento de mayor rango en un PR separado, y avanza con otra tarea no afectada mientras Edu decide.

---

## 3. Ciclo de trabajo por tarea (obligatorio)

1. **Tomar** la primera tarea no bloqueada del hito vigente en `specs/03-tareas.md`.
2. **Leer** sus HU y CA en la especificación, más las secciones del plan que referencia.
   Si la tarea es grande (más de un día de trabajo) y el módulo no tiene spec detallada,
   escribir primero `specs/modulos/<modulo>.md` (mini ciclo specify→clarify) y validarla
   contra la spec maestra.
3. **Escribir los tests primero**, derivados literalmente de los CA (unit para dominio puro,
   integración para RLS/SENCE, E2E para flujos completos).
4. **Implementar** en rama `feat/h<hito>-<tarea>-<descripcion>` (ej. `feat/h0-0.7-sence-engine`).
5. **Verificar** la Definición de Hecho completa (final de `03-tareas.md`): lint, typecheck,
   tests, RLS si tocó datos, 360 px/1440 px si tocó UI, sin secretos ni RUNs en logs.
6. **Abrir PR** con la plantilla del §8. En el MISMO PR, marcar la tarea como hecha en
   `specs/03-tareas.md` y actualizar toda documentación afectada (P1: el spec siempre refleja
   la realidad).
7. **CI rojo:** arreglar. Tres intentos fallidos sobre lo mismo → protocolo de bloqueo (§7).
8. **Repetir** con la siguiente tarea.

### Prohibiciones absolutas del agente (además de las de CLAUDE.md)

- Tocar producción o correr migraciones en ella. El deploy a producción lo aprueba Edu, siempre.
- Usar el token SENCE real o los ambientes `rcetest`/`rce` sin Edu presente en la sesión.
  El desarrollo autónomo usa EXCLUSIVAMENTE el mock local.
- Inventar valores de secretos o credenciales. Si falta una, se pide a Edu y se avanza en otra tarea.
- Reducir o eliminar silenciosamente un CA porque "era difícil". Se propone el cambio de spec y se espera.
- Mergear a `main` sin CI verde, o debilitar un test para que pase.
- Introducir dependencias significativas sin registrar un ADR nuevo en el plan §12.
- Usar datos reales de personas en tests, fixtures o seeds (existe el generador ficticio).

---

## 4. Estrategia de subagentes

Usa subagentes cuando aceleren sin arriesgar: trabajo paralelizable en archivos disjuntos,
revisión independiente, investigación puntual. El orquestador (tú) planifica, integra, resuelve
conflictos y responde ante Edu. Nunca delegues la integración final ni la comunicación con Edu.

### Roles de subagente

| Rol | Misión | Contexto que recibe | Devuelve |
|---|---|---|---|
| **Implementador** | Una tarea concreta del backlog | HU + CA, secciones pertinentes del plan, rutas de archivos de su módulo, extracto de reglas duras | Código + tests en verde + notas de decisiones |
| **Autor de tests** | Derivar tests de los CA ANTES de implementar | HU + CA + contratos/tipos del módulo | Suite de tests (roja, esperando implementación) |
| **Revisor adversarial** | Intentar ROMPER un PR: seguridad, RLS, casos borde SENCE, matriz de permisos | El diff del PR + HU/CA + matriz de roles + tabla de errores SENCE | Hallazgos con severidad y pasos de reproducción |
| **Auditor de spec** | Al cerrar cada hito: comparar código vs especificación | Spec maestra + árbol de código del hito | Desviaciones (código sin spec / spec sin código) |
| **Explorador** | Investigar una duda puntual (docs de librería, manual SENCE, comportamiento de Supabase) | La pregunta exacta + dónde buscar | Respuesta con fuentes, SIN tocar código |

### Reglas de coordinación

1. **Archivos disjuntos:** dos subagentes jamás escriben el mismo archivo en paralelo. Si el
   trabajo se cruza, secuenciar o usar worktrees aislados y que el orquestador integre.
2. **Cuatro ojos en lo crítico:** todo cambio en `src/modules/sence/`, políticas RLS o auth lo
   implementa un agente y lo revisa adversarialmente OTRO. Siempre. Sin excepción.
3. **Contexto mínimo:** cada subagente recibe solo lo que necesita. No le pases la sesión
   completa: el foco produce calidad.
4. **Presupuesto de reintentos:** si un subagente falla 2 veces la misma tarea, el orquestador
   la retoma con diagnóstico propio en vez de insistir a ciegas.
5. **Paralelismo prudente:** máximo 3–4 implementadores simultáneos; más solo para tareas
   triviales e independientes (plantillas de correo, textos i18n).
6. **La coherencia manda sobre la velocidad:** ante la duda entre paralelizar o mantener
   coherente un módulo, gana la coherencia.

### Plantilla de prompt para subagente implementador

```text
Eres un subagente implementador del proyecto Chilearning (LMS SaaS multi-tenant con integración
SENCE, Chile). Tu única misión: [TAREA X.Y — título].

Historia y criterios (copiados de specs/01-especificacion.md):
[HU-n.m completa con sus CA]

Decisiones técnicas que te rigen (extracto del plan):
[secciones pertinentes: stack, convenciones del módulo, modelo de datos afectado]

Archivos en tu perímetro: [rutas]. NO toques nada fuera de él.

Reglas duras: TypeScript estricto sin `any`; RLS + tenant_id en toda tabla nueva; tests
derivados de los CA (escríbelos primero); UI verificada en 360 px y 1440 px; textos de UI en
español de Chile vía src/i18n/es-CL.ts; código e identificadores en inglés; nada de secretos
ni RUNs reales; errores SENCE traducidos con la tabla oficial; Conventional Commits.

Entrega: código + tests en verde + resumen de 5 líneas (qué hiciste, qué decidiste, qué dudas
quedan). Si la tarea contradice el spec o te falta información, DETENTE y repórtalo en vez de
improvisar.
```

---

## 5. Plan end-to-end por fases (con puertas de salida)

No se abre una fase sin cerrar la puerta (gate) de la anterior. Las tareas exactas viven en
`specs/03-tareas.md`; aquí se define cuándo una fase está DE VERDAD terminada.

**G0 — Puerta humana de arranque (Edu):** repo GitHub creado con `main` protegida y este paquete
de documentos dentro; `.env.local` completado (bloque [H0]); acceso a Coolify/VPS confirmado.
Sin G0 no hay misión.

**F0 = Hito 0 — Fundación y motor SENCE (contra mock).**
Gate de salida: CI completo en verde (lint, typecheck, unit, integración, RLS); staging
desplegado vía Coolify; la suite del motor SENCE contra el mock cubre: apertura exitosa, TODOS
los códigos de error (100–310) con su traducción, callback de cierre, callback tardío,
replay/duplicado, expiración a 3 horas, RUN inválido, candado activado/liberado y alumno exento;
curso demo navegable con candado; runbook `RESTORE.md` con un restore de BD dev ensayado.
⚠ La tarea 0.9 (certificación en `rcetest` con token real) es **sesión supervisada con Edu** —
el agente la prepara (checklist, datos, pantallas) pero jamás la ejecuta solo. Ídem 0.10: el
agente redacta el borrador del correo a controlelearning@sence.cl (obligatoriedad de la API
LMS-SIC para línea 3); Edu lo envía.

**F1 = Hito 1 — Gestión académica y contenido.**
Gate: E2E "alumno completa un curso" en verde, incluida su versión móvil; import CSV de 100
alumnos con errores mixtos reporta fila a fila sin insertar basura; editor de marca funcional
con chequeo de contraste; magic links operativos; matriz de permisos de los 8 roles cubierta
por tests (denegación por defecto verificada).

**F2 = Hito 2 — Evaluación y cumplimiento SENCE.**
Gate: libro de notas con auditoría de cambios; export Excel del panel SENCE con las columnas del
reporte del plugin actual; el pre-flight detecta RUN inválidos plantados a propósito; el clonado
de una acción exige nuevas fechas y código antes de activarse; portal supervisor v1 en solo
lectura real (con tests de que NO puede escribir nada).

**F3 = Hito 3 — Cierre del ciclo formativo y endurecimiento.**
Gate: certificado emitido → verificado por QR público → revocado → la verificación refleja la
revocación; encuesta como requisito de completitud funcionando; expediente de fiscalización
descarga su ZIP completo; recordatorios e informes n8n operando contra staging con datos
ficticios; **ensayo de restauración #1 ejecutado y cronometrado** (RTO ≤ 4 h); revisión OWASP +
headers + rate limits documentada; Sentry y Uptime Kuma reportando.

**F4 = Hito 4 — PILOTO REAL (fase dirigida por Edu).**
Gate de ENTRADA (lo firma Edu): certificación rcetest completa; revisión adversarial del módulo
SENCE hecha por un subagente distinto del implementador; plan de contingencia escrito (qué pasa
con los alumnos si el motor falla un día de curso). Durante el piloto, el agente pasa a modo
soporte: monitoreo diario, fixes con prioridad máxima, cero features nuevas. Gate de salida:
una acción real completada + retrospectiva documentada + ensayo de restauración #2.

**F5 = Hito 5 — De producto a SaaS vendible.**
SCORM (spike con un paquete Storyline real de Edu ANTES de integrar), portal empresa, Tutor IA
(M11 — RNF-10 a rajatabla: minimización, transparencia, presupuesto de tokens con corte),
wizard de creación de cursos, importador de descriptores, WhatsApp, vencimientos, export de
tenant. Gate: crear un tenant nuevo completo sin tocar código (criterio de éxito #4) + demo con
datos ficticios lista para mostrar a OTECs prospecto.

---

## 6. Qué decide el agente y qué decide Edu

**Decide el agente solo (y documenta):** detalles de implementación reversibles dentro del plan;
estructura interna de componentes; nombres técnicos; orden de tareas dentro de un hito cuando
las dependencias lo permiten; refactors que no cambian comportamiento.

**Documenta SIEMPRE en `specs/DECISIONES.md`** (registro ADR-lite: fecha, decisión, por qué,
alternativas descartadas): toda elección no trivial que otro desarrollador querría entender después.

**Escala a Edu SIEMPRE (y espera respuesta):** todo lo que cueste dinero nuevo (servicios,
planes, dominios); todo lo legal o de datos personales; TODO lo que toque SENCE real (token,
rcetest, producción); marca, nombre y dominio; modificar o eliminar un CA o un ADR existente;
dependencias significativas; cualquier cosa irreversible. Regla de oro: si dudas de si preguntar,
pregunta — pero junta las preguntas en lotes, no gotees una por una.

---

## 7. Manejo de bloqueos

| Situación | Acción |
|---|---|
| CI rojo tras 3 intentos sobre lo mismo | Abrir issue con diagnóstico y pasar a la siguiente tarea NO dependiente |
| Falta una credencial o servicio de Edu | Pedirla (en lote), avanzar en otra tarea mientras tanto |
| Contradicción entre documentos | Parar esa tarea; PR separado proponiendo el fix al documento de mayor rango |
| El manual oficial SENCE difiere de la SPEC portable | Manda el manual oficial; actualizar SPEC portable + motor + tests y anotarlo en DECISIONES.md |
| `rcetest` caído (en sesión con Edu) | Continuar contra el mock y reagendar; jamás "probar en producción" |
| Vulnerabilidad en una dependencia | Parche inmediato: prioridad sobre cualquier feature (P7) |
| Dos subagentes chocan en un archivo | El orquestador integra a mano y revisa los perímetros asignados |

**Formato de reporte de bloqueo (5 líneas):** qué intentaba · dónde falló (archivo/comando/error
literal) · qué probé (los 3 intentos) · mi hipótesis · qué necesito para destrabarme.

---

## 8. Comunicación con Edu

- Español latino claro, siempre. Cero jerga sin explicar (una vez explicada, puede usarse).
- **Al cierre de cada bloque de trabajo**, resumen ejecutivo corto (Edu lo lee con el café):
  ✅ hecho (con evidencia: tests, capturas móviles) · 🔍 cómo se verificó · ⏭ próximo paso ·
  ❓ decisiones que esperan su respuesta · 🚫 bloqueos.
- Los PRs son el registro técnico; el resumen es el registro humano. Ambos existen siempre.
- Nunca reportar como "terminado" algo que no pasó su gate. La confianza del sistema completo
  depende de esto.

### Plantilla de PR

```text
## Qué hace
[1–3 líneas + tarea X.Y y HU-n.m que implementa]

## Cómo se verificó
- [ ] Tests derivados de los CA (listar cuáles)
- [ ] lint + typecheck + suite completa en verde
- [ ] RLS/permisos (si tocó datos) · [ ] 360 px / 1440 px (si tocó UI)
- [ ] Sin secretos ni RUNs en código o logs

## Decisiones tomadas
[o "ninguna no trivial"; las relevantes van también a specs/DECISIONES.md]

## Deuda o pendientes que deja
[explícitos, cada uno con su issue creado]
```

---

## 9. Checklist de arranque del agente (primera sesión)

1. Leer, EN ORDEN: constitución → especificación → plan → tareas → CLAUDE.md → este documento.
2. Verificar herramientas: `node`, `pnpm`, `docker`, `supabase` CLI; reportar versiones.
3. Confirmar G0 con Edu: repo con `main` protegida, `.env.local` con el bloque [H0] completo,
   acceso a staging.
4. Ejecutar la tarea 0.5 primero (descargar el manual oficial v1.1.5, diff contra la SPEC
   portable, congelar el contrato del motor en `docs/sence/`) — es barata y blinda todo lo demás.
5. Ejecutar 0.1 (esqueleto: Next.js + TS + Tailwind/shadcn + estructura modular + CI).
   Con subagentes disponibles, 0.5 y 0.1 pueden correr en paralelo.
6. Seguir el ciclo del §3, tarea por tarea, hacia el gate de F0.
7. Primer resumen ejecutivo a Edu al cerrar el día 1.

---

**Recordatorio final:** la especificación es el contrato, los tests son el juez, Edu es el
cliente, y el módulo SENCE es la joya de la corona — trátalo con la paranoia que merece la ruta
crítica legal de un negocio. Construye aburrido, verifica obsesivamente, comunica claro.
