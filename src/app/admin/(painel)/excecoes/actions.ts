"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { dispatchDueMessages, queueLeadNotice } from "@/lib/messaging/queue";
import { markOrderPaid } from "@/lib/orders/paid";
import type { ActionResult } from "@/lib/products/types";
import { analyzePdf } from "@/lib/proofs/analyze";
import { extractFields } from "@/lib/proofs/extract";
import { PROOF_BUCKET } from "@/lib/proofs/process";
import { saveTemplateSample, type TemplateTarget } from "@/lib/proofs/template-admin";
import { getSettings } from "@/lib/settings";
import { createServiceClient } from "@/lib/supabase/service";
import { kickWebhooks } from "@/lib/webhooks/dispatch";

const uuid = z.string().uuid();
const targetSchema = z.union([
  z.object({ templateId: z.string().uuid() }),
  z.object({
    bankCode: z.string().regex(/^[a-z_]{2,30}$/),
    channel: z.enum(["app", "express", "atm", "internet_banking", "outro"]),
    name: z.string().trim().min(2).max(80),
    keywords: z.array(z.string().trim().min(2).max(60)).max(8),
  }),
]);

function refresh(proofId: string) {
  revalidatePath("/admin/excecoes");
  revalidatePath(`/admin/excecoes/${proofId}`);
  after(() => dispatchDueMessages(createServiceClient()).catch((e) => console.error("[mensagens]", e)));
  kickWebhooks();
}

export async function approveProof(proofId: string, saveAs: TemplateTarget | null): Promise<ActionResult> {
  const { supabase, user } = await requireAdmin();
  if (!uuid.safeParse(proofId).success) return { ok: false, error: "Comprovativo inválido." };
  const target = saveAs ? targetSchema.safeParse(saveAs) : null;
  if (target && !target.success) return { ok: false, error: "Preencha os dados do modelo." };

  const { data: proof } = await supabase
    .from("payment_proofs")
    .select("id, order_id, kind, storage_path, decision")
    .eq("id", proofId)
    .maybeSingle();
  if (!proof) return { ok: false, error: "Comprovativo não encontrado." };

  const { error } = await supabase
    .from("payment_proofs")
    .update({
      decision: "approved", decision_source: "manual", decided_at: new Date().toISOString(), decided_by: user.id,
      decision_reason: null, decision_reason_code: null, fraud_suspected: false,
    })
    .eq("id", proof.id);
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "Este n.º de transação já foi aprovado noutro pedido." : "Não foi possível aprovar.",
    };
  }

  const settings = await getSettings(supabase, user.id);
  await markOrderPaid(supabase, settings, proof.order_id, proof.id, "manual");
  await supabase.from("admin_notifications").update({ read_at: new Date().toISOString() }).eq("proof_id", proof.id).is("read_at", null);

  let message = "Pagamento aprovado. O cliente já tem acesso ao produto.";
  if (target?.success && proof.kind === "pdf") {
    const { data: blob } = await supabase.storage.from(PROOF_BUCKET).download(proof.storage_path);
    if (blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const analysis = await analyzePdf(bytes);
      const saved = await saveTemplateSample(supabase, {
        analysis, extracted: extractFields(analysis.lines, analysis.text), bytes, target: target.data, sourceProofId: proof.id,
      });
      message += saved.ok ? " Formato guardado como modelo de referência." : ` Mas o modelo não foi guardado: ${saved.error}`;
      if (saved.ok) revalidatePath("/admin/modelos");
    }
  }

  refresh(proof.id);
  return { ok: true, message };
}

export async function rejectProof(proofId: string, input: { reason: string; fraud: boolean }): Promise<ActionResult> {
  const { supabase, user } = await requireAdmin();
  if (!uuid.safeParse(proofId).success) return { ok: false, error: "Comprovativo inválido." };
  const reason = input.reason.trim().slice(0, 300);
  if (reason.length < 5) return { ok: false, error: "Indique o motivo (o cliente vai vê-lo)." };

  const { data: proof } = await supabase.from("payment_proofs").select("id, order_id, lead_id").eq("id", proofId).maybeSingle();
  if (!proof) return { ok: false, error: "Comprovativo não encontrado." };
  const now = new Date().toISOString();

  await supabase
    .from("payment_proofs")
    .update({
      decision: "rejected", decision_source: "manual", decided_at: now, decided_by: user.id,
      decision_reason: reason, decision_reason_code: input.fraud ? "manual_fraud" : "manual", fraud_suspected: input.fraud,
    })
    .eq("id", proof.id);

  const settings = await getSettings(supabase, user.id);
  const { data: order } = await supabase
    .from("orders")
    .select("id, status, upload_count, expires_at, order_number, public_token, customer_phone, customer_email")
    .eq("id", proof.order_id)
    .single();

  if (order && order.status !== "paid") {
    let status: string;
    let rejected_reason: string | null = null;
    if (input.fraud) {
      await supabase.from("leads").update({ blocked_at: now, blocked_reason: `Fraude: ${reason}` }).eq("id", proof.lead_id);
      status = "rejected";
      rejected_reason = reason;
    } else if (order.upload_count >= settings.max_uploads_per_order) {
      status = "rejected";
      rejected_reason = `${reason} Atingiu o limite de envios.`;
    } else {
      const graceEnd = new Date(order.expires_at).getTime() + settings.upload_grace_hours * 3_600_000;
      status = Date.now() < graceEnd ? "awaiting_payment" : "expired";
    }
    await supabase.from("orders").update({ status, rejected_reason }).eq("id", order.id);
    await queueLeadNotice(
      supabase, order, settings, "rejected",
      status === "awaiting_payment"
        ? `o comprovativo do pedido #${order.order_number} não foi aceite (${reason}). Pode enviar outro aqui:`
        : `o pagamento do pedido #${order.order_number} não foi confirmado (${reason}). Detalhes:`,
    );
  }

  await supabase.from("admin_notifications").update({ read_at: now }).eq("proof_id", proof.id).is("read_at", null);
  refresh(proof.id);
  return { ok: true, message: input.fraud ? "Rejeitado e número bloqueado." : "Comprovativo rejeitado." };
}

/** Link assinado de 10 min para ver o ficheiro no painel. */
export async function proofFileUrl(proofId: string): Promise<string | null> {
  const { supabase } = await requireAdmin();
  const { data: proof } = await supabase.from("payment_proofs").select("storage_path").eq("id", proofId).maybeSingle();
  if (!proof) return null;
  const { data } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(proof.storage_path, 600);
  return data?.signedUrl ?? null;
}
