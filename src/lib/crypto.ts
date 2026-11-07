import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifra AES-256-GCM para segredos guardados na BD (ex.: token da API de
 * Conversões). Chave em META_TOKEN_ENCRYPTION_KEY (32 bytes em base64).
 * Formato: v1.<iv>.<tag>.<texto cifrado>, tudo em base64url.
 */
function key(): Buffer {
  const raw = process.env.META_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("Variável de ambiente em falta: META_TOKEN_ENCRYPTION_KEY");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("META_TOKEN_ENCRYPTION_KEY tem de ter 32 bytes (base64)");
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptSecret(token: string): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Segredo em formato inválido");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
