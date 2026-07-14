/**
 * Chilean RUN validation, normalization and check-digit computation.
 *
 * Pure domain (no IO). Derived from the frozen SENCE engine contract
 * (`src/modules/sence/README.md`, invariant I-8) and the SENCE manual v1.1.6
 * field table: RUN/RUT is sent as `xxxxxxxx-x` — no dots, single hyphen,
 * check digit ('k') normalized to LOWERCASE, maximum length 10.
 *
 * Design decisions (documented per task requirements):
 *  - `computeDv` returns the check digit as a lowercase string ('0'..'9' | 'k'),
 *    matching the normative send format ("k normalizada a minúscula", I-8).
 *  - `isValidRun` is STRICT about shape: it rejects dots, thousands separators,
 *    missing hyphen and any body longer than 8 digits (total length > 10). It
 *    accepts the check digit in EITHER case ('k' or 'K') because the value is
 *    the same valid digit regardless of case; `normalizeRun` is what lowercases
 *    it for the wire. Callers that need the canonical send form should
 *    `normalizeRun` first, then `isValidRun`.
 *  - `normalizeRun` is purely syntactic (strips dots/spaces, lowercases 'K',
 *    guarantees a single separating hyphen). It does NOT verify the check
 *    digit — validity is `isValidRun`'s job.
 */

/** Strict normative RUN shape: up to 8 body digits, hyphen, one check char. */
const RUN_STRICT = /^\d{1,8}-[0-9kK]$/;

/** Maximum length of a RUN/RUT on the wire (`xxxxxxxx-x`). */
export const MAX_RUN_LENGTH = 10;

/**
 * Compute the module-11 check digit for a numeric RUN body.
 *
 * @param body - The RUN without its check digit, digits only (e.g. `"5126663"`).
 * @returns The check digit as a lowercase string: `'0'`..`'9'` or `'k'`.
 * @throws {TypeError} If `body` is empty or contains non-digit characters
 *   (a programming error, never an expected domain violation).
 */
export function computeDv(body: string): string {
  if (body.length === 0 || !/^\d+$/.test(body)) {
    throw new TypeError("computeDv expects a non-empty digit string");
  }
  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    // charCodeAt never returns undefined; '0' === 48. RUN_STRICT/regex guard digits.
    const digit = body.charCodeAt(i) - 48;
    sum += digit * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  if (remainder === 11) return "0";
  if (remainder === 10) return "k";
  return String(remainder);
}

/**
 * Normalize a raw RUN/RUT string to the canonical send form `xxxxxxxx-x`.
 *
 * Strips dots and whitespace, lowercases the check digit, and guarantees a
 * single hyphen separating the body from the (last) check character. Best
 * effort and syntactic only: does NOT validate the check digit. Expects the
 * input to already include a check digit (body + DV).
 *
 * @returns The normalized RUN, or `""` if the input has no usable characters.
 */
export function normalizeRun(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\./g, "")
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .toLowerCase();
  if (cleaned.length === 0) return "";
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  return `${body}-${dv}`;
}

/**
 * Validate a RUN/RUT in the strict normative send shape.
 *
 * Returns `true` only when `raw` matches `^\d{1,8}-[0-9kK]$` (no dots, single
 * hyphen, total length ≤ 10) AND its check digit matches the module-11
 * computation. The check digit is accepted in either case ('k'/'K').
 */
export function isValidRun(raw: string): boolean {
  if (!RUN_STRICT.test(raw)) return false;
  const hyphen = raw.indexOf("-");
  const body = raw.slice(0, hyphen);
  const dv = raw.slice(hyphen + 1).toLowerCase();
  return computeDv(body) === dv;
}
