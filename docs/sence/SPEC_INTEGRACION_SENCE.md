# Spec portable — Integración de Asistencia SENCE (RCE) para cualquier plataforma

> **Congelada contra manual oficial v1.1.6 (SHA256 `e9435a9e9b95985b81e5ecc9696e42a1c7d7521c838b2217999f05636f8eac4c`) el 2026-07-14; reemplaza a `integracion-sence-portable/SPEC_INTEGRACION_SENCE.md` (v1.1.3).**
>
> Protocolo **agnóstico de tecnología** para registrar asistencia e-learning en SENCE
> (*Manual Técnico "Integración Registro Asistencia SENCE" v1.1.6*). Todo lo normativo
> de este documento se cita del manual; lo que proviene de comportamiento observado en
> producción (plugin `block_sence`) está marcado explícitamente como tal y vive en
> subsecciones separadas. **Regla de precedencia:** ante discrepancia, el manual oficial
> gana para todo lo que el motor promete/envía; lo observado en producción gana SOLO para
> parsing defensivo de lo que se recibe.

## 1. Idea central

SENCE **no expone una API REST servidor-a-servidor**. El registro se hace con un
**POST desde el navegador del alumno** hacia SENCE; SENCE autentica al alumno con su
**Clave Única** (ya NO Clave SENCE — cambio de v1.1.5+), registra, y **redirige de vuelta**
(POST) a una URL de tu plataforma (callback). Por eso funciona en **cualquier stack**: solo
necesitas (a) renderizar un formulario/redirección a SENCE y (b) un endpoint que reciba el POST
de vuelta.

```
[Tu plataforma]                [Navegador del alumno]               [SENCE RCE]
   muestra botón ──────────────► POST IniciarSesion ───────────────► login Clave Única
                                                                     + Token OTEC + curso
   guarda registro ◄──── POST a UrlRetoma/UrlError (callback) ◄───── redirige y registra
```

### ⚠️ Regla crítica v1.1.6 — abandono del login SIN callback

Si el alumno **no completa** el login de Clave Única, **SENCE no envía ningún callback**
(ni de éxito ni de error). Manual v1.1.6, §2 (textual):

> "Si el participante no ingresa correctamente su Clave Única, la plataforma no retornara
> parámetros de éxito ni parámetros de fracaso, ya que mantendrá al alumno en el login de
> clave única, hasta que este logre ingresar sus credenciales. Si el alumno olvida sus
> credenciales, dentro del login tendrá disponible un link para poder recuperarla."

Esto **invierte** el comportamiento de v1.1.3 (que garantizaba redirección de fracaso tras
3 intentos o 3 minutos). Consecuencia de diseño obligatoria: la plataforma debe modelar la
sesión "en tránsito" (POST enviado, callback nunca recibido) y **expirarla localmente** con
un timeout propio del lado OTEC. No modelar "fracaso de login" como estado terminal
alcanzable por callback.

Recomendación de UI del manual (§3.2): junto al botón de inicio, instruir al alumno que se
usará Clave Única e incluir el link `https://claveunica.gob.cl/` (Portal ciudadano).

## 2. Requisitos (independientes de la plataforma)

- **Token del OTEC** — ver ciclo de vida completo en §2.1.
- **RUT del OTEC** con dígito verificador, formato `xxxxxxxx-x` (sin puntos, con guion).
- **Curso registrado en SENCE como e-learning**, con su **Código SENCE** (10 dígitos, salvo
  línea 1 — ver §4.2) y su **línea de capacitación** (1, 3 o 6).
- Cada **alumno con su RUN** en formato `xxxxxxxx-x` (sin puntos, con guion y DV) y su
  **Clave Única** (estatal; la plataforma OTEC nunca la ve ni la toca).
- Una **URL pública** de tu plataforma para los callbacks (`UrlRetoma`/`UrlError`),
  de **máximo 100 caracteres** cada una (ver §4).

### 2.1 Ciclo de vida del Token OTEC (manual §3.1)

- **Emisión:** en el portal RTS `https://sistemas.sence.cl/rts`, identificándose con
  **RUT Empresa + RUT del representante legal válido ante SII + Clave SENCE (CS) de empresa**.
  (La Clave SENCE sigue vigente para la *empresa* en la emisión del token; lo que desapareció
  es la Clave SENCE del *alumno* en el login.)
