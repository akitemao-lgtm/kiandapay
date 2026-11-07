import "server-only";
import { PUBLIC_PRODUCT_COLUMNS, type PublicProduct } from "@/lib/checkout/public";
import type { Settings } from "@/lib/settings";
import type { ServiceDb } from "@/lib/supabase/service";

export const TOKEN_REGEX = /^[0-9a-f]{64}$/;

/** Estado mostrado ao lead (o da BD mais o prazo de tolerância). */
export type OrderView = "awaiting" | "awaiting_grace" | "under_review" | "paid" | "rejected" | "expired";

export type PublicOrder = {
  id: string;
  order_number: number;
  status: "awaiting_payment" | "under_review" | "paid" | "rejected" | "expired";
  amount_due: number;
  payment_entity: string;
  payment_reference: string;
  expires_at: string;
  paid_at: string | null;
  rejected_reason: string | null;
  product_id: string;
  upload_count: number;
  created_at: string;
  /** Conta do vendedor (configurações). Só no servidor. */
  owner_id: string;
};

export type DeliveryProduct = PublicProduct & {
  delivery_type: "pdf" | "link";
  delivery_button_label: string | null;
};

const ORDER_COLUMNS =
  "id, order_number, status, amount_due, payment_entity, payment_reference, expires_at, paid_at, rejected_reason, product_id, upload_count, created_at, owner_id";

export async function loadOrderByToken(db: ServiceDb, token: string): Promise<PublicOrder | null> {
  if (!TOKEN_REGEX.test(token)) return null;
  const { data } = await db.from("orders").select(ORDER_COLUMNS).eq("public_token", token).maybeSingle();
  return data ? { ...(data as PublicOrder), amount_due: Number(data.amount_due) } : null;
}

export async function loadOrderProduct(db: ServiceDb, productId: string): Promise<DeliveryProduct | null> {
  // Tipo de entrega e texto do botão sim; o URL e o caminho do ficheiro nunca.
  const { data } = await db
    .from("products")
    .select(`${PUBLIC_PRODUCT_COLUMNS}, delivery_type, delivery_button_label`)
    .eq("id", productId)
    .maybeSingle();
  return data ? { ...(data as DeliveryProduct), price: Number(data.price) } : null;
}

export function orderView(order: Pick<PublicOrder, "status" | "expires_at">, settings: Pick<Settings, "upload_grace_hours">, now = Date.now()): OrderView {
  const expires = new Date(order.expires_at).getTime();
  const graceEnd = expires + settings.upload_grace_hours * 3_600_000;
  switch (order.status) {
    case "paid":
      return "paid";
    case "under_review":
      return "under_review";
    case "rejected":
      return "rejected";
    case "awaiting_payment":
    case "expired":
      if (order.status === "awaiting_payment" && now < expires) return "awaiting";
      return now < graceEnd ? "awaiting_grace" : "expired";
  }
}

export function uploadDeadline(order: Pick<PublicOrder, "expires_at">, settings: Pick<Settings, "upload_grace_hours">): Date {
  return new Date(new Date(order.expires_at).getTime() + settings.upload_grace_hours * 3_600_000);
}
