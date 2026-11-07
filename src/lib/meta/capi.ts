import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { NO_NAME } from "@/lib/checkout/customer";
import { siteUrl } from "@/lib/site";
import { stripPersonalParams } from "@/lib/tracking/url";
import type { ServiceDb } from "@/lib/supabase/service";
import { GRAPH_VERSION, loadMetaConfig, metaEnabledProductIds, metaValue, type MetaConfig } from "./config";

type EventName = "InitiateCheckout" | "Purchase" | "ViewContent";
type Trigger = "auto" | "manual_approval" | "manual_resend" | "status_page";

export type CapiResult =
  | { status: "success"; eventsReceived: number; fbtraceId: string | null }
  | { status: "error"; message: string }
  | { status: "skipped"; reason: string };

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Normalização do Meta: minúsculas, sem espaços nem pontuação. */
function normName(v: string) {
  return v.toLowerCase().normalize("NFC").replace(/[^\p{L}]/gu, "");
}

export function hashedUserData(input: {
  phone: string | null; name: string | null; externalId: string | null;
  fbp: string | null; fbc: string | null; ip: string | null; userAgent: string | null;
  email?: string | null;
}) {
  const parts = (input.name ?? "").trim().split(/\s+/).filter(Boolean);
  const fn = parts.length ? normName(parts[0]) : "";
  const ln = parts.length > 1 ? normName(parts[parts.length - 1]) : "";
  const phone = input.phone?.replace(/\D/g, "") ?? "";
  const ip = input.ip && isIP(input.ip) && !/^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fe80:|fc|fd)/i.test(input.ip) ? input.ip : null;
  const data: Record<string, unknown> = { country: [sha256("ao")] };
  if (phone) data.ph = [sha256(phone.startsWith("244") ? phone : `244${phone}`)];
  const email = input.email?.trim().toLowerCase();
  if (email) data.em = [sha256(email)];
  if (fn) data.fn = [sha256(fn)];
  if (ln) data.ln = [sha256(ln)];
  if (input.externalId) data.external_id = [sha256(input.externalId)];
  if (input.fbp) data.fbp = input.fbp;
  if (input.fbc) data.fbc = input.fbc;
  if (ip) data.client_ip_address = ip;
  if (input.userAgent) data.client_user_agent = input.userAgent;
  return data;
}

/** Envio para a Graph API. O token vai no corpo e nunca é guardado no histórico. */
async function postEvent(cfg: MetaConfig, event: Record<string, unknown>) {
  const body: Record<string, unknown> = { data: [event] };
  if (cfg.testEventCode) body.test_event_code = cfg.testEventCode;
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${cfg.pixelId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: cfg.token }),
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { httpStatus: res.status, json, sentPayload: body };
}

type SendInput = {
  productId: string;
  orderId: string | null;
  visitId?: string | null;
  eventName: EventName;
  eventId: string;
  eventTime: Date;
  sourceUrl: string | null;
  trigger: Trigger;
  user: Parameters<typeof hashedUserData>[0];
  amountAoa: number;
  contentName: string;
};

export async function sendCapiEvent(db: ServiceDb, input: SendInput, cfgOverride?: MetaConfig | null): Promise<CapiResult> {
  const cfg = cfgOverride ?? (await loadMetaConfig(db, input.productId));
  if (!cfg) return { status: "skipped", reason: "Meta desativado ou sem Pixel ID neste produto" };
  if (!cfg.token) return { status: "skipped", reason: "Sem token da API de Conversões" };

  const value = metaValue(input.amountAoa, cfg);
  const event = {
    event_name: input.eventName,
    event_time: Math.floor(input.eventTime.getTime() / 1000),
    event_id: input.eventId,
    action_source: "website",
    event_source_url: stripPersonalParams(input.sourceUrl) ?? siteUrl(),
    user_data: hashedUserData(input.user),
    custom_data: {
      currency: cfg.currency,
      value,
      content_ids: [input.productId],
      content_name: input.contentName,
      content_type: "product",
      ...(input.orderId ? { order_id: input.orderId } : {}),
    },
  };

  // Linha "pending" antes do envio. Para o Purchase, o índice único da BD
  // impede um segundo envio em curso ou bem-sucedido para o mesmo pedido.
  const { data: row, error: rowError } = await db
    .from("meta_events")
    .insert({
      product_id: input.productId, order_id: input.orderId, visit_id: input.visitId ?? null,
      event_name: input.eventName, event_id: input.eventId, source: "server", trigger: input.trigger,
      pixel_id: cfg.pixelId, test_event_code: cfg.testEventCode, value, currency: cfg.currency, status: "pending",
    })
    .select("id")
    .single();
  if (rowError) {
    if (rowError.code === "23505") return { status: "skipped", reason: "Purchase já enviado para este pedido" };
    console.error("[meta] registo", rowError);
    return { status: "error", message: "Não foi possível registar o envio" };
  }

  let result: CapiResult;
  let update: Record<string, unknown>;
  try {
    const { httpStatus, json, sentPayload } = await postEvent(cfg, event);
    const err = json.error as { message?: string; fbtrace_id?: string; error_user_msg?: string } | undefined;
    const ok = httpStatus >= 200 && httpStatus < 300 && !err;
    const fbtraceId = (json.fbtrace_id as string) ?? err?.fbtrace_id ?? null;
    update = {
      status: ok ? "success" : "error", response_status: httpStatus, response_body: json,
      request_payload: sentPayload, fbtrace_id: fbtraceId, sent_at: new Date().toISOString(),
    };
    result = ok
      ? { status: "success", eventsReceived: Number(json.events_received ?? 0), fbtraceId }
      : { status: "error", message: err?.error_user_msg || err?.message || `HTTP ${httpStatus}` };
  } catch (e) {
    update = { status: "error", response_body: { error: String((e as Error).message ?? e) }, request_payload: { data: [event] }, sent_at: new Date().toISOString() };
    result = { status: "error", message: `Sem resposta do Meta: ${(e as Error).message}` };
  }
  await db.from("meta_events").update(update).eq("id", row.id);
  if (result.status === "error" && input.eventName === "Purchase" && input.orderId) {
    await notifyMetaError(db, input.orderId, result.message);
  }
  return result;
}

