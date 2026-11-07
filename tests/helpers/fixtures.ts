import type { PdfAnalysis } from "@/lib/proofs/analyze";
import type { Extracted } from "@/lib/proofs/extract";
import { buildFingerprint, type TemplateRow } from "@/lib/proofs/templates";
import type { SignatureInfo } from "@/lib/proofs/signature";

export const VALID_SIGNATURE: SignatureInfo = {
  present: true, count: 1, coversWholeFile: true, valid: true, subFilter: "adbe.pkcs7.detached",
  signer: "C=AO, O=EMIS - Empresa Interbancaria de Servicos SA, CN=noreply@mcxexpress.co.ao",
  issuer: "C=AO, O=EMIS - Empresa Interbancaria de Servicos SA, CN=EC EMIS RAIZ 01",
  certSha256: "a".repeat(64), signedAt: "2026-10-16T16:32:35.000Z", error: null,
};

export function analysis(over: Partial<PdfAnalysis> = {}): PdfAnalysis {
  return {
    kind: "pdf",
    producer: "iText® 7.0.5; modified using iText® 5.5.13.3",
    creator: null,
    pdfVersion: "1.7",
    creationDate: "2026-10-16T16:32:35.000Z",
    modDate: "2026-10-16T16:32:35.000Z",
    encrypted: false,
    pageCount: 1,
    pageSize: [595, 842],
    fonts: ["Helvetica", "Helvetica-Bold"],
    eofCount: 1,
    linearized: false,
    incrementalUpdates: 0,
    optionalContent: false,
    invisibleText: false,
    tinyText: false,
    overlappingText: [],
    lines: [],
    text: "Comprovativo Digital MULTICAIXA Express",
    qr: [],
    signature: VALID_SIGNATURE,
    ...over,
  };
}

export function extracted(over: Partial<Extracted> = {}): Extracted {
  return {
    entity: "10116",
    reference: "955567206",
    amount: 5000,
    paidAt: "2026-10-16T14:13:58.000Z",
    transactionId: "21466518",
    payerName: null,
    positions: {
      entity: { x: 0.235, y: 0.353, page: 1 },
      reference: { x: 0.235, y: 0.38, page: 1 },
      amount: { x: 0.235, y: 0.406, page: 1 },
      paidAt: { x: 0.235, y: 0.3, page: 1 },
      transactionId: { x: 0.235, y: 0.43, page: 1 },
    },
    bankGuess: "mcx_express",
    ...over,
  };
}

/** Modelo do Multicaixa Express construído a partir de uma amostra "verdadeira". */
export function expressTemplate(over: Partial<TemplateRow> = {}): TemplateRow {
  return {
    id: "tpl-express",
    bank_code: "mcx_express",
    channel: "express",
    name: "Multicaixa Express",
    version: 1,
    is_active: true,
    allows_auto_approve: true,
    detection: { keywords: ["MULTICAIXA Express"] },
    fingerprint: buildFingerprint(analysis(), extracted()),
    ...over,
  };
}

export const ORDER = {
  created_at: "2026-10-16T14:00:00.000Z",
  expires_at: "2026-10-17T14:00:00.000Z",
  amount_due: 5000,
};
export const PAYMENT = { entity: "10116", reference: "955567206" };
