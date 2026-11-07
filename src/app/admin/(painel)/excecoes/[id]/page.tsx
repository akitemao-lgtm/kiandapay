import Link from "next/link";
import { notFound } from "next/navigation";
import { ChecksList } from "@/components/admin/ChecksList";
import { ExceptionActions } from "@/components/admin/ExceptionActions";
import { cardClass } from "@/components/ui/styles";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatKz } from "@/lib/format";
import { formatAngolanPhone } from "@/lib/phone";
import { bankLabel } from "@/lib/proofs/banks";
import { PROOF_BUCKET } from "@/lib/proofs/process";
import { formatReference } from "@/lib/settings";

export const metadata = { title: "Analisar comprovativo" };

const DECISION: Record<string, string> = {
  pending: "Pendente", approved: "Aprovado", rejected: "Rejeitado", exception: "Em análise",
};

export default async function ExcecaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAdmin();
  const { data: proof } = await supabase
    .from("payment_proofs")
    .select("*, orders!payment_proofs_order_id_fkey(id, order_number, status, amount_due, created_at, expires_at, payment_entity, payment_reference, customer_name, customer_phone, customer_email, product_name, upload_count, utm_campaign)")
    .eq("id", id)
    .maybeSingle();
  if (!proof) notFound();
  const order = proof.orders as {
    id: string; order_number: number; status: string; amount_due: number; created_at: string; expires_at: string;
    payment_entity: string; payment_reference: string; customer_name: string; customer_phone: string;
    customer_email: string | null; product_name: string; upload_count: number; utm_campaign: string | null;
  };

  const [{ data: checks }, { data: others }, { data: templates }, { data: signed }, { data: template }] = await Promise.all([
    supabase.from("proof_checks").select("check_code, result, message").eq("proof_id", id).order("id"),
    supabase.from("payment_proofs").select("id, attempt_no, decision, decision_reason, created_at").eq("order_id", order.id).neq("id", id).order("attempt_no"),
    supabase.from("proof_templates").select("id, name").eq("is_active", true).order("name"),
    supabase.storage.from(PROOF_BUCKET).createSignedUrl(proof.storage_path, 600),
    proof.template_id ? supabase.from("proof_templates").select("name").eq("id", proof.template_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const rows: [string, string, string | null, boolean | null][] = [
    ["Valor", formatKz(order.amount_due), proof.ext_amount !== null ? formatKz(proof.ext_amount) : null,
      proof.ext_amount !== null ? Number(proof.ext_amount) >= Number(order.amount_due) : null],
    ["Entidade", order.payment_entity, proof.ext_entity, proof.ext_entity ? proof.ext_entity === order.payment_entity : null],
    ["Referência", formatReference(order.payment_reference), proof.ext_reference ? formatReference(proof.ext_reference) : null,
      proof.ext_reference ? proof.ext_reference === order.payment_reference : null],
    ["Data/hora", `Pedido: ${formatDateTime(order.created_at)}`, proof.ext_paid_at ? formatDateTime(proof.ext_paid_at) : null, null],
    ["N.º transação", "—", proof.ext_transaction_id, null],
    ["Ordenante", order.customer_name, proof.ext_payer_name, null],
  ];

  const fileUrl = signed?.signedUrl ?? null;
  const decided = proof.decision !== "exception" && proof.decision !== "pending";

  return (
    <>
      <Link href="/admin/excecoes" className="text-sm text-gray-500 hover:text-gray-900">← Exceções</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-2xl font-semibold">Pedido #{order.order_number}</h1>
        <span className="text-sm text-gray-500">
          Envio {proof.attempt_no} · {formatDateTime(proof.created_at)} · {DECISION[proof.decision]}
          {proof.decision_source === "manual" && " (manual)"}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={`${cardClass} p-0 sm:p-0`}>
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="text-sm font-medium">
              {proof.kind === "image" ? "Imagem" : "PDF"} · {template?.name ?? bankLabel(proof.bank_code)}
            </span>
            {fileUrl && <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline">Abrir</a>}
          </div>
          {fileUrl ? (
            proof.kind === "image" ? (
              <img src={fileUrl} alt="Comprovativo" className="max-h-[75vh] w-full object-contain" />
            ) : (
              <div className="space-y-2 p-2">
                {Array.from({ length: Math.min(Number((proof.pdf_meta as { pageCount?: number })?.pageCount) || 1, 3) }, (_, i) => (
                  <img key={i} src={`/admin/excecoes/${proof.id}/pagina/${i + 1}`} alt={`Página ${i + 1}`} className="w-full rounded-lg ring-1 ring-gray-200" />
                ))}
              </div>
            )
          ) : (
            <p className="p-4 text-sm text-red-600">Ficheiro indisponível.</p>
          )}
        </section>

        <div className="space-y-6">
          {proof.decision_reason && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>Motivo:</strong> {proof.decision_reason}
            </p>
          )}

          <section className={cardClass}>
            <h2 className="mb-3 font-semibold">Pedido vs comprovativo</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="pb-2 font-medium" />
                  <th className="pb-2 font-medium">Esperado</th>
                  <th className="pb-2 font-medium">Lido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(([label, expected, read, ok]) => (
                  <tr key={label}>
                    <td className="py-2 pr-2 text-gray-500">{label}</td>
                    <td className="py-2 pr-2">{expected}</td>
                    <td className={`py-2 font-medium ${ok === false ? "text-red-700" : ok ? "text-green-700" : ""}`}>{read ?? <span className="text-gray-400">não lido</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={cardClass}>
            <h2 className="mb-3 font-semibold">Decidir</h2>
            <ExceptionActions
              proofId={proof.id}
              isPdf={proof.kind === "pdf"}
              bankGuess={proof.bank_code}
              templates={templates ?? []}
              decided={decided}
            />
          </section>

          <section className={cardClass}>
            <h2 className="mb-2 font-semibold">Verificações</h2>
            <ChecksList checks={(checks ?? []).map((c) => ({ code: c.check_code, result: c.result, message: c.message }))} />
          </section>

          <section className={`${cardClass} text-sm`}>
            <h2 className="mb-2 font-semibold">Cliente</h2>
            <p>{order.customer_name} · {formatAngolanPhone(order.customer_phone)}</p>
            {order.customer_email && <p className="text-gray-600">{order.customer_email}</p>}
            <p className="mt-1 text-gray-600">{order.product_name}{order.utm_campaign && ` · campanha ${order.utm_campaign}`}</p>
            {others && others.length > 0 && (
              <>
                <h3 className="mb-1 mt-4 font-medium">Outros envios deste pedido</h3>
                <ul className="space-y-1">
                  {others.map((o) => (
                    <li key={o.id}>
                      <Link href={`/admin/excecoes/${o.id}`} className="underline">Envio {o.attempt_no}</Link>{" "}
                      · {DECISION[o.decision]} {o.decision_reason && <span className="text-gray-500">— {o.decision_reason}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