/** Um aviso por pedido enquanto não for lido (o cron pode repetir o envio até 3 vezes). */
async function notifyMetaError(db: ServiceDb, orderId: string, message: string) {
  const { count } = await db
    .from("admin_notifications")
    .select("id", { count: "exact", head: true })
    .eq("type", "meta_error")
    .eq("order_id", orderId)
    .is("read_at", null);
  if (count) return;
  const { data: o } = await db.from("orders").select("order_number").eq("id", orderId).maybeSingle();
  await db.from("admin_notifications").insert({
    type: "meta_error",
    order_id: orderId,
    title: `Pedido #${o?.order_number ?? "?"}: o Meta recusou o Purchase (${message.slice(0, 120)})`,
  });
}

type OrderForMeta = {
  id: string; lead_id: string; product_id: string; product_name: string; amount_due: number; status: string;
  customer_name: string; customer_phone: string | null; customer_email: string | null; fbp: string | null; fbc: string | null; ip: string | null;
  user_agent: string | null; source_url: string | null; created_at: string; paid_at: string | null;
  initiate_checkout_event_id: string; purchase_event_id: string; visit_id: string | null;
};

const ORDER_META_COLUMNS =
  "id, lead_id, product_id, product_name, amount_due, status, customer_name, customer_phone, customer_email, fbp, fbc, ip, user_agent, source_url, created_at, paid_at, initiate_checkout_event_id, purchase_event_id, visit_id";

async function loadOrder(db: ServiceDb, orderId: string): Promise<OrderForMeta | null> {
  const { data } = await db.from("orders").select(ORDER_META_COLUMNS).eq("id", orderId).maybeSingle();
  return data ? { ...(data as OrderForMeta), amount_due: Number(data.amount_due) } : null;
}

function userOf(o: OrderForMeta) {
  return {
    phone: o.customer_phone, name: o.customer_name === NO_NAME ? null : o.customer_name, email: o.customer_email, externalId: o.lead_id,
    fbp: o.fbp, fbc: o.fbc, ip: o.ip, userAgent: o.user_agent,
  };
}

export async function sendInitiateCheckout(db: ServiceDb, orderId: string): Promise<CapiResult> {
  const o = await loadOrder(db, orderId);
  if (!o) return { status: "skipped", reason: "Pedido não encontrado" };
  return sendCapiEvent(db, {
    productId: o.product_id, orderId: o.id, visitId: o.visit_id, eventName: "InitiateCheckout",
    eventId: o.initiate_checkout_event_id, eventTime: new Date(o.created_at), sourceUrl: o.source_url,
    trigger: "auto", user: userOf(o), amountAoa: o.amount_due, contentName: o.product_name,
  });
}

/** Purchase: só para pedidos pagos, uma única vez por pedido. */
export async function sendPurchase(db: ServiceDb, orderId: string, trigger: Trigger): Promise<CapiResult> {
  const o = await loadOrder(db, orderId);
  if (!o) return { status: "skipped", reason: "Pedido não encontrado" };
  if (o.status !== "paid") return { status: "skipped", reason: "O pedido não está pago" };
  const r = await sendCapiEvent(db, {
    productId: o.product_id, orderId: o.id, visitId: o.visit_id, eventName: "Purchase",
    eventId: o.purchase_event_id, eventTime: new Date(o.paid_at ?? Date.now()), sourceUrl: o.source_url,
    trigger, user: userOf(o), amountAoa: o.amount_due, contentName: o.product_name,
  });
  if (r.status === "success") {
    await db.from("orders").update({ purchase_capi_sent_at: new Date().toISOString() }).eq("id", o.id);
  }
  return r;
}

/**
 * Rede de segurança (cron): pedidos pagos nos últimos 7 dias sem Purchase
 * enviado — falhas de rede, Meta em baixo — com no máximo 3 tentativas.
 */
export async function retryMissingPurchases(db: ServiceDb, limit = 20): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
  const before = new Date(Date.now() - 5 * 60_000).toISOString();
  // Um processo que caiu a meio deixa o envio "pending", e o índice único bloquearia nova tentativa.
  await db
    .from("meta_events")
    .update({ status: "error", response_body: { error: "Envio interrompido" }, sent_at: new Date().toISOString() })
    .eq("event_name", "Purchase")
    .eq("source", "server")
    .eq("status", "pending")
    .lt("created_at", before);
  const productIds = await metaEnabledProductIds(db);
  if (!productIds.length) return 0;
  const { data } = await db
    .from("orders")
    .select("id")
    .in("product_id", productIds)
    .eq("status", "paid")
    .is("purchase_capi_sent_at", null)
    .gte("paid_at", since)
    .lte("paid_at", before)
    .limit(limit);
  let sent = 0;
  for (const { id } of data ?? []) {
    const { count } = await db
      .from("meta_events")
      .select("id", { count: "exact", head: true })
      .eq("order_id", id)
      .eq("event_name", "Purchase")
      .eq("source", "server");
    if ((count ?? 0) >= 3) continue;
    const r = await sendPurchase(db, id, "auto");
    if (r.status === "success") sent++;
  }
  return sent;
}
