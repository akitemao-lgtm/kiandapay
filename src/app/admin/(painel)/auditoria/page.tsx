import Link from "next/link";
import { MissingOrders, StatementImporter } from "@/components/admin/StatementImporter";
import { cardClass } from "@/components/ui/styles";
import { requireAdmin } from "@/lib/auth";
import { luandaDate } from "@/lib/audit/service";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Auditoria" };

export default async function AuditoriaPage() {
  const { supabase, user } = await requireAdmin();
  const [settings, { data: imports }, { data: missing }] = await Promise.all([
    getSettings(supabase, user.id),
    supabase.from("bank_statement_imports").select("*").order("created_at", { ascending: false }).limit(20),
    supabase
      .from("orders")
      .select("id, order_number, customer_name, customer_phone, amount_due, paid_at")
      .eq("status", "paid")
      .eq("reconciliation", "missing")
      .order("paid_at"),
  ]);

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold">Auditoria</h1>
      <p className="mb-6 text-sm text-gray-500">
        Cruze o extrato da sua conta com os pedidos aprovados para encontrar comprovativos falsos.
      </p>

      {!settings.unique_amount_enabled && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Dica: ative <Link href="/admin/configuracoes" className="underline">“Valor único por pedido”</Link> para que cada pagamento
          no extrato corresponda a um só pedido, mesmo com várias vendas do mesmo produto no mesmo dia.
        </p>
      )}

      <div className="space-y-6">
        <StatementImporter />

        {!!missing?.length && (
          <section className={cardClass}>
            <MissingOrders
              orders={missing.map((o) => ({
                id: o.id, order_number: o.order_number, customer_name: o.customer_name, customer_phone: o.customer_phone,
                amount: Number(o.amount_due), paidDate: luandaDate(o.paid_at),
              }))}
            />
          </section>
        )}

        <section className={cardClass}>
          <h2 className="mb-3 font-semibold">Importações anteriores</h2>
          {!imports?.length ? (
            <p className="text-sm text-gray-500">Ainda não importou nenhum extrato.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {imports.map((i) => (
                <li key={i.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {formatDateTime(i.created_at)} · {String(i.file_format).toUpperCase()} · {i.period_start} a {i.period_end}
                  </span>
                  <span className="text-gray-600">
                    {i.line_count} entradas · <span className="text-green-700">{i.matched_count} confirmados</span> ·{" "}
                    <span className={i.missing_count ? "text-red-700" : ""}>{i.missing_count} em falta</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
