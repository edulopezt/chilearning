# RUNBOOK — Sesión de certificación `rcetest` en STAGING (supervisada)

> **⛔ ESTADO 2026-07-15 — CERT PARQUEADA. LEE ESTO ANTES DE SEGUIR EL RUNBOOK.**
> Se intentó la certificación end-to-end (token + RUN reales) y **falló por el lado de SENCE**,
> no por el código. Hallazgo: **el `rcetest` de SENCE todavía sirve el login viejo de _Clave
> SENCE_** (RUT + Contraseña → error **210**), un flujo que SENCE **deprecó e inactivó** (la
> recuperación de Clave SENCE está fuera de servicio; Clave Única es obligatoria desde 08/2019).
> Es decir, su ambiente de pruebas corre una versión más vieja que su propia normativa.
> **Por lo tanto este runbook está DESACTUALIZADO en un punto clave: NO es Clave Única en
> rcetest, es Clave SENCE** (donde dice "Clave Única" en los pasos §1/§3, léelo como el login de
> SENCE que rcetest sirva). Nuestra integración quedó **probada correcta** (SENCE aceptó la
> petición y el motor manejó el callback). Edu **decidió no contactar a SENCE** ni forzar
> producción → validación diferida al **primer curso real en producción**. Detalle: memoria
> `rcetest-clave-sence-bloqueo` y `specs/ESTADO-PROYECTO.md` (§Bloqueos). Retomar solo si Edu lo pide.

> **⚠ SESIÓN SUPERVISADA. SOLO CON EDU PRESENTE (regla P3).**
> Esta sesión usa el **token REAL del OTEC** y el ambiente `rcetest` de SENCE. Claude la
> **prepara**; **no la ejecuta solo**. El token real **jamás** se pega en el repo, en el chat,
> en logs ni en fixtures: se ingresa por la UI (`/admin/sence`) y se guarda cifrado
> (AES-256-GCM, I-6). Este documento es la guía definitiva; reemplaza al
> `CHECKLIST-CERTIFICACION-RCETEST.md` (que queda como referencia histórica de la tarea 0.9).

**Objetivo.** Registrar una asistencia real de prueba en `rcetest` de punta a punta y verla
reflejada con un `IdSesionSence` real, con su evento `start_ok` en `sence_events`, y cerrar la
sesión. Es el gate que valida el motor (tarea 0.7) contra el SENCE real, no solo contra el mock.

**Entorno de la sesión (todo ya desplegado y verificado):**

| Recurso | Valor |
|---|---|
| App staging | `https://otec-andes.chilearning.cl` (login OK) |
| Tenant | OTEC Demo Andes — `11111111-1111-4111-8111-111111111111` |
| Backend | Supabase Cloud, ref `nnrlvprndsxcnyljccso` |
| Coolify | VPS clawbot `216.185.51.57:8000`, app uuid `jrhorroii4zlcjdkafdv0l75` |
| `SENCE_ENV` ahora | `mock` (lo cambiaremos a `test` para la sesión) |
| URL de callback | `https://otec-andes.chilearning.cl/api/sence/cb/<nonce>` (≤100 chars, OK) |

**IDs del demo (fijos en el seed — NO cambiarlos):**

| Recurso | ID | Dato ficticio de fábrica |
|---|---|---|
| Curso demo | `c0000000-0000-4000-8000-000000000001` | `cod_sence = '1234567890'` |
| Acción demo | `ac000000-0000-4000-8000-000000000001` | `codigo_accion='ACC-DEMO-0001'`, línea 3, `environment='rcetest'` |
| Inscripción demo | `e0000000-0000-4000-8000-000000000001` | `run = '5126663-3'` (ficticio) |
| Alumno demo (login) | user `aaaaaaaa-0000-4000-8000-000000000005` | `alumno@otec-andes.test` |
| Admin OTEC (panel) | user `aaaaaaaa-0000-4000-8000-000000000001` | `admin@otec-andes.test` |

---

