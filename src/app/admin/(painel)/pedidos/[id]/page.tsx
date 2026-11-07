import Link from "next/link";
import { notFound } from "next/navigation";
import { ResendPurchaseButton } from "@/components/admin/ResendPurchaseButton";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { cardClass } from "@/components/ui/styles";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatKz } from "@/lib/format";
import { formatAngolanPhone } from "@/lib/phone";
import { formatReference } from "@/lib/settings";
import { orderStatusUrl } from "@/lib/site";
import { unblockLead } from "../actions";

export const metadata = { title: "Pedido" };

const DECISION: Record<string, string> = { pending: "Pendente", approved: "Aprovado", rejected: "Rejeitado", exception: "Em análise" };
const ACCESS: Record<string, string> = { status_view: "Abriu a página", pdf_download: "Descarregou o PDF", link_click: "Abriu o link de acesso" };
const TRIGGER: Record<string, string> = { auto: "automático", manual_approval: "aprovação manual", manual_resend: "reenvio manual", status_page: "página do pedido" };

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-gray-500">{k}</dt>
      <dd className="min-w-0 break-words">{v ?? <span className="text-gray-400">—</span>}</dd>
    </div>
  );
}

export default async function PedidoAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAdmin();
  const { data: o } = await supabase.from("orders").select("*, leads!orders_lead_id_fkey(id, blocked_at, blocked_reason)").eq("id", id).maybeSingle();
  if (!o) notFound();
  const lead = o.leads as { id: string; blocked_at: string | null; blocked_reason: string | null };

  const [{ data: proofs }, { data: events }, { data: access }, { data: messages }, { data: timeline }] = await Promise.all([
    supabase.from("payment_proofs").select("id, attempt_no, created_at, kind, decision, decision_source, decision_reason, ext_amount, ext_transaction_id").eq("order_id", id).order("attempt_no"),
    supabase.from("meta_events").select("id, event_name, event_id, source, trigger, status, response_status, response_body, value, currency, test_event_code, created_at").eq("order_id", id).order("created_at"),
    supabase.from("order_access_logs").select("kind, created_at").eq("order_id", id).neq("kind", "status_view").order("created_at", { ascending: false }).limit(50),
    supabase.from("outbound_messages").select("channel, template, status, error, created_at").eq("order_id", id).order("created_at"),
    supabase.from("order_events").select("type, from_status, to_status, created_at").eq("order_id", id).order("created_at"),
  ]);
  const { count: views } = await supabase.from("order_access_logs").select("id", { count: "exact", head: true }).eq("order_id", id).eq("kind", "status_view");

  const purchaseOk = (events ?? []).some((e) => e.event_name === "Purchase" && e.source === "server" && e.status === "success");

  return (
    <>
      <Link href="/admin/pedidos" className="text-sm text-gray-500 hover:text-gray-900">← Pedidos</Link>
      <div className="mb-6 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Pedido #{o.order_number}</h1>
        <StatusBadge status={o.status} />
        <a href={orderStatusUrl(o.public_token)} target="_blank" rel="noopener noreferrer" className="text-sm underline">
          Ver página do cliente
        </a>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={cardClass}>
          <h2 className="mb-3 font-semibold">Cliente</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <Row k="Nome" v={o.customer_name} />
            <Row k="Telefone" v={formatAngolanPhone(o.customer_phone)} />
            <Row k="Email" v={o.customer_email} />
            <Row k="Bloqueado" v={lead.blocked_at ? `Sim — ${lead.blocked_reason ?? ""}` : "Não"} />
          </dl>
          {lead.blocked_at && (
            <form action={unblockLead.bind(null, lead.id, o.id)} className="mt-2">
              <button className="text-sm text-red-700 underline">Desbloquear número</button>
            </form>
          )}
        </section>

        <section className={cardClass}>
          <h2 className="mb-3 font-semibold">Pagamento</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <Row k="Produto" v={o.product_name} />
            <Row k="Valor" v={`${formatKz(o.amount_due)}${o.unique_offset ? ` (inclui +${o.unique_offset} Kz únicos)` : ""}`} />
            <Row k="Entidade / Ref." v={`${o.payment_entity} / ${formatReference(o.payment_reference)}`} />
            <Row k="Criado" v={formatDateTime(o.created_at)} />
            <Row k="Validade" v={formatDateTime(o.expires_at)} />
            <Row k="Pago" v={o.paid_at ? `${formatDateTime(o.paid_at)} (${o.paid_via === "auto" ? "automático" : "manual"})` : null} />
            <Row k="Motivo" v={o.rejected_reason} />
          </dl>
        </section>

        <section className={cardClass}>
          <h2 className="mb-3 font-semibold">Origem</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <Row k="UTM source" v={o.utm_source} />
            <Row k="UTM medium" v={o.utm_medium} />
            <Row k="UTM campaign" v={o.utm_campaign} />
            <Row k="UTM content" v={o.utm_content} />
            <Row k="UTM term" v={o.utm_term} />
            <Row k="fbclid" v={o.fbclid && <code className="text-xs">{o.fbclid}</code>} />
            <Row k="_fbc" v={o.fbc && <code className="text-xs">{o.fbc}</code>} />
            <Row k="_fbp" v={o.fbp && <code className="text-xs">{o.fbp}</code>} />
            <Row k="IP" v={o.ip} />
            <Row k="Browser" v={o.user_agent && <span className="text-xs">{o.user_agent}</span>} />
            <Row k="URL" v={o.source_url && <span className="text-xs">{o.source_url}</span>} />
          </dl>
        </section>

        <section className={cardClass}>
          <h2 className="mb-3 font-semibold">Comprovativos</h2>
          {!proofs?.length ? (
            <p className="text-sm text-gray-500">Nenhum comprovativo enviado.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {proofs.map((p) => (
                <li key={p.id}>
                  <Link href={`/admin/excecoes/${p.id}`} className="font-medium underline">Envio {p.attempt_no}</Link>{" "}
                  · {formatDateTime(p.created_at)} · {p.kind === "pdf" ? "PDF" : "Imagem"} ·{" "}
                  <strong>{DECISION[p.decision]}</strong>{p.decision_source === "manual" && " (manual)"}
                  {p.ext_amount !== null && ` · lido ${formatKz(p.ext_amount)}`}
                  {p.decision_reason && <span className="block text-gray-500">{p.decision_reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${cardClass} lg:col-span-2`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Eventos Meta</h2>
            {o.status === "paid" && !purchaseOk && <ResendPurchaseButton orderId={o.id} />}
          </div>
          {!events?.length ? (
            <p className="text-sm text-gray-500">Nenhum evento (o Meta está desativado neste produto?).</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr><th className="pb-2 pr-3">Quando</th><th className="pb-2 pr-3">Evento</th><th className="pb-2 pr-3">Via</th><th className="pb-2 pr-3">Estado</th><th className="pb-2">Resposta</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {events.map((e) => {
                    const body = e.response_body as { error?: { message?: string }; events_received?: number } | null;
                    return (
                      <tr key={e.id}>
                        <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(e.created_at)}</td>
                        <td className="py-2 pr-3">
                          {e.event_name}
                          {e.value !== null && <span className="text-gray-500"> · {e.value} {e.currency}</span>}
                          {e.test_event_code && <span className="ml-1 rounded bg-blue-50 px-1 text-xs text-blue-800">teste</span>}
                        </td>
                        <td className="py-2 pr-3">{e.source === "server" ? "API de Conversões" : "Pixel"} · {TRIGGER[e.trigger] ?? e.trigger}</td>
                        <td className={`py-2 pr-3 font-medium ${e.status === "success" ? "text-green-700" : e.status === "error" ? "text-red-700" : "text-gray-500"}`}>
                          {e.status === "success" ? "OK" : e.status === "error" ? "Erro" : "Pendente"}
                        </td>
                        <td className="py-2 text-xs text-gray-600">
                          {e.source === "server" && (body?.error?.message ?? (body?.events_received !== undefined ? `recebidos: ${body.events_received}` : e.response_status ?? ""))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-gray-400">event_id do Purchase: <code>{o.purchase_event_id}</code> (igual no Pixel e na API, para o Meta deduplicar).</p>
            </div>
          )}
        </section>

        <section className={cardClass}>
          <h2 className="mb-3 font-semibold">Acessos ao produto</h2>
          <p className="mb-2 text-sm text-gray-500">Página do pedido aberta {views ?? 0} vez(es).</p>
          {!access?.length ? (
            <p className="text-sm text-gray-500">Ainda sem downloads nem cliques.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {access.map((a, i) => <li key={i}>{formatDateTime(a.created_at)} — {ACCESS[a.kind]}</li>)}
            </ul>
          )}
        </section>

        <section className={cardClass}>
          <h2 className="mb-3 font-semibold">Mensagens e histórico</h2>
          <ul className="space-y-1 text-sm">
            {(timeline ?? []).map((t, i) => (
              <li key={`t${i}`} className="text-gray-700">
                {formatDateTime(t.created_at)} — {t.type === "created" ? "Pedido criado" : `${t.from_status} → ${t.to_status}`}
              </li>
            ))}
            {(messages ?? []).map((m, i) => (
              <li key={`m${i}`} className="text-gray-700">
                {formatDateTime(m.created_at)} — {m.channel.toUpperCase()} “{m.template}”: {m.status}
                {m.error && <span className="text-red-600"> ({m.error})</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
