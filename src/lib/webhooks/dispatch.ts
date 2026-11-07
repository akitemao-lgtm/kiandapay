import "server-only";
import { after } from "next/server";
import { decryptSecret } from "@/lib/crypto";
import { orderStatusUrl } from "@/lib/site";
import { createServiceClient, type ServiceDb } from "@/lib/supabase/service";
import { retryDelayMinutes, signWebhook } from "./security";
import { postWebhook, type SendResult } from "./send";

const STUCK_MINUTES = 5;
const BATCH = 5;

type Delivery = { id: string; endpoint_id: string; order_id: string | null; event: string; payload: Record<string, unknown>; attempts: number; created_at: string };

async function sendOne(db: ServiceDb, d: Delivery): Promise<SendResult> {
  const { data: endpoint } = await db.from("webhook_endpoints").select("url, secret_encrypted").eq("id", d.endpoint_id).maybeSingle();
  if (!endpoint) return { ok: false, status: null, error: "Webhook apagado" };

  // O link do pedido dá acesso ao produto depois de pago: só vai assinado para o vendedor.
  let payload = d.payload;
  if (d.order_id) {
    const { data: order } = await db.from("orders").select("public_token").eq("id", d.order_id).maybeSingle();
    if (order) payload = { ...payload, order: { ...(payload.order as object), url: orderStatusUrl(order.public_token) } };
  }
  const body = JSON.stringify({ id: d.id, event: d.event, created_at: d.created_at, data: payload });
  const timestamp = Math.floor(Date.now() / 1000);
  let signature: string;
  try {
    signature = signWebhook(decryptSecret(endpoint.secret_encrypted), timestamp, body);
  } catch (e) {
    console.error("[webhook] segredo", e);
    return { ok: false, status: null, error: "Erro interno ao assinar. Gere um segredo novo." };
  }
  return postWebhook(endpoint.url, body, {
    "X-KiandaPay-Event": d.event,
    "X-KiandaPay-Delivery": d.id,
    "X-KiandaPay-Timestamp": String(timestamp),
    "X-KiandaPay-Signature": signature,
    // Integrações externas já configuradas ainda validam os cabeçalhos com o nome antigo.
    "X-Kitanda-Event": d.event,
    "X-Kitanda-Delivery": d.id,
    "X-Kitanda-Timestamp": String(timestamp),
    "X-Kitanda-Signature": signature,
  });
}

/** Tenta uma entrega já reservada e grava o resultado (com a próxima tentativa, se falhou). */
async function attempt(db: ServiceDb, d: Delivery): Promise<SendResult> {
  const r = await sendOne(db, d).catch((e): SendResult => {
    console.error("[webhook] enviar", e);
    return { ok: false, status: null, error: "Erro interno" };
  });
  const attempts = d.attempts + 1;
  const delay = r.ok ? null : retryDelayMinutes(attempts);
  await db
    .from("webhook_deliveries")
    .update({
      status: r.ok ? "success" : delay === null ? "failed" : "pending",
      attempts, last_status: r.status, last_error: r.error, claimed_at: null,
      sent_at: r.ok ? new Date().toISOString() : null,
      ...(delay === null ? {} : { next_attempt_at: new Date(Date.now() + delay * 60_000).toISOString() }),
    })
    .eq("id", d.id);
  return r;
}

const COLUMNS = "id, endpoint_id, order_id, event, payload, attempts, created_at";

/** Reserva antes de enviar, para dois processos não enviarem o mesmo aviso. */
async function claim(db: ServiceDb, id: string): Promise<Delivery | null> {
  const { data } = await db
    .from("webhook_deliveries")
    .update({ status: "sending", claimed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select(COLUMNS)
    .maybeSingle();
  return data as Delivery | null;
}

export async function dispatchWebhooks(db: ServiceDb, limit = 25): Promise<number> {
  // Um processo que caiu a meio deixa o envio preso; volta à fila.
  await db
    .from("webhook_deliveries")
    .update({ status: "pending", claimed_at: null })
    .eq("status", "sending")
    .lt("claimed_at", new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString());

  const { data: due } = await db
    .from("webhook_deliveries")
    .select("id")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at")
    .limit(limit);

  let sent = 0;
  const ids = (due ?? []).map((d) => d.id as string);
  for (let i = 0; i < ids.length; i += BATCH) {
    const results = await Promise.all(
      ids.slice(i, i + BATCH).map(async (id) => {
        const d = await claim(db, id);
        return d ? (await attempt(db, d)).ok : false;
      }),
    );
    sent += results.filter(Boolean).length;
  }
  return sent;
}

/** Envio imediato de uma entrega (botões do painel). */
export async function dispatchDelivery(db: ServiceDb, id: string): Promise<SendResult> {
  const d = await claim(db, id);
  return d ? attempt(db, d) : { ok: false, status: null, error: "Este envio já está em curso." };
}

/** Envia depois de responder; o que falhar aqui, o cron repete. */
export function kickWebhooks() {
  const run = () => dispatchWebhooks(createServiceClient()).catch((e) => console.error("[webhook]", e));
  try {
    after(run);
  } catch {
    void run();
  }
}

export async function pruneWebhookDeliveries(db: ServiceDb) {
  await db
    .from("webhook_deliveries")
    .delete()
    .in("status", ["success", "failed"])
    .lt("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
}
