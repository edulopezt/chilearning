# Checklist de certificación en `rcetest` (tarea 0.9)

> **⚠ SESIÓN SUPERVISADA CON EDU.** Esta certificación usa el **token real del OTEC** y el
> ambiente `rcetest` de SENCE. Claude la **prepara** (este checklist, los datos, las pantallas)
> pero **jamás la ejecuta solo** (INSTRUCCIONES-AGENTE §3, P3). Requiere a Edu presente.
> El token real **nunca** se pega en el repo, en logs ni en fixtures: se ingresa por la UI de
> admin del tenant y se guarda cifrado (AES-256-GCM, I-6).

## Objetivo

Registrar una asistencia real de prueba en `rcetest` de punta a punta y verla reflejada con un
`IdSesionSence` real, con su evento en la bitácora (`sence_events`). Es el gate que valida el
motor (0.7) contra el SENCE real, no solo contra el mock.

## Requisitos previos (Edu los provee/confirma en la sesión)

- [ ] Acceso a `https://sistemas.sence.cl/rts` para **generar/confirmar el token** del OTEC
      (riesgo del sprint: verificarlo a primera hora).
- [ ] RUT del OTEC con dígito verificador.
- [ ] Una **acción de capacitación de prueba** en `rcetest` con su `CodSence` (curso) y
      `CodigoCurso` (acción), o bien usar el **wildcard `-1`** que en `rcetest` desactiva la
      validación de códigos (contrato I-8/I-11; útil si no hay una acción vigente).
- [ ] El **RUN propio de Edu** (o uno autorizado) para el login de Clave Única.
- [ ] Clave Única vigente del RUN de prueba.
- [ ] Motor 0.7 desplegado en un entorno con **callback público accesible** desde SENCE
      (staging, o un túnel tipo ngrok/cloudflared apuntando a `/api/sence/cb`). La URL de
      callback debe caber en **≤100 caracteres** (I-8).

## Datos a tener a mano (planilla de la sesión)

| Dato | Valor | Origen |
|---|---|---|
| `RutOtec` | `________-_` | Edu |
| Token OTEC | *(se ingresa cifrado en la UI; no se anota aquí)* | `/rts` |
| `LineaCapacitacion` | `___` (1 / 3 / 6) | de la acción |
| `CodSence` (curso) | `__________` o `-1` | acción rcetest |
| `CodigoCurso` (acción) | `__________` o `-1` | acción rcetest |
| `RunAlumno` | `________-_` | Edu |
| URL de callback | `https://____.____/api/sence/cb` (≤100) | staging/túnel |

## Pasos

1. [ ] Confirmar `SENCE_ENV=test` para la acción (jamás `prod` en esta sesión) — configurable
       **por acción**, nunca hardcodeado (I-11).
2. [ ] Ingresar el token del OTEC por la UI de admin → verificar que se guarda **cifrado**
       (revisar que en BD no aparece en claro; I-6).
3. [ ] Como alumno de prueba, abrir la lección con candado SENCE → pulsar "Registrar asistencia".
4. [ ] Verificar que el motor genera `id_sesion_alumno` único y hace el POST a
       `.../rcetest/Registro/IniciarSesion` con los campos correctos (quirk `CodSence` vs
       `CodigoCurso` NO invertido; línea 1 con `CodSence` vacío).
5. [ ] Completar el login de **Clave Única** con el RUN de prueba.
6. [ ] Verificar el **callback de éxito**: llega `IdSesionSence` real; la sesión pasa a
       `iniciada`; se persiste un evento `start_ok` en `sence_events`.
7. [ ] Verificar que el **candado se libera** y el contador de 3 h aparece (I-12, I-13).
8. [ ] Pulsar "Cerrar sesión" → POST a `.../rcetest/Registro/CerrarSesion` con `IdSesionSence`
       → callback de cierre (sin `GlosaError` y sin `IdSesionSence`) → sesión `cerrada`,
       evento `close_ok`.
9. [ ] Confirmar en la bitácora que **el token no aparece** en ningún `payload` ni log (I-7).
10. [ ] (Opcional, si hay tiempo) Forzar un error real (p.ej. RUN no autorizado → 208) y
        verificar la traducción es-CL al alumno, sin código crudo (I-9).

## Criterio de éxito (gate 0.9)

Asistencia visible con `IdSesionSence` real de `rcetest` + evento en la bitácora, y cierre de
sesión registrado. Token siempre cifrado y nunca filtrado.

## Si `rcetest` está caído

No "probar en producción" jamás. Continuar contra el **mock local** (0.6) y reagendar la
sesión con Edu (riesgo del sprint contemplado).
