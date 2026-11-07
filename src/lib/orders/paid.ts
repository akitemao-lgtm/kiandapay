import "server-only";
import { after } from "next/server";
import { sendPurchase } from "@/lib/meta/capi";
import { cancelReminders, queuePaidMessage } from "@/lib/messaging/queue";
import { createServiceClient } from "@/lib/supabase/service";
import type { Settings } from "@/lib/settings";
import type { ServiceDb } from "@/lib/supabase/service";

/**
 * Único ponto onde um pedido passa a "Pago" (aprovação automática ou manual).
 * Aqui sai o Purchase para a API de Conversões (uma vez por pedido).
 */
export async function markOrderPaid(
  db: ServiceDb,
  settings: Settings,
  orderId: string,
  proofId: string,
  via: "auto" | "manual",
): Promise<boolean> {
  const { data } = await db
    .from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString(), paid_via: via, approved_proof_id: proofId, rejected_reason: null })
    .eq("id", orderId)
    .in("status", ["awaiting_payment", "under_review", "expired", "rejected"])
    .select("id, order_number, public_token, customer_phone, customer_email")
    .maybeSingle();
  if (!data) return false;
  await cancelReminders(db, orderId);
  if (via === "manual") await queuePaidMessage(db, data, settings);

  const send = () =>
    sendPurchase(createServiceClient(), orderId, via === "auto" ? "auto" : "manual_approval")
      .then((r) => r.status === "error" && console.error("[meta] Purchase", r.message))
      .catch((e) => console.error("[meta] Purchase", e));
  try {
    after(send); // depois de responder ao lead/administrador
  } catch {
    await send(); // fora de um pedido HTTP (ex.: scripts)
  }
  return true;
}