## 0. Por qué no basta con “poner `SENCE_ENV=test`” (lee esto antes de empezar)

El motor resuelve **bien** las URLs reales cuando `SENCE_ENV≠mock`: con `SENCE_ENV=test` y la
acción en `environment='rcetest'` pega a `https://sistemas.sence.cl/rcetest/Registro/IniciarSesion`.
Eso ya está correcto y no hay que tocar código. Pero el demo viene sembrado con **datos
ficticios** que, sin corregir, **queman la sesión**. Las tres cosas que hay que arreglar sí o sí:

1. **Códigos SENCE ficticios de la acción** (`1234567890` / `ACC-DEMO-0001`) → `IniciarSesion`
   responderá 204/205/306/307/308/309/310. **Solución:** wildcard `-1` (Opción B) o los códigos
   de una acción real de prueba en rcetest (Opción A). Ver Paso 2.4.
2. **RUN / RUT / token ficticios** → 311 / 211 / 303 / 500. **Solución:** cargar el RUT+token
   reales por `/admin/sence` (Paso 2.3) y poner el RUN de Clave Única de Edu en la inscripción
   (Paso 2.5).
3. **No hay worker que expire sesiones** (T4/T6/T9 no tienen quién los dispare en staging). Si
   Edu abandona Clave Única, la sesión queda colgada en `iniciada_pendiente` y el índice único
   parcial hace **500** en el siguiente intento. **Solución:** tener a mano el SQL de
   “desbrickeo” (Paso 4.4) para reintentar.

Regla de oro de seguridad del ambiente: lo único que decide **rcetest vs producción** es
`action.environment`. `SENCE_ENV=test` y `SENCE_ENV=prod` se comportan **idéntico** (ambos usan
las URLs reales). **JAMÁS** poner `action.environment='rce'` en esta sesión: con las URLs reales,
`rce` pega a **PRODUCCIÓN** y las asistencias son **irreversibles** (manual §5).

---

## 1. Precondiciones — lo que Edu debe tener listo ANTES de empezar

Marca cada casillero. Si falta uno, **no arranques**: reagenda.

- [ ] **Token del OTEC** generado/confirmado en `https://sistemas.sence.cl/rts`. Debe ser un
      **GUID de exactamente 36 caracteres** (32 hex + 4 guiones, ej. `3f2504e0-4f89-41d3-9a0c-0305e82c3301`).
      El panel rechaza cualquier cosa que no mida 36 (`invalid_token`). Si `/rts` lo entrega sin
      guiones (32) o con otro formato → es un tema de contrato, avisar a Edu, **no** bajar la
      validación por tu cuenta. *(Verificar el formato a primera hora — riesgo del sprint.)*
- [ ] **RUT del OTEC** con dígito verificador, **normalizado**: sin puntos, con guion, `k`
      minúscula (ej. `76543210-k`). Debe ser el RUT al que pertenece el token (si no calzan → 211).
- [ ] **Elegir el camino de códigos** (uno de los dos):
      - **Opción A (recomendada si existe):** una **acción de prueba real en `rcetest`** con su
        `CodSence` (curso, 10 dígitos), su `CodigoCurso` (acción), su **línea** (1/3/6) y **fechas
        vigentes** que cubran hoy. Permite probar el flujo real, incluido 208 (RUN autorizado).
      - **Opción B (fallback):** **wildcard `-1`**, que en `rcetest` deshabilita la validación de
        códigos (manual §4/Anexo 5, I-8). No requiere provisionar una acción. Es el camino más
        seguro para conseguir el “verde”.
- [ ] **RUN de Clave Única de Edu** (o uno autorizado) normalizado (sin puntos, `k` minúscula,
      ej. `12345678-9`). En Opción A, ese RUN debe estar **autorizado/inscrito en la acción** ante
      SENCE (si no → 208). En Opción B basta con que sea el RUN con que Edu hará el login.
- [ ] **Clave Única vigente** de ese RUN (probarla en `claveunica.gob.cl` si hay dudas).
- [ ] **Credenciales del alumno demo** (`alumno@otec-andes.test`) y del **admin OTEC**
      (`admin@otec-andes.test`) para loguearse en staging. *(Edu las tiene.)*
