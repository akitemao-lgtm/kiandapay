import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatKz } from "@/lib/format";
import { bankLabel } from "@/lib/proofs/banks";

export const metadata = { title: "Exceções" };

type Row = {
  proof_id: string; created_at: string; decision_reason: string | null; bank_code: string | null; ext_amount: number | null;
  kind: "pdf" | "image"; order_number: number; amount_due: number; customer_name: string; product_name: string;
};

export default async function ExcecoesPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("v_pending_exceptions").select("*").order("created_at");
  const rows = (data ?? []) as Row[];

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold">Exceções</h1>
      <p className="mb-6 text-sm text-gray-500">Comprovativos que o sistema não decidiu sozinho. Os mais antigos primeiro.</p>
      {rows.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 p-10 text-center text-gray-500">
          Nada para analisar. 🎉
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
          {rows.map((r) => (
            <li key={r.proof_id}>
              <Link href={`/admin/excecoes/${r.proof_id}`} className="flex flex-col gap-1 p-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    #{r.order_number} · {r.customer_name}
                  </p>
                  <p className="truncate text-sm text-gray-500">{r.product_name} · {formatDateTime(r.created_at)}</p>
                  <p className="mt-1 text-sm text-amber-800">{r.decision_reason}</p>
                </div>
                <div className="text-sm sm:text-right">
                  <p>Pedido: <strong>{formatKz(r.amount_due)}</strong></p>
                  <p className="text-gray-500">
                    Lido: {r.ext_amount !== null ? formatKz(r.ext_amount) : "—"} · {r.kind === "image" ? "Imagem" : bankLabel(r.bank_code)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
