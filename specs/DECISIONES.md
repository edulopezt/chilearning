# DECISIONES.md — Registro de decisiones del proyecto (ADR-lite)

**Qué es este archivo:** registro liviano de decisiones de arquitectura y de
protocolo del proyecto Chilearning, en formato ADR-lite. Captura decisiones que no
ameritan un ADR formal en `specs/02-plan-tecnico.md` §12, pero que deben quedar
documentadas y ser auditables (especialmente las relativas a la integración
SENCE). Las decisiones son inmutables: si una decisión cambia, se agrega una
entrada nueva que la supersede y se anota la referencia cruzada — no se edita la
entrada original.

**Formato por entrada:**

- **ID:** correlativo `D-NNN`.
- **Fecha:** fecha de la decisión (AAAA-MM-DD).
- **Decisión:** qué se decidió, en una o dos frases accionables.
- **Por qué:** evidencia y razonamiento que la sustentan.
- **Alternativas descartadas:** qué otras opciones se evaluaron y por qué se
  rechazaron.

---

## D-001 — Congelar el contrato del motor contra el manual v1.1.6 (no v1.1.5)

- **ID:** D-001
- **Fecha:** 2026-07-14
- **Decisión:** el contrato del motor SENCE se congela contra el manual oficial
  *Integración Registro Asistencia SENCE* **v1.1.6**, y no contra v1.1.5 como
  estaba planificado.
- **Por qué:** el hub oficial de SENCE publica **v1.1.6 como la versión
  vigente**. Congelar contra v1.1.5 habría significado congelar contra un manual
  ya reemplazado. El diff v1.1.5 → v1.1.6 es acotado: redacción en glosas 304,
  305, 306 y 309, más la formalización de la línea **`6 = FPT`** en los valores
  de `LineaCapacitacion` (v1.1.5 solo listaba `3 = Impulsa Personas` en sus
  tablas de parámetros; v1.1.6 lista `1 = Programas Sociales / 3 = Franquicia
  Tributaria / 6 = FPT`, renombrando la línea 3) y la excepción **"excepto
  cursos FPT"** al mínimo de 7 caracteres de `CodigoCurso` (ausente en v1.1.5).
  **Sin códigos de error nuevos** (311, 312 y 313 ya existen en v1.1.5) ni
  cambios en la tabla de errores más allá de la redacción. Por eso el costo de
  adoptar v1.1.6 fue marginal y el beneficio es cumplir la regla del proyecto
  de validar contra el manual vigente.
- **Alternativas descartadas:**
  - *Congelar contra v1.1.5 (plan original):* descartada — dejaría el contrato
    referenciando un documento no vigente, debilitando la defensa ante
    fiscalización.
  - *Esperar una eventual v1.1.7:* descartada — no hay anuncio de nueva versión
    y bloquear el hito por un documento hipotético viola el principio de
    avanzar contra lo publicado (con auditabilidad vía D-004).

## D-002 — `GlosaError` se parsea como lista separada por `;`

- **ID:** D-002
- **Fecha:** 2026-07-14
- **Decisión:** el motor parsea `GlosaError` como **texto** y hace split por
  `;`, traduciendo cada código con la tabla de `src/modules/sence/errors.ts`,
  aunque el manual v1.1.6 lo tipifica **Entero** y en singular ("Identificador
  del error").
- **Por qué:** evidencia del plugin `block_sence` en producción: el callback de
  error puede traer varios códigos en un solo `GlosaError` separados por punto y
  coma (ejemplo documentado: `211;204`). El manual no menciona el separador `;`
  en ninguna de sus versiones, así que el comportamiento es extra-manual;
  parsear como lista es **parsing defensivo** — el caso de un solo código es un
  subconjunto trivial, de modo que la decisión no contradice lo que el motor
  promete ni envía (regla de precedencia: el manual manda para lo que se envía;
  el comportamiento observado manda para el parsing defensivo de lo recibido).
- **Alternativas descartadas:**
  - *Parsear como entero estricto según el manual:* descartada — rompería en
    producción ante callbacks multi-código reales ya observados.
  - *Rechazar/loggear como error los callbacks con `;`:* descartada — castigaría
    al alumno por un quirk del emisor SENCE y perdería información de
    diagnóstico.

## D-003 — Regla de 3 h de sesión / 60 min de inactividad como parámetro operativo

- **ID:** D-003
- **Fecha:** 2026-07-14
- **Decisión:** la regla "sesión SENCE dura máx. 3 horas / inactividad de app
  60 minutos" se implementa como **parámetro operativo configurable** (no como
  constante normativa del protocolo), con los valores 3 h / 60 min como default.
  La pregunta por su fuente normativa se añade al correo de la tarea 0.10
  dirigido a `controlelearning@sence.cl`.
