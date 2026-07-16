# Especificación Maestra v1 — "Chilearning"

> **Qué es este documento:** el QUÉ del producto — actores, módulos, historias de usuario y
> criterios de aceptación. Sin decisiones técnicas (esas viven en `02-plan-tecnico.md`).
> Cada módulo tendrá además su spec detallada propia antes de implementarse (ciclo SDD por módulo);
> aquí se fija el alcance maestro de la v1.
>
> Fecha: 2026-07-13 · Derivada de la entrevista SDD con Edu (4 rondas) y del material de
> `lms-marca/` (análisis block_sence, SPEC portable SENCE, referencia Node).

## 1. Visión y modelo de negocio

Plataforma LMS **SaaS multi-tenant** para OTECs chilenas. Cada OTEC contrata una suscripción
mensual y recibe un espacio propio (subdominio, logo, colores) donde ejecuta sus cursos
e-learning **con validación de asistencia SENCE integrada** (el diferenciador frente a un
Moodle genérico), además de cursos privados sin SENCE.

- Primer tenant: la OTEC de Edu (validación con cursos reales de franquicia tributaria).
- El Moodle actual de la OTEC queda como archivo histórico; el LMS nuevo parte de cero.
- v1 sin pagos en línea: la inscripción la gestiona la OTEC y la facturación ocurre fuera.

## 2. Glosario

| Término | Significado |
|---|---|
| OTEC | Organismo Técnico de Capacitación, ejecuta cursos. Es el **tenant** del SaaS. |
| OTIC | Intermediario que administra fondos de franquicia de las empresas. |
| SENCE | Servicio Nacional de Capacitación y Empleo. Fiscaliza y valida. |
| Franquicia tributaria / Impulsa Personas | Beneficio: la empresa descuenta de impuestos la capacitación (línea 3). |
| FPT | Formación en el Puesto de Trabajo, subsidio a contratación+capacitación (línea 6). |
| Programas Sociales | Becas financiadas por el Estado (línea 1). |
| RCE | Registro de asistencia e-learning de SENCE (`sistemas.sence.cl/rce`, pruebas: `/rcetest`). |
| Acción de capacitación | Ejecución concreta de un curso comunicada a SENCE, con código propio. |
| Código SENCE | Código del curso autorizado (10 dígitos). En el protocolo viaja como `CodSence`. |
| Código de acción | Identificador de la acción; en el protocolo viaja como `CodigoCurso` (¡quirk!). |
| DJ / GCA | Declaración jurada post-curso / plataforma de Gestión de acreditación (lce.sence.cl). |
| SIC | Sistema de Información de Capacitación de SENCE. |
| Clave Única | Identidad digital del Estado chileno; el alumno la usa ante SENCE. |
| Tenant | Una OTEC dentro del SaaS, con datos totalmente aislados. |

## 3. Actores y matriz de acceso

Ocho roles. Un usuario puede tener roles distintos en tenants distintos (ej.: relator en dos OTECs).

1. **Superadmin (plataforma)** — Edu. Administra tenants, planes, feature flags, salud del sistema. NO ve contenido pedagógico ni datos de alumnos salvo soporte con registro de auditoría.
2. **Admin OTEC** — dueño del tenant: configuración, marca, usuarios, cursos, SENCE (RUT/token), reportes completos, datos comerciales.
3. **Coordinador académico** — gestiona cursos, acciones, inscripciones, relatores y reportes académicos. Sin configuración del tenant ni datos comerciales.
4. **Relator (profesor)** — dicta sus cursos: contenido, calificaciones, foros, reporte de sus cursos.
5. **Tutor / ayudante** — apoya cursos asignados: responde foros/consultas, corrige tareas. No edita contenido ni notas finales.
6. **Alumno** — consume cursos, registra asistencia SENCE, rinde evaluaciones, descarga certificados.
7. **Empresa cliente (portal)** — RRHH de la empresa que capacita: ve avance/asistencia/resultados SOLO de sus trabajadores, en sus cursos.
8. **Supervisor externo (SENCE / OTIC / auditor)** — portal dedicado de solo lectura: avance, asistencia, evaluaciones y reportes descargables. Invitación por correo con alcance configurable (tenant completo o acciones específicas) y vigencia. Cubre la exigencia operativa de SENCE para e-learning y la supervisión de OTICs (ver M12).

