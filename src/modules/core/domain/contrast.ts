/**
 * Contraste WCAG 2.1 (dominio puro, sin IO) — task 1.10, HU-1.2.
 * Se usa para advertir cuando un color de marca deja el texto ilegible y para
 * proponer un ajuste que sí cumpla el mínimo AA.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** Parsea `#rrggbb` (o `rrggbb`) a RGB. null si no es un hex válido de 6. */
export function parseHex(hex: string): Rgb | null {
  const m = hex.trim().match(HEX_RE);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function channelLuminance(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa (WCAG). */
export function relativeLuminance(c: Rgb): number {
  return 0.2126 * channelLuminance(c.r) + 0.7152 * channelLuminance(c.g) + 0.0722 * channelLuminance(c.b);
}

/** Razón de contraste entre dos colores (1..21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** Mejor color de texto (blanco/negro) para un fondo, y su razón de contraste. */
export function bestTextOn(bg: Rgb): { text: "#ffffff" | "#000000"; ratio: number } {
  const onWhite = contrastRatio(bg, WHITE);
  const onBlack = contrastRatio(bg, BLACK);
  return onWhite >= onBlack
    ? { text: "#ffffff", ratio: onWhite }
    : { text: "#000000", ratio: onBlack };
}

/** Umbral AA para texto normal. */
export const AA_NORMAL = 4.5;

export interface ContrastCheck {
  ok: boolean;
  ratio: number;
  /** Color de texto recomendado (blanco/negro). */
  textColor: "#ffffff" | "#000000";
  /** Si no cumple AA: un color de marca ajustado que sí lo cumple (o null). */
  suggestion: string | null;
}

export function scaleToward(c: Rgb, target: Rgb, t: number): Rgb {
  return {
    r: c.r + (target.r - c.r) * t,
    g: c.g + (target.g - c.g) * t,
    b: c.b + (target.b - c.b) * t,
  };
}

/**
 * Evalúa un color de marca por su contraste contra el BLANCO — el caso concreto
 * de uso: texto blanco sobre un botón del color, y el color como texto/acento
 * sobre fondo blanco. Un color demasiado claro no cumple AA (4.5:1) en ninguno
 * de los dos usos. Si falla, propone el ajuste MÁS CERCANO (oscureciéndolo) que
 * sí cumple. `textColor` es siempre blanco (el uso que se valida); para el
 * preview general de legibilidad usa `bestTextOn`.
 */
export function checkBrandColor(hex: string, threshold = AA_NORMAL): ContrastCheck | null {
  const c = parseHex(hex);
  if (!c) return null;
  const ratio = contrastRatio(c, WHITE);
  if (ratio >= threshold) {
    return { ok: true, ratio, textColor: "#ffffff", suggestion: null };
  }
  // Demasiado claro: oscurecer hacia negro hasta cumplir el umbral.
  for (let t = 0.05; t <= 1; t += 0.05) {
    const adjusted = scaleToward(c, BLACK, t);
    if (contrastRatio(adjusted, WHITE) >= threshold) {
      return { ok: false, ratio, textColor: "#ffffff", suggestion: toHex(adjusted) };
    }
  }
  return { ok: false, ratio, textColor: "#ffffff", suggestion: "#000000" };
}
