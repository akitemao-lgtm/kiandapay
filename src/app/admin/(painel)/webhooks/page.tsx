import { WebhooksManager, type Delivery, type Endpoint } from "@/components/admin/WebhooksManager";
import { cardClass } from "@/components/ui/styles";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "Webhooks" };
export const dynamic = "force-dynamic";

const EXAMPLE = `{
  "id": "id-do-envio",
  "event": "order.paid",
  "created_at": "2026-11-04T12:00:00Z",
  "data": {
    "order": { "number": 1040, "status": "paid", "amount": 5000, "currency": "AOA", "paid_at": "…", "url": "…" },
    "customer": { "name": "Maria", "phone": "244923000000", "email": null },
    "product": { "id": "…", "name": "…", "slug": "…" },
    "tracking": { "utm_source": "facebook", "utm_campaign": "…" }
  }
}`;

const VERIFY = `const assinatura = "sha256=" + crypto
  .createHmac("sha256", SEGREDO)
  .update(req.headers["x-kiandapay-timestamp"] + "." + corpoOriginal)
  .digest("hex");
// compare com o cabeçalho x-kiandapay-signature`;

export default async function WebhooksPage() {
  const { supabase } = await requireAdmin();
  const [{ data: endpoints }, { data: products }, { data: deliveries }] = await Promise.all([
    supabase.from("webhook_endpoints").select("id, url, description, events, is_active, product_id").order("created_at"),
    supabase.from("products").select("id, name").order("name"),
    supabase
      .from("webhook_deliveries")
      .select("id, endpoint_id, event, status, attempts, last_status, last_error, next_attempt_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Webhooks</h1>
        <p className="text-sm text-gray-500">
          A KiandaPay avisa o seu sistema (n8n, Zapier, CRM…) sempre que um pedido muda de estado.
        </p>
      </div>
      <WebhooksManager endpoints={(endpoints ?? []) as Endpoint[]} deliveries={(deliveries ?? []) as Delivery[]} products={products ?? []} />
      <details className={`${cardClass} mt-6`}>
        <summary className="cursor-pointer font-semibold">Como funciona</summary>
        <div className="mt-3 space-y-3 text-sm text-gray-700">
          <p>
            Enviamos um <code>POST</code> em JSON. Responda com um código 2xx em menos de 10 segundos. Se falhar, repetimos
            até 6 vezes: depois de 1 minuto, 5 minutos, 30 minutos, 2 horas e 12 horas.
          </p>
          <p>
            O mesmo aviso pode chegar mais do que uma vez: use o <code>id</code> para ignorar repetições. Não seguimos
            redirecionamentos.
          </p>
          <p>
            <strong>Guarde em segurança o que recebe:</strong> inclui dados do cliente e o link do pedido, que dá acesso ao
            produto depois de pago.
          </p>
          <pre className="overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs">{EXAMPLE}</pre>
          <p>Confirme que o aviso veio da KiandaPay (Node.js):</p>
          <pre className="overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs">{VERIFY}</pre>
        </div>
      </details>
    </>
  );
}
