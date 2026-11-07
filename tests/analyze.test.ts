import { describe, expect, it } from "vitest";
import { analyzePdf, parsePdfDate, renderPdfPage } from "@/lib/proofs/analyze";
import { extractFields } from "@/lib/proofs/extract";
import { decide } from "@/lib/proofs/decide";
import { verifyPdfSignature } from "@/lib/proofs/signature";
import { buildFingerprint, matchTemplate, type TemplateRow } from "@/lib/proofs/templates";
import { appendIncrementalUpdate, expressLikeReceipt, tamperAmount } from "./helpers/receipts";
import { ORDER, PAYMENT } from "./helpers/fixtures";

describe("parsePdfDate", () => {
  it.each([
    ["D:20261016173235+01'00'", "2026-10-16T16:32:35.000Z"],
    ["D:20261016163235Z", "2026-10-16T16:32:35.000Z"],
    ["D:20261016", "2026-10-16T00:00:00.000Z"],
  ])("%s", (raw, iso) => expect(parsePdfDate(raw)).toBe(iso));
  it("ignora valores inválidos", () => expect(parsePdfDate(undefined)).toBeNull());
});

describe("analyzePdf com um comprovativo gerado", () => {
  it("lê metadados, fontes, página e texto com posições", async () => {
    const a = await analyzePdf(await expressLikeReceipt());
    expect(a).toMatchObject({
      kind: "pdf",
      pageCount: 1,
      pageSize: [595, 842],
      incrementalUpdates: 0,
      overlappingText: [],
      optionalContent: false,
      invisibleText: false,
    });
    expect(a.producer).toMatch(/iText/);
    expect(a.fonts).toEqual(["Helvetica", "Helvetica-Bold"]);
    expect(a.creationDate).toBe(a.modDate);
    expect(a.text).toContain("MULTICAIXA Express");
    expect(a.signature.present).toBe(false);
  });

  it("extrai os campos do texto lido", async () => {
    const a = await analyzePdf(await expressLikeReceipt({ amount: "5.017,00", transaction: "11223344" }));
    expect(extractFields(a.lines, a.text)).toMatchObject({
      entity: "10116",
      reference: "955567206",
      amount: 5017,
      transactionId: "11223344",
      paidAt: "2026-10-16T14:13:58.000Z",
    });
  });

  it("deteta o valor tapado e reescrito (texto sobreposto, produtor e datas alterados)", async () => {
    const forged = await analyzePdf(await tamperAmount(await expressLikeReceipt(), "50.000,00"));
    expect(forged.overlappingText.length).toBeGreaterThan(0);
    expect(forged.producer).toMatch(/pdf-lib/);
    expect(forged.modDate).not.toBe(forged.creationDate);
  });

  it("conta gravações incrementais acrescentadas no fim", async () => {
    const a = await analyzePdf(appendIncrementalUpdate(await expressLikeReceipt()));
    expect(a.incrementalUpdates).toBe(1);
  });

  it("renderiza a página em PNG para o painel", async () => {
    const png = await renderPdfPage(await expressLikeReceipt(), 1, 1);
    expect(png?.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(await renderPdfPage(await expressLikeReceipt(), 2)).toBeNull();
  });
});

describe("assinatura digital", () => {
  it("um PDF sem assinatura não é dado como assinado", async () => {
    expect(await verifyPdfSignature(await expressLikeReceipt())).toMatchObject({ present: false, valid: false });
  });

  it("assinatura com conteúdo ilegível é inválida", async () => {
    const fake = Buffer.concat([
      Buffer.from(await expressLikeReceipt()),
      Buffer.from("\n/ByteRange [0 10 30 5] /SubFilter /adbe.pkcs7.detached /Contents <DEADBEEF>\n%%EOF"),
    ]);
    const s = await verifyPdfSignature(new Uint8Array(fake));
    expect(s.present).toBe(true);
    expect(s.valid).toBe(false);
    expect(s.coversWholeFile).toBe(false);
  });
});

describe("do PDF à decisão (ponta a ponta, sem base de dados)", () => {
  async function templateFromSample(): Promise<TemplateRow> {
    const a = await analyzePdf(await expressLikeReceipt());
    return {
      id: "t", bank_code: "mcx_express", channel: "express", name: "Express", version: 1, is_active: true,
      allows_auto_approve: true, detection: { keywords: ["MULTICAIXA Express"] }, fingerprint: buildFingerprint(a, extractFields(a.lines, a.text)),
    };
  }
  async function decideFor(bytes: Uint8Array, t: TemplateRow) {
    const a = await analyzePdf(bytes);
    return decide({
      order: ORDER, payment: PAYMENT, analysis: a, extracted: extractFields(a.lines, a.text),
      template: matchTemplate(a, [t]), duplicateFile: null, transactionReuse: null,
    });
  }

  it("aprova outro comprovativo verdadeiro do mesmo formato", async () => {
    const t = await templateFromSample();
    expect((await decideFor(await expressLikeReceipt({ transaction: "55667788" }), t)).decision).toBe("approved");
  });

  it("manda o falsificado para Exceções", async () => {
    const t = await templateFromSample();
    const r = await decideFor(await tamperAmount(await expressLikeReceipt(), "50.000,00"), t);
    expect(r.decision).toBe("exception");
  });

  it("rejeita o comprovativo de outra referência", async () => {
    const t = await templateFromSample();
    expect((await decideFor(await expressLikeReceipt({ reference: "945647025" }), t)).decision).toBe("rejected");
  });
});
