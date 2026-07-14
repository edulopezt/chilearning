# Análisis a fondo — Plugin `block_sence` (Integración Asistencia SENCE)

> Estudio del plugin instalado en `aulavirtual` (Moodle 4.3.6), extraído del código fuente.
> Fecha: 2026-06-30.

## 1. Qué es y de dónde viene
- **Tipo:** **bloque** de Moodle (`block_sence`), no un módulo. Se agrega a la página de un curso.
- **Nombre visible:** *"Integración SENCE"*. Tabla en BD: `mdlil_block_sence`.
- **Autor:** Felipe Uzcátegui — **open source**, repo público: `https://github.com/fauzcategui/moodle-sence`.
- **Licencia:** **GNU AGPLv3** → libre de usar, estudiar, modificar y **redistribuir**. (No hay nada propietario que "piratear": exportarlo es 100% legítimo.)
- **Versión instalada:** `version = 2021041401`, `requires = 2019111200` (Moodle 3.8+). Corresponde a la **v3.2** del repo (la última estable publicada).
- **Manual oficial SENCE de referencia:** "Integración Registro Asistencia SENCE v1.1.3" (PDF en sence.gob.cl).

## 2. Para qué sirve
Permite que un **OTEC** registre la **asistencia oficial en SENCE** de los alumnos de cursos **e-learning**, cumpliendo el "Control e-learning OTEC". Cada vez que el alumno entra al curso, registra su asistencia en el sistema **RCE** de SENCE; opcionalmente bloquea el curso hasta que la registre.

## 3. La clave de la arquitectura (lo más ingenioso)
**El plugin NO llama a la API de SENCE desde el servidor** (no usa cURL ni SOAP, no guarda contraseñas). Usa un **POST desde el navegador del alumno**:

1. El bloque arma un formulario HTML `<form method="POST" action="https://sistemas.sence.cl/rce/Registro/IniciarSesion">` con campos ocultos.
2. El **navegador del alumno** lo envía a SENCE. SENCE pide la **Clave SENCE/ClaveÚnica** del alumno y valida.
3. SENCE **redirige de vuelta** al curso (parámetros `UrlRetoma`/`UrlError`) con un **POST** que trae el resultado (`RunAlumno`, `IdSesionSence`, `FechaHora`, `GlosaError`, etc.).
4. El bloque **lee ese POST** y guarda la asistencia en `mdlil_block_sence`.

Por eso solo necesita el **Token del OTEC** (identifica al organismo), no credenciales del alumno: la autenticación ocurre en el navegador, contra SENCE.

## 4. Flujo paso a paso (alumno)
1. El alumno abre el curso. El bloque detecta que es alumno (no tiene `moodle/course:viewhiddensections`).
2. Verifica que pertenezca a un grupo **`SENCE-<idAcción>`** (su código de acción). Si está en el grupo **"Becarios"**, queda exento.
3. Si no hay asistencia vigente, muestra el botón **"Iniciar Sesión"** que hace POST a SENCE con: `RutOtec`, `Token`, `LineaCapacitacion`, `RunAlumno`, `IdSesionAlumno` (=sesskey de Moodle), `UrlRetoma`/`UrlError` (=página del curso), `CodSence` (código SENCE del curso) y `CodigoCurso` (=idAcción del grupo).
4. Si `asistenciaObligatoria` está activo, inyecta **`locker.js`** que **bloquea el contenido** del curso hasta registrar asistencia.
5. SENCE responde por POST: si hay `GlosaError`, lo traduce con la tabla de errores; si es éxito, llama a `registra_asistencia()` e inserta el registro.
6. Si `senceTiempoCierre` está activo, la sesión dura máx **3 horas** (`timer.js` muestra el contador) y aparece **"Cerrar Sesión"** (POST a `.../CerrarSesion`), que marca `cierresesion`.

## 5. Configuración
**Global** (Administración del sitio › Plugins › Bloques › Integración SENCE) — ajuste `block_sence/otecs` (un **JSON** con `multiotec` y array de OTECs `{name, rut, token}`, guardado por `settings.js`) y `block_sence/testenv` (checkbox prod/test).
- **Token** de cada OTEC se genera en `https://sistemas.sence.cl/rts`.
- **Ambiente de pruebas:** usa endpoints `.../rcetest/...` (no registra asistencias reales, no exige código de curso válido).

