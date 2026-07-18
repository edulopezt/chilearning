/**
 * Saneo de PII para los borradores de IA del staff (task 5.9, HU-9.5). PURO, sin
 * IO — mismo espíritu que `tutor-ia/domain/prompt.ts::sanitizeFirstName`: una
 * puerta única entre un texto "real" (la última pregunta del alumno en el hilo)
 * y cualquier prompt que salga hacia el modelo.
 *
 * ⚠ ESTE NO ES UN BLINDAJE PERFECTO. Es una defensa de MINIMIZACIÓN (RNF-10):
 * reduce lo obvio (RUN, correo, teléfono) que un alumno pueda haber escrito en
 * su consulta. No detecta nombres propios, direcciones ni otros identificadores
 * en prosa libre — eso excede lo que un regex puede hacer sin falsos positivos
 * masivos. El llamador (`draft-service.ts`) SIEMPRE debe pasar el texto por acá
 * ANTES de construir el prompt (`buildDraftPrompt`), nunca al revés.
 *
 * Orden de aplicación (importa, y está probado en `pii-strip.test.ts`):
 * correo, LUEGO teléfono, y RUN al final.
 *  - Correo primero: el placeholder `[dato omitido]` lleva un espacio, y si se
 *    aplicara después de RUN/teléfono un correo pegado a un número ya
 *    redactado podría no reconocerse por el espacio intercalado.
 *  - Teléfono ANTES que RUN: un teléfono escrito en grupos de 4 (p.ej.
 *    "1234 5678") tiene la MISMA forma que un RUN de 8 dígitos con un espacio
 *    como separador interno (1+3+3+1 dígitos) — si RUN corriera primero se
 *    comería el teléfono completo y dejaría el prefijo "+56 9 " intacto (bug
 *    real, cazado en tests). Aplicando teléfono primero, esa secuencia ya
 *    queda redactada antes de que RUN la vea.
 *
 * Límites de los patrones (revisión adversarial task 5.9, hallazgo real
 * corregido — ver `pii-strip.test.ts` casos "adversarial"):
 *  - Los bordes usan lookaround de DÍGITO (`(?<!\d)` / `(?!\d)`), no `\b`.
 *    `\b` no distingue letra de dígito (ambos son `\w`), así que un RUN/
 *    teléfono pegado sin espacio a la palabra anterior o siguiente (p.ej.
 *    "rut12345678-9tengounaduda") NO se reconocía y salía intacto hacia el
 *    modelo — un bypass real de minimización (RNF-10). El lookaround de
 *    dígito solo exige que el carácter vecino no sea otro dígito, así que
 *    protege igual contra "comerse" un número más largo sin relación, pero
 *    SÍ redacta cuando lo pegado es una letra.
 *  - El RUN exige que AL MENOS UNO de los tres separadores (punto/espacio
 *    entre los grupos, o guion/espacio antes del verificador) esté presente.
 *    Sin esta exigencia el patrón degenera en "cualquier entero de 8-9
 *    dígitos" (sin validar dígito verificador módulo 11) y redacta datos que
 *    NO son un RUN — fechas ("20260713"), folios, teléfonos fijos de 8
 *    dígitos ("22345678") — destruyendo contenido legítimo del borrador sin
 *    ningún beneficio real de privacidad.
 */

const EMAIL_RE = /[^\s@]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Teléfono chileno (móvil, el formato dado por el brief): +56 opcional, "9",
// luego 4+4 dígitos, con separadores opcionales (espacio o guion) entre cada
// grupo. Bordes: lookaround de dígito (no `\b`) para no dejar pasar un
// teléfono pegado sin espacio a texto vecino.
const PHONE_RE = /(?<!\d)(\+?56[\s-]?)?9[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g;

// RUN chileno: 1-2 dígitos + 3 + 3 + dígito verificador (0-9 o k/K), con al
// menos UN separador presente (punto/espacio entre grupos, o guion/espacio
// antes del verificador) — cada alternativa exige un separador distinto como
// obligatorio y deja los otros dos opcionales, así que basta con que
// cualquiera de los tres esté presente. Bordes con lookaround de dígito (no
// `\b`) por la misma razón que el teléfono.
const RUN_SEP12 = "[.\\s]";
const RUN_SEP23 = "[.\\s]";
const RUN_SEP3C = "[-\\s]";
const RUN_RE = new RegExp(
  "(?<!\\d)(?:" +
    `\\d{1,2}${RUN_SEP12}\\d{3}${RUN_SEP23}?\\d{3}${RUN_SEP3C}?[0-9kK]` +
    "|" +
    `\\d{1,2}${RUN_SEP12}?\\d{3}${RUN_SEP23}\\d{3}${RUN_SEP3C}?[0-9kK]` +
    "|" +
    `\\d{1,2}${RUN_SEP12}?\\d{3}${RUN_SEP23}?\\d{3}${RUN_SEP3C}[0-9kK]` +
    ")(?!\\d)",
  "g",
);

const REDACTED = "[dato omitido]";

/**
 * Reemplaza RUN/correo/teléfono chilenos por `"[dato omitido]"`. Texto sin
 * esos patrones vuelve IDÉNTICO (no se toca nada más: mayúsculas, espacios,
 * tildes, etc. quedan intactos).
 */
export function stripPIIForDraft(text: string): string {
  return text
    .replace(EMAIL_RE, REDACTED)
    .replace(PHONE_RE, REDACTED)
    .replace(RUN_RE, REDACTED);
}