- **Cantidad y revocación:** el OTEC puede generar **cuantos tokens estime conveniente** y
  **dar de baja cualquiera en cualquier instante**. Cualquier token en estado vigente sirve
  para inicio y cierre de sesión.
- **Vigencia:** el manual **no fija fecha de expiración**; el estado es vigente/dado de baja
  a voluntad del OTEC. "La administración de los Token es de exclusiva responsabilidad del
  OTEC que los emite."
- **Obligatoriedad:** "Incluir un Token vigente en los POST de inicio y cierre de sesión es
  obligatorio."
- **Formato:** Texto, largo **36** (forma GUID en el ejemplo del Anexo 3).
- **Mismo token para test y producción** (§4): "deberá generar su Token, el cual podrá
  utilizarlo tanto para esta etapa de pruebas como para el ambiente productivo."
- Errores asociados: **211** (no pertenece al OTEC), **212** (no vigente), **303**
  (no existe o formato incorrecto).
- Regla propia de este proyecto (no del manual): el token va **cifrado en reposo
  (AES-256-GCM)** y jamás aparece en logs, respuestas al cliente ni fixtures. Nota: el
  protocolo obliga a que el token viaje en el form que el navegador postea a SENCE, por lo
  que es visible en el DOM del alumno — minimizar su exposición en todo lo demás.

## 3. Endpoints

| Ambiente | Iniciar sesión | Cerrar sesión |
|---|---|---|
| **Pruebas (`rcetest`)** | `https://sistemas.sence.cl/rcetest/Registro/IniciarSesion` | `https://sistemas.sence.cl/rcetest/Registro/CerrarSesion` |
| **Producción (`rce`)** | `https://sistemas.sence.cl/rce/Registro/IniciarSesion` | `https://sistemas.sence.cl/rce/Registro/CerrarSesion` |

- **Método:** POST vía redirección del navegador del alumno (formulario HTML), no
  server-to-server. Content-Type implícito: `application/x-www-form-urlencoded`
  (el manual no lo declara; es el mecanismo del `<form method="post">` del Anexo 3).
  Los callbacks SENCE → OTEC son igualmente POST de formulario.
- El ambiente se configura **POR ACCIÓN**; jamás hardcodear.
- **Advertencia de producción (§5, textual):** "Al utilizar las URL's del Ambiente
  Producción, se registrarán inicios y cierres de sesión en las bases de datos productivas
  del SENCE, información que será utilizada para todos los procesos administrativos
  asociados a ese curso E-Learning. **Esta información no podrá ser eliminada.**"

### 3.1 Ambiente `rcetest` y el wildcard `-1` (§4)

`rcetest` prueba envío de parámetros y recepción de respuesta "sin registrar información
en los sistemas productivos". Si no cuentas con códigos e-learning vigentes:

> "en los campos CodSence y CodigoCurso puede utilizar el valor **-1**, lo cual
> deshabilitará las verificaciones asociadas a esos códigos. Esto se podrá hacer **sólo en
> el Ambiente Test**."

