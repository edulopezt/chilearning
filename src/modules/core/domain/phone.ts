/**
 * Normalizador de celular chileno (dominio puro, sin IO) — task 6.2 (Hito 6),
 * UX-STANDARDS.md §5 ("teléfono tolerante al formato"). Tolera espacios, guiones,
 * paréntesis y +56 opcional en la entrada del usuario; siempre produce el mismo
 * E.164 canónico. Deja poblable `user_metadata.phone`, hoy vacío y bloqueando en
 * la práctica el canal WhatsApp (task 5.11, ver docs/whatsapp/ACTIVATION.md).
 */

export interface NormalizedClPhone {
  /** E.164 canónico para guardar, ej. "+56912345678". */
  e164: string;
  /** Formato legible para mostrar, ej. "+56 9 1234 5678". */
  display: string;
}

const MOBILE_LOCAL_RE = /^9\d{8}$/;

/**
 * Normaliza un celular chileno tolerando formato libre (con/sin +56, con
 * espacios/guiones/paréntesis). `null` si, tras limpiar el ruido, no quedan
 * exactamente los 9 dígitos de un móvil chileno (siempre inician en "9").
 */
export function normalizeClMobilePhone(input: string): NormalizedClPhone | null {
  const digits = input.replace(/\D/g, "");
  const local = digits.startsWith("56") ? digits.slice(2) : digits;
  if (!MOBILE_LOCAL_RE.test(local)) return null;
  return {
    e164: `+56${local}`,
    display: `+56 9 ${local.slice(1, 5)} ${local.slice(5, 9)}`,
  };
}

/** `true` si, tolerando formato libre, `input` es un móvil chileno válido. */
export function isValidClMobilePhone(input: string): boolean {
  return normalizeClMobilePhone(input) !== null;
}
