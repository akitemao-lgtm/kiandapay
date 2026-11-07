import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PREFILL_PARAMS } from "@/lib/checkout/prefill";
import { hashedUserData, sendCapiEvent } from "@/lib/meta/capi";
import { shouldFireBrowserPurchase } from "@/lib/meta/purchase";
import { stripPersonalParams } from "@/lib/tracking/url";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const HOUR = 3_600_000;

describe("dados do cliente enviados ao Meta", () => {
  it("normaliza e aplica hash como pede a documentação", () => {
    const u = hashedUserData({
      phone: "244923456789", name: "  João  da Silva ", email: " Ana@X.CO ", externalId: "lead-1",
      fbp: "fb.1.1.2", fbc: "fb.1.1.AbC", ip: "41.0.0.1", userAgent: "UA",
    });
    expect(u.ph).toEqual([sha("244923456789")]);
    expect(u.em).toEqual([sha("ana@x.co")]);
    expect(u.fn).toEqual([sha("joão")]);
    expect(u.ln).toEqual([sha("silva")]);
    expect(u.country).toEqual([sha("ao")]);
    expect(u.external_id).toEqual([sha("lead-1")]);
    // Sem hash, e o fbc sem alterar maiúsculas.
    expect(u).toMatchObject({ fbp: "fb.1.1.2", fbc: "fb.1.1.AbC", client_ip_address: "41.0.0.1", client_user_agent: "UA" });
  });

  it("não envia IPs privados", () => {
    expect(hashedUserData({ phone: null, name: null, externalId: null, fbp: null, fbc: null, ip: "10.0.0.1", userAgent: null }).client_ip_address).toBeUndefined();
  });
});

describe("evento enviado à API de Conversões", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tem os campos obrigatórios, sem dados pessoais no URL", async () => {
    const db = {
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "r" }, error: null }) }) }),
        update: () => ({ eq: async () => ({}) }),
      }),
    } as never;
    let url = "";
    let body: { access_token?: string; data: Record<string, unknown>[] } = { data: [] };
    vi.stubGlobal("fetch", async (u: string, init: RequestInit) => {
      url = u;
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ events_received: 1, fbtrace_id: "t" }), { status: 200 });
    });
    const r = await sendCapiEvent(db, {
      productId: "p", orderId: "o", eventName: "Purchase", eventId: "pur_1", eventTime: new Date("2026-11-07T10:00:00Z"),
      sourceUrl: "https://x.co/a?telefone=923456789&utm_source=FB", trigger: "auto",
      user: { phone: "244923456789", name: "Ana", externalId: "l", fbp: null, fbc: null, ip: "41.0.0.1", userAgent: "UA" },
      amountAoa: 100, contentName: "C",
    }, { pixelId: "123", token: "T", testEventCode: null, currency: "USD", rate: 0.5 });

    expect(r.status).toBe("success");
    expect(url).toMatch(/graph\.facebook\.com\/v\d+\.0\/123\/events$/);
    expect(body.access_token).toBe("T");
    expect(body.data[0]).toMatchObject({
      event_name: "Purchase", event_id: "pur_1", event_time: 1794045600, action_source: "website",
      event_source_url: "https://x.co/a?utm_source=FB",
      custom_data: { currency: "USD", value: 50, order_id: "o" },
    });
  });
});

describe("Purchase no browser", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  const paid = (hoursAgo: number) => new Date(now - hoursAgo * HOUR).toISOString();

  it("dispara dentro da janela de deduplicação", () => {
    expect(shouldFireBrowserPurchase({ paidAt: paid(1), pixelFiredAt: null }, now)).toBe(true);
  });
  it("não repete depois de disparar", () => {
    expect(shouldFireBrowserPurchase({ paidAt: paid(1), pixelFiredAt: paid(1) }, now)).toBe(false);
  });
  it("não dispara quando o cliente volta dias depois", () => {
    expect(shouldFireBrowserPurchase({ paidAt: paid(25), pixelFiredAt: null }, now)).toBe(false);
  });
  it("não dispara sem data de pagamento", () => {
    expect(shouldFireBrowserPurchase({ paidAt: null, pixelFiredAt: null }, now)).toBe(false);
  });
});

describe("dados pessoais no URL", () => {
  it("retira todos os parâmetros de pré-preenchimento e mantém o rastreamento", () => {
    const personal = PREFILL_PARAMS.map((p) => `${p}=x`).join("&");
    expect(stripPersonalParams(`https://x.co/a?${personal}&utm_source=FB&fbclid=AbC&src=1`))
      .toBe("https://x.co/a?utm_source=FB&fbclid=AbC&src=1");
  });
  it("devolve null para URLs inválidos", () => {
    expect(stripPersonalParams("lixo")).toBeNull();
    expect(stripPersonalParams(null)).toBeNull();
  });
});