Matriz resumida (C=crear, R=leer, U=editar, D=borrar; propio = limitado a lo asignado):

| Recurso | SupAdmin | AdminOTEC | Coord | Relator | Tutor | Alumno | Empresa | Fiscaliz. |
|---|---|---|---|---|---|---|---|---|
| Tenants/planes | CRUD | — | — | — | — | — | — | — |
| Config tenant + SENCE (RUT/token) | R (soporte) | CRUD | — | — | — | — | — | — |
| Usuarios del tenant | — | CRUD | CRU | — | — | — | — | — |
| Cursos y contenido | — | CRUD | CRUD | CRU propio | R propio | R inscrito | — | R con SENCE |
| Acciones SENCE e inscripciones | — | CRUD | CRUD | R propio | R propio | R propio | R sus trabajadores | R |
| Calificaciones | — | R | R | CRU propio | CU asignado* | R propias | R sus trabajadores | R |
| Asistencia SENCE | — | R | R | R propio | R propio | C propia (vía RCE) + R | R sus trabajadores | R |
| Certificados | — | CRUD | CR | R propio | — | R propios | R sus trabajadores | R |
| Reportes | — | todos | académicos | sus cursos | sus cursos | — | sus trabajadores | cursos SENCE |
| Auditoría | R plataforma | R tenant | — | — | — | — | — | — |

\* El tutor corrige tareas asignadas; la nota final la publica el relator.

## 4. Módulos y historias de usuario

Formato: **HU-x.y** historia — criterios de aceptación (CA) verificables. Las historias aquí
son las estructurales; cada módulo se detallará en su propio spec antes de implementarse.

### M1 — Núcleo multi-tenant y marca

- **HU-1.1** Como superadmin, creo una OTEC (tenant) con su plan, subdominio y admin inicial.
  CA: subdominio `{otec}.{dominio}` operativo con SSL **al instante y sin tocar DNS** (arquitectura
  de comodín, ver plan §3); slug validado (minúsculas, letras/números/guiones, 3–30 caracteres,
  único) con lista de nombres reservados (www, app, api, admin, staging, status, mail, cdn, docs);
  admin recibe invitación por correo; tenant nace con configuración por defecto segura; todo queda en auditoría.
- **HU-1.2** Como admin OTEC, personalizo la marca de mi espacio desde mi propio panel, sin tocar código: logo principal, logo compacto/favicon, logo para certificados, color primario y color de acento, además de los datos legales (razón social, RUT).
  CA: editor con **vista previa en vivo** (portal del alumno, correo y certificado) antes de publicar; la marca se aplica en el subdominio, la página de ingreso, los correos transaccionales, los certificados PDF y los portales de empresa y supervisor; los colores pasan **verificación automática de contraste** (WCAG 2.1 — si el color elegido deja texto ilegible, el sistema advierte y propone un ajuste); logos en PNG/SVG/WebP con tamaño máximo validado; todo cambio de marca queda en auditoría; los datos legales alimentan reportes SENCE y certificados.
- **HU-1.3** Como superadmin, activo/desactivo funciones por tenant (feature flags: líneas SENCE 1/6, SCORM, portal empresas).
  CA: una función desactivada desaparece de la UI y sus endpoints responden 403.
- **HU-1.4** Como superadmin, suspendo un tenant moroso sin borrar datos.
  CA: acceso bloqueado con aviso; datos intactos; reactivación en un clic.
- **HU-1.5** Como admin OTEC, exporto TODOS los datos de mi tenant (cursos, alumnos, registros SENCE, notas, certificados, documentos) en formatos abiertos (CSV/JSON + archivos). *(Hito 5)*
  CA: export asíncrono con notificación al estar listo; incluye manifiesto de contenido; la ejecución queda en auditoría.

### M2 — Identidad, acceso y RBAC

- **HU-2.1** Como usuario, ingreso con correo y contraseña; los roles admin exigen 2FA. Los alumnos
  pueden ingresar además con **enlace mágico** (magic link) enviado a su correo, sin contraseña.
  CA: sesión expira por inactividad (60 min, exigencia SENCE); bloqueo tras N intentos fallidos; recuperación de contraseña por correo; el magic link expira y es de un solo uso.
