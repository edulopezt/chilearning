# UX Standards — Chilearning

> Estándares transversales pedidos explícitamente por Edu para el Hito 6. Aplican a **toda
> pantalla migrada**, sin excepción. Son checklist de "done" en cada PR de área y lente
> obligatoria de la revisión adversarial visual. Complementa [`MASTER.md`](MASTER.md)
> (estética) — este documento es sobre **comportamiento**.

---

## 1. Cuatro estados por pantalla: Success, Loading, Error, Empty

Ninguna pantalla que dependa de datos remotos (casi todas) se considera terminada sin los
cuatro estados explícitamente diseñados:

- **Loading:** `loading.tsx` por segmento de ruta (App Router lo activa automático vía
  Suspense) con un **skeleton fiel al layout real** de la página — no un spinner genérico
  centrado. Ver §2 sobre cuándo usar skeleton vs spinner vs progress bar.
- **Error:** `error.tsx` boundary por área — mensaje amable (ver §4) + botón "Reintentar".
  Nunca un stack trace ni un mensaje técnico. Se apoya en el componente `Alert`/`EmptyState`
  del design system (PR 6.2).
- **Empty:** componente `EmptyState` (ícono + título + descripción + acción sugerida) en toda
  lista, tabla o feed vacío. Una tabla vacía muda ("sin filas, sin más") no es un estado
  terminado — siempre explica qué significa estar vacío y qué hacer al respecto (ej. "Aún no
  hay inscripciones — importa tu primera planilla CSV").
- **Success:** feedback explícito tras cada mutación relevante (crear, editar, eliminar,
  enviar) — un `Alert`/estado visible, no solo el silencio de "ya se guardó". El Toast se
  evalúa como mecanismo adicional en el PR de polish (6.15) si algún flujo queda sin feedback
  después de aplicar esto.

## 2–3. Loaders estratégicos y anti-flash

| Duración/contexto | Loader | Ejemplo en Chilearning |
|---|---|---|
| Carga de página completa (datos grandes) | **Skeleton** fiel al layout | Tablero, listado de cursos, gradebook |
| Acción pequeña (submit de formulario, toggle) | **Spinner inline** en el propio botón (`Button` con prop `loading`) | Guardar cambios de perfil, activar/desactivar |
| Duración conocida y variable | **Progress bar** determinada | Import CSV de inscripciones, subida/ingesta SCORM, exportación de tenant |
| **< 1 segundo** | **Ninguno** | Cualquier acción rápida — mostrar un loader la hace *sentir* más lenta, no más rápida |

Regla anti-flash: todo spinner/skeleton que pueda disparar para una acción rápida se muestra
con un **delay de ~400ms** (hook `useDelayedPending` o `animation-delay` CSS) — si la acción
termina antes del delay, el loader nunca llegó a pintarse. Se implementa una sola vez en el
primitivo `Spinner`/`Button` (PR 6.2/6.3) y se hereda en todos lados — no se reimplementa por
página.

## 4. Errores comprensibles para el usuario final

Todo mensaje de error visible en la UI sigue la estructura de tres partes y vive en
`src/i18n/es-CL.ts` (nunca un string suelto en el componente):

1. **Qué pasó** — en lenguaje llano, sin jerga técnica ni código de error crudo.
2. **Por qué** (cuando se sabe) — la causa probable, si aporta valor accionar sobre ella.
3. **Qué hacer** — la acción concreta disponible (reintentar, revisar un campo, contactar
   soporte, esperar).

Ejemplo de transformación:

- ❌ `Error: fetch failed with status 500`
- ✅ "No pudimos guardar los cambios. Puede ser un problema de conexión momentáneo — intenta
  de nuevo en unos segundos. Si persiste, contáctanos."

Los errores del protocolo SENCE **ya siguen esta filosofía** vía la tabla de
`src/modules/sence/errors.ts` (códigos 100–313 nunca se muestran crudos al alumno) — este
estándar la extiende a el resto de la aplicación, no la reemplaza ni la toca.

## 5. Reglas de formularios

Encapsuladas en el primitivo `Field` (PR 6.2/6.3) y sus helpers — **no se reimplementan por
página**, cada formulario del Hito 6 migra a estos primitivos:

- **Validación inline:** Zod on-blur (primer paso) + revalidación on-change una vez que un
  campo ya mostró error (para que el error desaparezca apenas se corrige, sin esperar a un
  nuevo blur). El mensaje de error aparece junto al campo, siguiendo la estructura de §4.
- **Requisitos de contraseña visibles:** componente `PasswordRequirements` (checklist en vivo,
  cada requisito se marca ✓ a medida que se cumple) en todo flujo de definir/cambiar
  contraseña — nunca una regla oculta que solo se revela al fallar el submit.
- **Botón de submit deshabilitado** hasta que el formulario sea válido, con `aria-disabled` +
  motivo accesible (no solo `disabled` mudo — un lector de pantalla debe poder saber por qué).
- **Contador de caracteres** en inputs/textareas con `maxLength` (foro, mensajería,
  descripciones de curso) — visible desde el inicio, no solo al acercarse al límite.
- **Prefill de datos conocidos:** ningún formulario pide de nuevo un dato que el sistema ya
  tiene (mis-datos, perfil de empresa, edición de curso) — se precarga siempre que exista.
- **Teléfono tolerante al formato:** normalizador `+56 9 XXXX XXXX` (dominio puro en
  `src/modules/core/domain/phone.ts`, PR 6.2) que acepta espacios, guiones, paréntesis, con o
  sin `+56` — el usuario nunca es rechazado por formatear el número "distinto". Este mismo
  normalizador deja poblable `user_metadata.phone`, hoy vacío y bloqueando el canal WhatsApp
  (task 5.11 — ver `docs/whatsapp/ACTIVATION.md`).

---

## Cómo se verifica

Cada PR de área (6.8–6.14) declara en su descripción qué pantallas cubren los 4 estados, qué
formularios migraron a `Field` con las 6 reglas de arriba, y qué loaders usan qué mecanismo.
La revisión adversarial visual de cierre de cada PR usa este documento como checklist
explícito, además de las lentes estéticas de `MASTER.md`.
