"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { sendPurchase } from "@/lib/meta/capi";
import type { ActionResult } from "@/lib/products/types";
import { createServiceClient } from "@/lib/supabase/service";

export async function resendPurchase(orderId: string): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  if (!z.string().uuid().safeParse(orderId).success) return { ok: false, error: "Pedido inválido." };
  // O RLS só devolve pedidos desta conta; o envio usa o cliente de serviço.
  const { data: own } = await supabase.from("orders").select("id").eq("id", orderId).maybeSingle();
  if (!own) return { ok: false, error: "Pedido inválido." };
  const r = await sendPurchase(createServiceClient(), orderId, "manual_resend");
  revalidatePath(`/admin/pedidos/${orderId}`);
  if (r.status === "success") return { ok: true, message: "Purchase enviado ao Meta." };
  if (r.status === "skipped") return { ok: false, error: r.reason };
  return { ok: false, error: `O Meta recusou: ${r.message}` };
}

export async function unblockLead(leadId: string, orderId: string): Promise<void> {
  const { supabase } = await requireAdmin();
  if (!z.string().uuid().safeParse(leadId).success) return;
  await supabase.from("leads").update({ blocked_at: null, blocked_reason: null }).eq("id", leadId);
  revalidatePath(`/admin/pedidos/${orderId}`);
}
