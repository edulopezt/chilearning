# DIFF de auditoría — SPEC portable (base v1.1.3) vs. Manual oficial SENCE v1.1.6

**Fecha:** 2026-07-14
**Autor:** auditoría automatizada (Claude Code) para el motor `src/modules/sence/` de Chilearning.

## Fuentes (SHA256)

| Archivo | SHA256 |
|---|---|
| `integracion_registro_asistencia_sence_v1.1.6.pdf` (manual oficial VIGENTE, descargado de sence.gob.cl) | `E9435A9E9B95985B81E5ECC9696E42A1C7D7521C838B2217999F05636F8EAC4C` |
| `integracion_registro_asistencia_sence_v1.1.5_0.pdf` (solo para trazar cuándo apareció cada cambio) | `BCC174A5A980FEA65119633E132FCB2D1CE16E16932A1CA9D746125B2033121F` |
| `integracion_registro_asistencia_sence_v1.1.3.pdf` (base histórica de la SPEC portable) | `2B9284AFA33BEA0252744C6BF41040AAF490504DC97D5847FCB4AA65CD3DC04F` |
| `integracion-sence-portable/SPEC_INTEGRACION_SENCE.md` (SPEC portable auditada) | `45E0000ED4333C6DE8105DEDA8384427A5129DA7CBC477ABC0A2FD092ADE40EB` |

> Nota de procedencia: los SHA256 fueron calculados localmente sobre los PDFs descargados desde
> `sence.gob.cl/sites/default/files/` (el llamador no entregó un SHA256SUMS válido). Los largos de
> campo se reconstruyeron alineando las tablas v1.1.6 contra v1.1.3 por el desplazamiento de columnas
> que produce la extracción de texto del PDF; ante duda de auditoría, validar contra el PDF v1.1.6.

## Regla de precedencia

**Ante discrepancia, EL MANUAL OFICIAL v1.1.6 GANA** para todo lo que el motor *promete o envía*
(campos, largos, obligatoriedad, endpoints, códigos de error). El comportamiento observado del
plugin `block_sence` en producción gana **solo** para el *parsing defensivo* de lo que SENCE
*devuelve* (ej.: `GlosaError` como lista separada por `;`), sin convertirse jamás en promesa del motor.

Veredictos posibles: `IGUAL` · `MANUAL GANA (corregir SPEC)` · `QUIRK REAL (parsing defensivo)` · `NUEVO EN v1.1.6` · `SIN FUENTE EN MANUAL`.

---

## Tabla de diferencias

