import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptToken,
  encryptToken,
  parseEncryptionKey,
  TokenCryptoError,
} from "@/modules/sence/domain/token-crypto";

const key = randomBytes(32);
const TOKEN = "12345678-90ab-cdef-1234-567890abcdef"; // token ficticio (36 chars)

describe("token-crypto (AES-256-GCM, I-6)", () => {
  it("cifra y descifra ida y vuelta", () => {
    const enc = encryptToken(TOKEN, key);
    expect(decryptToken(enc, key)).toBe(TOKEN);
  });

  it("el ciphertext NO contiene el token en claro (I-6)", () => {
    const enc = encryptToken(TOKEN, key);
    expect(enc).not.toContain(TOKEN);
    expect(enc.startsWith("v1.")).toBe(true);
  });

  it("dos cifrados del mismo token difieren (IV aleatorio)", () => {
    expect(encryptToken(TOKEN, key)).not.toBe(encryptToken(TOKEN, key));
  });

  it("una clave equivocada NO descifra (falla, no filtra)", () => {
    const enc = encryptToken(TOKEN, key);
    expect(() => decryptToken(enc, randomBytes(32))).toThrow(TokenCryptoError);
  });

  it("un ciphertext manipulado (tag inválido) falla", () => {
    const enc = encryptToken(TOKEN, key);
    const parts = enc.split(".");
    // Corrompe el ciphertext.
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("otro-dato").toString("base64")].join(".");
    expect(() => decryptToken(tampered, key)).toThrow(TokenCryptoError);
  });

  it("rechaza formatos inválidos", () => {
    expect(() => decryptToken("no-es-valido", key)).toThrow(TokenCryptoError);
    expect(() => decryptToken("v2.a.b.c", key)).toThrow(TokenCryptoError);
  });

  it("parseEncryptionKey acepta base64 de 32 bytes", () => {
    const b64 = randomBytes(32).toString("base64");
    expect(parseEncryptionKey(b64)).toHaveLength(32);
  });

  it("parseEncryptionKey acepta hex de 64 chars", () => {
    const hex = randomBytes(32).toString("hex");
    expect(parseEncryptionKey(hex)).toHaveLength(32);
  });

  it("parseEncryptionKey rechaza una clave de largo incorrecto", () => {
    expect(() => parseEncryptionKey(Buffer.from("corta").toString("base64"))).toThrow(
      TokenCryptoError,
    );
  });
});
