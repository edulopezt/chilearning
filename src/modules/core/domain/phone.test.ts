import { describe, expect, it } from "vitest";

import { isValidClMobilePhone, normalizeClMobilePhone } from "./phone";

describe("normalizeClMobilePhone", () => {
  it("acepta formato E.164 exacto", () => {
    expect(normalizeClMobilePhone("+56912345678")).toEqual({
      e164: "+56912345678",
      display: "+56 9 1234 5678",
    });
  });

  it("tolera espacios, guiones y paréntesis", () => {
    expect(normalizeClMobilePhone("+56 9 1234 5678")).toEqual({
      e164: "+56912345678",
      display: "+56 9 1234 5678",
    });
    expect(normalizeClMobilePhone("9-1234-5678")).toEqual({
      e164: "+56912345678",
      display: "+56 9 1234 5678",
    });
    expect(normalizeClMobilePhone("(9) 1234 5678")).toEqual({
      e164: "+56912345678",
      display: "+56 9 1234 5678",
    });
  });

  it("tolera con y sin +56", () => {
    expect(normalizeClMobilePhone("56912345678")).toEqual({
      e164: "+56912345678",
      display: "+56 9 1234 5678",
    });
    expect(normalizeClMobilePhone("912345678")).toEqual({
      e164: "+56912345678",
      display: "+56 9 1234 5678",
    });
  });

  it("rechaza números que no son móviles (no inician en 9)", () => {
    expect(normalizeClMobilePhone("+56221234567")).toBeNull();
  });

  it("rechaza largo incorrecto", () => {
    expect(normalizeClMobilePhone("+5691234567")).toBeNull(); // falta un dígito
    expect(normalizeClMobilePhone("+569123456789")).toBeNull(); // sobra un dígito
  });

  it("rechaza el trunk '0' que no existe en la numeración móvil chilena", () => {
    expect(normalizeClMobilePhone("0912345678")).toBeNull();
  });

  it("rechaza texto sin dígitos suficientes", () => {
    expect(normalizeClMobilePhone("no tengo teléfono")).toBeNull();
    expect(normalizeClMobilePhone("")).toBeNull();
  });
});

describe("isValidClMobilePhone", () => {
  it("refleja normalizeClMobilePhone", () => {
    expect(isValidClMobilePhone("+56 9 1234 5678")).toBe(true);
    expect(isValidClMobilePhone("221234567")).toBe(false);
  });
});