**Por bloque (instancia)** — `edit_form.php`:
- **Selecciona OTEC** (si multiotec).
- **Línea de Capacitación:** `6` = FPT e-learning, `3` = Impulsa Personas (default), `1` = Programas Sociales/Becas (con línea 1 se **desactiva** el campo Código de Curso; SENCE no lo pide).
- **Código SENCE del Curso** (10 dígitos).
- **Nombre Grupo Becarios** (default "Becarios").
- Checkboxes: solicitar cierre de sesión, mostrar logo SENCE, asistencia obligatoria (default ON).

## 6. Identificación del alumno
- El **RUN** se toma del **nombre de usuario** si tiene formato `1111111-1` (sin puntos, con guion y DV). Si no, lo busca en el campo **ID number** (regex `\d*-[0-9kK]`).
- El **código de acción** del alumno se codifica en el **nombre del grupo**: `SENCE-<idAcción>` (ej. `SENCE-RLAB-19-02-08-0071-1` para programas sociales línea 1). El bloque extrae lo que va después de `SENCE-`.
- Grupo **"Becarios"**: exento de integración SENCE.

## 7. Datos almacenados — tabla `mdlil_block_sence`
Una fila por sesión de asistencia: `courseid`, `userid`, `timecreated`, `codsence`, `codigocurso`, `idsesionalumno` (sesskey Moodle), `idsesionsence` (id de sesión que devuelve SENCE), `runalumno`, `fechahora`, `zonahoraria`, `lineacapacitacion`, `cierresesion`.

## 8. Reportería (`sence_report.php`)
Para profesores/editores, el bloque muestra **"Descargar Reporte"** → genera un **Excel (.xls)** con las asistencias del curso (CURSO, NOMBRES, APELLIDOS, RUN, CÓDIGO CURSO, ID SENCE, FECHA/HORA), usando `MoodleExcelWorkbook`. Lee de `mdlil_block_sence`.

## 9. Tabla de códigos de error SENCE (mapeados en `engine.php`)
100 = contraseña incorrecta / sin Clave SENCE · 204 = Código SENCE <10 car. · 205 = Código Curso <7 car. · 206 = línea de capacitación incorrecta · 207 = RUN con DV incorrecto · 208 = RUN no autorizado · 209 = RUT OTEC incorrecto · 210 = expiró el tiempo (3 min) · 211 = Token no pertenece al OTEC · 212 = Token no vigente · 303 = Token no existe/format. malo · 306 = Código Curso ≠ Código SENCE · 307 = curso no es e-learning · 308 = curso no corresponde al RUT OTEC · 309 = fechas no corresponden · 310 = curso Terminado/Anulado · (300/302/304/305 = errores internos a reportar a SENCE).

## 10. Archivos del plugin
- `version.php` — metadatos (component, version).
- `block_sence.php` — clase del bloque (solo en `course-view`, una instancia por curso).
- `engine.php` (530 líneas) — **núcleo**: arma los formularios POST, maneja OTECs/token, valida config, guarda asistencias, mapea errores.
- `sence_report.php` — exportación Excel de asistencias.
- `edit_form.php` — formulario de configuración del bloque.
- `settings.php` — ajustes globales (OTECs JSON + test env).
- `db/install.xml` — esquema de la tabla · `db/access.php` — capacidad `block/sence:addinstance` · `db/install.php`/`upgrade.php`/`uninstall.php`.
- `js/locker.js` (bloquea curso), `js/timer.js` (contador de sesión), `js/settings.js` (UI de OTECs).
- `lang/es`, `lang/en` · `assets/sence-logo.webp` · `README.md` · `license.txt` (AGPLv3).

## 11. Exportar / reinstalar
- Es un bloque estándar: para reinstalar en otro Moodle basta un **ZIP cuya carpeta raíz se llame `sence`** y subirlo en *Administración › Plugins › Instalar plugins*, o copiar la carpeta a `blocks/sence`.
- En este proyecto se generó: `servidor/block_sence/block_sence.zip` (instalable) + `servidor/block_sence/sence_src/` (fuente).
- Alternativa oficial: la v3.2 está en GitHub (`fauzcategui/moodle-sence`).

## 12. Notas / limitaciones / ideas
- Depende de que el alumno tenga **Clave SENCE** y el **RUN** bien cargado (username o idnumber).
- El código de acción va "amarrado" al **nombre del grupo** (`SENCE-xxxx`) — práctica frágil pero funcional.
- No cifra ni esconde el Token en el HTML (va en un input hidden del form que se postea a SENCE) — aceptable porque el Token solo identifica al OTEC ante SENCE.
- Mejoras posibles: validar config en el `edit_form`, manejar multiotec en JSON más robusto, registrar `zonahoraria` siempre, panel de reportes más completo, y soporte para más líneas de capacitación.
