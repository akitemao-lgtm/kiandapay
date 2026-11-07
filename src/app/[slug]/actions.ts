"use server";

import { after } from "next/server";
import { z } from "zod";
import { NO_NAME, readCustomer, type Customer } from "@/lib/checkout/customer";
import { readOptions } from "@/lib/checkout/defaults";
import { isSellerActive, PUBLIC_PRODUCT_COLUMNS } from "@/lib/checkout/public";
import { sendInitiateCheckout } from "@/lib/meta/capi";
import { dispatchDueMessages, queueOrderMessages } from "@/lib/messaging/queue";
import { getPaymentProvider } from "@/lib/payments/provider";
import { requestMeta } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { SLUG_REGEX } from "@/lib/slug";
import { createServiceClient, type ServiceDb } from "@/lib/supabase/service";
import { stripPersonalParams } from "@/lib/tracking/url";
import { kickWebhooks } from "@/lib/webhooks/dispatch";

const s = (max: number) => z.string().max(max).nullable().catch(null);
// Textos longos ficam cortados em vez de se perderem por inteiro.
const cut = (max: number) => z.string().transform((v) => v.slice(0, max)).nullable().catch(null);

const trackingSchema = z.object({
  visitorId: z.string().uuid(),
  fbclid: s(500),
  fbp: s(200),
  fbc: s(700),
  utmSource: cut(500),
  utmMedium: cut(500),
  utmCampaign: cut(500),
  utmContent: cut(500),
  utmTerm: cut(500),
  landingUrl: cut(2000),
  referrer: cut(2000),
});
type Tracking = z.infer<typeof trackingSchema>;

function trackingColumns(t: Tracking) {
  return {
    fbclid: t.fbclid, fbp: t.fbp, fbc: t.fbc,
    utm_source: t.utmSource, utm_medium: t.utmMedium, utm_campaign: t.utmCampaign,
    utm_content: t.utmContent, utm_term: t.utmTerm, referrer: t.referrer,
  };
}

async function allowed(db: ServiceDb, key: string, windowSeconds: number, max: number) {
  const { data, error } = await db.rpc("rate_limit_hit", { p_key: key, p_window_seconds: windowSeconds, p_max: max });
  if (error) {
    console.error("[rate-limit]", error);
    return true; // não bloquear vendas por falha do contador
  }
  return data === true;
}

// ---------------------------------------------------------------------
// Visita ao checkout ("checkout iniciado" no dashboard)
// ---------------------------------------------------------------------
export async function recordVisit(
  slug: string,
  rawTracking: unknown,
): Promise<{ visitId: string; viewContentEventId: string } | null> {
  const parsed = trackingSchema.safeParse(rawTracking);
  if (!parsed.success || !SLUG_REGEX.test(slug)) return null;
  const t = parsed.data;
  const db = createServiceClient();
  const { ip, userAgent } = await requestMeta();

  const { data: product } = await db.from("products").select("id").eq("slug", slug).eq("is_active", true).maybeSingle();
  if (!product) return null;

  // Recarregar a página na mesma meia hora conta como a mesma visita.
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: recent } = await db
    .from("checkout_visits")
    .select("id, view_content_event_id")
    .eq("product_id", product.id)
    .eq("visitor_id", t.visitorId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent) return { visitId: recent.id, viewContentEventId: recent.view_content_event_id };

  if (ip && !(await allowed(db, `visit:ip:${ip}`, 600, 60))) return null;

  const { data, error } = await db
    .from("checkout_visits")
    .insert({
      product_id: product.id, visitor_id: t.visitorId, ip, user_agent: userAgent,
      landing_url: stripPersonalParams(t.landingUrl), ...trackingColumns(t),
    })
    .select("id, view_content_event_id")
    .single();
  if (error) {
    console.error("[visita]", error);
    return null;
  }
  return { visitId: data.id, viewContentEventId: data.view_content_event_id };
}

// ---------------------------------------------------------------------
// Criação do pedido
// ---------------------------------------------------------------------
const orderSchema = z.object({
  slug: z.string().regex(SLUG_REGEX),
  name: z.string().trim().max(120),
  phone: z.string().max(30),
  email: z.string().trim().max(200),
  website: z.string().max(200), // honeypot: invisível para pessoas
  startedAt: z.number(),
  visitId: z.string().uuid().nullable(),
  tracking: trackingSchema,
});

