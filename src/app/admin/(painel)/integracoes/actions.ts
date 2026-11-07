"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { sendCapiEvent } from "@/lib/meta/capi";
import { fieldErrors } from "@/lib/products/schema";
import { requestMeta } from "@/lib/request";
import type { ActionResult } from "@/lib/products/types";
import { createServiceClient } from "@/lib/supabase/service";
import { buildUtmifyPayload, UTMIFY_CURRENCIES, UTMIFY_MAX_AGE_DAYS } from "@/lib/utmify/payload";
import { postToUtmify, syncUtmifyOrders } from "@/lib/utmify/sync";

const schema = z
  .object({
    metaEnabled: z.boolean(),
    pixelId: z.string().trim().regex(/^(\d{5,20})?$/, "O Pixel ID tem só dígitos"),
    metaToken: z.string().trim().max(1000),
    testEventCode: z.string().trim().max(40).regex(/^[A-Za-z0-9_-]*$/, "Código inválido"),
    metaCurrency: z.string().regex(/^[A-Z]{3}$/, "Moeda inválida"),
    metaRate: z.number().positive("Indique a taxa").nullable(),
    utmifyEnabled: z.boolean(),
    utmifyToken: z.string().trim().max(1000),
    utmifyCurrency: z.enum(UTMIFY_CURRENCIES),
    utmifyRate: z.number().positive("Indique a taxa").nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.metaEnabled && !v.pixelId) ctx.addIssue({ code: "custom", path: ["pixelId"], message: "Indique o Pixel ID" });
    if (v.metaCurrency !== "AOA" && !v.metaRate) ctx.addIssue({ code: "custom", path: ["metaRate"], message: "Indique a taxa de conversão" });
    if (v.utmifyEnabled && !v.utmifyRate) ctx.addIssue({ code: "custom", path: ["utmifyRate"], message: "Indique a taxa de conversão" });
  });

export type IntegrationsInput = z.input<typeof schema>;

function readable(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  try {
    return decryptSecret(encrypted);
  } catch {
    return null;
  }
}

export async function saveIntegrations(input: IntegrationsInput): Promise<ActionResult> {
  const { supabase, user } = await requireAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Verifique os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const db = createServiceClient();

  const { data: secret } = await db
    .from("account_integration_secrets")
    .select("utmify_token_encrypted")
    .eq("owner_id", user.id)
    .maybeSingle();
  const utmifyTokenChanged = !!v.utmifyToken && v.utmifyToken !== readable(secret?.utmify_token_encrypted);
  if (v.utmifyEnabled && !v.utmifyToken && !secret?.utmify_token_encrypted) {
    return { ok: false, error: "Verifique os campos assinalados.", fieldErrors: { utmifyToken: "Cole o token da UTMify" } };
  }

  const { error } = await supabase.from("account_integrations").upsert({
    owner_id: user.id,
    meta_enabled: v.metaEnabled,
    meta_pixel_id: v.pixelId || null,
    meta_test_event_code: v.testEventCode || null,
    meta_currency: v.metaCurrency,
    meta_conversion_rate: v.metaCurrency === "AOA" ? null : v.metaRate,
    utmify_enabled: v.utmifyEnabled,
    utmify_currency: v.utmifyCurrency,
    utmify_conversion_rate: v.utmifyRate,
  });
  if (error) {
    console.error("[integracoes] guardar", error);
    return { ok: false, error: "Não foi possível guardar." };
  }

  if (v.metaToken || v.utmifyToken) {
    const { error: secretError } = await db.from("account_integration_secrets").upsert({
      owner_id: user.id,
      ...(v.metaToken ? { meta_capi_token_encrypted: encryptSecret(v.metaToken) } : {}),
      ...(v.utmifyToken ? { utmify_token_encrypted: encryptSecret(v.utmifyToken) } : {}),
    });
    if (secretError) {
      console.error("[integracoes] segredo", secretError);
      return { ok: false, error: "Configuração guardada, mas o token não." };
    }
  }
  if (utmifyTokenChanged) {
    // A UTMify responde "SUCCESS" mesmo com um token errado: com um token novo, tudo volta a ser enviado.
    await db
      .from("orders")
      .update({ utmify_status: null, utmify_attempts: 0, utmify_error: null, utmify_sent_at: null })
      .eq("owner_id", user.id)
      .gte("created_at", new Date(Date.now() - UTMIFY_MAX_AGE_DAYS * 86_400_000).toISOString());
  }
  revalidatePath("/admin/integracoes");
  if (v.utmifyEnabled) await syncUtmifyOrders(db).catch((e) => console.error("[utmify]", e));
  return { ok: true, message: "Integrações guardadas." };
}

