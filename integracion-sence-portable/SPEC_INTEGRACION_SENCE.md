> ⚠ **SUPERSEDIDA (2026-07-14):** esta SPEC se basaba en el manual v1.1.3. La versión
> vigente, congelada contra el manual oficial **v1.1.6**, vive en
> [`docs/sence/SPEC_INTEGRACION_SENCE.md`](../docs/sence/SPEC_INTEGRACION_SENCE.md).
> Se conserva este archivo solo como baseline del diff (`docs/sence/DIFF-SPEC-v1.1.3-a-manual-v1.1.6.md`).

# Spec portable — Integración de Asistencia SENCE (RCE) para cualquier plataforma

> Protocolo **agnóstico de tecnología** para registrar asistencia e-learning en SENCE.
> Derivado del plugin open-source `block_sence` (AGPLv3) + manual SENCE. **Validar contra el
> *Manual Integración Registro Asistencia SENCE v1.1.3* (oficial) y probar en `rcetest`.**

## 1. Idea central
SENCE **no expone una API REST con credenciales servidor-a-servidor**. El registro se hace con un
**POST desde el navegador del alumno** hacia SENCE; SENCE autentica al alumno (su **Clave SENCE**),
registra, y **redirige de vuelta** (POST) a una URL de tu plataforma. Por eso funciona en **cualquier
stack**: solo necesitas (a) renderizar un formulario/redirección a SENCE y (b) un endpoint que reciba
el callback.

```
[Tu plataforma]                 [Navegador del alumno]                [SENCE RCE]
   muestra botón  ───────────────────►  POST IniciarSesion ───────────►  valida Clave SENCE
                                                                          + Token OTEC + curso
   guarda registro ◄──── POST a UrlRetoma (callback) ◄──── redirige ◄────  registra asistencia
```

## 2. Requisitos (independientes de la plataforma)
- **Token del OTEC** — se genera en `https://sistemas.sence.cl/rts`. Identifica al organismo.
- **RUT del OTEC** (con dígito verificador, ej. `76668428-9`).
- **Curso registrado en SENCE como e-learning**, con su **Código SENCE** (10 dígitos) y la **línea de capacitación**.
- Cada **alumno con su RUN** (formato `11111111-1`, sin puntos, con guion y DV en minúscula la `k`) y su **Clave SENCE**.
- Una **URL pública** de tu plataforma para el callback (`UrlRetoma`/`UrlError`).

## 3. Endpoints
| Ambiente | Iniciar sesión | Cerrar sesión |
|---|---|---|
| **Pruebas** | `https://sistemas.sence.cl/rcetest/Registro/IniciarSesion` | `https://sistemas.sence.cl/rcetest/Registro/CerrarSesion` |
| **Producción** | `https://sistemas.sence.cl/rce/Registro/IniciarSesion` | `https://sistemas.sence.cl/rce/Registro/CerrarSesion` |

Content-Type del POST: `application/x-www-form-urlencoded` (formulario HTML normal).

## 4. Petición — `IniciarSesion` (campos del formulario)
| Campo | Contenido | Notas |
|---|---|---|
| `RutOtec` | RUT del OTEC con DV | obligatorio |
| `Token` | Token del OTEC | obligatorio |
| `LineaCapacitacion` | `1`, `3` o `6` | 6=FPT e-learning · 3=Impulsa Personas · 1=Programas Sociales/Becas |
| `RunAlumno` | RUN del alumno (`11111111-1`) | obligatorio |
| `IdSesionAlumno` | **id que tú generas** para correlacionar | te vuelve en el callback |
| `UrlRetoma` | URL absoluta de tu callback de **éxito** | obligatorio |
| `UrlError` | URL absoluta de tu callback de **error** | obligatorio (puede ser la misma que Retoma) |
| `CodSence` | **Código SENCE del curso** (10 díg.) | ⚠️ ojo al nombre (ver abajo); en blanco si línea 1 |
| `CodigoCurso` | **Código de acción del alumno** (idAcción) | ⚠️ ojo al nombre |

> **Quirk de nombres (importante):** en este protocolo el campo `CodSence` lleva el **código del
> curso**, y el campo `CodigoCurso` lleva el **código de acción** del alumno. Es contra-intuitivo
> pero así lo usa SENCE. (En línea de capacitación **1**, el `CodSence` va vacío: SENCE no lo pide.)

