/**
 * Utilidades puras del folio y la máscara de RUN del certificado (task 3.2).
 * `formatFolio` espeja el SQL del RPC (`CERT-{año}-{seq6}`); `maskRun` produce la
 * versión que muestra la verificación PÚBLICA sin exponer el RUN completo (P4).
 */

export function formatFolio(year: number, seq: number): string {
  return `CERT-${year}-${String(seq).padStart(6, "0")}`;
}

/**
 * Enmascara un RUN para la verificación pública: conserva los primeros 2 dígitos
 * y oculta el resto (incluido el DV). "12.345.678-9" → "12.XXX.XXX-X".
 */
export function maskRun(run: string): string {
  const clean = run.replace(/[^0-9kK]/g, "");
  if (clean.length < 3) return "XXX-X";
  return `${clean.slice(0, 2)}.XXX.XXX-X`;
}
