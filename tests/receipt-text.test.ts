import { describe, expect, it } from "vitest";
import { readReceiptText } from "@/lib/proofs/receipt-text";
import { BAI_DIRECTO, EXPRESS_DETAIL, EXPRESS_PDF, EXPRESS_SUCCESS, EXPRESS_SUCCESS_SEM_DATA } from "./helpers/ocr-texts";

describe("modelos de comprovativo", () => {
  it("lê o ecrã de pagamento realizado do Multicaixa Express", () => {
    expect(readReceiptText(EXPRESS_SUCCESS)).toEqual({
      layout: "express_success", success: true, entity: "10116", reference: "955567206",
      amount: 9900, paidAt: "2026-11-03T03:37:43.000Z", transactionId: null, conflicts: [], missing: [],
    });
  });

  it("lê o detalhe do pagamento, onde os valores estão a cinzento claro", () => {
    expect(readReceiptText(EXPRESS_DETAIL)).toMatchObject({
      layout: "express_detail", success: true, entity: "10116", reference: "921411702",
      amount: 3500, paidAt: "2026-11-11T20:38:00.000Z", transactionId: "2457591", conflicts: [], missing: [],
    });
  });

  it("lê o comprovativo digital fotografado do leitor de PDF", () => {
    expect(readReceiptText(EXPRESS_PDF)).toMatchObject({
      layout: "express_pdf", success: true, entity: "10116", reference: "927411146",
      amount: 3500, paidAt: "2026-11-06T04:48:54.000Z", transactionId: "6722566", conflicts: [], missing: [],
    });
  });

  it("lê o BAI Directo, onde a entidade vem do nome do serviço", () => {
    expect(readReceiptText(BAI_DIRECTO)).toMatchObject({
      layout: "bai_directo", success: true, entity: "10116", reference: "953281086",
      amount: 9900, paidAt: "2026-11-05T12:34:59.000Z", conflicts: [], missing: [],
    });
  });

  it("um ecrã cortado acima da data fica sem data, com tudo o resto lido", () => {
    expect(readReceiptText(EXPRESS_SUCCESS_SEM_DATA)).toMatchObject({
      layout: "express_success", success: true, entity: "10116", reference: "955567206",
      amount: 9900, paidAt: null, missing: ["paidAt"], conflicts: [],
    });
  });

  it("não inventa um modelo a partir de uma imagem qualquer", () => {
    expect(readReceiptText(["bom dia", "foto do gato", "a"]).layout).toBe(null);
  });
});

describe("leituras cruzadas", () => {
  it("um dado lido num só dos dois sítios fica por confirmar", () => {
    const [a, b, c] = EXPRESS_SUCCESS;
    const semCampo = (t: string) => t.replace("955567206\n", "95556720G\n");
    const r = readReceiptText([a, semCampo(b), semCampo(c)]);
    // O texto do recibo ainda o dá, e é mostrado ao administrador, mas não chega para aprovar.
    expect(r.reference).toBe("955567206");
    expect(r.missing).toContain("reference");
  });

  it("um dado que nenhuma leitura apanha duas vezes não conta", () => {
    const [a, b, c] = EXPRESS_SUCCESS;
    const semData = (t: string) => t.replace("03-11-2026 04:37:43", "03-11-2O26 04:37:43");
    const r = readReceiptText([a, semData(b), semData(c)]);
    expect(r.paidAt).toBe(null);
    expect(r.missing).toContain("paidAt");
  });

  it("duas leituras iguais chegam, mesmo com a terceira a falhar", () => {
    const [a, b, c] = EXPRESS_SUCCESS;
    const r = readReceiptText([a, b, c.replace("9.900,00 Kz", "9.90O,0O Kz")]);
    expect(r.amount).toBe(9900);
    expect(r.missing).toEqual([]);
  });

  it("duas leituras que dizem valores diferentes dão conflito, não um palpite", () => {
    const [a, b, c] = EXPRESS_SUCCESS;
    const r = readReceiptText([a, b.replace("9.900,00 Kz", "3.500,00 Kz"), c.replace("9.900,00 Kz", "3.500,00 Kz")]);
    expect(r.amount).toBe(null);
    expect(r.conflicts).toContain("amount");
  });

  it("o valor do campo tem de bater certo com o do texto do recibo", () => {
    const trocado = EXPRESS_SUCCESS.map((t) => t.replace("MONTANTE: 9900.00", "MONTANTE: 3500.00"));
    const r = readReceiptText(trocado);
    expect(r.amount).toBe(null);
    expect(r.conflicts).toContain("amount");
  });

  it("a referência do campo tem de bater certo com a do texto do recibo", () => {
    const trocado = EXPRESS_SUCCESS.map((t) => t.replace("REFERÊNCIA: 955 567 206", "REFERÊNCIA: 111 222 333").replace("REFERENCIA: 955 567 206", "REFERENCIA: 111 222 333"));
    const r = readReceiptText(trocado);
    expect(r.reference).toBe(null);
    expect(r.conflicts).toContain("reference");
  });

  it("leituras que veem modelos diferentes não decidem nada", () => {
    expect(readReceiptText([EXPRESS_SUCCESS[0], EXPRESS_DETAIL[0], BAI_DIRECTO[0]]).layout).toBe(null);
  });

  it("o texto de um PDF é exato: uma leitura basta", () => {
    expect(readReceiptText([EXPRESS_PDF[2]], 1)).toMatchObject({ layout: "express_pdf", amount: 3500, reference: "927411146" });
  });
});

describe("operação que não foi concluída", () => {
  it("o detalhe com estado diferente de Sucesso não passa", () => {
    const falhado = EXPRESS_DETAIL.map((t) => t.replace(/Estado \| Sucesso/g, "Estado | Rejeitado"));
    const r = readReceiptText(falhado);
    expect(r.success).toBe(false);
    expect(r.missing).toContain("success");
  });

  it("o BAI Directo sem 'Estado: Sucesso' não passa", () => {
    const r = readReceiptText(BAI_DIRECTO.map((t) => t.replace(/Estado: Sucesso/g, "Estado: Pendente")));
    expect(r.success).toBe(false);
  });
});