- **Por qué:** la regla **no tiene fuente en el manual RCE**: v1.1.6 no fija
  duración de sesión ni tiempo de inactividad en ninguna parte (solo recomienda
  cronómetro en pantalla y alerta a 10 minutos del término, sin cuantificar el
  tiempo del curso). El límite de 3 h proviene del comportamiento heredado del
  plugin `block_sence`, donde vive en `engine.php` (comentario "Tiempo de
  Sesión (3 Horas)", `$tiempoSesion = 3600 * 3`) y en
  `classes/hook_callbacks.php` (`const TIEMPO_SESION = 10800`); `js/timer.js`
  es solo un contador ascendente de UI, sin límite alguno. Ante una regla sin
  respaldo documental, lo
  correcto es hacerla configurable y pedir la fuente al organismo, no
  hardcodearla como si fuera norma.
- **Alternativas descartadas:**
  - *Hardcodear 3 h / 60 min como regla del protocolo:* descartada — atribuiría
    al manual algo que no dice; si SENCE informa otro valor habría que tocar
    código en vez de configuración.
  - *Eliminar el límite hasta tener la fuente:* descartada — el plugin en
    producción lo aplica hace años y quitarlo podría generar sesiones abiertas
    indefinidas ante callbacks que nunca llegan (login de Clave Única no
    completado no genera callback en v1.1.6).

## D-004 — Commitear los PDFs oficiales en `docs/sence/manuales/` con SHA256SUMS

- **ID:** D-004
- **Fecha:** 2026-07-14
- **Decisión:** los PDFs oficiales de SENCE (manuales RCE v1.1.3, v1.1.5 y
  v1.1.6, guía GCA e instructivo LMS-SIC) se commitean en
  `docs/sence/manuales/` acompañados de un archivo `SHA256SUMS` con el hash de
  cada documento.
- **Estado (2026-07-14):** los 5 PDFs y el `SHA256SUMS` ya están copiados en
  `docs/sence/manuales/` con sus hashes verificados contra la tabla del
  [CHANGELOG](./CHANGELOG.md); el **commit está pendiente** y debe hacerse por
  el flujo normal del repo (rama + CI verde), junto con el resto de `docs/`.
- **Por qué:** **auditabilidad ante fiscalización** — el contrato del motor cita
  versiones y páginas concretas de los manuales, y SENCE **republica documentos
  silenciosamente** en las mismas URLs (sin changelog público). Con los PDFs
  versionados y sus hashes, siempre se puede demostrar contra qué documento
  exacto se congeló el contrato, y detectar una republicación comparando el hash
  del PDF descargado contra el registrado.
- **Alternativas descartadas:**
  - *Guardar solo los enlaces a sence.gob.cl:* descartada — los enlaces no
    garantizan contenido estable (republicación silenciosa) y pueden romperse.
  - *Guardar solo las extracciones de texto (.txt):* descartada — el texto
    extraído pierde tablas y formato, y no sirve como evidencia del documento
    oficial; los .txt son artefactos de trabajo, el PDF es la fuente.

## D-005 — Mantener los códigos 100 y 210 en `errors.ts` como `deprecated`

- **ID:** D-005
- **Fecha:** 2026-07-14
- **Decisión:** los códigos de error **100** ("Contraseña incorrecta o el
  usuario no tiene Clave SENCE.") y **210** ("Expiró el tiempo disponible para
  el ingreso de RUT y Contraseña…"), eliminados de los manuales vigentes (desde
  v1.1.5), **se mantienen** en la tabla de `src/modules/sence/errors.ts`
  marcados como `deprecated`, con su glosa según v1.1.3 (última versión donde
  existen).
- **Por qué:** costo cero (dos entradas en una tabla) y cubre **emisores
  legacy**: si algún componente del lado SENCE aún emitiera esos códigos, el
  motor los traduciría a un mensaje comprensible en vez de caer al genérico
  "error desconocido". Coherente con D-002 (parsing defensivo de lo recibido):
  la tabla de errores es superficie de *recepción*, no de *emisión*, por lo que
  mantenerlos no contradice el contrato congelado contra v1.1.6.
- **Alternativas descartadas:**
  - *Retirarlos de la tabla por no existir en v1.1.6:* descartada — ganancia
    nula y pérdida de robustez ante emisores legacy; un código no mapeado
    terminaría mostrado como error genérico al alumno.
  - *Mantenerlos sin marca:* descartada — sin la marca `deprecated` un futuro
    diff contra el manual vigente los reportaría como discrepancia inexplicada.
