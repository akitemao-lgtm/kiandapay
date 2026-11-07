"use client";

import { useState, useTransition } from "react";
import {
  addReference, deleteReference, renameReference, setDefaultReference, setReferenceActive,
} from "@/app/admin/(painel)/configuracoes/references-actions";
import { buttonPrimary, buttonSecondary, cardClass, errorClass, hintClass, inputClass, labelClass } from "@/components/ui/styles";
import { safeAction } from "@/lib/client/safe-action";
import type { PaymentRef } from "@/lib/payments/references";
import type { ActionResult } from "@/lib/products/types";
import { formatReference } from "@/lib/settings";

const smallBtn = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50";

export function PaymentReferences({ refs }: { refs: PaymentRef[] }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) => {
    setResult(null);
    start(async () => setResult(await safeAction(fn)));
  };
  const inUse = refs.find((r) => r.is_default);

  return (
    <section className={`${cardClass} space-y-4`}>
      <div>
        <h2 className="font-semibold">Referências de pagamento</h2>
        <p className={hintClass}>
          A referência <strong>em uso</strong> aparece em todos os checkouts. Pode trocar a qualquer momento: os pedidos
          novos passam a usá-la e os pedidos já criados mantêm a referência com que foram feitos.
        </p>
      </div>

      {!inUse && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Adicione uma referência. Enquanto não houver nenhuma em uso, o checkout não aceita pedidos.
        </p>
      )}

      {refs.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-xl ring-1 ring-gray-200">
          {refs.map((r) => (
            <RefRow key={r.id} r={r} pending={pending} run={run} />
          ))}
        </ul>
      )}

      {result && (
        <p className={`text-sm ${result.ok ? "text-green-700" : "text-red-600"}`}>{result.ok ? result.message : result.error}</p>
      )}

      <AddForm />
    </section>
  );
}

function RefRow({
  r, pending, run,
}: { r: PaymentRef; pending: boolean; run: (fn: () => Promise<ActionResult>) => void }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(r.label);

  return (
    <li className={`flex flex-col gap-3 p-3 sm:flex-row sm:items-center ${r.is_active ? "" : "opacity-60"}`}>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setEditing(false);
              run(() => renameReference(r.id, label));
            }}
          >
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Nome (ex.: BAI do João)" className={inputClass} autoFocus />
            <button type="submit" className={smallBtn}>OK</button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{r.label || "Sem nome"}</span>
            {r.is_default && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Em uso</span>}
            {!r.is_active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Desativada</span>}
            <button type="button" onClick={() => setEditing(true)} className="text-xs text-gray-500 underline">mudar nome</button>
          </div>
        )}
        <p className="mt-0.5 font-mono text-sm text-gray-700">
          Entidade {r.entity} · Ref. {formatReference(r.reference)}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {!r.is_default && r.is_active && (
          <button type="button" disabled={pending} onClick={() => run(() => setDefaultReference(r.id))} className={buttonPrimary}>
            Usar nos checkouts
          </button>
        )}
        {!r.is_default && (
          <button type="button" disabled={pending} onClick={() => run(() => setReferenceActive(r.id, !r.is_active))} className={smallBtn}>
            {r.is_active ? "Desativar" : "Ativar"}
          </button>
        )}
        {!r.is_default && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(`Apagar a referência ${formatReference(r.reference)}? Os pedidos já feitos não são afetados.`)) {
                run(() => deleteReference(r.id));
              }
            }}
            className={`${smallBtn} text-red-700`}
          >
            Apagar
          </button>
        )}
      </div>
    </li>
  );
}

function AddForm() {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ label: "", entity: "", reference: "" });
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {};

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonSecondary}>
        + Adicionar referência
      </button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-xl bg-gray-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        start(async () => {
          const r = await safeAction(() => addReference(v));
          setResult(r);
          if (r.ok) setV({ label: "", entity: "", reference: "" });
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="ref-label">Nome</label>
          <input id="ref-label" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} maxLength={60} placeholder="ex.: BAI do João" className={inputClass} />
          {errors.label && <p className={errorClass}>{errors.label}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="ref-entity">Entidade</label>
          <input id="ref-entity" inputMode="numeric" value={v.entity} onChange={(e) => setV({ ...v, entity: e.target.value })} placeholder="00000" className={`${inputClass} font-mono`} />
          {errors.entity && <p className={errorClass}>{errors.entity}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="ref-ref">Referência</label>
          <input id="ref-ref" inputMode="numeric" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} placeholder="000 000 000" className={`${inputClass} font-mono`} />
          {errors.reference && <p className={errorClass}>{errors.reference}</p>}
        </div>
      </div>
      {result && (
        <p className={`text-sm ${result.ok ? "text-green-700" : "text-red-600"}`}>{result.ok ? result.message : result.error}</p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={buttonPrimary}>{pending ? "A guardar…" : "Adicionar"}</button>
        <button type="button" onClick={() => { setOpen(false); setResult(null); }} className={buttonSecondary}>Fechar</button>
      </div>
      <p className={hintClass}>A nova referência fica na lista. Toque em “Usar nos checkouts” para a pôr em uso.</p>
    </form>
  );
}
