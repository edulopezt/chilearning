/**
 * Grupos operativos del OTEC (HU-2.2): en las planillas reales los alumnos
 * vienen etiquetados con el grupo `Sence-<código del curso>` (inscritos vía
 * SENCE: marcan asistencia) o `Becario` (asisten al curso SIN marcar SENCE →
 * `exento`, I-14). Dominio puro: parseo de la celda "grupo" del CSV y
 * etiqueta derivada para la UI (import, cumplimiento, certificados y portal
 * del alumno). La etiqueta es un CÓDIGO operativo, no un texto traducible:
 * se muestra igual en todas las superficies.
 */

export type GrupoValue =
  | { kind: "none" } // celda vacía o columna ausente → decide la columna `exento`
  | { kind: "becario" }
  | { kind: "sence"; code: string }
  | { kind: "invalid" };

/** Etiqueta del grupo de exentos, tal como viene en las planillas del OTEC. */
export const BECARIO_LABEL = "Becario";

/** `Sence-` + código del curso (cod_sence tiene hasta 10 dígitos, HU-3.1). */
const SENCE_GROUP_RE = /^sence-(\d{1,10})$/i;

/** Interpreta la celda "grupo" del CSV (tolerante a mayúsculas y espacios). */
export function parseGrupo(raw: string | undefined): GrupoValue {
  const v = (raw ?? "").trim();
  if (v === "") return { kind: "none" };
  if (v.toLowerCase() === "becario") return { kind: "becario" };
  const m = SENCE_GROUP_RE.exec(v);
  if (m) return { kind: "sence", code: m[1] as string };
  return { kind: "invalid" };
}

/**
 * Etiqueta de grupo derivada de los datos (sin columna nueva en la BD):
 * exento → "Becario"; alumno SENCE → "Sence-<código del curso>"; curso sin
 * código SENCE y no exento → null (no hay grupo que mostrar).
 */
export function enrollmentGroupLabel(exento: boolean, codSence: string | null): string | null {
  if (exento) return BECARIO_LABEL;
  return codSence ? `Sence-${codSence}` : null;
}
