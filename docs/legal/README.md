# Legal — handoff para Edu

> **Qué hay acá:** los borradores legales de la tarea **5.6**. Ninguno es válido todavía.
> Este README es la lista de lo que **solo Edu puede decidir** y de lo que necesita a un abogado.
>
> **Regla:** nada de esta carpeta se publica como definitivo, ni se manda a un cliente, sin la
> revisión de un abogado chileno. La tarea 5.6 no se marca ✅ hasta que eso ocurra.

## Documentos

| Documento | Estado | Qué es |
|---|---|---|
| `CONTRATO-ENCARGO-BORRADOR.md` | 🔶 borrador técnico | Contrato de encargo OTEC (responsable) ↔ Chilearning (encargado), exigido por **P4**. |
| `/privacidad` (`src/app/privacidad/`) | 🔶 borrador publicado con banner | Política de privacidad Ley 21.719. La página **muestra un banner de BORRADOR** y va con `noindex`. |
| Landing (`src/app/page.tsx`) | 🔶 provisional | Landing comercial con la marca de trabajo "Chilearning". |

---

## 🔴 Bloqueantes — antes de que esto sea público de verdad

1. **Identidad legal del prestador.** No existe en ningún documento del repo: falta **razón social,
   RUT y domicilio**. Sin eso el contrato no se firma y la política de privacidad no puede publicarse
   como vigente (la Ley 21.719 exige identificar al responsable/encargado). Están como
   `[POR DEFINIR]` en `LEGAL_ENTITY` de `src/app/privacidad/content.ts` y en los comparecientes del
   contrato.

2. **Correo de contacto comercial.** La landing apunta a **`hola@chilearning.cl`**, que **no está
   confirmado en ninguna parte del repo**. Los únicos correos versionados son
   `soporte@chilearning.cl` (aviso de OTEC suspendida) y `no-responder@chilearning.cl` (remitente de
   Resend). **Hay que crear la casilla o cambiar la constante** `CONTACT_EMAIL` en
   `src/app/page.tsx` (una línea). Un CTA que cae al vacío pierde leads en silencio.

3. **Marca definitiva.** "Chilearning" es marca de trabajo; el dominio `chilearning.cl` está decidido
   (**D-009**), la identidad no. Si cambia: `esCL.common.appName` + `esCL.landing.*`. Ningún
   componente tiene la marca escrita a mano.

4. **Riesgo S2 — transferencia internacional a Brasil.** La BD (con **RUN** de alumnos) está en
   **São Paulo**. La especificación lo registra como **supuesto no validado**. Es la **primera**
   pregunta para el abogado: si la respuesta es que no es admisible, el impacto es de **arquitectura**
   (migrar la BD a Chile), no de redacción. Conviene saberlo **antes** de firmar clientes, no después.

## 🟡 Para el abogado — agenda concreta

1. **S2 primero** (ver arriba): mecanismo de transferencia admisible, cláusulas tipo, si hay que
   registrar o autorizar algo ante la Agencia de Protección de Datos Personales.
2. **Plazos de retención (D-033).** El catálogo `RETENTION_POLICIES`
   (`src/modules/core/domain/privacy.ts`) vive en código, versionado y auditable, y se muestra tal
   cual al titular en `/mis-datos` y en `/privacidad`. Los períodos (**≥ 5 años** para asistencia
   SENCE, certificados, notas y auditoría) son **defaults razonables marcados para revisión legal**,
   no plazos confirmados contra la normativa. Hay que confirmar cada fila contra el Estatuto de
   Capacitación. **Cambiar el catálogo actualiza la app y la política de una sola vez.**
3. **Límite de la supresión.** Confirmar que la obligación de fiscalización SENCE prima sobre el
   derecho de supresión, tal como está implementado (D-033: se conserva la evidencia SENCE y se
   redacta perfil, foro y mensajería).
4. **Plazos entre corchetes** del contrato: notificación de brechas (`[24]` h), preaviso de
   subencargados (`[30]` d), devolución (`[30]` d), supresión (`[90]` d), retención de respaldos.
5. **Responsabilidad, límites y jurisdicción** (§11 del contrato, sin redactar).
6. **Bases de licitud** de la tabla de tratamientos: hoy son las que la app declara; confirmar que la
   calificación jurídica es correcta (especialmente "interés legítimo" para auditoría y seguridad).

## 🟢 DPAs de proveedores — archivar

Firmar/descargar y guardar (fuera del repo, junto al resto de los papeles del negocio). Deben cuadrar
con la §5 del contrato:

- [ ] **Supabase** — DPA (BD/Auth/Storage, São Paulo). El más importante: es donde vive el RUN.
- [ ] **Resend** — DPA (correo transaccional).
- [ ] **Bunny Stream** — DPA (video).
- [ ] **Cloudflare** — DPA (DNS/R2, respaldos cifrados).
- [ ] **Sentry** — DPA (errores; ya va con PII depurada).
- [ ] Proveedor del **VPS** — DPA + confirmar **región** (está `[POR CONFIRMAR]` en ambos documentos).
- [ ] **OpenRouter** — solo si se activa el tutor IA (5.8). Exigir **no-entrenamiento + retención cero**.
- [ ] **Meta** — solo si se activa WhatsApp (trámite ya identificado en 3.10).

## Cómo mantener esto sin que se pudra

- La **lista de subencargados** vive en dos lugares y **deben cuadrar**: `SUBPROCESSORS` en
  `src/app/privacidad/content.ts` y la §5 del contrato. Si entra un proveedor nuevo, se tocan los dos.
- Las tablas de **tratamientos** y **retención** de `/privacidad` se generan desde
  `src/modules/core/domain/privacy.ts` — no se editan a mano y no pueden contradecir a la app.
- La **versión** de la política (`CURRENT_PRIVACY_POLICY_VERSION`) es la misma que firma el alumno al
  consentir. Si cambia el texto de forma relevante, sube la versión: los consentimientos viejos
  apuntan a la versión vieja.
- Cuando el abogado apruebe: sacar los banners de borrador, quitar el `noindex` de `/privacidad`,
  completar los `[corchetes]` y marcar 5.6 en `specs/03-tareas.md` + `specs/ESTADO-PROYECTO.md`.