- **HU-2.2** Como admin OTEC, creo usuarios con rol e importo alumnos **masivamente** por planilla (CSV/Excel), con plantilla estándar descargable, pudiendo inscribirlos directo a una acción en el mismo paso.
  CA: RUN validado (formato y dígito verificador) al importar; duplicados detectados; resultado del import con errores por fila; la inscripción directa a acción respeta las validaciones de HU-3.2; la planilla acepta la columna `grupo` con los grupos operativos del OTEC — `Sence-<código del curso>` (alumno SENCE) o `Becario` (exento, I-14) — validando que el código coincida con el curso de la acción destino (planilla equivocada = filas rechazadas); la etiqueta de grupo se muestra en el resultado del import, el panel de cumplimiento, la emisión de certificados y el portal del alumno.
- **HU-2.3** Como sistema, aplico denegación por defecto según la matriz §3.
  CA: tests automatizados cubren la matriz completa; acceso denegado queda en auditoría.
- **HU-2.4** Como alumno, veo y ejerzo mis derechos de datos (Ley 21.719): acceso, rectificación, supresión, portabilidad.
  CA: exporte de mis datos en formato legible por máquina; solicitud de supresión respeta retenciones legales (registros SENCE se conservan e informan como tales).

### M3 — Gestión académica

- **HU-3.1** Como coordinador, creo un curso (nombre, descripción, horas, modalidad: asincrónico / sincrónico / mixto, con o sin SENCE).
  CA: un curso SENCE exige código SENCE válido (10 dígitos) antes de poder activarse.
- **HU-3.2** Como coordinador, creo una **acción** (ejecución) del curso con fechas, código de acción, empresa asociada y participantes.
  CA: no se puede registrar asistencia fuera del rango de fechas de la acción; participantes con RUN validado; alumnos exentos (becarios) marcables por participante.
- **HU-3.3** Como coordinador, inscribo/retiro alumnos de una acción.
  CA: retiro conserva historial; el alumno inscrito ve el curso al ingresar; el alumno recibe correo de bienvenida con instrucciones (incluida Clave Única si el curso es SENCE).
- **HU-3.4** Como relator, veo mis cursos y el avance de cada alumno (lecciones, tiempo, evaluaciones, asistencia SENCE).
  CA: tablero por acción con % de avance y semáforo de riesgo (sin conexión en X días).
- **HU-3.5** Como coordinador, subo un descriptor de curso SENCE (.docx) y la plataforma propone la estructura del curso (módulos, aprendizajes esperados, horas) para editar y confirmar. *(Hito 5)*
  CA: el descriptor queda archivado junto al curso; nada se publica sin revisión humana.
- **HU-3.6** Como coordinador, clono un curso completo o re-ejecuto una acción (copia configuración y contenido, sin participantes) en un clic.
  CA: la acción clonada exige nuevas fechas y nuevo código de acción antes de poder activarse; nada clonado queda activo por defecto.

### M4 — Contenido (constructor nativo + SCORM)

- **HU-4.1** Como relator/coordinador, construyo un curso con módulos y lecciones: video, texto enriquecido, archivos descargables, imagen, embed.
  CA: reordenable arrastrando; vista previa como alumno; borradores no visibles para alumnos; video se reproduce vía streaming (nunca descarga directa del servidor de la app).
- **HU-4.2** Como relator/coordinador, subo un paquete SCORM (1.2 o 2004) como lección o curso completo.
  CA: el paquete se valida al subir; progreso y nota del SCORM se registran en el avance del alumno; funciona en móvil.
- **HU-4.3** Como alumno, retomo el curso donde quedé, desde cualquier dispositivo.
  CA: progreso por lección persistente; marcado manual o automático de completitud según tipo.
- **HU-4.4** Como coordinador, defino reglas de completitud del curso (ej.: 100% lecciones + nota ≥ 4.0 + encuesta respondida).
  CA: el certificado solo se emite si se cumplen las reglas.
- **HU-4.5** Como coordinador/relator, creo un curso con un **asistente guiado paso a paso** con dos puertas de entrada: **desde cero** o **desde un descriptor SENCE** (.docx, se apoya en HU-3.5). Pasos del flujo: datos del curso → estructura de módulos → aprendizajes esperados → contenido por lección → evaluaciones → reglas de completitud → revisión final y publicación. *(Hito 5)*
  CA: se puede guardar a medias y retomar después; cada paso valida antes de avanzar (en cursos SENCE: horas coherentes con el descriptor, al menos una evaluación por módulo, encuesta configurada); plantillas de curso precargadas por tipo (ej. "e-learning asincrónico SENCE estándar"); nada se publica sin pasar por la revisión final; el constructor libre (HU-4.1) sigue disponible para quien no quiera el asistente.

