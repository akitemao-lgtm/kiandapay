export const UTMIFY_URL = "https://api.utmify.com.br/api-credentials/orders";
export const UTMIFY_PLATFORM = "KiandaPay";
export const UTMIFY_CURRENCIES = ["USD", "EUR", "BRL", "GBP", "ARS", "CAD", "COP", "MXN", "PYG", "CLP", "PEN", "PLN"] as const;
/** A UTMify só aceita pedidos com até 7 dias. */
export const UTMIFY_MAX_AGE_DAYS = 7;
// A UTMify exige email, mas no checkout é opcional. O domínio .invalid nunca recebe correio.
const NO_EMAIL = "sem-email@kiandapay.invalid";
// A lista da UTMify não tem referência bancária; PIX é o método equivalente, pago na hora por transferência.
const PAYMENT_METHOD = "pix";

export type UtmifyStatus = "waiting_payment" | "paid" | "refused";

export type UtmifyOrder = {
  id: string;
  status: "awaiting_payment" | "under_review" | "paid" | "rejected" | "expired";
  created_at: string;
  paid_at: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  ip: string | null;
  product_id: string;
  product_name: string;
  amount_due: number;
  source_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
};

export function utmifyStatus(status: UtmifyOrder["status"]): UtmifyStatus {
  if (status === "paid") return "paid";
  if (status === "rejected" || status === "expired") return "refused";
  return "waiting_payment";
}

/** Formato pedido pela UTMify: YYYY-MM-DD HH:MM:SS em UTC. */
export function utmifyDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace("T", " ");
}

function queryParam(url: string | null, name: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get(name) || null;
  } catch {
    return null;
  }
}

export function buildUtmifyPayload(order: UtmifyOrder, cfg: { currency: string; rate: number }, isTest = false) {
  const status = utmifyStatus(order.status);
  const cents = Math.round(order.amount_due * cfg.rate * 100);
  return {
    orderId: order.id,
    platform: UTMIFY_PLATFORM,
    paymentMethod: PAYMENT_METHOD,
    status,
    createdAt: utmifyDate(order.created_at),
    approvedDate: status === "paid" && order.paid_at ? utmifyDate(order.paid_at) : null,
    refundedAt: null,
    customer: {
      name: order.customer_name,
      email: order.customer_email || NO_EMAIL,
      phone: order.customer_phone,
      document: null,
      country: "AO",
      ...(order.ip ? { ip: order.ip } : {}),
    },
    products: [
      { id: order.product_id, name: order.product_name, planId: null, planName: null, quantity: 1, priceInCents: cents },
    ],
    trackingParameters: {
      src: queryParam(order.source_url, "src"),
      sck: queryParam(order.source_url, "sck"),
      utm_source: order.utm_source,
      utm_campaign: order.utm_campaign,
      utm_medium: order.utm_medium,
      utm_content: order.utm_content,
      utm_term: order.utm_term,
    },
    // A plataforma não cobra taxa sobre a venda: o vendedor recebe o total.
    commission: { totalPriceInCents: cents, gatewayFeeInCents: 0, userCommissionInCents: cents, currency: cfg.currency },
    ...(isTest ? { isTest: true } : {}),
  };
}
