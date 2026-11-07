import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { retryMissingPurchases } from "@/lib/meta/capi";
import { dispatchDueMessages } from "@/lib/messaging/queue";
import { createServiceClient } from "@/lib/supabase/service";
import { syncUtmifyOrders } from "@/lib/utmify/sync";
import { dispatchWebhooks, pruneWebhookDeliveries } from "@/lib/webhooks/dispatch";

export const dynamic = "force-dynamic";

type Db = ReturnType<typeof createServiceClient>;

/** Aceita o CRON_SECRET do serviço ou o segredo guardado no Vault, que o pg_cron do Supabase usa. */
async function authorized(req: Request, db: Db) {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const expected = Buffer.from(`Bearer ${secret}`);
    const got = Buffer.from(header);
    if (got.length === expected.length && timingSafeEqual(got, expected)) return true;
  }
  const { data, error } = await db.rpc("cron_secret_ok", { p_secret: header.slice(7) });
  if (error) console.error("[cron] segredo", error);
  return data === true;
}

/**
 * Tarefas periódicas (chamar a cada 1–5 minutos):
 *  - marca como expirados os pedidos sem pagamento fora do prazo;
 *  - envia mensagens agendadas (lembretes) e reenvia as que ficaram por enviar;
 *  - repete o Purchase da API de Conversões que tenha falhado (até 3 vezes, 7 dias);
 *  - envia à UTMify os pedidos que mudaram de estado.
 * Autenticação: cabeçalho "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(req: Request) {
  const db = createServiceClient();
  if (!(await authorized(req, db))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: expired, error } = await db.rpc("expire_orders");
  if (error) console.error("[cron] expire_orders", error);
  const sent = await dispatchDueMessages(db, 100);
  const purchases = await retryMissingPurchases(db);
  const webhooks = await dispatchWebhooks(db, 100);
  await pruneWebhookDeliveries(db);
  const utmify = await syncUtmifyOrders(db);
  return NextResponse.json({ expired: expired ?? 0, sent, purchases, webhooks, utmify });
}