### M5 — Motor SENCE (el diferenciador)

Protocolo según SPEC portable de `lms-marca/` + manual oficial vigente (v1.1.5/v1.1.6 — validar diff con v1.1.3 en fase Plan).

- **HU-5.1** Como alumno de un curso SENCE, al entrar debo registrar asistencia: la plataforma me redirige a SENCE (POST con RutOtec, Token, LineaCapacitacion, RunAlumno, IdSesionAlumno, CodSence, CodigoCurso, UrlRetoma/UrlError), me autentico con Clave Única y vuelvo al curso.
  CA: si el registro falla, veo el error en lenguaje humano (tabla GlosaError completa) con pasos a seguir y enlace para recuperar Clave Única; si SENCE no responde, puedo reintentar; nunca pierdo mi lugar en el curso.
- **HU-5.2** Como sistema, bloqueo el contenido del curso SENCE hasta que la asistencia del día esté registrada (candado configurable por acción, como el plugin actual).
  CA: candado activo por defecto en cursos franquicia; alumnos exentos/becarios pasan directo; el cierre de sesión SENCE es configurable (opcional según norma vigente) y la sesión SENCE dura máx. 3 horas con contador visible.
- **HU-5.3** Como sistema, registro cada evento SENCE en una bitácora inmutable: apertura, callback éxito (IdSesionSence, FechaHora, ZonaHoraria), callback error (códigos), cierre.
  CA: correlación por IdSesionAlumno; ningún callback se pierde aunque el alumno cierre el navegador (el registro ocurre al recibir el POST); replay/duplicados detectados.
- **HU-5.4** Como admin OTEC, configuro desde mi propio panel el RUT y el **token SENCE** de mi OTEC (generado en `sistemas.sence.cl/rts`) y elijo ambiente (rcetest/producción) por acción.
  CA: el token se guarda **cifrado en reposo** (AES-256-GCM, con clave maestra fuera de la base de datos) y es de **solo escritura**: tras guardarse, la UI muestra únicamente los últimos 4 caracteres y no puede volver a leerse completo jamás; modificarlo exige reautenticación (paso de verificación adicional) y solo el rol admin OTEC puede hacerlo; todo cambio queda en auditoría y se notifica por correo al admin; el token nunca aparece en logs ni en respuestas de API; botón "Probar en rcetest" con prueba guiada que interpreta los códigos de error de token (211/212/303); si en producción se detectan errores 212 (token vencido), el sistema alerta al admin con la guía para renovarlo en /rts.
  *Nota de protocolo (transparencia):* por diseño de SENCE, el token viaja en el formulario que el navegador del alumno envía a SENCE al registrar asistencia — es un identificador del organismo, no un secreto de usuario. Aun así la plataforma lo trata como secreto: se materializa solo en ese instante, en una página de redirección sin caché y con autoenvío inmediato.
- **HU-5.5** Como coordinador, veo el panel de cumplimiento SENCE por acción: asistencias por alumno/día, huecos, errores frecuentes, exportable (Excel/CSV) con las columnas del reporte del plugin actual (curso, nombres, apellidos, RUN, código curso, IdSesionSence, fecha/hora).
  CA: el fiscalizador SENCE ve este mismo panel en solo lectura.
- **HU-5.6** Como coordinador, gestiono el ciclo post-curso asistido: checklist de DJ por participante con estado y recordatorios (la DJ se emite en la GCA de SENCE; la plataforma guía y registra, no reemplaza a la GCA).
  CA: recordatorios automáticos configurables (pueden ejecutarse vía n8n al ser periféricos); nómina exportable para la GCA.
- **HU-5.7** Líneas de capacitación: línea 3 activa y certificada en v1; líneas 1 y 6 implementadas en el motor (línea 1: CodSence vacío, código de acción formato SIC) pero ocultas tras feature flag por tenant.
  CA: activar una línea no requiere deploy; la API LMS↔SIC queda **diseñada** (contratos y tablas) y su implementación se gatilla cuando un tenant active línea 1 (verificación de obligatoriedad documentada en fase Plan).
