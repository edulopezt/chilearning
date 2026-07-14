import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado del token del OTEC en reposo (I-6): AES-256-GCM. El token solo se
 * descifra en memoria al construir el POST hacia SENCE (I-7). La clave viene de
 * `SENCE_TOKEN_ENCRYPTION_KEY` (base64 de 32 bytes; `openssl rand -base64 32`).
 *
 * Formato del ciphertext persistido: `v1.<iv_b64>.<tag_b64>.<ct_b64>` — versionado
 * para poder rotar el esquema sin ambigüedad. NUNCA se registra el token en claro.
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // recomendado para GCM
const KEY_BYTES = 32;
const VERSION = "v1";

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCryptoError";
  }
}

/** Decodifica y valida la clave. Acepta base64 (32 bytes) o hex (64 chars). */
export function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else {
    key = Buffer.from(trimmed, "base64");
  }
  if (key.length !== KEY_BYTES) {
    throw new TokenCryptoError(
      `SENCE_TOKEN_ENCRYPTION_KEY debe decodificar a ${KEY_BYTES} bytes (recibió ${key.length}). Genera con: openssl rand -base64 32`,
    );
  }
  return key;
}

export function encryptToken(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new TokenCryptoError("clave de cifrado inválida");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decryptToken(encoded: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new TokenCryptoError("clave de cifrado inválida");
  const parts = encoded.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new TokenCryptoError("formato de token cifrado inválido o versión desconocida");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  try {
    const iv = Buffer.from(ivB64!, "base64");
    const tag = Buffer.from(tagB64!, "base64");
    const ct = Buffer.from(ctB64!, "base64");
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    // Un tag inválido (manipulación o clave equivocada) cae aquí. No se filtra
    // ningún dato del token.
    throw new TokenCryptoError("no se pudo descifrar el token (clave o datos inválidos)");
  }
}
