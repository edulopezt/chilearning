import { describe, expect, it } from "vitest";

import { brandCssVars } from "./brand-palette";
import { AA_NORMAL, contrastRatio, parseHex } from "./contrast";

const DARK_BG = { r: 2, g: 6, b: 23 };

describe("brandCssVars", () => {
  it("null si primaryColor o accentColor no son hex válidos", () => {
    expect(brandCssVars({ primaryColor: "no-es-hex", accentColor: "#0ea5e9" })).toBeNull();
    expect(brandCssVars({ primaryColor: "#1e3a8a", accentColor: "azul" })).toBeNull();
  });

  it("un azul oscuro típico (#1e3a8a) pasa casi intacto en light, se aclara en dark", () => {
    const result = brandCssVars({ primaryColor: "#1e3a8a", accentColor: "#0ea5e9" });
    expect(result).not.toBeNull();
    expect(result!.light["--primary"]).toBe("#1e3a8a"); // ya cumple AA contra blanco, sin ajuste
    expect(result!.dark["--primary"]).not.toBe("#1e3a8a"); // demasiado oscuro para el fondo dark, se aclaró
  });

  it("blanco puro (#ffffff) — extremo: se oscurece en light, queda intacto en dark", () => {
    const result = brandCssVars({ primaryColor: "#ffffff", accentColor: "#ffffff" });
    expect(result).not.toBeNull();
    expect(result!.light["--primary"]).not.toBe("#ffffff");
    expect(result!.dark["--primary"]).toBe("#ffffff"); // blanco sobre fondo oscuro ya es máximo contraste
  });

  it("negro puro (#000000) — extremo: queda intacto en light, se aclara en dark", () => {
    const result = brandCssVars({ primaryColor: "#000000", accentColor: "#000000" });
    expect(result).not.toBeNull();
    expect(result!.light["--primary"]).toBe("#000000"); // negro sobre blanco ya es máximo contraste
    expect(result!.dark["--primary"]).not.toBe("#000000");
  });

  it("amarillo saturado (#ffff00) — extremo típico de bajo contraste en ambos modos", () => {
    const result = brandCssVars({ primaryColor: "#ffff00", accentColor: "#ffff00" });
    expect(result).not.toBeNull();
    // Verifica el contrato real: cualquiera sea el ajuste, cumple AA contra su
    // propio foreground (light) y contra el fondo oscuro real (dark).
    const lightPrimary = parseHex(result!.light["--primary"]!)!;
    const lightForeground = parseHex(result!.light["--primary-foreground"]!)!;
    expect(contrastRatio(lightPrimary, lightForeground)).toBeGreaterThanOrEqual(AA_NORMAL - 0.1);

    const darkPrimary = parseHex(result!.dark["--primary"]!)!;
    expect(contrastRatio(darkPrimary, DARK_BG)).toBeGreaterThanOrEqual(AA_NORMAL - 0.1);
  });

  it("primary-foreground es siempre blanco o negro (bestTextOn), nunca otro color", () => {
    const result = brandCssVars({ primaryColor: "#0ea5e9", accentColor: "#1e3a8a" });
    expect(["#ffffff", "#000000"]).toContain(result!.light["--primary-foreground"]);
    expect(["#ffffff", "#000000"]).toContain(result!.dark["--primary-foreground"]);
  });

  it("no toca --accent (rol estructural de hover, se queda con el default de Chilearning)", () => {
    const result = brandCssVars({ primaryColor: "#dc2626", accentColor: "#16a34a" });
    expect(result!.light).not.toHaveProperty("--accent");
    expect(result!.dark).not.toHaveProperty("--accent");
  });

  it("todos los valores devueltos son hex válidos de 6 dígitos", () => {
    const result = brandCssVars({ primaryColor: "#123456", accentColor: "#abcdef" });
    for (const value of [...Object.values(result!.light), ...Object.values(result!.dark)]) {
      expect(parseHex(value)).not.toBeNull();
    }
  });
});
