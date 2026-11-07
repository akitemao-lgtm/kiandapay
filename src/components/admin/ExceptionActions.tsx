"use client";

import { safeAction } from "@/lib/client/safe-action";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveProof, rejectProof } from "@/app/admin/(painel)/excecoes/actions";
import { buttonPrimary, buttonSecondary, errorClass, hintClass, inputClass, labelClass } from "@/components/ui/styles";
import type { ActionResult } from "@/lib/products/types";
import { BANK_LABELS, CHANNEL_LABELS } from "@/lib/proofs/banks";

const PRESETS = [
  "O valor pago é inferior ao valor do pedido.",
  "A Entidade/Referência não correspondem às indicadas.",
  "O comprovativo não é legível. Envie o PDF gerado pela app.",
  "Não encontrámos este pagamento.",
];

type Props = {
  proofId: string;
  isPdf: boolean;
  bankGuess: string | null;
  templates: { id: string; name: string }[];
  decided: boolean;
};

export function ExceptionActions({ proofId, isPdf, bankGuess, templates, decided }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateMode, setTemplateMode] = useState<"new" | string>("new");
  const [bankCode, setBankCode] = useState(bankGuess ?? "bai");
  const [channel, setChannel] = useState("app");
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [fraud, setFraud] = useState(false);

  function run(fn: () => Promise<ActionResult>) {
    setResult(null);
    start(async () => {
      const r = await safeAction(fn);
      setResult(r);
      if (r.ok) router.refresh();
    });
  }

  function approve() {
    const target = !saveTemplate
      ? null
      : templateMode === "new"
        ? {
            bankCode, channel,
            name: name.trim() || `${BANK_LABELS[bankCode] ?? bankCode} — ${CHANNEL_LABELS[channel]}`,
            keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
          }
        : { templateId: templateMode };
    run(() => approveProof(proofId, target));
  }

  return (
    <div className="space-y-4">
      {decided && (
        <p className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">
          Este comprovativo já foi decidido. Pode alterar a decisão, se necessário.
        </p>
      )}

      {isPdf && (
        <div className="rounded-xl border border-gray-200 p-3">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} className="mt-0.5 h-5 w-5" />
            <span className="text-sm">
              <span className="font-medium">Guardar como modelo de referência</span>
              <span className="block text-gray-500">Só para comprovativos verdadeiros. Este formato passa a ser aprovado automaticamente.</span>
            </span>
          </label>
          {saveTemplate && (
            <div className="mt-3 space-y-3">
              <div>
                <label className={labelClass} htmlFor="tmode">Modelo</label>
                <select id="tmode" value={templateMode} onChange={(e) => setTemplateMode(e.target.value)} className={inputClass}>
                  <option value="new">Novo modelo</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>Acrescentar a: {t.name}</option>)}
                </select>
              </div>
              {templateMode === "new" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass} htmlFor="bank">Banco/app</label>
                      <select id="bank" value={bankCode} onChange={(e) => setBankCode(e.target.value)} className={inputClass}>
                        {Object.entries(BANK_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="channel">Canal</label>
                      <select id="channel" value={channel} onChange={(e) => setChannel(e.target.value)} className={inputClass}>
                        {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="tname">Nome</label>
                    <input id="tname" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${BANK_LABELS[bankCode]} — ${CHANNEL_LABELS[channel]}`} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="kw">Palavras obrigatórias (opcional)</label>
                    <input id="kw" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="ex.: BAI Directo, Comprovativo" className={inputClass} />
                    <p className={hintClass}>Separadas por vírgulas. Texto que aparece sempre neste formato.</p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {!rejecting ? (
        <div className="grid grid-cols-2 gap-3">
          <button type="button" disabled={pending} onClick={approve} className={`${buttonPrimary} bg-green-700 hover:bg-green-800`}>
            {pending ? "A guardar…" : "Aprovar pagamento"}
          </button>
          <button type="button" disabled={pending} onClick={() => setRejecting(true)} className={`${buttonSecondary} text-red-700`}>
            Rejeitar
          </button>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-red-200 p-3">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p} type="button" onClick={() => setReason(p)} className="rounded-full border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50">
                {p}
              </button>
            ))}
          </div>
          <div>
            <label className={labelClass} htmlFor="reason">Motivo (o cliente vê esta mensagem)</label>
            <textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={fraud} onChange={(e) => setFraud(e.target.checked)} className="h-5 w-5" />
            Suspeita de fraude: bloquear este número
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" disabled={pending} onClick={() => run(() => rejectProof(proofId, { reason, fraud }))} className={`${buttonPrimary} bg-red-700 hover:bg-red-800`}>
              {pending ? "A guardar…" : "Confirmar rejeição"}
            </button>
            <button type="button" onClick={() => setRejecting(false)} className={buttonSecondary}>Cancelar</button>
          </div>
        </div>
      )}

      {result && <p className={result.ok ? "text-sm text-green-700" : errorClass}>{result.ok ? result.message : result.error}</p>}
    </div>
  );
}