- **HU-5.8** Como coordinador, ejecuto el **pre-flight** de una acción antes de su inicio: validación de RUN/DV de todos los inscritos, envío de la guía de Clave Única y verificación de configuración (token, código SENCE, fechas, ambiente).
  CA: checklist con estado por ítem; alerta temprana el día 1 si la asistencia registrada está bajo el umbral; ataca en origen los errores 207/208.
- **HU-5.9** Como sistema, envío recordatorios de asistencia a alumnos sin registro del día, correos a alumnos inactivos e informes automáticos de asistencia al coordinador (reglas simples primero; personalización con IA en Hito 5), por correo y, si el tenant lo activa, WhatsApp.
  CA: frecuencia, umbrales y horarios configurables por acción; opt-out registrado; ejecución vía n8n (periférico ✔).
- **HU-5.10** Como coordinador, mantengo el **expediente digital de fiscalización** de cada acción: orden de compra OTIC, comunicación, rectificaciones, nóminas, DJs, certificados y evidencias, cada documento con tipo, estado y fecha.
  CA: checklist de completitud del expediente por acción; descarga de la carpeta completa (ZIP) en un clic; los documentos marcados como definitivos se vuelven inmutables.

### M6 — Evaluación

- **HU-6.1** Quizzes autocorregidos: alternativas, V/F, términos pareados; intentos, tiempo límite, banco de preguntas y aleatorización configurables.
  CA: nota inmediata en escala chilena 1.0–7.0 (configurable); revisión de respuestas según política del curso.
- **HU-6.2** Tareas con corrección manual: alumno sube archivos; relator/tutor corrige con rúbrica o nota directa y retroalimentación.
  CA: fechas límite con tolerancia configurable; historial de entregas; notificación al corregir.
- **HU-6.3** Encuesta de satisfacción al cierre (plantilla estándar por tenant, editable).
  CA: anónima o nominada según configuración; puede ser requisito de completitud; resultados agregados por acción.
- **HU-6.4** Libro de notas por acción: consolidado de quizzes y tareas con ponderaciones.
  CA: exportable; cambios de nota quedan en auditoría con motivo.

### M7 — Certificados

- **HU-7.1** Como coordinador, emito certificados (individual o masivo) para quienes cumplen las reglas de completitud. Los cursos SENCE usan la **plantilla "Certificado SENCE"**: además de alumno (nombre, RUN), curso, horas, fechas y nota, incluye código SENCE, número de acción, porcentaje de asistencia registrada, razón social y RUT de la OTEC, y firma digitalizada del representante.
  CA: PDF con marca del tenant, folio único y QR; en cursos SENCE la emisión exige además que la asistencia SENCE registrada supere el umbral configurado en la acción; lista exacta de campos normados se valida en la spec del módulo (§7-R7); página de ayuda que guía al alumno a descargar también su certificado oficial en el portal de SENCE.
- **HU-7.2** Como cualquiera con el folio/QR, verifico un certificado en página pública.
  CA: la verificación muestra validez y datos mínimos (sin exponer datos sensibles); certificados revocables con motivo.
- **HU-7.3** Como coordinador, configuro **vigencia** en cursos normativos: el certificado lleva fecha de vencimiento y el sistema alerta a la OTEC y a la empresa cuando a sus trabajadores se les acerca la recertificación. *(Hito 5)*
  CA: alertas configurables (90/60/30 días, vía n8n); listado de vencimientos por empresa exportable; enlace directo a re-inscripción en una nueva acción.

### M8 — Portal empresa

- **HU-8.1** Como RRHH de empresa cliente, veo el avance de MIS trabajadores en las acciones que mi empresa contrató: progreso, asistencia SENCE, notas, certificados.
  CA: jamás ve alumnos de otras empresas; export a Excel; acceso por invitación del admin/coordinador OTEC.
- **HU-8.2** Como RRHH, recibo un resumen periódico por correo (semanal, configurable), redactado
  con IA en lenguaje ejecutivo (avance, riesgos, hitos) sobre datos agregados. *(redacción IA: Hito 5)*
  CA: opt-out; hacia el modelo solo van datos agregados/seudonimizados; el envío es automatización periférica (n8n permitido).

### M9 — Comunicación (requisito SENCE para e-learning)

