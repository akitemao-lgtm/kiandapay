import "server-only";
import type { ServiceDb } from "@/lib/supabase/service";
import type { Settings } from "@/lib/settings";
import { readImageMeta } from "./image-meta";
import type { PayableOrder, PaymentReuse, ReceiptContext } from "./receipt-checks";
import type { ReceiptReading } from "./receipt-text";

/** O pedido a que o comprovativo foi enviado. */
export type ProofOrder = PayableOrder & {
  id: string;
  order_number: number;
  lead_id: string;
  owner_id: string;
  amount_due: number;
};

const ORDER_FIELDS = "id, order_number, lead_id, owner_id, amount_due, payment_entity, payment_reference, created_at, expires_at";

/** Uma data e hora iguais ao segundo são o mesmo pagamento; o relógio do ecrã não tem mais precisão. */
const SAME_PAYMENT_MS = 1_000;

/**
 * Pedidos anteriores do mesmo cliente que este pagamento também podia estar a pagar:
 * mesmo valor, criados antes deste e cujo prazo de envio ainda não tinha acabado
 * quando o comprovativo chegou. É o caso de quem paga e só depois abre o pedido novo.
 */
export async function earlierOrders(db: ServiceDb, order: ProofOrder, settings: Settings, uploadedAt: string): Promise<PayableOrder[]> {
  const stillOpen = new Date(Date.parse(uploadedAt) - settings.upload_grace_hours * 3_600_000).toISOString();
  const { data } = await db
    .from("orders")
    .select(ORDER_FIELDS)
    .eq("lead_id", order.lead_id)
    .eq("amount_due", order.amount_due)
    .neq("id", order.id)
    .in("status", ["awaiting_payment", "under_review", "expired"]) // nunca um pedido já rejeitado
    .lt("created_at", order.created_at)
    .gt("expires_at", stillOpen)
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? []) as PayableOrder[];
}

/** O mesmo pagamento já apresentado noutro pedido: mesma data, hora e valor. */
async function paymentReuse(db: ServiceDb, order: ProofOrder, r: ReceiptReading): Promise<PaymentReuse> {
  if (!r.paidAt || r.amount === null) return null;
  const paid = Date.parse(r.paidAt);
  const { data } = await db
    .from("payment_proofs")
    .select("order_id, orders!payment_proofs_order_id_fkey(order_number)")
    .eq("owner_id", order.owner_id)
    .eq("ext_amount", r.amount)
    .gte("ext_paid_at", new Date(paid - SAME_PAYMENT_MS).toISOString())
    .lte("ext_paid_at", new Date(paid + SAME_PAYMENT_MS).toISOString())
    .neq("order_id", order.id)
    .neq("decision", "rejected")
    .is("duplicate_of", null)
    .limit(1);
  const other = data?.[0];
  if (!other) return null;
  return { orderNumber: (other.orders as unknown as { order_number: number } | null)?.order_number ?? null, sameTransaction: false };
}

/** O mesmo ecrã enviado outra vez: a captura tem a hora exacta do telemóvel, que um corte não muda. */
async function captureReuse(db: ServiceDb, order: ProofOrder, takenAt: string | null) {
  if (!takenAt) return null;
  const { data } = await db
    .from("payment_proofs")
    .select("order_id, orders!payment_proofs_order_id_fkey(order_number)")
    .eq("owner_id", order.owner_id)
    .eq("capture_taken_at", takenAt)
    .neq("order_id", order.id)
    .neq("decision", "rejected")
    .is("duplicate_of", null)
    .limit(1);
  const other = data?.[0];
  return other ? { orderNumber: (other.orders as unknown as { order_number: number } | null)?.order_number ?? null } : null;
}

/** Reúne tudo o que é preciso para decidir sobre um comprovativo em imagem. */
export async function buildReceiptContext(
  db: ServiceDb,
  input: { order: ProofOrder; settings: Settings; reading: ReceiptReading; bytes: Uint8Array | null; uploadedAt: string },
): Promise<ReceiptContext> {
  const { order, settings, reading, uploadedAt } = input;
  const capture = input.bytes ? readImageMeta(input.bytes) : null;
  const [earlier, reuse, repeatedCapture] = await Promise.all([
    earlierOrders(db, order, settings, uploadedAt),
    paymentReuse(db, order, reading),
    settings.allow_screenshot_time && !reading.paidAt ? captureReuse(db, order, capture?.takenAt ?? null) : Promise.resolve(null),
  ]);
  return {
    order,
    earlier,
    uploadedAt,
    reuse,
    capture,
    captureReuse: repeatedCapture,
    allowCaptureTime: settings.allow_screenshot_time,
  };
}
