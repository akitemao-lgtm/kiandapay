import { describe, expect, it } from "vitest";
import { buildUtmifyPayload, utmifyDate, utmifyStatus, type UtmifyOrder } from "@/lib/utmify/payload";

const order: UtmifyOrder = {
  id: "o1", status: "paid", created_at: "2026-11-07T10:00:05.123Z", paid_at: "2026-11-07T11:43:37.000Z",
  customer_name: "Ana", customer_phone: "244923456789", customer_email: null, ip: "41.0.0.1",
  product_id: "p1", product_name: "Curso", amount_due: 10000,
  source_url: "https://x.invalid/curso?src=abc&utm_source=FB",
  utm_source: "FB", utm_medium: null, utm_campaign: "C|1", utm_content: null, utm_term: null,
};
const cfg = { currency: "USD", rate: 0.0011 };

describe("UTMify", () => {
  it("mapeia os estados do pedido", () => {
    expect(utmifyStatus("awaiting_payment")).toBe("waiting_payment");
    expect(utmifyStatus("under_review")).toBe("waiting_payment");
    expect(utmifyStatus("paid")).toBe("paid");
    expect(utmifyStatus("rejected")).toBe("refused");
    expect(utmifyStatus("expired")).toBe("refused");
  });

  it("formata as datas em UTC sem fuso", () => {
    expect(utmifyDate("2026-11-07T12:00:05.123+01:00")).toBe("2026-11-07 11:00:05");
  });

  it("converte os Kwanzas para cêntimos inteiros da moeda escolhida", () => {
    const p = buildUtmifyPayload(order, cfg);
    expect(p.commission).toEqual({ totalPriceInCents: 1100, gatewayFeeInCents: 0, userCommissionInCents: 1100, currency: "USD" });
    expect(p.products[0].priceInCents).toBe(1100);
    expect(Number.isInteger(p.commission.totalPriceInCents)).toBe(true);
  });

  it("só tem data de aprovação quando está pago", () => {
    expect(buildUtmifyPayload(order, cfg).approvedDate).toBe("2026-11-07 11:43:37");
    expect(buildUtmifyPayload({ ...order, status: "awaiting_payment", paid_at: null }, cfg).approvedDate).toBeNull();
    expect(buildUtmifyPayload(order, cfg).refundedAt).toBeNull();
  });

  it("lê src e sck do link e envia null nos parâmetros em falta", () => {
    const t = buildUtmifyPayload(order, cfg).trackingParameters;
    expect(t.src).toBe("abc");
    expect(t.sck).toBeNull();
    expect(t.utm_source).toBe("FB");
    expect(t.utm_term).toBeNull();
    expect(buildUtmifyPayload({ ...order, source_url: "lixo" }, cfg).trackingParameters.src).toBeNull();
  });

  it("preenche o email obrigatório quando o cliente não o indicou", () => {
    expect(buildUtmifyPayload(order, cfg).customer.email).toBe("sem-email@kiandapay.invalid");
    expect(buildUtmifyPayload({ ...order, customer_email: "a@b.co" }, cfg).customer.email).toBe("a@b.co");
  });

  it("só marca como teste quando pedido", () => {
    expect("isTest" in buildUtmifyPayload(order, cfg)).toBe(false);
    expect(buildUtmifyPayload(order, cfg, true).isTest).toBe(true);
  });
});
