import "server-only";
import { decryptSecret } from "@/lib/crypto";
import type { ServiceDb } from "@/lib/supabase/service";

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";

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

/** Configuração pública (sem token) — segura para usar ao renderizar páginas. */
export async function loadPixelConfig(db: ServiceDb, productId: string) {
  const { data } = await db.from("product_meta_settings").select("*").eq("product_id", productId).maybeSingle();
  const row = data as MetaSettingsRow | null;
  if (!row?.enabled || !row.pixel_id) return null;
  return { pixelId: row.pixel_id, currency: row.currency, rate: Number(row.conversion_rate ?? 1) };
}

/** Configuração completa para a API de Conversões (inclui o token decifrado). Só no servidor. */
export async function loadMetaConfig(db: ServiceDb, productId: string): Promise<MetaConfig | null> {
  const pixel = await loadPixelConfig(db, productId);
  if (!pixel) return null;
  const [{ data: settings }, { data: secret }] = await Promise.all([
    db.from("product_meta_settings").select("test_event_code").eq("product_id", productId).single(),
    db.from("product_meta_secrets").select("capi_token_encrypted").eq("product_id", productId).maybeSingle(),
  ]);
  let token: string | null = null;
  if (secret?.capi_token_encrypted) {
    try {
      token = decryptSecret(secret.capi_token_encrypted);
    } catch (e) {
      console.error("[meta] token ilegível", e);
    }
  }
  return { ...pixel, token, testEventCode: settings?.test_event_code || null };
}
