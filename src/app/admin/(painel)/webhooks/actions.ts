"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import type { ActionResult } from "@/lib/products/types";
import { createServiceClient } from "@/lib/supabase/service";
import { dispatchDelivery } from "@/lib/webhooks/dispatch";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhooks/events";
import { generateWebhookSecret, webhookUrlError } from "@/lib/webhooks/security";

export type WebhookResult = ActionResult & { secret?: string };

const MAX_ENDPOINTS = 10;
const uuid = z.string().uuid();
const eventNames = Object.keys(WEBHOOK_EVENTS) as [WebhookEvent, ...WebhookEvent[]];
const schema = z.object({
  url: z.string().trim().min(1, "Indique o URL").superRefine((v, ctx) => {
    const error = webhookUrlError(v);
    if (error) ctx.addIssue({ code: "custom", message: error });
  }),
  description: z.string().trim().max(80, "Máximo 80 caracteres"),
  events: z.array(z.enum(eventNames)).min(1, "Escolha pelo menos um evento"),
  productId: uuid.nullable(),
});

function refresh() {
  revalidatePath("/admin/webhooks");
  revalidatePath("/admin/produtos/[id]/webhooks", "page");
}

function done(message: string, secret?: string): WebhookResult {
  refresh();
  return { ok: true, message, secret };
}

/** As escritas usam a chave de serviço: tudo filtra pela conta com sessão. */
async function ownedEndpoint(id: string) {
  const { user } = await requireAdmin();
  if (!uuid.safeParse(id).success) return null;
  const db = createServiceClient();
  const { data } = await db.from("webhook_endpoints").select("id, product_id").eq("id", id).eq("owner_id", user.id).maybeSingle();
  return data ? { db, ownerId: user.id, productId: data.product_id as string | null } : null;
}

export async function createWebhook(input: { url: string; description: string; events: string[]; productId: string | null }): Promise<WebhookResult> {
  const { user } = await requireAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    return { ok: false, error: "Verifique os campos.", fieldErrors };
  }
  const { productId } = parsed.data;
  const db = createServiceClient();
  if (productId) {
    const { data: product } = await db.from("products").select("id").eq("id", productId).eq("owner_id", user.id).maybeSingle();
    if (!product) return { ok: false, error: "Produto inválido." };
  }
  const existing = db.from("webhook_endpoints").select("id", { count: "exact", head: true }).eq("owner_id", user.id);
  const { count } = await (productId ? existing.eq("product_id", productId) : existing.is("product_id", null));
  if ((count ?? 0) >= MAX_ENDPOINTS) {
    return { ok: false, error: `Pode ter no máximo ${MAX_ENDPOINTS} webhooks ${productId ? "em cada produto" : "para todos os produtos"}.` };
  }

  const secret = generateWebhookSecret();
  const { error } = await db.from("webhook_endpoints").insert({
    owner_id: user.id, url: parsed.data.url, description: parsed.data.description, events: parsed.data.events,
    product_id: productId, secret_encrypted: encryptSecret(secret),
  });
  if (error) {
    console.error("[webhooks] criar", error);
    return { ok: false, error: "Não foi possível guardar. Tente de novo." };
  }
  return done("Webhook criado.", secret);
}

export async function setWebhookActive(id: string, active: boolean): Promise<WebhookResult> {
  const o = await ownedEndpoint(id);
  if (!o) return { ok: false, error: "Webhook não encontrado." };
  const { error } = await o.db.from("webhook_endpoints").update({ is_active: active }).eq("id", id).eq("owner_id", o.ownerId);
  if (error) return { ok: false, error: "Não foi possível guardar." };
  return done(active ? "Webhook ativado." : "Webhook desativado.");
}

export async function deleteWebhook(id: string): Promise<WebhookResult> {
  const o = await ownedEndpoint(id);
  if (!o) return { ok: false, error: "Webhook não encontrado." };
  const { error } = await o.db.from("webhook_endpoints").delete().eq("id", id).eq("owner_id", o.ownerId);
  if (error) return { ok: false, error: "Não foi possível apagar." };
  return done("Webhook apagado.");
}

export async function rotateWebhookSecret(id: string): Promise<WebhookResult> {
  const o = await ownedEndpoint(id);
  if (!o) return { ok: false, error: "Webhook não encontrado." };
  const secret = generateWebhookSecret();
  const { error } = await o.db.from("webhook_endpoints").update({ secret_encrypted: encryptSecret(secret) }).eq("id", id).eq("owner_id", o.ownerId);
  if (error) return { ok: false, error: "Não foi possível gerar." };
  return done("Segredo novo gerado. O anterior deixou de valer.", secret);
}

export async function sendTestWebhook(id: string): Promise<WebhookResult> {
  const o = await ownedEndpoint(id);
  if (!o) return { ok: false, error: "Webhook não encontrado." };
  const { data: product } = o.productId
    ? await o.db.from("products").select("id, name, slug").eq("id", o.productId).maybeSingle()
    : { data: null };
  const { data, error } = await o.db
    .from("webhook_deliveries")
    .insert({
      endpoint_id: id, owner_id: o.ownerId, event: "test",
      payload: {
        order: { id: null, number: 0, status: "paid", amount: 1000, currency: "AOA", entity: "00000", reference: "000000000" },
        customer: { name: "Cliente de teste", phone: "244900000000", email: null },
        product: product ?? { id: null, name: "Produto de teste", slug: "teste" },
        tracking: {},
      },
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Não foi possível criar o teste." };
  const r = await dispatchDelivery(o.db, data.id);
  refresh();
  return r.ok ? { ok: true, message: `Teste entregue (resposta ${r.status}).` } : { ok: false, error: `Teste falhou: ${r.error}.` };
}

export async function resendDelivery(id: string): Promise<WebhookResult> {
  const { user } = await requireAdmin();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Envio inválido." };
  const db = createServiceClient();
  const { data } = await db
    .from("webhook_deliveries")
    .update({ status: "pending", attempts: 0, next_attempt_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id)
    .in("status", ["success", "failed"])
    .select("id")
    .maybeSingle();
  if (!data) return { ok: false, error: "Este envio já está em curso." };
  const r = await dispatchDelivery(db, id);
  refresh();
  return r.ok ? { ok: true, message: `Entregue (resposta ${r.status}).` } : { ok: false, error: `Falhou: ${r.error}.` };
}