- [ ] **Acceso al SQL del Supabase cloud** (ref `nnrlvprndsxcnyljccso`) — SQL Editor del proyecto
      o `psql` — para correr las verificaciones y el desbrickeo.
- [ ] **Acceso a Coolify** (`216.185.51.57:8000`) para cambiar la env var y redeployar.
- [ ] **`SENCE_TOKEN_ENCRYPTION_KEY`** ya seteada en Coolify (base64 de 32 bytes o 64 hex).
      **No** la vas a tocar; solo confirma que existe y es estable.

### Planilla de la sesión (llénala a mano; el token NO se anota aquí)

| Dato | Valor | Origen |
|---|---|---|
| `RutOtec` (normalizado) | `__________` | Edu |
| Token OTEC (36 chars) | *(se ingresa cifrado en la UI; NO se anota)* | `/rts` |
| Camino de códigos | Opción A ▢ / Opción B (`-1`) ▢ | decisión |
| `CodSence` (curso) | `__________` o `-1` | acción rcetest |
| `CodigoCurso` (acción) | `__________` o `-1` | acción rcetest |
| `LineaCapacitacion` | `1` / `3` / `6` | acción |
| `RunAlumno` (= Clave Única de Edu) | `__________` | Edu |
| URL de callback esperada | `https://otec-andes.chilearning.cl/api/sence/cb/<nonce>` | staging |

---

## 2. Puesta en modo `rcetest` — pasos exactos (respeta el ORDEN)

El orden importa por la clave de cifrado: el token se carga **después** del redeploy para que
se cifre con la clave definitiva del contenedor.

### 2.1 — Cambiar `SENCE_ENV=test` en Coolify + redeploy

1. Entra a Coolify (`http://216.185.51.57:8000`) → aplicación `jrhorroii4zlcjdkafdv0l75`
   (Chilearning staging) → pestaña **Environment Variables**.
2. Cambia `SENCE_ENV` de `mock` a **`test`**. Escríbelo **exactamente** `test`, en minúsculas,
   **sin espacios** delante ni detrás.
   > ⚠ Cualquier valor distinto de `mock` que NO sea `test`/`prod` (un typo, o un espacio final
   > como `"mock "`) hace que el motor deje de usar el mock y **pegue a SENCE REAL** igual. Y si
   > lo dejas en `test` pero con la acción en `rce`, pega a producción. Verifica bien.
3. **Redeploy** (Deploy). Basta el restart del redeploy; la var se lee en runtime.
4. Confirma que la app volvió a levantar: abre `https://otec-andes.chilearning.cl` y verifica que
   el login sigue funcionando.

### 2.2 — Confirmar la clave de cifrado (no tocar)

- [ ] Verifica en Coolify que `SENCE_TOKEN_ENCRYPTION_KEY` está seteada. **No la cambies** durante
      toda la sesión: si la rotas con un token ya guardado, el próximo `start` da **500**
      (`TokenCryptoError`).

### 2.3 — Cargar el RUT + token REALES del OTEC por la UI (después del redeploy)

1. Loguéate en staging como **admin OTEC** (`admin@otec-andes.test`).
2. Ve a `https://otec-andes.chilearning.cl/admin/sence`.
3. Ingresa el **RUT del OTEC** (normalizado) y el **token de 36 chars**. Guarda.
   - El panel valida el largo exacto (36) y guarda RUT + token **juntos**, cifrando el token
     (AES-256-GCM, formato en reposo `v1.<iv>.<tag>.<ct>`).
   - Si el panel rechaza el token (`invalid_token`) → revisa el largo (debe ser 36). No sigas
     hasta que guarde OK.