| Ítem | SPEC portable (v1.1.3) | Manual oficial v1.1.6 | Veredicto |
|---|---|---|---|
| Endpoint test `IniciarSesion` | `https://sistemas.sence.cl/rcetest/Registro/IniciarSesion` | Idéntico (§4, Anexo 1) | IGUAL |
| Endpoint test `CerrarSesion` | `https://sistemas.sence.cl/rcetest/Registro/CerrarSesion` | Idéntico (§4, Anexo 1) | IGUAL |
| Endpoint prod `IniciarSesion` | `https://sistemas.sence.cl/rce/Registro/IniciarSesion` | Idéntico (§5, Anexo 1) | IGUAL |
| Endpoint prod `CerrarSesion` | `https://sistemas.sence.cl/rce/Registro/CerrarSesion` | Idéntico (§5, Anexo 1) | IGUAL |
| Método y content-type | POST desde el navegador del alumno; `application/x-www-form-urlencoded` (form HTML normal) | POST vía redirección del navegador (§3.2/§3.3); no declara content-type, pero el mecanismo normativo es `<form method="post">` (Anexo 3) → urlencoded implícito. Callbacks SENCE→OTEC igualmente POST de formulario | IGUAL |
| `IniciarSesion` · `RutOtec` | RUT del OTEC con DV, obligatorio (ej. `76668428-9`) | Texto, largo 10, "RUT OTEC sin puntos y con digito verificador, en formato xxxxxxxx-x", obligatorio | IGUAL |
| `IniciarSesion` · `Token` | Token del OTEC, obligatorio | Texto, largo 36 (forma GUID en Anexo 3); "Incluir un Token vigente en los POST de inicio y cierre de sesión es obligatorio" (§3.1) | IGUAL |
| `IniciarSesion` · `CodSence` (quirk de nombres) | Lleva el código SENCE del **CURSO** (10 dígitos), NO el de la acción | Texto, largo 10, "Código SENCE del curso"; Anexo 4 confirma que es el código del curso de la orden de compra. El quirk es real y el manual lo respalda. Ojo: en el ejemplo del Anexo 3 la etiqueta dice `CodigoSence` pero el `name` real del campo es `CodSence` | IGUAL |
| `IniciarSesion` · `CodSence` vacío en línea 1 | En Programas Sociales `CodSence` va vacío | Anexo 5: "Para Programas Sociales o Becas Laborales, dejar en blanco" (en v1.1.6 la regla vive SOLO en el Anexo 5, ya no en las tablas de parámetros) | IGUAL |
| `IniciarSesion` · `CodigoCurso` (semántica) | Lleva el código de **ACCIÓN** del alumno (idAcción) | Texto, largo 50; Anexo 4: "También se le conoce como ID de acción, Folio SENCE, Registro Único SENCE, y SENCENET" | IGUAL |
| `IniciarSesion` · `CodigoCurso` (mínimo 7) | Mínimo 7 caracteres (herencia v1.1.3, sin excepciones) | "Identificador del curso, (mínimo 7 caracteres, **excepto cursos FPT**)" — la excepción no existía en v1.1.3 | NUEVO EN v1.1.6 |
| `IniciarSesion` · `CodigoCurso` formato SIC en línea 1 | En línea 1 suele venir en formato SIC tipo `RLAB-19-02-08-0071-1` | Anexo 5: "código del curso entregado por SIC […] por ejemplo: RLAB-19-02-08-0071-1, BOTIC-SOFOF-19-12-13-0046" | IGUAL |
| `IniciarSesion` · `LineaCapacitacion` (valores) | `1`, `3` o `6` | Entero; `1`, `3` o `6` (la línea 6 no existía en v1.1.3; la SPEC ya la anticipaba) | IGUAL |
| Nombres de las líneas de capacitación | 1 = Programas Sociales/Becas; 3 = **Impulsa Personas**; 6 = FPT e-learning | "1 = Programas Sociales / 3 = **Franquicia Tributaria**. / 6 = FPT" — v1.1.6 renombra la línea 3 (misma semántica de fondo) y formaliza la 6 | MANUAL GANA (corregir SPEC) |
| `IniciarSesion` · `RunAlumno` | RUN del alumno formato `11111111-1`, obligatorio | Texto, largo 10, "RUN Participante, sin puntos y con digito verificador, en formato xxxxxxxx-x" | IGUAL |
| Formato RUN — exigencia `k` en minúscula | La SPEC exige DV `k` en minúscula | El manual solo dice "sin puntos y con digito verificador, en formato xxxxxxxx-x"; no norma mayúscula/minúscula del DV (el error 207 castiga formato/DV incorrecto). La regla de la `k` viene del plugin, no del manual | SIN FUENTE EN MANUAL |
| `IniciarSesion` · `IdSesionAlumno` | Identificador generado por la plataforma para correlacionar; SENCE lo devuelve en el callback | Texto, largo 149, "Identificador sesión plataforma OTEC"; devuelto en los 4 callbacks | IGUAL |
| `IniciarSesion` · `UrlRetoma` / `UrlError` (obligatoriedad) | Ambas obligatorias, URLs absolutas; pueden ser la misma | "201 La URL de Retoma y/o URL de Error no tienen información. Ambos parámetros son obligatorios en todos los POST" (Anexo 2). El plugin en producción usa una sola URL para ambas y funciona | IGUAL |
| `UrlRetoma` / `UrlError` — largo máximo | Herencia v1.1.3: **200** caracteres (la SPEC no fija otro largo) | **Texto, largo 100** en las tablas de inicio Y cierre. Cambio normativo desde v1.1.5 (200→100; v1.1.5 ya especifica 100, mantenido en v1.1.6) | MANUAL GANA (corregir SPEC) |
| `CerrarSesion` — campos | Mismos campos que `IniciarSesion` MÁS `IdSesionSence` (el devuelto por SENCE al abrir) | §3.3: `RutOtec`(10), `Token`(36), `CodSence`(10), `CodigoCurso`(50), `LineaCapacitacion`, `RunAlumno`(10), `IdSesionAlumno`(149), **`IdSesionSence`(149)**, `UrlRetoma`(100), `UrlError`(100) | IGUAL |
| Callback de **inicio exitoso** (a `UrlRetoma`) | Trae al menos: `RunAlumno`, `IdSesionAlumno`, `IdSesionSence`, `CodSence`, `CodigoCurso`, `FechaHora`, `ZonaHoraria`, `LineaCapacitacion` | §3.2: exactamente esos 8 campos; `FechaHora` Texto 19 "aaaa-mm-dd hh:mm:ss"; `ZonaHoraria` Texto 100; `IdSesionSence` "debe ser enviado en el cierre de sesión" | IGUAL |
| Callback de **inicio incorrecto** (a `UrlError`) | Trae `GlosaError` más `RunAlumno` (enumeración incompleta) | §3.2: trae los MISMOS 8 campos del éxito (**incluido `IdSesionSence`**) MÁS `GlosaError`. La SPEC debe completar la lista: el error de inicio también trae `IdSesionSence` | MANUAL GANA (corregir SPEC) |
| Callback de **cierre** (exitoso e incorrecto) | El callback de cierre NO trae `IdSesionSence`; se correlaciona por `IdSesionAlumno` | §3.3: cierre exitoso = 7 campos sin `IdSesionSence` ni `GlosaError`; cierre incorrecto = los 7 + `GlosaError`, tampoco lleva `IdSesionSence` | IGUAL |
| Regla de discriminación de callbacks (URL única) | Hay `GlosaError` → error; hay `IdSesionSence` → éxito de inicio; ninguno → cierre | El manual no la enuncia como frase, pero la composición de sus 4 tablas la sustenta exactamente. **El orden importa**: evaluar `GlosaError` PRIMERO (el error de inicio también trae `IdSesionSence`) | IGUAL |
| `GlosaError` — tipo y multiplicidad | Lista de códigos separados por `;` (ejemplo citado: `211;204`) | Declarado "**Entero**", singular ("Identificador del error"); el carácter `;` NO aparece en todo el manual (ni en v1.1.3/v1.1.5). El multi-código es comportamiento real observado en producción, extra-manual | QUIRK REAL (parsing defensivo) |
| Autenticación del alumno | Clave SENCE del alumno; 3 intentos; a la 3ª falla o a los 3 minutos, redirección garantizada a la página de fracaso (base v1.1.3) | **Clave Única** (§2 Paso 2): "el participante ingresará su RUT y Clave Única". Las URLs de gestión de Clave SENCE del alumno fueron eliminadas; se recomienda link a `https://claveunica.gob.cl/`. (La Clave SENCE sigue vigente SOLO para la empresa al emitir el token, §3.1) | MANUAL GANA (corregir SPEC) |
| Abandono del login — ¿callback de fracaso? | Herencia v1.1.3: fracaso de login SÍ producía redirección a `UrlError` (error 100/210) | §2: "Si el participante no ingresa correctamente su Clave Única, la plataforma **no retornara parámetros de éxito ni parámetros de fracaso**, ya que mantendrá al alumno en el login de clave única". Sin login exitoso NO llega ningún POST de vuelta | MANUAL GANA (corregir SPEC) |
| Error 100 (contraseña incorrecta / sin Clave SENCE) | Incluido en la tabla de la SPEC | **Eliminado** desde v1.1.5 (obsoleto con Clave Única). No existe en v1.1.6 | MANUAL GANA (corregir SPEC) |
| Error 200 (parámetro mandatorio sin información / mal escrito) | Incluido | Idéntico en v1.1.3/v1.1.5/v1.1.6 | IGUAL |
| Error 201 (UrlRetoma/UrlError sin información) | Incluido | Idéntico en las tres versiones | IGUAL |
| Error 202 (UrlRetoma formato incorrecto) | Incluido | Idéntico | IGUAL |
| Error 203 (UrlError formato incorrecto) | Incluido | Idéntico | IGUAL |
| Error 204 (Código SENCE <10 o inválido) | Incluido | Idéntico | IGUAL |
| Error 205 (Código Curso <7 o inválido) | Incluido | Idéntico (la glosa no menciona la excepción FPT, pero la tabla de parámetros sí) | IGUAL |
| Error 206 (línea de capacitación incorrecta) | Incluido | Idéntico | IGUAL |
| Error 207 (RUN formato/DV incorrecto) | Incluido | Idéntico | IGUAL |
| Error 208 (RUN no autorizado para el curso) | Incluido | Idéntico | IGUAL |
| Error 209 (RUT OTEC formato/DV incorrecto) | Incluido | Idéntico | IGUAL |
| Error 210 (expiró tiempo de ingreso RUT/contraseña — 3 min) | Incluido | **Eliminado** desde v1.1.5 (la tabla salta de 209 a 211). El único plazo numérico del protocolo antiguo desaparece con la Clave SENCE | MANUAL GANA (corregir SPEC) |
| Error 211 (Token no pertenece al OTEC) | Incluido | Idéntico | IGUAL |
| Error 212 (Token no vigente) | Incluido | Idéntico | IGUAL |
| Error 300 (error interno no clasificado) | Incluido | Idéntico | IGUAL |
| Error 301 (no se pudo registrar ingreso/cierre — línea o código de curso incorrecto) | Incluido | Idéntico | IGUAL |
| Error 302 (no se pudo validar info del Organismo) | Incluido | Idéntico | IGUAL |
| Error 303 (Token no existe o formato incorrecto) | Incluido | Idéntico | IGUAL |
| Error 304 (no se pudieron verificar los datos) | Glosa corta v1.1.3 ("…antecedentes disponibles.") | v1.1.6 amplía: "…antecedentes disponibles (ej. enviar parámetros de inicio o cierre de sesión según corresponda)" | MANUAL GANA (corregir SPEC) |
| Error 305 (no se pudo registrar la información) | Glosa corta v1.1.3 | v1.1.6 amplía con el mismo apéndice "(ej. enviar parámetros de inicio o cierre de sesión según corresponda)" | MANUAL GANA (corregir SPEC) |
| Error 306 (Código Curso no corresponde al código SENCE) | Incluido | Idéntico salvo casing ("Código"→"código" SENCE) | IGUAL |
| Error 307 (Código Curso sin modalidad E-learning) | Incluido | Idéntico salvo casing ("E-Learning"→"E-learning") | IGUAL |
| Error 308 (Código Curso no corresponde al RUT OTEC) | Incluido | Idéntico salvo punto final | IGUAL |
| Error 309 (fechas de ejecución no corresponden a la fecha actual) | Incluido | Idéntico (v1.1.5 tenía la errata "Las fecha"; v1.1.6 la corrige) | IGUAL |
| Error 310 (Código Curso Terminado o Anulado) | Incluido | Idéntico | IGUAL |
| Error 311 (RUN del login Clave Única ≠ RUN informado por el ejecutor) | NO está en la SPEC | "Run ingresado en el Login de Clave Única no corresponde con Run alumno informado por el ejecutor." Aparece en v1.1.5, se mantiene en v1.1.6 | NUEVO EN v1.1.6 |
| Error 312 (falla de autenticación Clave Única) | NO está en la SPEC | "No se pudo completar la autenticación con Clave Única." Aparece en v1.1.5, se mantiene en v1.1.6 | NUEVO EN v1.1.6 |
| Error 313 (URL de cierre de sesión incorrecta) | NO está en la SPEC | "URL de Cierre de sesión Incorrecta." Aparece en v1.1.5, se mantiene en v1.1.6 | NUEVO EN v1.1.6 |
| Wildcard `-1` en `rcetest` | La SPEC no documenta el wildcard `-1` ni el comportamiento de `rcetest` (solo lista los endpoints de prueba); la observación equivalente vive solo en `block_sence/ANALISIS_PLUGIN_SENCE.md` ("no registra asistencias reales, no exige código de curso válido") | §4 lo formaliza: sin códigos vigentes, "en los campos CodSence y CodigoCurso puede utilizar el valor **-1**, lo cual deshabilitará las verificaciones asociadas […] sólo en el Ambiente Test". En línea 1, el `-1` va SOLO en `CodigoCurso` (`CodSence` sigue en blanco, Anexo 5). El mismo Token sirve para test y producción | MANUAL GANA (corregir SPEC) |
| Ciclo de vida del Token OTEC | Se genera en `https://sistemas.sence.cl/rts`; guardarlo server-side; es identificador de OTEC, no secreto de usuario | §3.1: se emite en RTS identificándose con RUT Empresa + RUT representante legal (SII) + Clave SENCE de empresa; N tokens simultáneos; revocables en cualquier instante; el manual no menciona expiración — solo estados vigente/dado de baja (inferencia, no texto del §3.1); Texto 36; errores 211/212/303 | IGUAL |
| Regla 3 h de sesión / 60 min de inactividad | Sesión máx. 3 horas (herencia del plugin, C-19); CLAUDE.md agrega 60 min de inactividad | El manual **NO fija ninguno de los dos límites**. Solo recomienda cronómetro en pantalla y alerta a los 10 minutos del término del "tiempo de ejecución asignado al curso", sin cuantificar. Buscar la fuente real en instructivos complementarios (p. ej. instructivo LMS–SIC) | SIN FUENTE EN MANUAL |

