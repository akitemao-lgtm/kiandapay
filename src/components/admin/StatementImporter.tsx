"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { importStatement, markAsFound, markAsFraud, previewStatement, type Preview } from "@/app/admin/(painel)/auditoria/actions";
import { buttonPrimary, buttonSecondary, cardClass, errorClass, hintClass, inputClass, labelClass } from "@/components/ui/styles";
import type { Mapping } from "@/lib/audit/parse";
import type { ImportResult, OrderBrief } from "@/lib/audit/service";
import { formatKz } from "@/lib/format";
import { formatAngolanPhone } from "@/lib/phone";
import type { ActionResult } from "@/lib/products/types";
import { uploadStatement } from "@/lib/upload";

const STATUS: Record<string, string> = { awaiting_payment: "aguarda pagamento", under_review: "em análise", expired: "expirado" };

export function StatementImporter() {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPreview(null);
    setResult(null);
    start(async () => {
      try {
        const p = await uploadStatement(file);
        const r = await previewStatement(p);
        if (!r.ok) return setError(r.error);
        setPath(p);
        setPreview(r.data);
        setMapping(r.data.suggested);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (input.current) input.current.value = "";
      }
    });
  }

  function run() {
    if (!path || !mapping) return;
    setError(null);
    start(async () => {
      const r = await importStatement(path, mapping);
      if (!r.ok) return setError(r.error);
      setResult(r.data);
      setPreview(null);
    });
  }

  const columnSelect = (key: "date" | "amount" | "description" | "reference", label: string, optional = false) =>
    preview && mapping && (
      <div>
        <label className={labelClass} htmlFor={`m-${key}`}>{label}</label>
        <select
          id={`m-${key}`}
          value={mapping[key] ?? ""}
          onChange={(e) => setMapping({ ...mapping, [key]: e.target.value === "" ? null : Number(e.target.value) })}
          className={inputClass}
        >
          {optional && <option value="">— nenhuma —</option>}
          {preview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
        </select>
      </div>
    );

  return (
    <section className={`${cardClass} space-y-4`}>
      <div>
        <h2 className="font-semibold">Importar extrato</h2>
        <p className={hintClass}>CSV, Excel (.xlsx) ou PDF exportado do banco ou da carteira. Só as entradas de dinheiro são usadas.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending} onClick={() => input.current?.click()} className={buttonSecondary}>
          {pending && !preview ? "A ler…" : "Escolher ficheiro"}
        </button>
        <input ref={input} type="file" accept=".csv,.xlsx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      {error && <p className={errorClass}>{error}</p>}

      {preview && mapping && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{preview.total} linha(s) no ficheiro. Confirme as colunas:</p>
          {preview.format === "pdf" && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Num PDF não dá para distinguir as colunas de débito e crédito: escolha o valor que corresponde às entradas.
              Saídas sem sinal podem aparecer como “entradas sem pedido”. Sempre que puder, prefira CSV ou Excel.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {columnSelect("date", "Data")}
            {columnSelect("amount", "Valor")}
            <div>
              <label className={labelClass} htmlFor="m-mode">Tipo de valor</label>
              <select id="m-mode" value={mapping.amountMode} onChange={(e) => setMapping({ ...mapping, amountMode: e.target.value as Mapping["amountMode"] })} className={inputClass}>
                <option value="signed">Com sinal (− = saída)</option>
                <option value="credit">Coluna só de entradas</option>
              </select>
            </div>
            {columnSelect("description", "Descrição", true)}
            {columnSelect("reference", "Referência / n.º", true)}
          </div>
          <div className="overflow-x-auto rounded-lg ring-1 ring-gray-200">
            <table className="w-full min-w-[600px] text-xs">
              <thead className="bg-gray-50 text-left">
                <tr>
                  {preview.headers.map((h, i) => (
                    <th
                      key={i}
                      className={`px-2 py-1.5 font-medium ${
                        i === mapping.date || i === mapping.amount ? "bg-blue-50 text-blue-900" : i === mapping.description || i === mapping.reference ? "bg-gray-100" : ""
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.rows.map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j} className="max-w-[16rem] truncate px-2 py-1">{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" disabled={pending} onClick={run} className={buttonPrimary}>
            {pending ? "A cruzar com os pedidos…" : "Importar e cruzar"}
          </button>
        </div>
      )}

      {result && <ResultView result={result} />}
    </section>
  );
}

function ResultView({ result }: { result: ImportResult }) {
  return (
    <div className="space-y-5 border-t border-gray-100 pt-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Entradas no extrato" value={result.credits} />
        <Stat label="Pedidos confirmados" value={result.matched.length} tone="good" />
        <Stat label="Pagos sem entrada" value={result.missing.length} tone={result.missing.length ? "bad" : undefined} />
        <Stat label="Entradas sem pedido" value={result.unmatched.length} />
      </div>
      {result.period && (
        <p className="text-xs text-gray-500">
          Período do extrato: {result.period.from} a {result.period.to}.
          {result.outside > 0 &&
            ` ${result.outside} pedido(s) pago(s) fora deste período, ou nos últimos dias dele (o banco pode lançar depois), ficam por avaliar no próximo extrato.`}
        </p>
      )}
      {result.missing.length > 0 && <MissingOrders orders={result.missing} />}
      {result.unmatched.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold">Entradas sem pedido pago</h3>
          <ul className="divide-y divide-gray-100 text-sm">
            {result.unmatched.map((u, i) => (
              <li key={i} className="py-2">
                <span className="font-medium">{formatKz(u.amount)}</span> · {u.date}
                {u.description && <span className="text-gray-500"> · {u.description}</span>}
                {u.candidates.length > 0 && (
                  <span className="block text-xs text-amber-800">
                    Pode ser de:{" "}
                    {u.candidates.map((c, j) => (
                      <span key={c.id}>
                        {j > 0 && ", "}
                        <Link href={`/admin/pedidos/${c.id}`} className="underline">#{c.order_number} {c.customer_name}</Link> ({STATUS[c.status] ?? c.status})
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${tone === "bad" ? "text-red-700" : tone === "good" ? "text-green-700" : ""}`}>{value}</p>
    </div>
  );
}

/** Pedidos pagos sem entrada no extrato: confirmar fraude ou marcar como encontrado. */
export function MissingOrders({ orders }: { orders: OrderBrief[] }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const open = orders.filter((o) => !done[o.id]);

  const act = (fn: () => Promise<ActionResult>, ids: string[], label: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r);
      if (r.ok) setDone((d) => ({ ...d, ...Object.fromEntries(ids.map((id) => [id, label])) }));
    });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-red-800">Pagos sem entrada no extrato</h3>
        {open.length > 1 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => markAsFraud(open.map((o) => o.id)), open.map((o) => o.id), "fraude")}
            className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            Marcar todos ({open.length}) como fraude
          </button>
        )}
      </div>
      <p className={`${hintClass} mb-2`}>
        Marcar como fraude retira o acesso ao produto e bloqueia o número. Se o pagamento entrou noutra conta ou noutro extrato, use “Encontrei”.
      </p>
      <ul className="divide-y divide-gray-100 text-sm">
        {orders.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <Link href={`/admin/pedidos/${o.id}`} className="font-medium underline">#{o.order_number}</Link> · {o.customer_name} ·{" "}
              {formatAngolanPhone(o.customer_phone)}
              <span className="block text-xs text-gray-500">{formatKz(o.amount)} · pago a {o.paidDate}</span>
            </div>
            {done[o.id] ? (
              <span className="text-xs font-medium text-gray-600">{done[o.id] === "fraude" ? "Marcado como fraude" : "Confirmado"}</span>
            ) : (
              <div className="flex gap-2">
                <button type="button" disabled={pending} onClick={() => act(() => markAsFound(o.id), [o.id], "ok")} className="rounded-lg border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50">
                  Encontrei
                </button>
                <button type="button" disabled={pending} onClick={() => act(() => markAsFraud([o.id]), [o.id], "fraude")} className="rounded-lg border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50">
                  Fraude
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.ok ? msg.message : msg.error}</p>}
    </div>
  );
}
