"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { rateError } from "@/lib/currency/rate";
import { encryptSecret } from "@/lib/crypto";
import { sendCapiEvent } from "@/lib/meta/capi";
import { loadMetaConfig } from "@/lib/meta/config";
import { fieldErrors } from "@/lib/products/schema";
import type { ActionResult } from "@/lib/products/types";
import { requestMeta } from "@/lib/request";
import { createServiceClient } from "@/lib/supabase/service";

const schema = z
  .object({
    enabled: z.boolean(),
    pixelId: z.string().trim().regex(/^(\d{5,20})?$/, "O Pixel ID tem só dígitos"),
    token: z.string().trim().max(1000),
    testEventCode: z.string().trim().max(40).regex(/^[A-Za-z0-9_-]*$/, "Código inválido"),
    currency: z.string().regex(/^[A-Z]{3}$/, "Moeda inválida"),
    rate: z.number().positive("Indique a taxa").nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.enabled && !v.pixelId) ctx.addIssue({ code: "custom", path: ["pixelId"], message: "Indique o Pixel ID" });
    if (v.currency !== "AOA" && !v.rate) ctx.addIssue({ code: "custom", path: ["rate"], message: "Indique a taxa de conversão" });
    const invalidRate = rateError(v.currency, v.rate);
    if (invalidRate) ctx.addIssue({ code: "custom", path: ["rate"], message: invalidRate });
  });

export type MetaInput = z.input<typeof schema>;

/** O RLS só devolve produtos desta conta; o cliente de serviço não verifica nada. */
async function ownsProduct(supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"], id: string) {
  const { data } = await supabase.from("products").select("id").eq("id", id).maybeSingle();
  return !!data;
}

export async function saveMetaSettings(productId: string, input: MetaInput): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  if (!z.string().uuid().safeParse(productId).success) return { ok: false, error: "Produto inválido." };
  if (!(await ownsProduct(supabase, productId))) return { ok: false, error: "Produto inválido." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Verifique os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  const { error } = await supabase.from("product_meta_settings").upsert({
    product_id: productId,
    enabled: v.enabled,
    pixel_id: v.pixelId || null,
    test_event_code: v.testEventCode || null,
    currency: v.currency,
    conversion_rate: v.currency === "AOA" ? null : v.rate,
  });
  if (error) return { ok: false, error: "Não foi possível guardar." };

  // O token só é escrito (cifrado) pelo servidor; a tabela não é acessível nem ao painel.
  if (v.token) {
    const { error: secretError } = await createServiceClient()
      .from("product_meta_secrets")
      .upsert({ product_id: productId, capi_token_encrypted: encryptSecret(v.token) });
    if (secretError) return { ok: false, error: "Configuração guardada, mas o token não." };
  }

  revalidatePath(`/admin/produtos/${productId}/meta`);
  return { ok: true, message: v.token ? "Configuração e token guardados." : "Configuração guardada." };
}

export async function removeMetaToken(productId: string): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  if (!z.string().uuid().safeParse(productId).success) return { ok: false, error: "Produto inválido." };
  if (!(await ownsProduct(supabase, productId))) return { ok: false, error: "Produto inválido." };
  await createServiceClient().from("product_meta_secrets").delete().eq("product_id", productId);
  revalidatePath(`/admin/produtos/${productId}/meta`);
  return { ok: true, message: "Token removido." };
}

/** Envia um ViewContent com o Test Event Code para confirmar a ligação no Gestor de Eventos. */
export async function sendTestEvent(productId: string): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  if (!z.string().uuid().safeParse(productId).success) return { ok: false, error: "Produto inválido." };
  if (!(await ownsProduct(supabase, productId))) return { ok: false, error: "Produto inválido." };
  const db = createServiceClient();
  const cfg = await loadMetaConfig(db, productId);
  if (!cfg) return { ok: false, error: "Ative o Meta e indique o Pixel ID primeiro." };
  if (!cfg.token) return { ok: false, error: "Guarde primeiro o token da API de Conversões." };
  if (!cfg.testEventCode) return { ok: false, error: "Indique um Test Event Code para o evento aparecer em Testar eventos." };
  const { data: product } = await supabase.from("products").select("name, price").eq("id", productId).single();
  const { ip, userAgent } = await requestMeta();
  const r = await sendCapiEvent(db, {
    productId, orderId: null, eventName: "ViewContent", eventId: `teste_${crypto.randomUUID()}`, eventTime: new Date(),
    sourceUrl: null, trigger: "manual_resend",
    user: { phone: "244900000000", name: "Teste Painel", externalId: "teste", fbp: null, fbc: null, ip, userAgent },
    amountAoa: Number(product?.price ?? 0), contentName: product?.name ?? "Teste",
  }, cfg);
  if (r.status === "success") return { ok: true, message: `Meta recebeu ${r.eventsReceived} evento(s). Veja em Gestor de Eventos → Testar eventos.` };
  if (r.status === "skipped") return { ok: false, error: r.reason };
  return { ok: false, error: `O Meta recusou: ${r.message}` };
}