export async function removeIntegrationToken(kind: "meta" | "utmify"): Promise<ActionResult> {
  const { user } = await requireAdmin();
  const column = kind === "meta" ? "meta_capi_token_encrypted" : "utmify_token_encrypted";
  await createServiceClient().from("account_integration_secrets").update({ [column]: null }).eq("owner_id", user.id);
  revalidatePath("/admin/integracoes");
  return { ok: true, message: "Token removido." };
}

/** Valida o formato com isTest: nada fica guardado. A UTMify não recusa tokens errados, por isso isto não prova o token. */
export async function testUtmify(): Promise<ActionResult> {
  const { supabase, user } = await requireAdmin();
  const db = createServiceClient();
  const [{ data: cfg }, { data: secret }] = await Promise.all([
    supabase.from("account_integrations").select("utmify_currency, utmify_conversion_rate").eq("owner_id", user.id).maybeSingle(),
    db.from("account_integration_secrets").select("utmify_token_encrypted").eq("owner_id", user.id).maybeSingle(),
  ]);
  if (!secret?.utmify_token_encrypted) return { ok: false, error: "Guarde primeiro o token da UTMify." };
  if (!cfg?.utmify_conversion_rate) return { ok: false, error: "Guarde primeiro a taxa de conversão." };
  let token: string;
  try {
    token = decryptSecret(secret.utmify_token_encrypted);
  } catch {
    return { ok: false, error: "O token guardado já não é legível. Cole-o de novo." };
  }
  const now = new Date().toISOString();
  const payload = buildUtmifyPayload(
    {
      id: `teste-${crypto.randomUUID()}`, status: "paid", created_at: now, paid_at: now,
      customer_name: "Teste Painel", customer_phone: "244900000000", customer_email: null, ip: null,
      product_id: "teste", product_name: "Teste", amount_due: 1000, source_url: null,
      utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
    },
    { currency: cfg.utmify_currency, rate: Number(cfg.utmify_conversion_rate) },
    true,
  );
  const r = await postToUtmify(token, payload);
  return r.ok ? { ok: true, message: "Formato aceite. Isto não confirma o token: veja se a próxima venda aparece no painel da UTMify." } : { ok: false, error: `A UTMify recusou: ${r.error}` };
}

/** Envia um ViewContent com o Test Event Code para confirmar a ligação em Testar eventos. O Meta conta-o nos dados do Pixel. */
export async function testMeta(): Promise<ActionResult> {
  const { supabase, user } = await requireAdmin();
  const db = createServiceClient();
  const [{ data: cfg }, { data: secret }, { data: product }] = await Promise.all([
    supabase.from("account_integrations").select("*").eq("owner_id", user.id).maybeSingle(),
    db.from("account_integration_secrets").select("meta_capi_token_encrypted").eq("owner_id", user.id).maybeSingle(),
    db.from("products").select("id, name, price").eq("owner_id", user.id).eq("is_active", true).limit(1).maybeSingle(),
  ]);
  if (!cfg?.meta_pixel_id) return { ok: false, error: "Guarde primeiro o Pixel ID." };
  if (!secret?.meta_capi_token_encrypted) return { ok: false, error: "Guarde primeiro o token da API de Conversões." };
  if (!cfg.meta_test_event_code) return { ok: false, error: "Indique um Test Event Code para o evento aparecer em Testar eventos." };
  if (!product) return { ok: false, error: "Precisa de pelo menos um produto ativo para enviar o teste." };
  let token: string;
  try {
    token = decryptSecret(secret.meta_capi_token_encrypted);
  } catch {
    return { ok: false, error: "O token guardado já não é legível. Cole-o de novo." };
  }
  const { ip, userAgent } = await requestMeta();
  const r = await sendCapiEvent(db, {
    productId: product.id, orderId: null, eventName: "ViewContent", eventId: `teste_${crypto.randomUUID()}`, eventTime: new Date(),
    sourceUrl: null, trigger: "manual_resend",
    user: { phone: "244900000000", name: "Teste Painel", externalId: "teste", fbp: null, fbc: null, ip, userAgent },
    amountAoa: Number(product.price), contentName: product.name,
  }, {
    pixelId: cfg.meta_pixel_id, token, testEventCode: cfg.meta_test_event_code,
    currency: cfg.meta_currency, rate: Number(cfg.meta_conversion_rate ?? 1),
  });
  if (r.status === "success") return { ok: true, message: `O Meta recebeu ${r.eventsReceived} evento(s). Veja em Gestor de Eventos → Testar eventos.` };
  if (r.status === "skipped") return { ok: false, error: r.reason };
  return { ok: false, error: `O Meta recusou: ${r.message}` };
}