---

## Consecuencias para el motor (`src/modules/sence/`)

- **`errors.ts`:** retirar los códigos **100 y 210** — *nota de supersesión: esta instrucción fue reemplazada por [D-005 en DECISIONES.md](../../specs/DECISIONES.md) (decisión posterior a este diff): los códigos 100 y 210 se **mantienen** en la tabla marcados `deprecated`, con su glosa según v1.1.3, como superficie de recepción defensiva ante emisores legacy*; agregar **311, 312, 313** con sus glosas y traducciones es-CL; actualizar las glosas de **304 y 305** (piden antecedentes concretos). El rango vigente del manual queda **200–313** — actualizar la referencia "códigos 100–310" de CLAUDE.md.
- **Parsing de `GlosaError` (defensivo, extra-manual):** recibirlo como **texto**, hacer `split(';')`, trim y traducir cada código por separado; tolerar valores no enteros. Nunca prometer multi-código en lo que el motor emite ni documentarlo como norma: el manual declara "Entero" singular.
- **Discriminación de callbacks:** evaluar `GlosaError` **antes** que `IdSesionSence` — el callback de error de inicio TAMBIÉN trae `IdSesionSence`; invertir el orden clasifica errores como éxitos. Regla final: `GlosaError` presente → error (de inicio si trae `IdSesionSence`, de cierre si no); sin `GlosaError` y con `IdSesionSence` → inicio exitoso; sin ambos → cierre exitoso.
- **Sesiones "en tránsito" sin callback:** con Clave Única, si el alumno no completa el login **no llega ningún POST de vuelta** (ni éxito ni error). El motor necesita expiración local del intento (timeout propio + estado `abandoned`) y no debe modelar el fracaso de login como estado alcanzable por callback.
- **`UrlRetoma`/`UrlError` ≤ 100 caracteres** (v1.1.3 permitía 200): validar en build-time de la URL por tenant (subdominio + ruta + query con el correlador) y cubrir con test; los errores 202/203/313 castigan el formato.
- **Línea 6 (FPT):** soportar `LineaCapacitacion = 6` y **eximir del mínimo de 7 caracteres** a `CodigoCurso` en cursos FPT (validador Zod condicional por línea).
- **Renombrar líneas en UI/i18n (`es-CL.ts`):** 3 = "Franquicia Tributaria" (antes "Impulsa Personas"), 1 = "Programas Sociales", 6 = "FPT". Los IDs no cambian.
- **Regla 3 h / 60 min:** moverla a configuración con cita explícita a su fuente real (no este manual) en `docs/sence/SPEC_INTEGRACION_SENCE.md`; mantener la recomendación de UI del manual (cronómetro visible + alerta a 10 min del término).
- **`rcetest`:** usar el wildcard `-1` documentado (en línea 1 solo en `CodigoCurso`); recordar que test deshabilita las verificaciones de códigos, por lo que **no sirve** para validar códigos reales de negocio. El mismo token opera en ambos ambientes — cuidar que fixtures del mock jamás usen tokens reales.
- **Validación de RUN:** exigir `xxxxxxxx-x` sin puntos; normalizar el DV `k` a minúscula por compatibilidad con el plugin, pero no rechazarla en mayúscula (la exigencia de minúscula no tiene fuente en el manual).
- **Parsing defensivo de nombres de campo:** el ejemplo ASP oficial trae la errata `request.form("LineaCapacitacion ")` (espacio colgante) y la etiqueta `CodigoSence` sobre un campo `name="CodSence"`. Al leer callbacks, hacer trim de keys; al enviar, usar SIEMPRE los `name` exactos (`CodSence`, no `CodigoSence`; `RunAlumno`, no `RutAlumno` — error 200).
- **Callback de error de inicio:** persistir el payload completo (los 8 campos + `GlosaError`), no solo `GlosaError` + `RunAlumno` como sugería la SPEC — corrige la enumeración de la SPEC portable.
- **Actualizar la SPEC portable** (`integracion-sence-portable/SPEC_INTEGRACION_SENCE.md`) con todas las filas `MANUAL GANA` y `NUEVO EN v1.1.6` de este diff, y cambiar su fuente normativa declarada de v1.1.3 a v1.1.6.