4. **Verifica que el token quedó cifrado** (nunca en claro): corre en el SQL cloud
   ```sql
   select tenant_id, rut_otec,
          left(token_encrypted, 3) as prefijo,   -- debe empezar en 'v1.'
          length(token_encrypted) as largo
   from public.sence_otec_config
   where tenant_id = '11111111-1111-4111-8111-111111111111';
   -- OK = rut_otec el real, prefijo 'v1.' (cifrado), largo > 36. Nunca el token en claro.
   ```

### 2.4 — Fijar los códigos de la acción demo

**Opción B — wildcard `-1` (recomendada, camino más seguro):** en el SQL cloud
```sql
update public.courses
   set cod_sence = '-1'
 where id = 'c0000000-0000-4000-8000-000000000001';

update public.actions
   set codigo_accion = '-1',
       environment    = 'rcetest'          -- confirmar rcetest; JAMÁS 'rce'
 where id = 'ac000000-0000-4000-8000-000000000001';
```

**Opción A — acción real de prueba en rcetest:** reemplaza por los códigos reales y ajusta la
línea si no es 3. *(Si la acción real es LÍNEA 1, `cod_sence` va VACÍO — usa `NULL` — y
`codigo_accion` lleva el formato SIC. Con `-1` no aplica esta salvedad.)*
```sql
update public.courses
   set cod_sence = '<COD_SENCE_REAL_10_DIGITOS>'   -- o NULL si es línea 1
 where id = 'c0000000-0000-4000-8000-000000000001';

update public.actions
   set codigo_accion = '<CODIGO_ACCION_REAL>',
       training_line = <1|3|6>,
       environment    = 'rcetest',
       starts_on = '<AAAA-MM-DD>', ends_on = '<AAAA-MM-DD>'   -- vigentes (cubran hoy)
 where id = 'ac000000-0000-4000-8000-000000000001';
```

### 2.5 — Fijar el RUN del alumno = el RUN de Clave Única de Edu

```sql
update public.enrollments
   set run = '<RUN_REAL_DE_EDU>'    -- normalizado, ej. 12345678-9 (k minúscula si aplica)
 where id = 'e0000000-0000-4000-8000-000000000001';
```
> El RUN con que Edu autentica en Clave Única DEBE coincidir con este `run`. Si no coinciden → 311.

### 2.6 — Pre-check del callback SIN gastar un intento con SENCE (importante)

Esto confirma que la URL de retorno sale bien **sin** pegarle todavía a SENCE, evitando quemar
un intento por una URL mal formada.

1. Loguéate como el **alumno demo** (`alumno@otec-andes.test`).
2. Entra a `/mi-curso` (curso demo con candado SENCE) y pulsa **“Registrar asistencia”**.
3. En la página de redirección haz **Ver código fuente** (o inspecciona el `<form>`).
4. Confirma que los inputs ocultos `UrlRetoma` y `UrlError` son **exactamente**
   `https://otec-andes.chilearning.cl/api/sence/cb/<nonce>` — con **`https://`**, host público, y
   ≤100 caracteres.
   - Si sale `http://` (sin `s`) o un host interno → SENCE responderá 202/203 o el callback nunca
     llega. Antes de seguir, asegúrate en Coolify/Traefik de que reenvía `Host` + `X-Forwarded-Proto=https`.
     *(El `Host` casi seguro está bien porque el login funciona en el host público; el sospechoso
     es el `proto` http vs https.)*
   - Puedes hacer este pre-check incluso con `SENCE_ENV` aún en `mock` (no dispara SENCE real).
   - **No completes** el submit del pre-check hasta tener todo lo demás listo. Si ya creó una
     sesión `iniciada_pendiente`, ver el desbrickeo (Paso 4.4) antes del intento real.

No hay que tocar nada más en el código. `resolveEndpoint(action.environment, …)` ya produce
`https://sistemas.sence.cl/rcetest/Registro/IniciarSesion` con `SENCE_ENV=test` + `environment='rcetest'`.

---

## 3. Ejecución del flujo (con Edu presente)

1. Loguéate en staging como el **alumno demo** (`alumno@otec-andes.test`).
2. Abre el curso demo en `/mi-curso`. El contenido debe estar **bloqueado** (candado SENCE, I-12),
   con el botón **“Registrar asistencia”** visible.