export type CreateOrderResult =
  | { ok: true; token: string; initiateCheckoutEventId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const GENERIC = "Não foi possível criar o pedido. Tente de novo dentro de instantes.";

export async function createOrder(raw: unknown): Promise<CreateOrderResult> {
  const parsed = orderSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: GENERIC };
  const input = parsed.data;

  // Anti-spam: honeypot preenchido ou submetido em menos de 2 s.
  if (input.website || Date.now() - input.startedAt < 2000) return { ok: false, error: GENERIC };

  const db = createServiceClient();
  const { ip, userAgent } = await requestMeta();

  const { data: product } = await db
    .from("products")
    .select(`${PUBLIC_PRODUCT_COLUMNS}, owner_id`)
    .eq("slug", input.slug)
    .maybeSingle();
  if (!product?.is_active || !(await isSellerActive(db, product.owner_id))) {
    return { ok: false, error: "Este produto não está disponível de momento." };
  }

  const { data: page } = await db.from("checkout_pages").select("payment_instructions").eq("product_id", product.id).maybeSingle();
  const { customer, errors: fieldErrors } = readCustomer(input, readOptions(page?.payment_instructions ?? null));
  const { name, phone, email } = customer;
  if (email && !z.string().email().safeParse(email).success) fieldErrors.email = "Indique um e-mail válido.";
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Verifique os dados.", fieldErrors };

  if (ip && !(await allowed(db, `order:ip:${ip}`, 600, 10))) {
    return { ok: false, error: "Muitas tentativas seguidas. Aguarde alguns minutos." };
  }
  if (phone && !(await allowed(db, `order:phone:${phone}`, 3600, 5))) {
    return { ok: false, error: "Já criou vários pedidos com este número. Aguarde um pouco ou use o link que recebeu." };
  }

  const settings = await getSettings(db, product.owner_id);
  const provider = getPaymentProvider(settings);
  if (!provider.isConfigured()) {
    console.error("[pedido] Entidade/Referência por configurar", product.owner_id);
    return { ok: false, error: "Os pagamentos estão temporariamente indisponíveis. Tente mais tarde." };
  }

  const { data: lead, error: leadError } = await saveLead(db, product.owner_id, customer);
  if (leadError || !lead) {
    console.error("[pedido] lead", leadError);
    return { ok: false, error: GENERIC };
  }
  if (lead.blocked_at) {
    return { ok: false, error: "Não é possível concluir pedidos com este número. Contacte o suporte." };
  }

  // A visita tem o tracking do primeiro toque; o formulário serve de reserva.
  let tracking = trackingColumns(input.tracking);
  let visitId: string | null = null;
  if (input.visitId) {
    const { data: visit } = await db
      .from("checkout_visits")
      .select("id, product_id, fbclid, fbp, fbc, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer")
      .eq("id", input.visitId)
      .maybeSingle();
    if (visit && visit.product_id === product.id) {
      visitId = visit.id;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, product_id, ...fromVisit } = visit;
      tracking = Object.fromEntries(
        Object.entries(tracking).map(([k, v]) => [k, (fromVisit as Record<string, string | null>)[k] ?? v]),
      ) as typeof tracking;
    }
  }
  // Cookies podem ter sido criados depois da visita (ex.: o Pixel): ficam os mais recentes.
  tracking.fbp = input.tracking.fbp ?? tracking.fbp;
  tracking.fbc = input.tracking.fbc ?? tracking.fbc;

  const price = Number(product.price);
  const payment = await provider.createPayment({ amount: price });
  const expiresAt = new Date(Date.now() + settings.order_ttl_minutes * 60_000).toISOString();

  const baseRow = {
    product_id: product.id, lead_id: lead.id, visit_id: visitId,
    customer_name: name ?? NO_NAME, customer_phone: phone, customer_email: email,
    product_name: product.name, base_amount: price,
    payment_provider: provider.id, payment_entity: payment.entity, payment_reference: payment.reference,
    provider_payment_id: payment.providerPaymentId, provider_data: payment.data,
    expires_at: expiresAt, ip, user_agent: userAgent, source_url: stripPersonalParams(input.tracking.landingUrl),
    ...tracking,
  };

  let order: {
    id: string; order_number: number; public_token: string; initiate_checkout_event_id: string; amount_due: number;
  } | null = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    const offset = settings.unique_amount_enabled ? await pickUniqueOffset(db, price) : 0;
    const { data, error } = await db
      .from("orders")
      .insert({ ...baseRow, unique_offset: offset })
      .select("id, order_number, public_token, initiate_checkout_event_id, amount_due")
      .single();
    if (!error) order = data;
    else if (!(error.code === "23505" && offset > 0)) {
      console.error("[pedido] inserir", error);
      return { ok: false, error: GENERIC };
    }
  }
  if (!order) return { ok: false, error: GENERIC };

  await queueOrderMessages(
    db,
    { ...order, amount_due: Number(order.amount_due), customer_phone: phone, customer_email: email, product_name: product.name },
    settings,
  );
  after(() => dispatchDueMessages(createServiceClient()).catch((e) => console.error("[mensagens]", e)));
  kickWebhooks();
  // Mesmo event_id que o Pixel usa no browser → o Meta deduplica.
  after(() => sendInitiateCheckout(createServiceClient(), order!.id).catch((e) => console.error("[meta] IC", e)));

  return { ok: true, token: order.public_token, initiateCheckoutEventId: order.initiate_checkout_event_id };
}

/** Um lead por telefone em cada conta; sem telefone, um novo em cada pedido. O nome e o email guardados só mudam se vierem preenchidos. */
async function saveLead(db: ServiceDb, ownerId: string, { name, phone, email }: Customer) {
  const row = { owner_id: ownerId, phone, name: name ?? NO_NAME, ...(email ? { email } : {}) };
  if (!phone) return db.from("leads").insert(row).select("id, blocked_at").single();
  if (!name) {
    const { data: existing } = await db.from("leads").select("id, blocked_at").eq("owner_id", ownerId).eq("phone", phone).maybeSingle();
    if (existing) {
      if (email) await db.from("leads").update({ email }).eq("id", existing.id);
      return { data: existing, error: null };
    }
  }
  return db.from("leads").upsert(row, { onConflict: "owner_id,phone" }).select("id, blocked_at").single();
}

/** 1–99 Kz livres entre os pedidos pendentes; 0 se estiverem todos ocupados. */
async function pickUniqueOffset(db: ServiceDb, base: number): Promise<number> {
  const { data } = await db
    .from("orders")
    .select("amount_due")
    .in("status", ["awaiting_payment", "under_review"])
    .gt("unique_offset", 0)
    .gte("amount_due", base + 1)
    .lte("amount_due", base + 99);
  const used = new Set((data ?? []).map((r: { amount_due: number }) => Math.round(Number(r.amount_due) - base)));
  const free = Array.from({ length: 99 }, (_, i) => i + 1).filter((n) => !used.has(n));
  return free.length ? free[Math.floor(Math.random() * free.length)] : 0;
}
