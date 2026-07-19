/**
 * Overrides CSS de branding por tenant (dominio puro, sin IO) — task 6.6
 * (Hito 6). Deriva los pares light/dark de `--primary`/`--ring`/`--sidebar-*`
 * a partir de los colores guardados por el tenant, SIEMPRE con AA (4.5:1)
 * garantizado en su rol real (botón/foreground con `bestTextOn`, texto/ring
 * sobre el fondo real de cada modo) — el guardado en `branding-service.ts` es
 * ADVISORY (no bloquea el contraste al guardar), así que este es el
 * cinturón de seguridad antes de que el color llegue a un `<style>` real.
 *
 * Deliberadamente NO toca el token estructural `--accent` (fondo de hover de
 * dropdowns/tabs/menús): usarlo a saturación completa con un color de marca
 * arbitrario volvería garish cualquier hover del shell. Solo se sobre-escriben
 * los roles donde el color de marca es protagonista: botón primario, nav
 * activo del sidebar, focus ring.
 */

import { AA_NORMAL, bestTextOn, checkBrandColor, contrastRatio, parseHex, scaleToward, toHex, type Rgb } from "./contrast";

export interface TenantBrandInput {
  primaryColor: string;
  accentColor: string;
}

export interface BrandCssVars {
  light: Record<string, string>;
  dark: Record<string, string>;
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

// Debe reflejar `--background` de `.dark` en globals.css (slate-950). Solo se
// usa para calcular contraste — nunca se emite como valor real.
const DARK_BACKGROUND: Rgb = { r: 2, g: 6, b: 23 };

/** Aclara `hex` hacia blanco hasta cumplir `threshold` de contraste contra `bg`. */
function lightenUntilAA(hex: string, bg: Rgb, threshold = AA_NORMAL): string {
  const c = parseHex(hex);
  if (!c) return hex;
  if (contrastRatio(c, bg) >= threshold) return hex;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const adjusted = scaleToward(c, WHITE, t);
    if (contrastRatio(adjusted, bg) >= threshold) return toHex(adjusted);
  }
  return "#ffffff";
}

function foregroundFor(hex: string): string {
  const c = parseHex(hex);
  return c ? bestTextOn(c).text : "#ffffff";
}

/**
 * `null` si los colores guardados no son hex válidos de 6 dígitos — el
 * caller simplemente no emite override y rige el default de Chilearning.
 *
 * Light: mismo ajuste que ya usa el editor de marca (`checkBrandColor`,
 * oscurece hacia negro contra blanco) — el uso real es texto blanco encima
 * (botón primario).
 * Dark: se aclara hacia blanco hasta cumplir AA contra el fondo oscuro real
 * — un azul de marca oscuro sería casi invisible como ring/nav activo sobre
 * un fondo casi negro.
 */
export function brandCssVars(input: TenantBrandInput): BrandCssVars | null {
  if (!parseHex(input.primaryColor) || !parseHex(input.accentColor)) return null;

  const primaryLight = checkBrandColor(input.primaryColor)?.suggestion ?? input.primaryColor;
  const accentLight = checkBrandColor(input.accentColor)?.suggestion ?? input.accentColor;
  const primaryDark = lightenUntilAA(input.primaryColor, DARK_BACKGROUND);
  const accentDark = lightenUntilAA(input.accentColor, DARK_BACKGROUND);

  return {
    light: {
      "--primary": primaryLight,
      "--primary-foreground": foregroundFor(primaryLight),
      "--ring": accentLight,
      "--sidebar-primary": primaryLight,
      "--sidebar-primary-foreground": foregroundFor(primaryLight),
      "--sidebar-ring": accentLight,
    },
    dark: {
      "--primary": primaryDark,
      "--primary-foreground": foregroundFor(primaryDark),
      "--ring": accentDark,
      "--sidebar-primary": primaryDark,
      "--sidebar-primary-foreground": foregroundFor(primaryDark),
      "--sidebar-ring": accentDark,
    },
  };
}