3. Pulsa **“Registrar asistencia”**.
   - El motor crea la sesión en `iniciada_pendiente` (T1), genera `id_sesion_alumno` único y
     arma el form POST auto-submit hacia `.../rcetest/Registro/IniciarSesion`.
   - Si aquí sale **500 crudo**, NO es Clave Única: es (a) token no configurado, (b) mismatch de
     clave de cifrado, o (c) una sesión previa colgada (índice único). Ver Paso 5 y el desbrickeo 4.4.
4. El navegador redirige a **Clave Única REAL**. Edu autentica con **su** RUN + Clave Única.
   *(El RUN debe ser el mismo del Paso 2.5, o 311.)*
5. Al volver, SENCE postea el callback de **inicio exitoso** a
   `https://otec-andes.chilearning.cl/api/sence/cb/<nonce>`:
   - La sesión pasa a **`iniciada`** (T2), se persiste `id_sesion_sence`, `opened_at` y
     `expires_at` (= `opened_at` + 3 h, I-13).
   - Se inserta un evento `start_ok` en `sence_events` (`late = false`).
6. Verifica en la UI que el **candado se liberó** (el contenido del curso ya se sirve) y aparece
   el estado de sesión activa.
7. **Cierre:** pulsa **“Cerrar sesión”** → POST a `.../rcetest/Registro/CerrarSesion` con el
   `IdSesionSence` → callback de cierre exitoso (sin `GlosaError` y sin `IdSesionSence`) → sesión
   **`cerrada`** (T5), evento `close_ok`.

---

## 4. Verificación del éxito — SQL exacto (Supabase cloud, ref `nnrlvprndsxcnyljccso`)

### 4.1 — La sesión y el `IdSesionSence` real
```sql
select id, status, environment, id_sesion_alumno, id_sesion_sence,
       opened_at, expires_at, closed_at, error_codes, callback_nonce, created_at
from public.sence_sessions
where enrollment_id = 'e0000000-0000-4000-8000-000000000001'
order by created_at desc
limit 5;
```
- **Inicio OK** = fila con `status='iniciada'` y `id_sesion_sence` **NOT NULL**.
- **Cierre OK** = esa fila luego en `status='cerrada'` con `closed_at` poblado.
- `status='iniciada_pendiente'` = SENCE aún no volvió (Clave Única en curso o abandonada).
- `status='error'` = llegó un `GlosaError` (mira `error_codes` y el Paso 5).

### 4.2 — La bitácora de eventos (evidencia I-1)
```sql
select e.received_at, e.kind, e.late, e.error_codes, e.glosa_error_raw, e.payload
from public.sence_events e
left join public.sence_sessions s on s.id = e.session_id
where s.enrollment_id = 'e0000000-0000-4000-8000-000000000001'
   or e.session_id is null           -- incluye 'unmatched' recientes (nonce malo / ruta sin nonce)
order by e.received_at desc
limit 20;
```
- **Éxito de inicio** = evento `kind='start_ok'`, `late=false`.
- **Éxito de cierre** = evento `kind='close_ok'`.
- `kind='start_error'` / `close_error` = hubo `GlosaError` (códigos en `error_codes`).
- `kind='unmatched'` = llegó un callback que no correlacionó (nonce equivocado, o ruta sin nonce).

### 4.3 — El token NUNCA aparece en el payload (I-7) — debe dar **0 filas**
```sql
select id from public.sence_events
where payload ? 'Token' or payload ? 'token';
```

