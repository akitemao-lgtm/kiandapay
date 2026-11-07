import { describe, expect, it } from "vitest";
import { decide, type DecisionInput } from "@/lib/proofs/decide";
import { buildFingerprint, matchTemplate } from "@/lib/proofs/templates";
import { analysis, expressTemplate, extracted, ORDER, PAYMENT, VALID_SIGNATURE } from "./helpers/fixtures";

function run(over: Partial<DecisionInput> = {}) {
  return decide({
    order: ORDER,
    payment: PAYMENT,
    analysis: analysis(),
    extracted: extracted(),
    template: expressTemplate(),
    duplicateFile: null,
    transactionReuse: null,
    ...over,
  });
}
const failed = (r: ReturnType<typeof run>) => r.checks.filter((c) => c.result === "fail").map((c) => c.code);

describe("aprovação automática", () => {
  it("aprova um comprovativo correto, assinado e no formato do modelo", () => {
    const r = run();
    expect(r.decision).toBe("approved");
    expect(failed(r)).toEqual([]);
    expect(r.checks.find((c) => c.code === "digital_signature")?.result).toBe("pass");
  });

  it("aprova quando se paga mais do que o valor do pedido", () => {
    expect(run({ extracted: extracted({ amount: 5500 }) }).decision).toBe("approved");
  });

  it("aceita referência com espaços no pedido", () => {
    expect(run({ payment: { entity: "10116", reference: "955 567 206" } }).decision).toBe("approved");
  });

  it("aceita 2 minutos de diferença de relógio antes da criação do pedido", () => {
    expect(run({ extracted: extracted({ paidAt: "2026-10-16T13:59:00.000Z" }) }).decision).toBe("approved");
  });
});

describe("rejeição automática (regras 1, 3, 4, 5)", () => {
  it("regra 1: entidade diferente", () => {
    const r = run({ extracted: extracted({ entity: "99999" }) });
    expect(r.decision).toBe("rejected");
    expect(r.reasonCode).toBe("entity_reference");
    expect(r.reason).toMatch(/Entidade ou a Referência/);
  });

  it("regra 1: referência diferente", () => {
    expect(run({ extracted: extracted({ reference: "945647025" }) }).decision).toBe("rejected");
  });

  it("regra 3: pagamento anterior à criação do pedido", () => {
    const r = run({ extracted: extracted({ paidAt: "2026-10-15T10:00:00.000Z" }) });
    expect(r.decision).toBe("rejected");
    expect(r.checks.find((c) => c.code === "paid_at_window")?.message).toMatch(/anterior/);
  });

  it("regra 3: pagamento depois do prazo", () => {
    const r = run({ extracted: extracted({ paidAt: "2026-10-18T10:00:00.000Z" }) });
    expect(r.decision).toBe("rejected");
    expect(r.checks.find((c) => c.code === "paid_at_window")?.message).toMatch(/depois do prazo/);
  });

  it("regra 4: transação usada noutro pedido pago → rejeita e marca fraude", () => {
    const r = run({ transactionReuse: { otherOrderPaid: true } });
    expect(r).toMatchObject({ decision: "rejected", reasonCode: "txn_unique", fraud: true });
  });

  it("regra 4: transação noutro pedido ainda por pagar → rejeita sem fraude", () => {
    expect(run({ transactionReuse: { otherOrderPaid: false } })).toMatchObject({ decision: "rejected", fraud: false });
  });

  it("regra 5: o mesmo ficheiro neste pedido", () => {
    const r = run({ duplicateFile: { sameOrder: true, otherOrderPaid: false } });
    expect(r).toMatchObject({ decision: "rejected", reasonCode: "duplicate_file", fraud: false });
    expect(r.reason).toMatch(/já foi enviado/);
  });

  it("regra 5: o mesmo ficheiro de outro pedido já pago → fraude", () => {
    expect(run({ duplicateFile: { sameOrder: false, otherOrderPaid: true } })).toMatchObject({ decision: "rejected", fraud: true });
  });

  it("uma rejeição ganha a uma exceção", () => {
    const r = run({ extracted: extracted({ entity: "99999", amount: 100 }) });
    expect(r.decision).toBe("rejected");
  });
});

describe("Exceções (revisão manual)", () => {
  it("valor inferior ao do pedido", () => {
    const r = run({ extracted: extracted({ amount: 4999 }) });
    expect(r.decision).toBe("exception");
    expect(r.reasonCode).toBe("amount");
  });

  it.each([
    ["valor", { amount: null }, "amount"],
    ["data", { paidAt: null }, "paid_at_window"],
    ["transação", { transactionId: null }, "txn_unique"],
    ["entidade", { entity: null }, "entity_reference"],
  ])("campo por ler (%s)", (_, over, code) => {
    const r = run({ extracted: extracted(over) });
    expect(r.decision).toBe("exception");
    expect(r.reasonCode).toBe(code);
  });

  it("imagem ou fotografia vai sempre para Exceções", () => {
    expect(run({ analysis: { kind: "image", qr: [] }, extracted: null })).toMatchObject({
      decision: "exception", reasonCode: "image", reason: "Comprovativo em imagem (verificação manual)",
    });
  });

  it("banco sem modelo de referência nunca é aprovado", () => {
    const r = run({ template: null });
    expect(r.decision).toBe("exception");
    expect(failed(r)).toContain("template_known");
  });

  it("modelo marcado só para revisão manual", () => {
    expect(run({ template: expressTemplate({ allows_auto_approve: false }) }).reasonCode).toBe("auto_approve");
  });
});

