import "server-only";
import { toCheckoutConfig } from "@/lib/checkout/defaults";
import type { CheckoutConfig, CheckoutPageRow } from "@/lib/checkout/types";
import { RESERVED_SLUGS, SLUG_REGEX } from "@/lib/slug";
import { publicMediaUrl } from "@/lib/storage";
import type { ServiceDb } from "@/lib/supabase/service";

/**
 * Só campos seguros para o browser. NUNCA incluir delivery_url nem
 * delivery_file_path: o produto só é entregue depois do pagamento confirmado.
 */
export const PUBLIC_PRODUCT_COLUMNS = "id, slug, name, description, price, image_path, is_active";

export type PublicProduct = {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  image_path: string | null;
  is_active: boolean;
};

/** ownerId fica no servidor (configurações e referência do vendedor); não vai para o browser. */
export async function loadPublicCheckout(
  db: ServiceDb,
  slug: string,
): Promise<{ product: PublicProduct; config: CheckoutConfig; ownerId: string; sellerActive: boolean } | null> {
  if (!SLUG_REGEX.test(slug) || RESERVED_SLUGS.has(slug)) return null;
  const { data: product } = await db
    .from("products")
    .select(`${PUBLIC_PRODUCT_COLUMNS}, owner_id`)
    .eq("slug", slug)
    .maybeSingle();
  if (!product) return null;
  const { owner_id: ownerId, ...publicFields } = product as PublicProduct & { owner_id: string };
  const [{ data: page }, sellerActive] = await Promise.all([
    db.from("checkout_pages").select("*").eq("product_id", product.id).maybeSingle(),
    isSellerActive(db, ownerId),
  ]);
  return {
    product: { ...publicFields, price: Number(publicFields.price) },
    config: toCheckoutConfig(page as CheckoutPageRow | null),
    ownerId,
    sellerActive,
  };
}

/** Contas suspensas (ou ainda por aprovar) não aceitam pedidos novos. */
export async function isSellerActive(db: ServiceDb, ownerId: string): Promise<boolean> {
  const { data } = await db.from("profiles").select("status").eq("user_id", ownerId).maybeSingle();
  return data?.status === "active";
}

export function toViewProduct(p: PublicProduct) {
  return { name: p.name, description: p.description, price: p.price, imageUrl: publicMediaUrl(p.image_path) };
}
