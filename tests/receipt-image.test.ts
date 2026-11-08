import { describe, expect, it } from "vitest";
import { readReceiptText, receiptChecks, receiptReason } from "@/lib/proofs/receipt-image";

// Texto real lido pelo OCR de um ecrã do Multicaixa Express.
const OCR = `11 005100000509673910179 — 08-11-2026 22:41:23
639182*+*+**6863
PAGAMENTO REALIZADO
COM SUCESSO
9.900,00 Kz
MONTANTE
954269550
REFERÊNCIA
10116 - PAYPAY ÁFRICA
ENTIDADE
PAYPAY AFRICA
REFERÊNCIA: 954 269 550
MONTANTE: 9900.00
CARREGAMENTO
PAGO 042000000000114081940
INFORMAÇÃO
SALDO ACTUAL ***** /5\\`;

const order = {
  created_at: "2026-11-08T21:30:00Z", expires_at: "2026-11-09T21:30:00Z",
  amount_due: 9900, payment_entity: "10116", payment_reference: "954269550",
};
const codes = (c: ReturnType<typeof receiptChecks>) => Object.fromEntries(c.map((x) => [x.code, x.result]));

describe("comprovativo em imagem", () => {
  it("lê um ecrã real do Multicaixa Express", () => {
    expect(readReceiptText(OCR, order)).toEqual({
      entity: "10116", reference: "954269550", amount: 9900, paidAt: "2026-11-08T21:41:23.000Z",
    });
  });
  it("confere quando tudo bate certo, mas nunca decide sozinho", () => {
    const checks = receiptChecks(readReceiptText(OCR, order), order, false);
    expect(new Set(checks.map((c) => c.result))).toEqual(new Set(["pass"]));
    expect(checks.every((c) => c.effect !== "reject")).toBe(true);
    expect(receiptReason(checks)).toContain("Confirme a entrada do dinheiro");
  });
  it("apanha outra referência", () => {
    const r = readReceiptText(OCR.replaceAll("954269550", "111222333").replace("954 269 550", "111 222 333"), order);
    expect(r.reference).toBe("111222333");
    expect(codes(receiptChecks(r, order, false)).entity_reference).toBe("fail");
  });
  it("apanha um valor inferior, sem o confundir com a referência ou o saldo", () => {
    const text = "4.000,00 Kz\nMONTANTE\n954269550\nREFERÊNCIA\nSALDO ACTUAL 9.900,00 Kz";
    const r = readReceiptText(text, order);
    expect(r.amount).toBe(4000);
    const checks = receiptChecks(r, order, false);
    expect(codes(checks).amount).toBe("fail");
    expect(receiptReason(checks)).toContain("inferior");
  });
  it("assinala pagamentos fora do prazo e comprovativos repetidos", () => {
    const late = { ...order, created_at: "2026-11-09T00:00:00Z", expires_at: "2026-11-10T00:00:00Z" };
    const checks = codes(receiptChecks(readReceiptText(OCR, late), late, true));
    expect(checks.paid_at_window).toBe("fail");
    expect(checks.image_repeat).toBe("fail");
  });
  it("avisa quando não consegue ler", () => {
    const r = readReceiptText("foto desfocada", order);
    expect(r).toEqual({ entity: null, reference: null, amount: null, paidAt: null });
    expect(receiptReason(receiptChecks(r, order, false))).toContain("lida em parte");
  });
});
