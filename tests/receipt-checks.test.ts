import { describe, expect, it } from "vitest";
import { receiptApproved, receiptChecks, type ReceiptContext } from "@/lib/proofs/receipt-checks";
import { readReceiptText, type ReceiptReading } from "@/lib/proofs/receipt-text";
import { EXPRESS_SUCCESS, EXPRESS_SUCCESS_SEM_DATA } from "./helpers/ocr-texts";

// Comprovativo verdadeiro: 9.900,00 Kz, entidade 10116, referência 955567206, pago a 03-11-2026 04:37:43 (Luanda).
const LEITURA = readReceiptText(EXPRESS_SUCCESS);
const SEM_DATA = readReceiptText(EXPRESS_SUCCESS_SEM_DATA);

const PEDIDO = {
  order_number: 1024,
  created_at: "2026-11-03T03:30:00.000Z",
  expires_at: "2026-11-04T03:30:00.000Z",
  payment_entity: "10116",
  payment_reference: "955567206",
  amount_due: 9900,
};

function ctx(over: Partial<ReceiptContext> = {}): ReceiptContext {
  return {
    order: PEDIDO,
    earlier: [],
    uploadedAt: "2026-11-03T03:40:00.000Z",
    reuse: null,
    capture: null,
    captureReuse: null,
    allowCaptureTime: true,
    ...over,
  };
}
const decide = (r: ReceiptReading, c: Partial<ReceiptContext> = {}) => receiptApproved(receiptChecks(r, ctx(c)));
const motivos = (r: ReceiptReading, c: Partial<ReceiptContext> = {}) =>
  receiptChecks(r, ctx(c)).filter((x) => x.effect !== "none").map((x) => x.code);

describe("aprovação automática de uma imagem", () => {
  it("aprova um comprovativo verdadeiro que confere com o pedido", () => {
    expect(decide(LEITURA)).toBe(true);
  });

  it("não aprova nada quando o modelo não é reconhecido", () => {
    expect(decide(readReceiptText(["foto desfocada", "foto desfocada", "foto desfocada"]))).toBe(false);
  });

  it("não aprova quando a leitura se contradiz", () => {
    const trocado = EXPRESS_SUCCESS.map((t, i) => (i ? t.replace("9.900,00 Kz", "3.500,00 Kz") : t));
    expect(motivos(readReceiptText(trocado))).toContain("receipt_data");
  });
});

describe("o comprovativo tem de ser deste pedido", () => {
  it("recusa outra referência", () => {
    const outra = EXPRESS_SUCCESS.map((t) => t.replaceAll("955567206", "111222333").replaceAll("955 567 206", "111 222 333"));
    expect(motivos(readReceiptText(outra))).toContain("entity_reference");
  });

  it("recusa outra entidade", () => {
    const outra = EXPRESS_SUCCESS.map((t) => t.replace("10116 - PAYPAY", "99999 - PAYPAY").replace("10116 - PAYPAY", "99999 - PAYPAY"));
    expect(motivos(readReceiptText(outra))).toContain("entity_reference");
  });

  it("recusa um valor inferior ao do pedido", () => {
    expect(motivos(LEITURA, { order: { ...PEDIDO, amount_due: 15000 } })).toContain("amount");
  });

  it("deixa para análise um valor superior ao do pedido", () => {
    expect(decide(LEITURA, { order: { ...PEDIDO, amount_due: 3500 } })).toBe(false);
  });
});

describe("data do pagamento", () => {
  it("recusa um pagamento anterior à criação do pedido", () => {
    expect(motivos(LEITURA, { order: { ...PEDIDO, created_at: "2026-11-03T05:00:00.000Z", expires_at: "2026-11-04T05:00:00.000Z" } }))
      .toContain("paid_at_window");
  });

  it("recusa um pagamento feito depois do prazo", () => {
    expect(motivos(LEITURA, { order: { ...PEDIDO, created_at: "2026-11-01T00:00:00.000Z", expires_at: "2026-11-02T00:00:00.000Z" } }))
      .toContain("paid_at_window");
  });

  it("recusa uma data posterior ao envio do comprovativo", () => {
    expect(motivos(LEITURA, { uploadedAt: "2026-11-03T03:35:00.000Z" })).toContain("paid_at_window");
  });

  it("aceita quem pagou e só depois abriu o pedido novo", () => {
    const novo = { ...PEDIDO, order_number: 1030, created_at: "2026-11-03T04:00:00.000Z", expires_at: "2026-11-04T04:00:00.000Z" };
    expect(decide(LEITURA, { order: novo })).toBe(false);
    expect(decide(LEITURA, {
      order: novo,
      earlier: [{ order_number: 1024, created_at: PEDIDO.created_at, expires_at: PEDIDO.expires_at, payment_entity: "10116", payment_reference: "955567206" }],
    })).toBe(true);
  });
});

describe("o mesmo pagamento não serve dois pedidos", () => {
  it("recusa quando outro pedido já mostrou este pagamento", () => {
    expect(motivos(LEITURA, { reuse: { orderNumber: 1020, sameTransaction: false } })).toContain("image_repeat");
  });
});

describe("ecrãs que não mostram a data do pagamento", () => {
  const capture = { takenAt: "2026-11-03T04:35:00", offsetMinutes: 60, software: null };

  it("aprova pela hora da captura, feita dentro do prazo do pedido", () => {
    expect(decide(SEM_DATA, { capture })).toBe(true);
  });

  it("não aprova sem a hora da captura", () => {
    expect(decide(SEM_DATA, { capture: { takenAt: null, offsetMinutes: null, software: null } })).toBe(false);
  });

  it("não aprova com a captura desligada nas Configurações", () => {
    expect(decide(SEM_DATA, { capture, allowCaptureTime: false })).toBe(false);
  });

  it("recusa um ecrã fotografado antes de o pedido existir", () => {
    expect(motivos(SEM_DATA, { capture: { ...capture, takenAt: "2026-11-02T10:00:00" } })).toContain("paid_at_window");
  });

  it("recusa a mesma captura já usada noutro pedido", () => {
    expect(motivos(SEM_DATA, { capture, captureReuse: { orderNumber: 1019 } })).toContain("paid_at_window");
  });

  it("sem fuso gravado, aceita a hora em qualquer fuso, mas não noutro dia", () => {
    expect(decide(SEM_DATA, { capture: { takenAt: "2026-11-03T04:35:00", offsetMinutes: null, software: null } })).toBe(true);
    expect(motivos(SEM_DATA, { capture: { takenAt: "2026-11-01T04:35:00", offsetMinutes: null, software: null } })).toContain("paid_at_window");
  });
});

describe("imagem editada", () => {
  it("recusa uma imagem gravada por um programa de edição", () => {
    expect(motivos(LEITURA, { capture: { takenAt: "2026-11-03T04:35:00", offsetMinutes: 60, software: "Adobe Photoshop 25.0" } }))
      .toContain("image_capture");
  });

  it("recusa uma captura anterior ao pagamento que mostra", () => {
    expect(motivos(LEITURA, { capture: { takenAt: "2026-11-03T01:00:00", offsetMinutes: 60, software: null } }))
      .toContain("image_capture");
  });

  it("aceita uma captura normal do telemóvel", () => {
    expect(decide(LEITURA, { capture: { takenAt: "2026-11-03T04:38:00", offsetMinutes: 60, software: "Android BP4A.251205.006" } })).toBe(true);
  });
});
