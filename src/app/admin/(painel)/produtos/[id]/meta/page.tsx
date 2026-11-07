import Link from "next/link";
import { notFound } from "next/navigation";
import { MetaForm } from "@/components/admin/MetaForm";
import { CheckoutLink } from "@/components/admin/CheckoutLink";
import { ProductTabs } from "@/components/admin/ProductTabs";
import { requireAdmin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata = { title: "Meta" };

export default async function MetaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAdmin();
  const [{ data: product }, { data: settings }, { data: secret }] = await Promise.all([
    supabase.from("products").select("id, name, price, slug").eq("id", id).maybeSingle(),
    supabase.from("product_meta_settings").select("*").eq("product_id", id).maybeSingle(),
    createServiceClient().from("product_meta_secrets").select("capi_token_encrypted").eq("product_id", id).maybeSingle(),
  ]);
  if (!product) notFound();

  let tokenHint: string | null = null;
  if (secret?.capi_token_encrypted) {
    try {
      tokenHint = decryptSecret(secret.capi_token_encrypted).slice(-4);
    } catch {
      tokenHint = "????";
    }
  }

  return (
    <>
      <Link href="/admin/produtos" className="text-sm text-gray-500 hover:text-gray-900">← Produtos</Link>
      <h1 className="mt-2 truncate text-2xl font-semibold">{product.name}</h1>
      <div className="mb-4 mt-2">
        <CheckoutLink slug={product.slug} showUrl />
      </div>
      <ProductTabs id={product.id} active="meta" />
      <MetaForm
        productId={product.id}
        price={Number(product.price)}
        tokenHint={tokenHint}
        initial={{
          enabled: settings?.enabled ?? false,
          pixelId: settings?.pixel_id ?? "",
          testEventCode: settings?.test_event_code ?? "",
          currency: settings?.currency ?? "AOA",
          rate: settings?.conversion_rate ? Number(settings.conversion_rate) : null,
        }}
      />
    </>
  );
}