- **HU-9.1** Anuncios por curso/acción con notificación por correo.
- **HU-9.2** Foro de consultas por curso (hilos, respuestas, marca "respondida"; relator/tutor moderan).
- **HU-9.3** Mensajería interna alumno↔relator/tutor (canal asincrónico exigible por SENCE).
- **HU-9.4** Calendario del curso con hitos y plazos (evaluaciones, fin de acción).
- **HU-9.5** Como tutor/relator, recibo un **borrador de respuesta generado por IA** para cada consulta del foro/mensajería, que reviso, edito y envío (human-in-the-loop: nada se envía solo). *(Hito 5)*
  CA (módulo): tiempos de respuesta visibles; todo notificable por correo y, opcional por tenant, WhatsApp; sin dependencia de herramientas externas para el canal oficial; los borradores IA se generan con la consulta + contenido del curso, sin datos identificatorios del alumno.

### M10 — Reportería y auditoría

- **HU-10.1** Reportes por tenant: avance por acción, asistencia SENCE, notas, encuestas, certificados, y métricas de calidad por relator derivadas de las encuestas; export Excel/CSV.
- **HU-10.2** Auditoría consultable por admin OTEC (su tenant) y superadmin (plataforma) con filtros por usuario/acción/fecha.
- **HU-10.3** Tablero superadmin: tenants activos, uso, errores SENCE agregados, salud del sistema.

### M11 — Tutor IA (add-on premium, Hito 5)

Asistente de estudio integrado en la página del curso, fundado (RAG) en el contenido real del curso del tenant.

- **HU-11.1** Como alumno, converso con el tutor IA sobre el contenido del curso y recibo respuestas que citan las lecciones correspondientes.
  CA: respuestas en streaming; historial por inscripción; botón "derivar a tutor humano" que crea un mensaje en M9; el asistente se identifica siempre como IA.
- **HU-11.2** Como admin OTEC, activo/desactivo el tutor IA por curso y veo su uso (conversaciones, costos, temas frecuentes).
  CA: límites de uso por alumno/día y por tenant/mes con corte automático al llegar al tope.
- **HU-11.3** Como sistema, envío al modelo SOLO: fragmentos del contenido del curso, avance agregado del alumno, la conversación y su nombre de pila o alias.
  CA: nunca salen RUN, apellidos, correo, empresa, notas de terceros ni datos SENCE; proveedor con contrato de no-entrenamiento y retención cero; interacciones registradas con política de retención propia.

### M12 — Portal Supervisor (SENCE / OTIC / auditores externos)

- **HU-12.1** Como admin OTEC, invito por correo a un supervisor externo con alcance definido (todo el tenant o acciones específicas) y vigencia.
  CA: acceso de solo lectura; revocable en un clic; expira automáticamente; sin acceso a datos comerciales ni configuración del tenant.
- **HU-12.2** Como supervisor, entro a un portal simplificado (sin el ruido del LMS): avance por acción, asistencia SENCE día a día, evaluaciones y descarga de reportes en un clic.
  CA: solo ve su alcance; todo lo que consulta o descarga queda en auditoría (quién, qué, cuándo) — P8.

## 5. Requisitos no funcionales