### 4.4 — Desbrickeo entre intentos (libera el índice único parcial)
Si un intento quedó colgado (`iniciada_pendiente` por abandono de Clave Única, o `iniciada` sin
cierre) y el siguiente “Registrar asistencia” da **500** por el índice único
`sence_sessions_one_open_per_enrollment`:
```sql
update public.sence_sessions
   set status = 'expirada'
 where enrollment_id = 'e0000000-0000-4000-8000-000000000001'
   and status in ('iniciada_pendiente', 'iniciada');
-- Esto deja el enrollment listo para reintentar. NUNCA borres sence_events (INSERT-only, I-2).
```
> No uses `DELETE` en `sence_sessions`: el FK `sence_events.session_id … on delete restrict` lo
> bloquea y `service_role` no tiene grant de delete. Un `status='error'` que venga de un error de
> INICIO (T3) **no** brickea (no entra en el índice parcial): puedes reintentar directo.

### Criterio de éxito del gate
Asistencia visible con **`id_sesion_sence` real de `rcetest`** + evento **`start_ok`** en
`sence_events`, y cierre registrado (**`cerrada`** + **`close_ok`**). Token siempre cifrado (4.0)
y nunca filtrado (4.3).

---

## 5. Qué hacer ante cada familia de errores

Cuando la sesión cae en `error`, mira `error_codes` (4.1) o `glosa_error_raw` (4.2). `GlosaError`
puede traer **varios códigos separados por `;`** (ej. `211;204`) — trátalos todos. La traducción
al alumno y la acción por código está en la **tabla del contrato §5** (`src/modules/sence/README.md`,
fuente única de `errors.ts`). Al alumno **nunca** se le muestra el código crudo (I-9).

### Config / integración — 200, 201, 202, 203, 204, 205, 206, 209, 301, 306–310
- **202 / 203** (URL de Retoma/Error con formato incorrecto): callback mal armado. Vuelve al
  **pre-check 2.6** (¿`https://`? ¿≤100 chars? ¿host público?). Es lo más probable si algo del
  proxy cambió.
- **204** (CodSence <10 o inválido) / **205** (CodigoCurso <7 o inválido): códigos de la acción.
  Cámbiate a **wildcard `-1`** (2.4 Opción B) o corrige a los códigos reales.
- **206** (línea incorrecta) / **301** (línea o código de curso incorrecto): revisa
  `training_line ∈ {1,3,6}` y el par curso/acción.
- **306** (CodigoCurso no corresponde al código SENCE): sospecha **inversión del quirk I-10**
  (`CodSence` = curso; `CodigoCurso` = acción — no los inviertas).
- **307** (no es e-learning) / **308** (no corresponde al RUT OTEC) / **309** (fuera de fechas) /
  **310** (terminado/anulado): problema de la **acción real** ante SENCE. Con **`-1`** estos no
  deberían salir; si estás en Opción A, la acción de prueba no está bien comunicada → pásate a `-1`
  para conseguir el verde y anota el hallazgo.
- **200 / 201 / 209** (parámetros mandatorios / URLs vacías / RUT OTEC formato): bug propio o RUT
  mal cargado. Revisa 2.3 (RUT normalizado) y que el token quedó guardado.

### Token — 211, 212, 303
- **211** (el token no pertenece al OTEC): el token no corresponde al **RUT** cargado. Reingresa
  el par RUT+token correcto en `/admin/sence` (2.3).
- **212** (token no vigente): **regenera** el token en `https://sistemas.sence.cl/rts` y vuelve a
  cargarlo (2.3). No cambies la clave de cifrado.
- **303** (token no existe / formato incorrecto): revisa que el token sea de **36 chars** y que se
  guardó bien. Si guardó OK pero da 303, sospecha mismatch de la clave de cifrado (¿alguien tocó
  `SENCE_TOKEN_ENCRYPTION_KEY`?) → NO la cambies; recarga el token (2.3) para recifrar.

### RUN del alumno — 207, 208
- **207** (RUN formato/DV incorrecto): no debería pasar (el pre-vuelo I-8 lo filtra). Revisa el
  `run` de la inscripción (2.5): sin puntos, DV correcto, `k` minúscula.
- **208** (RUN no autorizado para el curso): el RUN no está inscrito ante SENCE **en esa acción**.
  Solo aplica en **Opción A** (acción real): pide inscribir el RUN, o cámbiate a **`-1`** (Opción B),
  donde no se valida autorización.

