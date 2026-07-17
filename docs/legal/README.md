# Legal — handoff para Edu

> **Qué hay acá:** los borradores legales de la tarea **5.6**. Ninguno es válido todavía.
> Este README es la lista de lo que **solo Edu puede decidir** y de lo que necesita a un abogado.
>
> **Regla:** nada de esta carpeta se publica como definitivo, ni se manda a un cliente, sin
> revisión de abogado. La tarea 5.6 no se marca ✅ hasta que eso ocurra.

## 🚨 Lo primero: la prestadora está en Alemania, y eso cambia el régimen

Edu confirmó (2026-07-17) que **la sociedad que presta el servicio está en Frankfurt**, no en Chile.
Todos estos borradores se escribieron asumiendo un prestador chileno. Consecuencias que **hay que
validar con asesoría que cubra el lado alemán** (no basta un abogado chileno):

1. **Aplican DOS regímenes sobre los mismos datos.** El RGPD aplica por el **establecimiento** del
   responsable/encargado en la UE (art. 3.1), sin importar que los titulares estén en Chile. O sea:
   RGPD **+** Ley 21.719, a la vez. El contrato de encargo debe satisfacer el **art. 28 del RGPD**
   (contenido mínimo tasado), no solo el estándar chileno; y probablemente haga falta el **registro
   de actividades de tratamiento del art. 30**.
2. **La BD en São Paulo deja de ser solo el riesgo S2 chileno.** Pasa a ser **transferencia a un
   tercer país sin decisión de adecuación de la UE** → exige instrumento del RGPD (cláusulas
   contractuales tipo + evaluación de la transferencia). Si esto no cuadra, el impacto es de
   **arquitectura** (mover la BD a una región de la UE), no de redacción: **decidirlo ANTES de firmar
   clientes**, porque migrar después es caro.
   *(Nota técnica: Supabase ofrece regiones en la UE — Frankfurt incluida. Cambiar de región implica
   migrar el proyecto, no un flag.)*
3. **Sitio web alemán ⇒ Impressum.** Un prestador alemán debe publicar pie de imprenta (§5 DDG) con
   sus datos registrales. Hoy no existe esa página.
4. **Identificadores**: no hay RUT. `LEGAL_ENTITY` (`src/app/privacidad/content.ts`) ya pide los
   campos correctos: razón social **con forma jurídica** (GmbH/UG/…), **Handelsregister + nº HRB**,
   **USt-IdNr** y domicilio en Frankfurt.
5. **Quién factura y contrata a las OTECs chilenas**: si es la sociedad alemana, revisar también IVA
   y retenciones en la venta transfronteriza a Chile. (Fuera del alcance del código; lo anoto para
   que no se pase por alto.)

## Documentos

| Documento | Estado | Qué es |
|---|---|---|
| `CONTRATO-ENCARGO-BORRADOR.md` | 🔶 borrador técnico | Contrato de encargo OTEC (responsable) ↔ Chilearning (encargado), exigido por **P4**. |
| `/privacidad` (`src/app/privacidad/`) | 🔶 borrador publicado con banner | Política de privacidad Ley 21.719. La página **muestra un banner de BORRADOR** y va con `noindex`. |
| Landing (`src/app/page.tsx`) | 🔶 provisional | Landing comercial con la marca de trabajo "Chilearning". |

---

## 🔴 Bloqueantes — antes de que esto sea público de verdad

1. **Datos registrales de la sociedad alemana.** Faltan **razón social con forma jurídica,
   Handelsregister + nº HRB, USt-IdNr y domicilio en Frankfurt**. Sin eso el contrato no se firma y
   la política no puede publicarse como vigente (identificar al responsable/encargado es exigible por
   la Ley 21.719 **y** por el RGPD). Están como `[POR DEFINIR]` en `LEGAL_ENTITY` de
   `src/app/privacidad/content.ts` y en los comparecientes del contrato. La constante **se renderiza**
   en la §11 de `/privacidad`: rellenarla cambia de verdad el documento publicado, y mientras no se
   rellene el `[POR DEFINIR]` se ve en la página (a propósito: así no se publica por descuido).

2. ~~**Correo de contacto comercial.**~~ ✅ **RESUELTO (2026-07-17):** Edu confirmó
   **`hola@edulopezt.com`**. Está en `CONTACT_EMAIL` (`src/app/page.tsx`) y en `LEGAL_ENTITY`.

3. **Marca definitiva.** "Chilearning" es marca de trabajo; el dominio `chilearning.cl` está decidido
   (**D-009**), la identidad no. Si cambia: `esCL.common.appName` + `esCL.landing.*`. Ningún
   componente tiene la marca escrita a mano.

4. **Tono de las afirmaciones de la landing (decisión de Edu).** La revisión adversarial bajó tres
   afirmaciones que el repo no respalda, y el criterio conviene que lo confirme Edu antes de publicar:
   - **SENCE**: se decía «asistencia SENCE integrada» + «es el módulo más probado de la plataforma».
     El motor **nunca ha corrido contra SENCE real** (`rcetest` PARQUEADA, ver `ESTADO-PROYECTO.md`
     §Bloqueos). Ahora la landing renderiza SIEMPRE un párrafo (`landing.differentiatorStatus`) que
     dice que está probado contra el **simulador** y que la validación real ocurre en el primer curso
     en producción. Se evitó a propósito «la certificación está en curso»: la certificación está
     **parqueada** (Edu decidió no contactar a SENCE), y «en curso» insinuaría un avance que no hay.
     Si un OTEC compra creyendo que valida franquicia desde el día 1 y el primer curso falla, pierde
     plata real.
   - **«en uso»**: se decía «Todo lo de esta lista está construido y en uso». No hay ningún curso
     dictado ni ningún cliente (piloto parqueado) → ahora dice «construido y funcionando en la
     plataforma». La versión «en marcha blanca con nuestra propia OTEC» solo será verdad cuando
     Seminarea haya dictado un curso.
   - **«Ley 21.719 por diseño»** → «Derechos del titular, resueltos en la app»: afirmar cumplimiento
     es insostenible mientras S2 (abajo) esté sin validar y la política sea un borrador.

5. **Riesgo S2 — transferencia internacional a Brasil.** La BD (con **RUN** de alumnos) está en
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