## 5. Callback — qué te devuelve SENCE (POST a `UrlRetoma` / `UrlError`)
**Éxito** (POST a `UrlRetoma`): trae al menos
`RunAlumno`, `IdSesionAlumno`, `IdSesionSence`, `CodSence`, `CodigoCurso`, `FechaHora`,
`ZonaHoraria`, `LineaCapacitacion`. → **guarda un registro** con estos datos.
**Error** (POST a `UrlError`): trae `GlosaError` = lista de **códigos separados por `;`** (ej. `211;204`)
y `RunAlumno`. → traduce los códigos (tabla §7) y muéstralos.

> Si usas **una sola URL** para ambos, distingue: hay `GlosaError` → error; hay `IdSesionSence` →
> éxito; ninguno de los dos → es un **cierre** de sesión.

## 6. Cierre de sesión — `CerrarSesion`
Mismos campos que IniciarSesion **más** `IdSesionSence` (el que te devolvió SENCE al abrir).
El callback de cierre **no** trae `IdSesionSence`; ubícalo por `IdSesionAlumno` y marca la hora de cierre.
Reglas del plugin: sesión dura máx **3 horas**; pasado ese tiempo se exige nueva apertura.

## 7. Tabla de códigos de error (GlosaError)
| Código | Significado |
|---|---|
| 100 | Contraseña incorrecta o el usuario no tiene Clave SENCE |
| 200 | Falta uno o más parámetros obligatorios en el POST |
| 201 | Falta UrlRetoma y/o UrlError (ambos obligatorios) |
| 202 / 203 | UrlRetoma / UrlError con formato incorrecto |
| 204 | Código SENCE con menos de 10 caracteres o inválido |
| 205 | Código Curso con menos de 7 caracteres o inválido |
| 206 | Línea de capacitación incorrecta |
| 207 | RUN del alumno con formato/DV incorrecto |
| 208 | RUN del alumno no autorizado para el curso |
| 209 | RUT OTEC con formato/DV incorrecto |
| 210 | Expiró el tiempo de ingreso de RUT y Contraseña (3 minutos) |
| 211 | El Token no pertenece al OTEC |
| 212 | El Token no está vigente |
| 300 / 302 / 304 / 305 | Errores internos → reportar a SENCE |
| 301 | No se pudo registrar (línea o código de curso incorrecto) |
| 303 | El Token no existe o su formato es incorrecto |
| 306 | El Código Curso no corresponde al Código SENCE |
| 307 | El Código Curso no tiene modalidad E-Learning |
| 308 | El Código Curso no corresponde al RUT OTEC |
| 309 | Las fechas de ejecución no corresponden a la fecha actual |
| 310 | El Código Curso está Terminado o Anulado |

## 8. Modelo de datos sugerido (equivalente a `block_sence`)
```
asistencia_sence(
  id, plataforma_usuario_id, curso_id, creado_en,
  cod_sence,            -- código SENCE del curso
  codigo_accion,        -- idAcción del alumno
  id_sesion_alumno,     -- el que tú generaste
  id_sesion_sence,      -- el que devolvió SENCE
  run_alumno, fecha_hora, zona_horaria, linea_capacitacion,
  cierre_sesion         -- timestamp de cierre (nullable)
)
```

## 9. Casos borde / reglas
- **Identificación del RUN:** úsalo del perfil del alumno (debe ser `11111111-1`).
- **Código de acción por alumno:** en Moodle se guarda en el nombre del grupo `SENCE-<idAcción>`; en tu plataforma puedes guardarlo como un campo de la inscripción.
- **Becarios / exentos:** alumnos sin franquicia no pasan por SENCE.
- **Asistencia obligatoria:** opcionalmente bloquea el contenido hasta registrar (lógica de tu front).
- **Línea 1 (Programas Sociales):** `CodSence` vacío; el `CodigoCurso` suele venir como `RLAB-19-02-08-0071-1`.
- **Seguridad:** el `Token` viaja en el form que postea el navegador a SENCE (es identificador de OTEC, no secreto de usuario); aun así, no lo expongas innecesariamente y guárdalo server-side.

## 10. Fuentes
- Plugin de referencia: `github.com/fauzcategui/moodle-sence` (AGPLv3) — ver `engine.php`.
- Manual oficial: *Integración Registro Asistencia SENCE v1.1.3* (sence.gob.cl).
- Implementación de referencia en Node/Express: ver `referencia-node/`.