Para **línea 1** (Programas Sociales) en test, Anexo 5: `CodSence` **sigue vacío** ("Dejar
en Blanco"); el `-1` va **solo en `CodigoCurso`**; `LineaCapacitacion = 1`.

⚠️ Implicancia: en `rcetest` con `-1` no se validan los códigos — un test "verde" ahí no
demuestra que los códigos reales sean correctos.

## 4. Petición — `IniciarSesion` (campos del formulario, §3.2)

Largos y tipos **normativos** del manual v1.1.6. Todos los parámetros son obligatorios
(error 200 castiga parámetros mandatorios vacíos, solo espacios, o **mal escritos** — el
ejemplo del propio manual: `RutAlumno` en lugar de `RunAlumno`).

| Campo | Tipo | Largo máx. | Contenido | Notas |
|---|---|---|---|---|
| `RutOtec` | Texto | 10 | RUT OTEC sin puntos, con DV, formato `xxxxxxxx-x` | |
| `Token` | Texto | 36 | Token del OTEC | ver §2.1 |
| `CodSence` | Texto | 10 | **Código SENCE del CURSO** (10 dígitos) | ⚠️ nombre invertido (§4.1); **VACÍO en línea 1** |
| `CodigoCurso` | Texto | 50 | **Código de la ACCIÓN** (idAcción) | ⚠️ nombre invertido; "mínimo 7 caracteres, **excepto cursos FPT**" |
| `LineaCapacitacion` | Entero | — | `1`, `3` o `6` | 1 = Programas Sociales · 3 = Franquicia Tributaria · 6 = FPT (§4.2) |
| `RunAlumno` | Texto | 10 | RUN del alumno sin puntos, con DV, formato `xxxxxxxx-x` | |
| `IdSesionAlumno` | Texto | 149 | **Id que tú generas** para correlacionar | te vuelve en el callback |
| `UrlRetoma` | Texto | **100** | URL absoluta del callback de éxito | ⚠️ era 200 en v1.1.3; cuidado al construir URLs por tenant |
| `UrlError` | Texto | **100** | URL absoluta del callback de error | puede ser la misma que Retoma |

### 4.1 Quirk de nombres `CodSence` / `CodigoCurso` (normativo — Anexo 4)

En este protocolo `CodSence` lleva el **código SENCE del curso** y `CodigoCurso` lleva el
**código de acción**. Es contra-intuitivo pero es normativo. Anexo 4 (textual):
`CodigoCurso` "También se le conoce como **ID de acción, Folio SENCE, Registro Único SENCE,
y SENCENET**". Ambos valores se pueden obtener del sistema de Gestión de Acreditación de
Participación (`http://lce.sence.cl/CertificadoAsistencia`) para cursos comunicados desde
el 1 de julio de 2019.

Trampa adicional del propio manual: en el ejemplo ASP del Anexo 3 la *etiqueta* visible
dice `CodigoSence`, pero el `name` real del campo es `CodSence`. El nombre válido del
parámetro es **`CodSence`**.

### 4.2 Variantes por Línea de Capacitación (nombres vigentes v1.1.6)

Glosa oficial v1.1.6: "1 = Programas Sociales / 3 = Franquicia Tributaria. / 6 = FPT".
(v1.1.3 decía "1 = Sistema Integrado de Capacitación / 3 = Impulsa Personas"; los IDs
conservan su semántica, cambió la glosa, y la línea 6 es nueva.)

| Línea | Nombre vigente | `CodSence` | `CodigoCurso` |
|---|---|---|---|
| **1** | Programas Sociales (Becas Laborales) | **VACÍO** ("Para Programas Sociales o Becas Laborales, dejar en blanco" — Anexo 5) | Código entregado por SIC, formato tipo `RLAB-19-02-08-0071-1` o `BOTIC-SOFOF-19-12-13-0046` |
| **3** | Franquicia Tributaria | Código SENCE del curso, 10 dígitos (de la orden de compra del OTIC/Empresa) | ID de acción de la nómina comunicada |
| **6** | FPT | Código SENCE del curso | **Exento del mínimo de 7 caracteres** |

Un validador que exija `CodigoCurso` ≥ 7 caracteres debe eximir la línea 6.

## 5. Callbacks — qué te devuelve SENCE (POST a `UrlRetoma` / `UrlError`)

Cuatro callbacks posibles; todos POST de formulario del navegador. Largos normativos.

**5a. Inicio de sesión EXITOSO** (a `UrlRetoma` del IniciarSesion):
`CodSence` (10), `CodigoCurso` (50), `IdSesionAlumno` (149), **`IdSesionSence` (149)**,
`RunAlumno` (10), `FechaHora` (19), `ZonaHoraria` (100), `LineaCapacitacion` (entero).
El manual exige guardar `IdSesionSence`: "Este identificador debe ser enviado en el cierre
de sesión, para poder asociar correctamente el inicio con el cierre de la sesión."
→ **guarda un registro** con todos estos datos.

**5b. Inicio de sesión INCORRECTO** (a `UrlError`): los mismos 8 campos de 5a
(incluye `IdSesionSence`) **más `GlosaError`** (declarado "Entero" — ver §7 y §5.2).

**5c. Cierre de sesión EXITOSO** (a `UrlRetoma` del CerrarSesion):
`CodSence`, `CodigoCurso`, `IdSesionAlumno`, `RunAlumno`, `FechaHora`, `ZonaHoraria`,
`LineaCapacitacion`. **NO trae `IdSesionSence` ni `GlosaError`.**

**5d. Cierre de sesión INCORRECTO** (a `UrlError`): los 7 campos de 5c **más `GlosaError`**.
Tampoco trae `IdSesionSence`.

- **`FechaHora`**: Texto 19, "formato aaaa-mm-dd hh:mm:ss".
- **`ZonaHoraria`**: Texto 100; el manual no da catálogo de valores (en producción se ha
  observado que puede llegar vacío — persistir como nullable).

### 5.1 Regla de discriminación de callbacks (una sola URL o URL compartida)

Derivada por composición de las 4 tablas del manual (el manual no la enuncia como frase):

1. Hay `GlosaError` → callback de **error** (de inicio si además trae `IdSesionSence`;
   de **cierre** si no lo trae).
2. Sin `GlosaError`, **con** `IdSesionSence` → **inicio de sesión exitoso**.
3. Sin `GlosaError` y **sin** `IdSesionSence` → **cierre de sesión exitoso**.

Recordar §1: el abandono del login de Clave Única **no genera callback alguno** — la
ausencia de callback también es un estado que la plataforma debe manejar (timeout local).

### 5.2 Comportamiento observado en producción (parsing defensivo — NO normativo)

Lo siguiente proviene del plugin `block_sence` operando en producción, **no** del manual
v1.1.6 (que no lo respalda). Aplicar SOLO al parsear lo recibido, nunca a lo que se envía:

- **`GlosaError` multi-código con `;`.** El manual declara `GlosaError` como "Entero" y en
  singular ("Identificador del error"); el carácter `;` no aparece en todo el documento.
  Sin embargo, en producción se han observado callbacks con **varios códigos separados por
  `;`** (ej. `211;204`). Parsing defensivo: tratar `GlosaError` como **texto**, hacer
  `split(';')`, trimear y traducir **cada** código con la tabla §7; nunca asumir un único
  código ni parsearlo como entero.
- **Nombres de campo con espacios colgantes.** El ejemplo ASP del Anexo 3 lee
  `request.form("LineaCapacitacion ")` (con espacio) en la página de error — errata del
  manual presente desde v1.1.3. El `name` real emitido es `LineaCapacitacion`; conviene
  tolerar/trimear espacios en los nombres de campo al parsear, solo defensivamente.
- **`ZonaHoraria` puede no llegar o no persistirse** (observado en `block_sence`); tratar
  como opcional al recibir aunque la tabla la declare.
- Estos comportamientos van cubiertos por tests contra el mock RCE local, marcados como
  quirks (no como contrato).

## 6. Cierre de sesión — `CerrarSesion` (§3.3)

Mismos campos que `IniciarSesion` (mismos tipos y largos, incluidas `UrlRetoma`/`UrlError`
≤ 100) **más**:

| Campo | Tipo | Largo máx. | Contenido |
|---|---|---|---|
| `IdSesionSence` | Texto | 149 | El identificador devuelto por SENCE en el callback de inicio exitoso (5a) |

- El callback de cierre **no** trae `IdSesionSence` (ver 5c/5d): ubica el registro por
  `IdSesionAlumno` y marca la hora de cierre.
- Error específico nuevo (v1.1.5+): **313** "URL de Cierre de sesión Incorrecta."
- **Duración de sesión:** el manual v1.1.6 **no fija** ni las 3 horas máximas de sesión ni
  los 60 minutos de inactividad; solo *recomienda* (§2 Paso 3) cronómetro en pantalla y
  alerta a 10 minutos del término del "tiempo de ejecución asignado al curso", sin
  cuantificarlo. Los límites operativos "máx. 3 h de sesión / 60 min de inactividad" que
  usa este proyecto provienen de práctica heredada del plugin y de instructivos
  complementarios SENCE/SIC (p. ej. *Instructivo técnico de integración entre LMS y SIC*),
  **no** de este manual — citarlos a su fuente real donde se implementen.

## 7. Tabla de códigos de error (`GlosaError`) — Anexo 2, v1.1.6

Glosas **VERBATIM** del manual v1.1.6 (no corregir ortografía ni puntuación al copiarlas a
`errors.ts`). Nunca mostrar códigos crudos al alumno: traducir siempre.

| Código | Glosa oficial (verbatim v1.1.6) |
|---|---|
| 200 | El POST tiene uno o más parámetros mandatorios sin información. Esto también ocurre cuando un parámetro está mal escrito (por ejemplo, RutAlumno en lugar de RunAlumno), o cuando se ingresan sólo espacios en blanco en un parámetro obligatorio. |
| 201 | La URL de Retoma y/o URL de Error no tienen información. Ambos parámetros son obligatorios en todos los POST. |
| 202 | La URL de Retoma tiene formato incorrecto. |
| 203 | La URL de Error tiene formato incorrecto. |
| 204 | El Código SENCE tiene menos de 10 caracteres y/o no es código válido. |
| 205 | El Código Curso tiene menos de 7 caracteres y/o no es código válido. |
| 206 | La línea de capacitación es incorrecta. |
| 207 | El Run Alumno tiene formato incorrecto, o tiene el dígito verificador incorrecto. |
| 208 | El Run Alumno no está autorizado para realizar el curso. |
| 209 | El Rut OTEC tiene formato incorrecto, o tiene el dígito verificador incorrecto. |
| 211 | El Token no pertenece al OTEC. |
| 212 | El Token no está vigente. |
| 300 | Error interno no clasificado, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles. |
| 301 | No se pudo registrar el ingreso o cierre de sesión. Esto ocurre cuando la Línea de Capacitación es incorrecta, o el Código de Curso es incorrecto. |
| 302 | No se pudo validar la información del Organismo, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles. |
| 303 | El Token no existe, o su formato es incorrecto. |
| 304 | No se pudieron verificar los datos enviados, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles (ej. enviar parámetros de inicio o cierre de sesión según corresponda) |
| 305 | No se pudo registrar la información, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles. (ej. enviar parámetros de inicio o cierre de sesión según corresponda) |
| 306 | El Código Curso no corresponde al código SENCE. |
| 307 | El Código Curso no tiene modalidad E-learning. |
| 308 | El Código Curso no corresponde al RUT OTEC |
| 309 | Las fechas de ejecución comunicadas para el Código Curso no corresponden a la fecha actual. |
| 310 | El Código Curso está en estado Terminado o Anulado. |
| 311 | Run ingresado en el Login de Clave Única no corresponde con Run alumno informado por el ejecutor. |
| 312 | No se pudo completar la autenticación con Clave Única. |
| 313 | URL de Cierre de sesión Incorrecta. |

Notas de la tabla:

- Los puntos finales ausentes (304, 308) y las mayúsculas irregulares (313 "Incorrecta")
  son **del original** — se preservan por fidelidad verbatim.
- **Códigos ELIMINADOS respecto de v1.1.3** (retirar de `errors.ts` si venían de la spec
  antigua): **100** ("Contraseña incorrecta o el usuario no tiene Clave SENCE.") y **210**
  ("Expiró el tiempo disponible para el ingreso de RUT y Contraseña. El tiempo disponible
  es de tres minutos."). Ambos eran del flujo con Clave SENCE del alumno, obsoleto desde
  v1.1.5; la tabla vigente salta de 209 a 211.
- **Códigos NUEVOS respecto de v1.1.3:** 311, 312, 313 (agregados en v1.1.5, sin cambios
  en v1.1.6). Entre v1.1.5 y v1.1.6 solo hubo cambios de redacción (304, 305, 306, 309).
- El manual declara `GlosaError` tipo "Entero", sin largo, en singular. La multiplicidad
  con `;` es extra-manual: ver §5.2 (parsing defensivo).
- Texto normativo acompañante (§3.2/§3.3): "Es importante que la plataforma OTEC interprete
  el error informado por la plataforma SENCE, y muestre un mensaje adecuado al participante,
  para que le permita realizar las acciones correspondientes."

## 8. Modelo de datos sugerido (equivalente a `block_sence`)

```
asistencia_sence(
  id, plataforma_usuario_id, curso_id, creado_en,
  cod_sence,            -- código SENCE del curso (NULL/vacío en línea 1); máx 10
  codigo_accion,        -- idAcción del alumno (param CodigoCurso); máx 50
  id_sesion_alumno,     -- el que tú generaste; máx 149; único por apertura
  id_sesion_sence,      -- el que devolvió SENCE; máx 149; NULL hasta callback de inicio
  run_alumno,           -- formato xxxxxxxx-x; máx 10
  fecha_hora,           -- del callback, "aaaa-mm-dd hh:mm:ss" (Texto 19)
  zona_horaria,         -- Texto 100; nullable (ver §5.2)
  linea_capacitacion,   -- 1 | 3 | 6
  estado,               -- en_transito | abierta | cerrada | error | expirada_local
  cierre_sesion         -- timestamp de cierre (nullable)
)
```

Cambios respecto del modelo de la spec v1.1.3: se agrega `estado` porque el abandono del
login de Clave Única no genera callback (§1) — la fila creada al despachar el POST puede
quedar huérfana y debe poder expirarse localmente. `IdSesionAlumno` debe ser único por
apertura y recuperable sin depender de la sesión web del navegador (el plugin usaba el
sesskey de Moodle: funciona, pero acopla la correlación a la sesión del navegador).

## 9. Casos borde / reglas

- **Formato RUN/RUT (normativo):** sin puntos, con guion y DV, formato `xxxxxxxx-x`
  (`RutOtec` y `RunAlumno`, ambos Texto 10). Errores: 207 (formato/DV RUN), 208 (RUN no
  autorizado), 209 (formato/DV RUT OTEC). Nuevo cruce v1.1.5+: **311** — el RUN tecleado en
  Clave Única debe coincidir con el `RunAlumno` que informó el ejecutor. Validar el DV
  localmente ANTES de despachar el POST. (DV `k`: el manual no fija mayúscula/minúscula;
  normalizar a un solo casing al persistir y comparar case-insensitive.)
- **Nombres de parámetros exactos:** el error 200 se dispara también por un parámetro
  **mal escrito** (ej. del manual: `RutAlumno` en vez de `RunAlumno`). Los nombres son
  case-sensitive en la práctica: usar exactamente los de §4/§6.
- **Código de acción por alumno:** es dato de la inscripción (en Moodle heredado vivía en
  el nombre de grupo `SENCE-<idAcción>`; en plataforma propia, campo dedicado y validado).
- **Becarios / exentos:** alumnos sin franquicia/beca no pasan por SENCE (regla operativa
  de la plataforma, no del protocolo).
- **Asistencia obligatoria (candado):** si se bloquea contenido hasta registrar asistencia,
  imponer el gate **en servidor** (el candado JS del plugin heredado era solo frontend).
- **Línea 1 (Programas Sociales):** `CodSence` VACÍO; `CodigoCurso` formato SIC
  (`RLAB-19-02-08-0071-1`, `BOTIC-SOFOF-19-12-13-0046`). En `rcetest`, el `-1` va solo en
  `CodigoCurso` (§3.1).
- **Línea 6 (FPT):** exenta del mínimo de 7 caracteres en `CodigoCurso` (§4.2).
- **URLs por tenant:** `UrlRetoma`/`UrlError` ≤ **100 caracteres** — subdominios + ruta +
  query deben caber; verificar largo al construirlas por tenant (error 202/203 si el
  formato es incorrecto, 201 si faltan).
- **Sesión en tránsito:** timeout local obligatorio para aperturas sin callback (§1).
- **Inmutabilidad:** lo registrado en `rce` productivo "no podrá ser eliminada" (§5) —
  coherente con `sence_events` INSERT-only de este proyecto.
- **Seguridad del Token:** viaja en el form que el navegador postea a SENCE (visible en el
  DOM); guardarlo cifrado server-side, no loguearlo, no exponerlo en ninguna otra
  respuesta (§2.1).

## 10. Fuentes

- **Normativa (fuente de verdad):** *Manual Técnico "Integración Registro Asistencia
  SENCE" v1.1.6* (sence.gob.cl, `integracion_registro_asistencia_sence_v1.1.6.pdf`,
  SHA256 `e9435a9e9b95985b81e5ecc9696e42a1c7d7521c838b2217999f05636f8eac4c`).
  Anexos relevantes: 1 (URLs), 2 (tabla de errores), 3 (ejemplos ASP), 4 (Franquicia
  Tributaria), 5 (Programas Sociales — presente en el cuerpo aunque el índice del PDF lo
  omita, errata del documento).
- **Comparación histórica:** manuales v1.1.3 y v1.1.5 (mismo sitio) — diffs incorporados
  en §§4.2, 6, 7 y en la regla de abandono (§1).
- **Comportamiento en producción (solo parsing defensivo, §5.2):** plugin
  `github.com/fauzcategui/moodle-sence` (AGPLv3, `engine.php`) v3.2 en Moodle 4.3.6, y su
  análisis en `block_sence/ANALISIS_PLUGIN_SENCE.md`.
- **Documento reemplazado:** `integracion-sence-portable/SPEC_INTEGRACION_SENCE.md`
  (basado en manual v1.1.3) — obsoleto; ante conflicto rige este documento.
- Cualquier cambio al contrato SENCE exige diff contra el manual oficial vigente +
  checklist en `rcetest` antes del release (regla dura del proyecto).
