import "server-only";
import { decryptSecret } from "@/lib/crypto";
import type { ServiceDb } from "@/lib/supabase/service";
import { buildUtmifyPayload, UTMIFY_MAX_AGE_DAYS, UTMIFY_URL, utmifyStatus, type UtmifyOrder } from "./payload";

const MAX_ATTEMPTS = 5;
const BATCH = 25;
const ORDER_COLUMNS =
  "id, owner_id, status, created_at, paid_at, customer_name, customer_phone, customer_email, ip, product_id, product_name, amount_due, source_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term, utmify_attempts";
// Pedidos cujo estado ainda não foi aceite pela UTMify.
const OUT_OF_SYNC =
  "utmify_status.is.null," +
  "and(status.in.(awaiting_payment,under_review),utmify_status.neq.waiting_payment)," +
  "and(status.eq.paid,utmify_status.neq.paid)," +
  "and(status.in.(rejected,expired),utmify_status.neq.refused)";

export async function postToUtmify(token: string, payload: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(UTMIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}` };
  } catch (e) {
    return { ok: false, error: `Sem resposta da UTMify: ${(e as Error).message}` };
  }
}

/** Envia os pedidos recentes que mudaram de estado. Só contas ativas, produtos ativos. */
export async function syncUtmifyOrders(db: ServiceDb): Promise<number> {
  const { data: accounts } = await db
    .from("account_integrations")
    .select("owner_id, utmify_currency, utmify_conversion_rate")
    .eq("utmify_enabled", true);
  let sent = 0;
  const since = new Date(Date.now() - UTMIFY_MAX_AGE_DAYS * 86_400_000).toISOString();

  for (const account of accounts ?? []) {
    const { data: secret } = await db
      .from("account_integration_secrets")
      .select("utmify_token_encrypted")
      .eq("owner_id", account.owner_id)
      .maybeSingle();
    if (!secret?.utmify_token_encrypted) continue;
    let token: string;
    try {
      token = decryptSecret(secret.utmify_token_encrypted);
    } catch (e) {
      console.error("[utmify] token ilegível", e);
      continue;
    }

    const { data: products } = await db.from("products").select("id").eq("owner_id", account.owner_id).eq("is_active", true);
    const productIds = (products ?? []).map((p: { id: string }) => p.id);
    if (!productIds.length) continue;

    const { data: orders } = await db
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("owner_id", account.owner_id)
      .in("product_id", productIds)
      .gte("created_at", since)
      .lt("utmify_attempts", MAX_ATTEMPTS)
      .or(OUT_OF_SYNC)
      .order("created_at")
      .limit(BATCH);

    const cfg = { currency: account.utmify_currency as string, rate: Number(account.utmify_conversion_rate) };
    for (const row of orders ?? []) {
      const order = { ...(row as unknown as UtmifyOrder), amount_due: Number(row.amount_due) };
      const r = await postToUtmify(token, buildUtmifyPayload(order, cfg));
      if (r.ok) {
        sent++;
        await db
          .from("orders")
          .update({ utmify_status: utmifyStatus(order.status), utmify_attempts: 0, utmify_error: null, utmify_sent_at: new Date().toISOString() })
          .eq("id", order.id);
      } else {
        console.error("[utmify] envio", order.id, r.error);
        await db
          .from("orders")
          .update({ utmify_attempts: (row.utmify_attempts as number) + 1, utmify_error: r.error })
          .eq("id", order.id);
      }
    }
  }
  return sent;
}
