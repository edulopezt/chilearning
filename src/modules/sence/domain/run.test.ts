import { describe, expect, it } from "vitest";
import { computeDv, isValidRun, MAX_RUN_LENGTH, normalizeRun } from "./run";

/**
 * All RUNs here are FICTITIOUS (no real people), per project rules. Their check
 * digits were computed with the module-11 algorithm the contract mandates.
 */

describe("computeDv (module-11 check digit)", () => {
  it("computes numeric check digits for fictitious bodies", () => {
    expect(computeDv("11111111")).toBe("1");
    expect(computeDv("5126663")).toBe("3");
    expect(computeDv("12345678")).toBe("5");
    expect(computeDv("1")).toBe("9");
    expect(computeDv("6355650")).toBe("5");
  });

  it("returns lowercase 'k' when the remainder is 10 (normalized to lowercase, I-8)", () => {
    expect(computeDv("1000005")).toBe("k");
    expect(computeDv("11111109")).toBe("k");
  });

  it("returns '0' when the remainder is 11", () => {
    expect(computeDv("1000013")).toBe("0");
    expect(computeDv("1000030")).toBe("0");
  });

  it("throws for empty or non-digit input (programming error, not a domain violation)", () => {
    expect(() => computeDv("")).toThrow(TypeError);
    expect(() => computeDv("12a45")).toThrow(TypeError);
    expect(() => computeDv("1.234")).toThrow(TypeError);
  });
});

describe("normalizeRun (syntactic canonicalization for the wire)", () => {
  it("strips dots and normalizes to xxxxxxxx-x", () => {
    expect(normalizeRun("11.111.111-1")).toBe("11111111-1");
    expect(normalizeRun("5.126.663-3")).toBe("5126663-3");
  });

  it("lowercases the 'K' check digit (I-8: k normalizada a minúscula)", () => {
    expect(normalizeRun("1000005-K")).toBe("1000005-k");
    expect(normalizeRun("11.111.109-K")).toBe("11111109-k");
  });

  it("inserts a hyphen before the check digit when missing", () => {
    expect(normalizeRun("111111111")).toBe("11111111-1");
    expect(normalizeRun("1000005k")).toBe("1000005-k");
  });

  it("strips surrounding whitespace", () => {
    expect(normalizeRun("  5126663-3  ")).toBe("5126663-3");
  });

  it("returns empty string for input without usable characters", () => {
    expect(normalizeRun("")).toBe("");
    expect(normalizeRun("   ")).toBe("");
  });
});

describe("isValidRun (strict normative shape + check digit)", () => {
  it("accepts valid fictitious RUNs", () => {
    expect(isValidRun("11111111-1")).toBe(true);
    expect(isValidRun("5126663-3")).toBe(true);
    expect(isValidRun("12345678-5")).toBe(true);
    expect(isValidRun("1-9")).toBe(true);
  });

  it("accepts a valid RUN whose check digit is 'k' in either case", () => {
    expect(isValidRun("1000005-k")).toBe(true);
    expect(isValidRun("1000005-K")).toBe(true);
    expect(isValidRun("11111109-k")).toBe(true);
  });

  it("rejects a RUN with an incorrect check digit", () => {
    expect(isValidRun("11111111-2")).toBe(false);
    expect(isValidRun("5126663-4")).toBe(false);
    expect(isValidRun("1000005-1")).toBe(false); // real DV is k
  });

  it("rejects the dotted format (not the normative wire shape)", () => {
    expect(isValidRun("11.111.111-1")).toBe(false);
    expect(isValidRun("5.126.663-3")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(isValidRun("")).toBe(false);
  });

  it("rejects a RUN longer than 10 characters (body over 8 digits)", () => {
    expect(isValidRun("123456789-5")).toBe(false); // 9 body digits, length 11
    expect("123456789-5".length).toBeGreaterThan(MAX_RUN_LENGTH);
  });

  it("rejects shapes without a single separating hyphen", () => {
    expect(isValidRun("111111111")).toBe(false); // no hyphen
    expect(isValidRun("1111-1111-1")).toBe(false); // extra hyphen
    expect(isValidRun("11111111-")).toBe(false); // missing DV
  });

  it("round-trips: normalize then validate a dotted uppercase-K RUN", () => {
    const raw = "1.000.005-K";
    expect(isValidRun(raw)).toBe(false); // dotted, not yet normalized
    expect(isValidRun(normalizeRun(raw))).toBe(true);
  });
});
