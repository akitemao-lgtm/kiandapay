import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { LegalFooter } from "@/components/checkout/LegalFooter";
import { MetaPixel } from "@/components/meta/MetaPixel";
import { loadPixelConfig, metaValue } from "@/lib/meta/config";
import { readPrefill } from "@/lib/checkout/prefill";
import { loadPublicCheckout, toViewProduct } from "@/lib/checkout/public";
import { getSettings } from "@/lib/settings";
import { createServiceClient } from "@/lib/supabase/service";
import { CheckoutForm } from "./CheckoutForm";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadPublicCheckout(createServiceClient(), slug);
  if (!data) return {};
  return { title: data.config.title || data.product.name };
}

export default async function CheckoutPage({ params, searchParams }: Props) {
  const { slug } = await params;
  // ?nome=…&telefone=…&email=… pré-preenchem o formulário (links enviados pelo vendedor).
  const prefill = readPrefill(await searchParams);
  const db = createServiceClient();
  const data = await loadPublicCheckout(db, slug);
  if (!data) notFound();
  const { product, config } = data;
  const available = product.is_active && data.sellerActive;
  const [settings, pixel] = await Promise.all([
    getSettings(db, data.ownerId),
    available ? loadPixelConfig(db, product.id) : null,
  ]);
  const footer = <LegalFooter siteName={settings.site_name} supportPhone={settings.support_phone} />;

  if (!available) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
        <p className="text-lg font-semibold">Este produto não está disponível de momento.</p>
        {footer}
      </main>
    );
  }

  return (
    <main className="min-h-dvh" style={{ background: config.backgroundColor }}>
      {pixel && (
        <MetaPixel
          checkout
          pixelId={pixel.pixelId}
          currency={pixel.currency}
          value={metaValue(product.price, pixel)}
          productId={product.id}
          productName={product.name}
        />
      )}
      <CheckoutView
        product={toViewProduct(product)}
        config={config}
        screen="form"
        formSlot={<CheckoutForm slug={product.slug} buttonText={config.buttonText} price={product.price} emailField={config.emailField} prefill={prefill} />}
        footerSlot={footer}
      />
    </main>
  );
}
