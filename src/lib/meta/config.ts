import "server-only";
import { decryptSecret } from "@/lib/crypto";
import type { ServiceDb } from "@/lib/supabase/service";

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v27.0";

export type MetaSettingsRow = {
  product_id: string;
  enabled: boolean;
  pixel_id: string | null;
  test_event_code: string | null;
  currency: string;
  conversion_rate: number | null;
};

export type MetaConfig = {
  pixelId: string;
  token: string | null;
  testEventCode: string | null;
  currency: string;
  rate: number;
};

/** Valor a enviar ao Meta: em AOA, ou convertido com a taxa configurada. */
export function metaValue(amountAoa: number, cfg: Pick<MetaConfig, "currency" | "rate">): number {
  return cfg.currency === "AOA" ? Math.round(amountAoa * 100) / 100 : Math.round(amountAoa * cfg.rate * 100) / 100;
}

type Resolved = {
  pixelId: string;
  currency: string;
  rate: number;
  testEventCode: string | null;
  source: { kind: "product"; productId: string } | { kind: "account"; ownerId: string };
};

/** Um Pixel próprio do produto tem prioridade; senão vale o da conta, só para produtos ativos. */
async function resolve(db: ServiceDb, productId: string): Promise<Resolved | null> {
  const { data } = await db.from("product_meta_settings").select("*").eq("product_id", productId).maybeSingle();
  const row = data as MetaSettingsRow | null;
  if (row?.enabled && row.pixel_id) {
    return {
      pixelId: row.pixel_id, currency: row.currency, rate: Number(row.conversion_rate ?? 1),
      testEventCode: row.test_event_code || null, source: { kind: "product", productId },
    };
  }
  const { data: product } = await db.from("products").select("owner_id, is_active").eq("id", productId).maybeSingle();
  if (!product?.is_active) return null;
  const { data: account } = await db
    .from("account_integrations")
    .select("meta_enabled, meta_pixel_id, meta_test_event_code, meta_currency, meta_conversion_rate")
    .eq("owner_id", product.owner_id)
    .maybeSingle();
  if (!account?.meta_enabled || !account.meta_pixel_id) return null;
  return {
    pixelId: account.meta_pixel_id, currency: account.meta_currency, rate: Number(account.meta_conversion_rate ?? 1),
    testEventCode: account.meta_test_event_code || null, source: { kind: "account", ownerId: product.owner_id },
  };
}

/** Configuração pública (sem token) — segura para usar ao renderizar páginas. */
export async function loadPixelConfig(db: ServiceDb, productId: string) {
  const cfg = await resolve(db, productId);
  return cfg && { pixelId: cfg.pixelId, currency: cfg.currency, rate: cfg.rate };
}

function readToken(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  try {
    return decryptSecret(encrypted);
  } catch (e) {
    console.error("[meta] token ilegível", e);
    return null;
  }
}

/** Configuração completa para a API de Conversões (inclui o token decifrado). Só no servidor. */
export async function loadMetaConfig(db: ServiceDb, productId: string): Promise<MetaConfig | null> {
  const cfg = await resolve(db, productId);
  if (!cfg) return null;
  let encrypted: string | null | undefined;
  if (cfg.source.kind === "product") {
    const { data } = await db.from("product_meta_secrets").select("capi_token_encrypted").eq("product_id", productId).maybeSingle();
    encrypted = data?.capi_token_encrypted;
  } else {
    const { data } = await db.from("account_integration_secrets").select("meta_capi_token_encrypted").eq("owner_id", cfg.source.ownerId).maybeSingle();
    encrypted = data?.meta_capi_token_encrypted;
  }
  return { pixelId: cfg.pixelId, currency: cfg.currency, rate: cfg.rate, testEventCode: cfg.testEventCode, token: readToken(encrypted) };
}

/** Produtos com envio ao Meta ativo, próprio ou herdado da conta. */
export async function metaEnabledProductIds(db: ServiceDb): Promise<string[]> {
  const [{ data: own }, { data: accounts }] = await Promise.all([
    db.from("product_meta_settings").select("product_id").eq("enabled", true),
    db.from("account_integrations").select("owner_id").eq("meta_enabled", true),
  ]);
  const ids = new Set((own ?? []).map((r: { product_id: string }) => r.product_id));
  const owners = (accounts ?? []).map((a: { owner_id: string }) => a.owner_id);
  if (owners.length) {
    const { data: products } = await db.from("products").select("id").in("owner_id", owners).eq("is_active", true);
    for (const p of products ?? []) ids.add(p.id as string);
  }
  return [...ids];
}
