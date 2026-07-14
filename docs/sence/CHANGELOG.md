# Changelog — módulo SENCE (`src/modules/sence/`)

Registro de cambios del contrato de integración con el Registro Centralizado
E-learning (RCE) de SENCE. Regla del proyecto (ver `CLAUDE.md`): todo cambio que
toque `src/modules/sence/` se anota aquí, y cualquier cambio al contrato SENCE
exige diff contra el manual oficial + checklist en `rcetest` antes del release.

---

## 2026-07-14 — Contrato del motor congelado contra manual oficial *Integración Registro Asistencia SENCE* v1.1.6

El contrato del motor SENCE queda **congelado contra el manual oficial
"Integración Registro Asistencia SENCE" v1.1.6**, versión publicada como vigente
en el hub oficial de SENCE. No se congeló contra v1.1.5, que era lo planificado
(ver [D-001 en DECISIONES.md](../../specs/DECISIONES.md)).

Puntos clave del congelamiento (detalle completo en el
[DIFF](./DIFF-SPEC-v1.1.3-a-manual-v1.1.6.md)):

- `UrlRetoma` / `UrlError`: largo máximo **100 caracteres** (v1.1.3 permitía 200).
- Líneas de capacitación vigentes: `1 = Programas Sociales`,
  `3 = Franquicia Tributaria` y **`6 = FPT` (nueva)**. `CodigoCurso` mantiene el
  mínimo de 7 caracteres **excepto** para cursos FPT.
- Tabla de errores (Anexo 2): se agregan **311, 312 y 313** (Clave Única y URL de
  cierre de sesión); los códigos **100 y 210 desaparecen** de los manuales
  vigentes — se mantienen en `errors.ts` marcados `deprecated`
  (ver [D-005](../../specs/DECISIONES.md)).
- Autenticación del alumno con **Clave Única**: si el alumno no completa el
  login, SENCE **no envía callback alguno** (ni de éxito ni de error) — el motor
  debe expirar localmente las sesiones "en tránsito".
- `GlosaError`: el manual lo tipifica **Entero** (singular), pero el motor lo
  parsea defensivamente como **lista separada por `;`**
  (ver [D-002](../../specs/DECISIONES.md)).
- La regla "sesión máx. 3 h / inactividad 60 min" **no proviene de este manual**:
  se implementa como parámetro operativo configurable
  (ver [D-003](../../specs/DECISIONES.md)).

### Manuales oficiales de referencia (SHA256)

PDFs oficiales guardados en `docs/sence/manuales/` junto a su archivo
`SHA256SUMS`, con hashes verificados contra esta tabla (ver
[D-004](../../specs/DECISIONES.md)). Commiteados al repositorio por el flujo normal (rama + PR con CI):

| SHA256 | Archivo |
| --- | --- |
| `1d8a415559fda281c0ab4c7cfbe67e79021c504ceb7ce9c806bc7c63307692d4` | `guia_de_uso_gca_e-learning_otec_v1.3_0.pdf` |
| `7724337078c18e7598043c204cc3cf65114c92ef135aad64c28d4f125b12fe0d` | `instructivo_tecnico_de_integracion_entre_lms_y_sic_v2.0_0.pdf` |
| `2b9284afa33bea0252744c6bf41040aaf490504dc97d5847fcb4aa65cd3dc04f` | `integracion_registro_asistencia_sence_v1.1.3.pdf` |
| `bcc174a5a980fea65119633e132fcb2d1ce16e16932a1ca9d746125b2033121f` | `integracion_registro_asistencia_sence_v1.1.5_0.pdf` |
| `e9435a9e9b95985b81e5ecc9696e42a1c7d7521c838b2217999f05636f8eac4c` | `integracion_registro_asistencia_sence_v1.1.6.pdf` |

### Referencias

- Diff normativo v1.1.3 → v1.1.6:
  [`DIFF-SPEC-v1.1.3-a-manual-v1.1.6.md`](./DIFF-SPEC-v1.1.3-a-manual-v1.1.6.md)
- Especificación de integración actualizada:
  [`SPEC_INTEGRACION_SENCE.md`](./SPEC_INTEGRACION_SENCE.md)
- Contrato del motor:
  [`src/modules/sence/README.md`](../../src/modules/sence/README.md)
- Registro de decisiones: [`specs/DECISIONES.md`](../../specs/DECISIONES.md)