describe("verificações de autenticidade", () => {
  it.each([
    ["Microsoft® Word 2019"],
    ["Canva"],
    ["iLovePDF"],
    ["Adobe Acrobat Pro DC 23.1"],
  ])("software de edição no produtor: %s", (producer) => {
    expect(failed(run({ analysis: analysis({ producer }) }))).toContain("editor_software");
  });

  it("assinatura digital inválida (PDF alterado depois de assinado)", () => {
    const r = run({ analysis: analysis({ signature: { ...VALID_SIGNATURE, valid: false, error: "Message digest doesn't match" } }) });
    expect(r.decision).toBe("exception");
    expect(failed(r)).toContain("digital_signature");
  });

  it("conteúdo acrescentado depois da assinatura", () => {
    expect(failed(run({ analysis: analysis({ signature: { ...VALID_SIGNATURE, coversWholeFile: false } }) }))).toContain("digital_signature");
  });

  it("formato assinado mas este PDF não tem assinatura", () => {
    const sig = { ...VALID_SIGNATURE, present: false, valid: false, coversWholeFile: false };
    expect(failed(run({ analysis: analysis({ signature: sig }) }))).toContain("digital_signature");
  });

  it("assinado com outro certificado (mesmo nome, chave diferente)", () => {
    const r = run({ analysis: analysis({ signature: { ...VALID_SIGNATURE, certSha256: "b".repeat(64) } }) });
    expect(r.checks.find((c) => c.code === "digital_signature")?.message).toMatch(/certificado desconhecido/);
  });

  it.each([
    ["produtor diferente", { producer: "OutraCoisa 1.0" }, "producer"],
    ["versão PDF diferente", { pdfVersion: "1.4" }, "pdf_version"],
    ["fonte que o modelo não usa", { fonts: ["Helvetica", "Arial-BoldMT"] }, "fonts"],
    ["tamanho de página diferente", { pageSize: [612, 792] as [number, number] }, "page_layout"],
    ["gravação incremental", { incrementalUpdates: 1 }, "incremental_updates"],
    ["data de modificação diferente", { modDate: "2026-10-17T09:00:00.000Z" }, "mod_date"],
    ["texto sobreposto", { overlappingText: [{ a: "Montante 5.000,00", b: "Montante 50.000,00" }] }, "hidden_text"],
    ["camadas escondidas", { optionalContent: true }, "hidden_text"],
    ["texto minúsculo", { tinyText: true }, "hidden_text"],
    ["PDF cifrado", { encrypted: true }, "encrypted"],
  ])("%s", (_, over, code) => {
    const r = run({ analysis: analysis(over) });
    expect(r.decision).toBe("exception");
    expect(failed(r)).toContain(code);
  });

  it("campo fora da posição do modelo", () => {
    const ex = extracted();
    const moved = extracted({ positions: { ...ex.positions, amount: { x: 0.6, y: 0.8, page: 1 } } });
    expect(failed(run({ extracted: moved }))).toContain("field_positions");
  });

  describe("QR code", () => {
    const withQr = expressTemplate({ fingerprint: buildFingerprint(analysis({ qr: ["X"] }), extracted()) });
    it("confere quando o QR contém a transação", () => {
      expect(run({ template: withQr, analysis: analysis({ qr: ["TRX=21466518;VAL=5000"] }) }).decision).toBe("approved");
    });
    it("falha quando o QR não corresponde", () => {
      expect(failed(run({ template: withQr, analysis: analysis({ qr: ["TRX=999;VAL=1"] }) }))).toContain("qr_match");
    });
    it("falha quando o modelo tem QR e este não", () => {
      expect(failed(run({ template: withQr, analysis: analysis({ qr: [] }) }))).toContain("qr_match");
    });
  });
});

describe("modelos de referência", () => {
  it("uma amostra nova alarga o modelo (fontes, certificados) sem perder as anteriores", () => {
    const base = expressTemplate().fingerprint;
    const novo = buildFingerprint(
      analysis({ fonts: ["Helvetica", "Helvetica-Oblique"], signature: { ...VALID_SIGNATURE, certSha256: "c".repeat(64) } }),
      extracted(),
      base,
    );
    expect(novo.fonts).toEqual(["Helvetica", "Helvetica-Bold", "Helvetica-Oblique"]);
    expect(novo.signerCerts).toEqual(["a".repeat(64), "c".repeat(64)]);
    expect(novo.samples).toBe(2);
    expect(novo.signed).toBe(true);
  });

  it("deixa de exigir assinatura se uma amostra verdadeira vier sem ela", () => {
    const novo = buildFingerprint(analysis({ signature: { ...VALID_SIGNATURE, present: false, valid: false } }), extracted(), expressTemplate().fingerprint);
    expect(novo.signed).toBe(false);
  });

  it("identifica o modelo pelo produtor, página, fontes e palavras obrigatórias", () => {
    const t = expressTemplate();
    expect(matchTemplate(analysis(), [t])?.id).toBe("tpl-express");
    expect(matchTemplate(analysis({ text: "outro banco" }), [t])).toBeNull(); // falta "MULTICAIXA Express"
    expect(matchTemplate(analysis(), [{ ...t, is_active: false }])).toBeNull();
  });
});