### Clave Única — 311, 312
- **311** (el RUN del login de Clave Única ≠ el RunAlumno informado): Edu autenticó con un RUN
  distinto al de la inscripción. Ajusta el `run` de la inscripción (2.5) al RUN de Clave Única de
  Edu, o que Edu ingrese con la Clave Única de ESE RUN. **Reintento inmediato** (nueva sesión).
- **312** (no se pudo completar la autenticación con Clave Única): fallo de Clave Única. **Reintento
  inmediato**; si persiste, revisar la Clave Única en `claveunica.gob.cl`.

> Para 311/312 y otros que permiten reintento: si la sesión quedó colgada, corre el desbrickeo
> (4.4) antes de volver a pulsar “Registrar asistencia”.

### `rcetest` caído / no responde
No “probar en producción” **jamás**. Si `rcetest` no responde: vuelve a `mock` (Paso 6) y reagenda
la sesión con Edu (riesgo del sprint contemplado).

---

## 6. Rollback — volver a `mock` al terminar

1. Coolify → `SENCE_ENV=mock` → **redeploy**. El motor vuelve a apuntar al mock local.
   > Nota: en staging el mock (`127.0.0.1:4010`) no corre, así que el botón “Registrar asistencia”
   > quedará no-funcional. Es el **estado esperado** del staging pre-piloto.
2. Limpieza opcional del estado de la cert (deja el demo prolijo):
   ```sql
   -- Cierra cualquier sesión abierta que haya quedado colgada:
   update public.sence_sessions set status = 'expirada'
    where enrollment_id = 'e0000000-0000-4000-8000-000000000001'
      and status in ('iniciada_pendiente', 'iniciada');

   -- (Opcional) retira el token real del reposo:
   update public.sence_otec_config set token_encrypted = null
    where tenant_id = '11111111-1111-4111-8111-111111111111';

   -- Revierte los datos demo a ficticios si usaste wildcard o el RUN real:
   update public.courses     set cod_sence     = '1234567890'
    where id = 'c0000000-0000-4000-8000-000000000001';
   update public.actions     set codigo_accion = 'ACC-DEMO-0001', training_line = 3, environment = 'rcetest'
    where id = 'ac000000-0000-4000-8000-000000000001';
   update public.enrollments set run           = '5126663-3'
    where id = 'e0000000-0000-4000-8000-000000000001';
   ```

### Qué NO tocar (romperías cosas)
- **`SENCE_TOKEN_ENCRYPTION_KEY`**: cambiarla deja el token guardado indescifrable → 500 en el
  próximo `start`.
- **`action.environment`**: **jamás** `rce` en esta sesión → con URLs reales pega a PRODUCCIÓN
  (asistencias irreversibles, manual §5). Mantener `rcetest`.
- **`sence_events`**: INSERT-only por diseño (I-2). No editar ni borrar.
- **Los IDs del seed** (tenant/course/action/enrollment/user): el flujo del demo depende de ellos.
- **`SENCE_ENV`**: escribirlo exactamente `mock`/`test`/`prod`, sin espacios.

---

## 7. Recordatorio final (P3 — innegociable)

- Esta sesión se ejecuta **SOLO con Edu presente**. Claude prepara; no dispara nada contra
  `sistemas.sence.cl` por su cuenta.
- El **token real** del OTEC **jamás** va al chat, a un commit, a un log, a un fixture ni a una
  captura. Solo se ingresa por `/admin/sence` (queda cifrado, I-6) y solo viaja al form POST hacia
  SENCE (I-7).
- El **RUN de Edu** es dato personal (Ley 21.719): no lo pegues en logs ni fixtures; vive solo en
  la inscripción demo mientras dure la sesión y se puede revertir en el rollback.
- Al cerrar: dejar `SENCE_ENV=mock`, verificar 4.3 (token no filtrado) y anotar el resultado del
  gate en `specs/03-tareas.md` (tarea 0.9) y, si tocaste algo del contrato, en
  `docs/sence/CHANGELOG.md`.