- **RNF-1 Aislamiento:** RLS en base de datos; tests de fuga entre tenants obligatorios en CI.
- **RNF-2 Seguridad:** OWASP Top 10 cubierto; 2FA para roles administrativos; rate limiting; secretos cifrados; sesiones con expiración por inactividad de 60 min (SENCE).
- **RNF-3 Privacidad (Ley 21.719, vigente 01-12-2026):** consentimiento informado al primer ingreso; registro de tratamientos; contratos de encargo por tenant; retención definida por tipo de dato; derechos del titular operables desde la UI (ver HU-2.4).
- **RNF-4 Disponibilidad:** RTO ≤ 4 h, RPO ≤ 24 h; backup diario off-site cifrado; restauración ensayada mensualmente; página de estado simple.
- **RNF-5 Rendimiento:** soportar la concurrencia de las acciones vigentes (dimensionar: 500 alumnos concurrentes en v1); video SIEMPRE por CDN; páginas de curso < 2 s en 4G.
- **RNF-6 Responsividad total y compatibilidad:** la plataforma es **100% responsiva en TODAS las vistas y roles** — no solo el alumno: paneles de administración, constructor de cursos, reportes, portales de empresa y supervisor. Móvil primero en las superficies del alumno (el flujo de asistencia SENCE con Clave Única se prueba en teléfonos reales — muchos trabajadores estudian desde el celular); en vistas administrativas, las tablas colapsan a tarjetas en pantallas chicas. Criterios verificables: sin scroll horizontal en 360/768/1024/1440 px; objetivos táctiles ≥ 44 px; los flujos críticos de la suite E2E corren también en viewport móvil; navegadores evergreen; accesibilidad WCAG 2.1 nivel AA razonable (recomendación SENCE). Límite honesto documentado: los paquetes SCORM se reproducen en contenedor responsivo, pero su contenido interno es tan responsivo como lo haya exportado la herramienta de autor (Rise sí; Storyline según configuración del player) — la plataforma lo advierte a la OTEC al subir el paquete.
- **RNF-7 Auditabilidad:** bitácoras de solo inserción para eventos SENCE, notas, certificados, configuración y accesos a datos personales.
- **RNF-8 Operabilidad:** deploy con un push; runbooks para restore, rotación de secretos, caída de VPS e incidente SENCE; monitoreo con alertas.
- **RNF-9 Idioma:** español de Chile; textos SENCE alineados con la terminología oficial.
- **RNF-10 IA responsable:** minimización de datos hacia modelos externos (ver HU-11.3); transparencia (el usuario siempre sabe cuándo interactúa con IA); human-in-the-loop en toda comunicación saliente generada por IA; presupuesto de tokens por tenant con corte automático; proveedor con DPA, no-entrenamiento y retención cero. División arquitectónica: IA interactiva dentro de la app; IA por lotes en n8n solo con datos seudonimizados/agregados.

## 6. Fuera de alcance v1 (explícito)

Presencial/semipresencial con LCE · checkout y pasarelas de pago · migración de datos desde
Moodle · apps móviles nativas · marketplace público de cursos entre OTECs · videoconferencia
propia (el sincrónico usa Zoom/Meet/Teams enlazado + registro de asistencia) · gamificación ·
integración API SIC operativa (queda diseñada; se implementa al activar línea 1) · multi-idioma.

## 7. Riesgos, supuestos y pendientes de verificación

| # | Ítem | Estado |
|---|---|---|
| R1 | Diff manual RCE v1.1.3 (docs de Edu) vs v1.1.5/v1.1.6 vigente | Pendiente fase Plan (PDFs oficiales descargables) |
| R2 | Obligatoriedad de API LMS↔SIC para franquicia (línea 3) vs solo Aula Digital/línea 1 | Pendiente: leer Manual LMS-SIC v1.4 e Instructivo v2.0; consultar controlelearning@sence.cl |
| R3 | Reglas exactas del sincrónico SENCE (registro por sesión en vivo) | Pendiente verificación normativa |
| R4 | UrlRetoma/UrlError máx. 100 caracteres → restringe largo del dominio + ruta de callback | Asumido del manual; validar en rcetest |
| R5 | Piloto real con alumnos de franquicia solo tras certificar el motor en rcetest y ensayo completo | Acordado (mitiga riesgo económico de la franquicia) |
| R6 | Marca y dominio sin definir; el dominio debe ser corto (ver R4) y soportar subdominios por tenant | Pendiente decisión de Edu |
| R7 | Lista exacta de campos normados del certificado SENCE (plantilla HU-7.1) | Pendiente: verificar contra guía de apoyo OTEC y normativa vigente al especificar M7 |
| S1 | Supuesto: los alumnos franquicia cuentan con Clave Única activa; el onboarding incluye guía de recuperación | Aceptado |
| S2 | Supuesto: transferencia internacional de datos (BD gestionada fuera de Chile) es admisible bajo 21.719 con salvaguardas contractuales | Documentar en contrato de encargo; revisar con abogado antes del lanzamiento comercial |

## 8. Criterios de éxito de la v1

1. Un curso e-learning asincrónico de franquicia (línea 3) ejecutado de punta a punta con la
   OTEC de Edu: inscripción → asistencia SENCE real → evaluaciones → encuesta → certificado →
   reporte listo para DJ, sin planillas externas.
2. Cero incidentes de fuga de datos entre tenants (validado por tests y auditoría).
3. Restauración de backup ensayada con éxito al menos 2 veces antes del piloto real.
4. Un segundo tenant (OTEC externa) puede crearse y operar sin tocar código.
