"use client";

import { useState, useTransition } from "react";
import {
  createWebhook, deleteWebhook, resendDelivery, rotateWebhookSecret, sendTestWebhook, setWebhookActive, type WebhookResult,
} from "@/app/admin/(painel)/webhooks/actions";
import { buttonPrimary, buttonSecondary, cardClass, errorClass, hintClass, inputClass, labelClass } from "@/components/ui/styles";
import { safeAction } from "@/lib/client/safe-action";
import { formatDateTime } from "@/lib/format";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhooks/events";

export type Endpoint = { id: string; url: string; description: string; events: string[]; is_active: boolean; product_id: string | null };
export type ProductOption = { id: string; name: string };
export type Delivery = {
  id: string; endpoint_id: string; event: string; status: string; attempts: number; last_status: number | null;
  last_error: string | null; next_attempt_at: string; created_at: string;
};

const smallBtn = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50";
const EVENTS = Object.entries(WEBHOOK_EVENTS) as [WebhookEvent, string][];

const STATUS: Record<string, { label: string; c: string }> = {
  success: { label: "Entregue", c: "bg-green-100 text-green-800" },
  failed: { label: "Falhou", c: "bg-red-100 text-red-800" },
  pending: { label: "Por enviar", c: "bg-amber-100 text-amber-800" },
  sending: { label: "A enviar", c: "bg-blue-100 text-blue-800" },
};

function useRun() {
  const [result, setResult] = useState<WebhookResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<WebhookResult>) => {
    setResult(null);
    start(async () => setResult((await safeAction(fn)) as WebhookResult));
  };
  return { run, pending, result, setResult };
}

function Feedback({ result }: { result: WebhookResult | null }) {
  if (!result) return null;
  return (
    <div className="space-y-2">
      <p className={`text-sm ${result.ok ? "text-green-700" : "text-red-600"}`}>{result.ok ? result.message : result.error}</p>
      {result.ok && result.secret && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Copie o segredo agora. Não volta a ser mostrado.</p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">{result.secret}</code>
        </div>
      )}
    </div>
  );
}

/** fixedProductId: na página de um produto, os webhooks novos ficam ligados a ele. */
export function WebhooksManager({
  endpoints, deliveries, products, fixedProductId,
}: { endpoints: Endpoint[]; deliveries: Delivery[]; products: ProductOption[]; fixedProductId?: string }) {
  const productName = (id: string | null) =>
    id ? (products.find((p) => p.id === id)?.name ?? "Produto") : "Todos os produtos";
  return (
    <div className="space-y-6">
      <AddForm products={products} fixedProductId={fixedProductId} />
      {endpoints.map((e) => (
        <EndpointCard
          key={e.id}
          endpoint={e}
          scope={fixedProductId ? null : productName(e.product_id)}
          deliveries={deliveries.filter((d) => d.endpoint_id === e.id)}
        />
      ))}
    </div>
  );
}

function AddForm({ products, fixedProductId }: { products: ProductOption[]; fixedProductId?: string }) {
  const empty = { url: "", description: "", events: ["order.paid"] as string[], productId: fixedProductId ?? null as string | null };
  const [v, setV] = useState(empty);
  const { run, pending, result } = useRun();
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {};

  return (
    <form
      className={`${cardClass} space-y-4`}
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await createWebhook(v);
          if (r.ok) setV(empty);
          return r;
        });
      }}
    >
      <h2 className="font-semibold">Adicionar webhook</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="wh-url">URL</label>
          <input id="wh-url" type="url" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} placeholder="https://exemplo.com/webhook" className={inputClass} />
          {errors.url && <p className={errorClass}>{errors.url}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="wh-desc">Descrição (opcional)</label>
          <input id="wh-desc" maxLength={80} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="ex.: n8n vendas" className={inputClass} />
          {errors.description && <p className={errorClass}>{errors.description}</p>}
        </div>
      </div>
      {!fixedProductId && (
        <div>
          <label className={labelClass} htmlFor="wh-product">Produto</label>
          <select
            id="wh-product"
            value={v.productId ?? ""}
            onChange={(e) => setV({ ...v, productId: e.target.value || null })}
            className={inputClass}
          >
            <option value="">Todos os produtos</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {errors.productId && <p className={errorClass}>{errors.productId}</p>}
        </div>
      )}
      <fieldset>
        <legend className={labelClass}>Eventos</legend>
        <div className="flex flex-wrap gap-2">
          {EVENTS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={v.events.includes(key)}
                onChange={(e) => setV({ ...v, events: e.target.checked ? [...v.events, key] : v.events.filter((x) => x !== key) })}
              />
              {label}
            </label>
          ))}
        </div>
        {errors.events && <p className={errorClass}>{errors.events}</p>}
      </fieldset>
      <Feedback result={result} />
      <button type="submit" disabled={pending} className={buttonPrimary}>{pending ? "A guardar…" : "Adicionar"}</button>
    </form>
  );
}

function EndpointCard({ endpoint: e, scope, deliveries }: { endpoint: Endpoint; scope: string | null; deliveries: Delivery[] }) {
  const { run, pending, result } = useRun();
  return (
    <section className={`${cardClass} space-y-4 ${e.is_active ? "" : "opacity-70"}`}>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">{e.description || "Webhook"}</h2>
          {scope && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">{scope}</span>}
          {!e.is_active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Desativado</span>}
        </div>
        <p className="mt-0.5 break-all font-mono text-sm text-gray-700">{e.url}</p>
        <p className={hintClass}>{e.events.map((x) => WEBHOOK_EVENTS[x as WebhookEvent] ?? x).join(" · ")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => run(() => sendTestWebhook(e.id))} className={buttonSecondary}>Enviar teste</button>
        <button type="button" disabled={pending} onClick={() => run(() => setWebhookActive(e.id, !e.is_active))} className={smallBtn}>
          {e.is_active ? "Desativar" : "Ativar"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => confirm("Gerar um segredo novo? O atual deixa de valer imediatamente.") && run(() => rotateWebhookSecret(e.id))}
          className={smallBtn}
        >
          Gerar segredo novo
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => confirm("Apagar este webhook e o histórico de envios?") && run(() => deleteWebhook(e.id))}
          className={`${smallBtn} text-red-700`}
        >
          Apagar
        </button>
      </div>
      <Feedback result={result} />

      <div>
        <h3 className="mb-2 text-sm font-medium">Últimos envios</h3>
        {deliveries.length ? (
          <ul className="divide-y divide-gray-100 rounded-xl ring-1 ring-gray-200">
            {deliveries.map((d) => {
              const s = STATUS[d.status] ?? { label: d.status, c: "bg-gray-100" };
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.c}`}>{s.label}</span>
                  <span className="font-mono text-xs">{d.event}</span>
                  <span className="min-w-0 flex-1 text-xs text-gray-500">
                    {formatDateTime(d.created_at)} · {d.attempts} {d.attempts === 1 ? "tentativa" : "tentativas"}
                    {d.last_error && ` · ${d.last_error}`}
                    {d.status === "pending" && d.attempts > 0 && ` · nova tentativa ${formatDateTime(d.next_attempt_at)}`}
                  </span>
                  {(d.status === "failed" || d.status === "success") && (
                    <button type="button" disabled={pending} onClick={() => run(() => resendDelivery(d.id))} className="text-xs underline disabled:opacity-50">
                      Reenviar
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-gray-500">Ainda sem envios.</p>}
      </div>
    </section>
  );
}
