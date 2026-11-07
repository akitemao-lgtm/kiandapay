import "server-only";
import { createHash, webcrypto } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

/**
 * Assinatura digital de PDFs (PKCS#7 destacada, como a do Multicaixa Express).
 * Se o PDF for alterado depois de assinado — nem que seja um carácter — o
 * resumo deixa de bater certo e a assinatura fica inválida.
 */
export type SignatureInfo = {
  present: boolean;
  count: number;
  /** A zona assinada vai do primeiro ao último byte do ficheiro. */
  coversWholeFile: boolean;
  /** Resumo (hash) e assinatura criptográfica válidos. */
  valid: boolean;
  subFilter: string | null;
  signer: string | null;
  issuer: string | null;
  certSha256: string | null;
  signedAt: string | null;
  error: string | null;
};

const EMPTY: SignatureInfo = {
  present: false, count: 0, coversWholeFile: false, valid: false, subFilter: null,
  signer: null, issuer: null, certSha256: null, signedAt: null, error: null,
};

const OID_NAMES: Record<string, string> = {
  "2.5.4.3": "CN", "2.5.4.10": "O", "2.5.4.11": "OU", "2.5.4.6": "C", "2.5.4.7": "L", "2.5.4.8": "ST",
};

let engineReady = false;
function ensureEngine() {
  if (engineReady) return;
  pkijs.setEngine("node", new pkijs.CryptoEngine({ name: "node", crypto: webcrypto as unknown as Crypto }));
  engineReady = true;
}

function dn(name: pkijs.RelativeDistinguishedNames): string {
  return name.typesAndValues
    .map((tv) => `${OID_NAMES[tv.type] ?? tv.type}=${String(tv.value.valueBlock.value)}`)
    .join(", ");
}

function parsePdfDate(raw: string | undefined): string | null {
  const m = raw?.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([Zz+-])?(\d{2})?'?(\d{2})?/);
  if (!m) return null;
  let ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (m[7] === "+" || m[7] === "-") ms -= (m[7] === "+" ? 1 : -1) * (+(m[8] ?? 0) * 60 + +(m[9] ?? 0)) * 60_000;
  return new Date(ms).toISOString();
}

export async function verifyPdfSignature(bytes: Uint8Array): Promise<SignatureInfo> {
  const raw = Buffer.from(bytes).toString("latin1");
  const ranges = [...raw.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  if (!ranges.length) return EMPTY;

  // A última assinatura é a que tem de cobrir o ficheiro todo.
  const last = ranges[ranges.length - 1];
  const [a, b, c, d] = last.slice(1, 5).map(Number);
  const around = raw.slice(Math.max(0, (last.index ?? 0) - 2000), (last.index ?? 0) + 2000);
  const info: SignatureInfo = {
    ...EMPTY,
    present: true,
    count: ranges.length,
    coversWholeFile: a === 0 && b < c && c + d === bytes.length,
    subFilter: around.match(/\/SubFilter\s*\/([\w.]+)/)?.[1] ?? null,
    signedAt: parsePdfDate(around.match(/\/M\s*\((D:[^)]*)\)/)?.[1]),
  };
  if (b >= c || c + d > bytes.length) return { ...info, error: "Intervalo assinado inválido" };
  if (info.subFilter && !/pkcs7\.detached|ETSI\.CAdES\.detached/i.test(info.subFilter)) {
    return { ...info, error: `Tipo de assinatura não suportado: ${info.subFilter}` };
  }

  try {
    ensureEngine();
    const hex = raw.slice(b, c).replace(/[<>\s]/g, "").replace(/(00)+$/, "");
    const der = Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");
    const asn = asn1js.fromBER(new Uint8Array(der).buffer);
    if (asn.offset === -1) return { ...info, error: "Assinatura ilegível" };
    const content = new pkijs.ContentInfo({ schema: asn.result });
    const signed = new pkijs.SignedData({ schema: content.content });

    const data = Buffer.concat([Buffer.from(bytes.subarray(a, a + b)), Buffer.from(bytes.subarray(c, c + d))]);
    const result = await signed.verify({
      signer: 0,
      data: new Uint8Array(data).buffer,
      checkChain: false,
      extendedMode: true,
    });

    const cert = (result as { signerCertificate?: pkijs.Certificate }).signerCertificate
      ?? (signed.certificates?.[0] as pkijs.Certificate | undefined);
    return {
      ...info,
      valid: (result as { signatureVerified?: boolean }).signatureVerified === true,
      signer: cert ? dn(cert.subject) : null,
      issuer: cert ? dn(cert.issuer) : null,
      certSha256: cert ? createHash("sha256").update(Buffer.from(cert.toSchema().toBER(false))).digest("hex") : null,
    };
  } catch (e) {
    return { ...info, valid: false, error: `Assinatura inválida: ${(e as Error).message ?? e}`.slice(0, 200) };
  }
}
