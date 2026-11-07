import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { LegalFooter } from "@/components/checkout/LegalFooter";
import { MetaPurchasePixel } from "@/components/meta/MetaPixel";
import { loadPixelConfig, metaValue } from "@/lib/meta/config";
import { shouldFireBrowserPurchase } from "@/lib/meta/purchase";
import { toCheckoutConfig } from "@/lib/checkout/defaults";
import { toViewProduct } from "@/lib/checkout/public";
import type { CheckoutPageRow } from "@/lib/checkout/types";
import { formatDateTime, formatKz } from "@/lib/format";
import { loadOrderByToken, loadOrderProduct, orderView, uploadDeadline, type OrderView } from "@/lib/orders/public";
import { requestMeta } from "@/lib/request";
import { formatReference, getSettings } from "@/lib/settings";
import { createServiceClient } from "@/lib/supabase/service";
import { ProofUpload } from "./ProofUpload";
import { StatusPoller } from "./StatusPoller";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "O seu pedido", robots: { index: false, follow: false } };

const card = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5";
const primaryButton =
  "block w-full rounded-xl bg-[var(--c-primary)] px-4 py-3.5 text-center text-base font-bold text-[var(--c-on-primary)]";

export default async function PedidoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = createServiceClient();
  const order = await loadOrderByToken(db, token);
  if (!order) notFound();

  const [product, settings, { data: page }, pixel, { data: meta }] = await Promise.all([
    loadOrderProduct(db, order.product_id),
    getSettings(db, order.owner_id),
    db.from("checkout_pages").select("*").eq("product_id", order.product_id).maybeSingle(),
    loadPixelConfig(db, order.product_id),
    db.from("orders").select("purchase_event_id, purchase_pixel_fired_at, customer_phone, lead_id").eq("id", order.id).single(),
  ]);
  if (!product) notFound();
  const config = toCheckoutConfig(page as CheckoutPageRow | null);
  const view = orderView(order, settings);

  const { ip, userAgent } = await requestMeta();
  await db.from("order_access_logs").insert({ order_id: order.id, kind: "status_view", ip, user_agent: userAgent });

  const footer = <LegalFooter siteName={settings.site_name} supportPhone={settings.support_phone} />;
  // O link do pedido é secreto: aqui o Pixel só corre para o Purchase, num iframe (dedup com a CAPI pelo event_id).
  const pixelTag = pixel && meta && view === "paid" &&
    shouldFireBrowserPurchase({ paidAt: order.paid_at, pixelFiredAt: meta.purchase_pixel_fired_at }) && (
    <MetaPurchasePixel
      pixelId={pixel.pixelId}
      currency={pixel.currency}
      value={metaValue(order.amount_due, pixel)}
      productId={order.product_id}
      productName={product.name}
      token={token}
      eventId={meta.purchase_event_id}
      orderId={order.id}
      phone={meta.customer_phone}
      externalId={meta.lead_id}
    />
  );
  const viewProduct = toViewProduct(product);

  if (view === "awaiting" || view === "awaiting_grace") {
    const attemptsLeft = Math.max(0, settings.max_uploads_per_order - order.upload_count);
    const { data: last } = await db
      .from("payment_proofs")
      .select("decision, decision_reason")
      .eq("order_id", order.id)
      .order("attempt_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastRejection = last?.decision === "rejected" ? last.decision_reason : null;
    return (
      <Shell bg={config.backgroundColor}>
        <StatusPoller token={token} view={view} uploads={order.upload_count} />
        {pixelTag}
        <CheckoutView
          product={viewProduct}
          config={config}
          screen="payment"
          payment={{
            entity: order.payment_entity,
            reference: formatReference(order.payment_reference),
            amount: order.amount_due,
            orderNumber: order.order_number,
          }}
          createdAt={order.created_at}
          serverNow={Date.now()}
          revealAll={order.upload_count > 0 || view === "awaiting_grace"}
          paymentHeader={
            view === "awaiting_grace" && (
              <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
                O prazo de pagamento terminou às {formatDateTime(order.expires_at)}. Se pagou antes disso, envie o
                comprovativo até {formatDateTime(uploadDeadline(order, settings))}.
              </p>
            )
          }
          uploadSlot={<ProofUpload token={token} attemptsLeft={attemptsLeft} lastRejection={lastRejection} />}
          footerSlot={footer}
        />
      </Shell>
    );
  }

  return (
    <Shell bg={config.backgroundColor}>
      <StatusPoller token={token} view={view} uploads={order.upload_count} />
      {pixelTag}
      <CheckoutView
        product={viewProduct}
        config={config}
        screen="status"
        statusSlot={<StatusCard view={view} order={order} product={product} token={token} slug={product.slug} />}
        footerSlot={footer}
      />
    </Shell>
  );
}

function Shell({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh" style={{ background: bg }}>
      {children}
    </main>
  );
}

function StatusCard({
  view, order, product, token, slug,
}: {
  view: Exclude<OrderView, "awaiting" | "awaiting_grace">;
  order: NonNullable<Awaited<ReturnType<typeof loadOrderByToken>>>;
  product: NonNullable<Awaited<ReturnType<typeof loadOrderProduct>>>;
  token: string;
  slug: string;
}) {
  const head = (
    <p className="text-xs uppercase tracking-wide text-gray-500">
      Pedido #{order.order_number} · {formatKz(order.amount_due)}
    </p>
  );

  if (view === "paid") {
    return (
      <section className={`${card} text-center`}>
        {head}
        <div className="mx-auto mt-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl text-green-700">✓</div>
        <h1 className="mt-3 text-xl font-bold">Pagamento confirmado</h1>
        <p className="mt-1 text-sm text-gray-600">{product.name}</p>
        <div className="mt-5">
          {product.delivery_type === "pdf" ? (
            <a href={`/pedido/${token}/download`} className={primaryButton}>Descarregar PDF</a>
          ) : (
            <a href={`/pedido/${token}/acesso`} target="_blank" rel="noopener noreferrer" className={primaryButton}>
              {product.delivery_button_label || "Aceder"}
            </a>
          )}
        </div>
        <p className="mt-3 text-xs text-gray-500">Pode voltar a esta página sempre que precisar.</p>
      </section>
    );
  }

  if (view === "under_review") {
    return (
      <section className={`${card} text-center`}>
        {head}
        <div className="mx-auto mt-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-[var(--c-primary)]" />
        <h1 className="mt-3 text-xl font-bold">Comprovativo em análise</h1>
        <p className="mt-1 text-sm text-gray-600">
          Estamos a confirmar o seu pagamento. Esta página actualiza sozinha. Também pode fechar e voltar mais tarde
          pelo link que recebeu.
        </p>
      </section>
    );
  }

  if (view === "rejected") {
    return (
      <section className={`${card} text-center`}>
        {head}
        <h1 className="mt-3 text-xl font-bold">Pagamento não confirmado</h1>
        {order.rejected_reason && <p className="mt-2 text-sm text-gray-700">{order.rejected_reason}</p>}
        <p className="mt-2 text-sm text-gray-600">Se acha que é um engano, contacte o suporte com o número do pedido.</p>
      </section>
    );
  }

  return (
    <section className={`${card} text-center`}>
      {head}
      <h1 className="mt-3 text-xl font-bold">Pedido expirado</h1>
      <p className="mt-1 text-sm text-gray-600">O prazo para pagar este pedido terminou.</p>
      <a href={`/${slug}`} className={`${primaryButton} mt-5`}>Fazer novo pedido</a>
    </section>
  );
}
