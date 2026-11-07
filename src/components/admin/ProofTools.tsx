"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { analyzeSample, saveSample, testProof } from "@/app/admin/(painel)/modelos/actions";
import { ReportView } from "@/components/admin/ReportView";
import { buttonPrimary, buttonSecondary, cardClass, errorClass, hintClass, inputClass, labelClass } from "@/components/ui/styles";
import { parseKz } from "@/lib/format";
import type { ActionResult } from "@/lib/products/types";
import { BANK_LABELS, CHANNEL_LABELS } from "@/lib/proofs/banks";
import type { ProofReport } from "@/lib/proofs/report";
import { uploadProofFile } from "@/lib/upload";

function FilePicker({ label, busy, onFile }: { label: string; busy: boolean; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className={buttonSecondary}>
        {busy ? "A ler o PDF…" : label}
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </>
  );
}

export function SampleUploader({ templates }: { templates: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [path, setPath] = useState<string | null>(null);
  const [report, setReport] = useState<ProofReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [mode, setMode] = useState("new");
  const [bankCode, setBankCode] = useState("bai");
  const [channel, setChannel] = useState("app");
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");

  function onFile(file: File) {
    setError(null);
    setReport(null);
    setResult(null);
    start(async () => {
      try {
        const p = await uploadProofFile("uploads", file);
        const r = await analyzeSample(p);
        if (!r.ok) return setError(r.error);
        setPath(p);
        setReport(r.data);
        const guess = r.data.extracted?.bankGuess;
        if (guess) setBankCode(guess);
        if (r.data.template) setMode(r.data.template.id);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function save() {
    if (!path) return;
    const target =
      mode === "new"
        ? {
            bankCode, channel,
            name: name.trim() || `${BANK_LABELS[bankCode]} — ${CHANNEL_LABELS[channel]}`,
            keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
          }
        : { templateId: mode };
    start(async () => {
      const r = await saveSample(path, target);
      setResult(r);
      if (r.ok) {
        setPath(null);
        setReport(null);
        router.refresh();
      }
    });
  }

  return (
    <section className={`${cardClass} space-y-4`}>
      <div>
        <h2 className="font-semibold">Adicionar comprovativo verdadeiro</h2>
        <p className={hintClass}>
          Carregue o PDF original de um pagamento real (sem reenviar por WhatsApp nem “imprimir para PDF”). Quantos mais
          exemplos de cada banco/app, melhor.
        </p>
      </div>
      <FilePicker label="Escolher PDF" busy={busy && !report} onFile={onFile} />
      {error && <p className={errorClass}>{error}</p>}
      {report && (
        <>
          <ReportView report={report} />
          <div className="space-y-3 border-t border-gray-100 pt-4">
            <div>
              <label className={labelClass} htmlFor="smode">Guardar em</label>
              <select id="smode" value={mode} onChange={(e) => setMode(e.target.value)} className={inputClass}>
                <option value="new">Novo modelo</option>
                {templates.map((t) => <option key={t.id} value={t.id}>Acrescentar a: {t.name}</option>)}
              </select>
            </div>
            {mode === "new" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass} htmlFor="sbank">Banco/app</label>
                    <select id="sbank" value={bankCode} onChange={(e) => setBankCode(e.target.value)} className={inputClass}>
                      {Object.entries(BANK_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="schannel">Canal</label>
                    <select id="schannel" value={channel} onChange={(e) => setChannel(e.target.value)} className={inputClass}>
                      {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelClass} htmlFor="sname">Nome</label>
                  <input id="sname" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${BANK_LABELS[bankCode]} — ${CHANNEL_LABELS[channel]}`} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="skw">Palavras obrigatórias (opcional)</label>
                  <input id="skw" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="ex.: BAI Directo" className={inputClass} />
                </div>
              </>
            )}
            <button type="button" disabled={busy} onClick={save} className={buttonPrimary}>
              {busy ? "A guardar…" : "Guardar modelo"}
            </button>
          </div>
        </>
      )}
      {result && <p className={result.ok ? "text-sm text-green-700" : errorClass}>{result.ok ? result.message : result.error}</p>}
    </section>
  );
}

export function ProofTester() {
  const [busy, start] = useTransition();
  const [amount, setAmount] = useState("");
  const [report, setReport] = useState<ProofReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onFile(file: File) {
    setError(null);
    setReport(null);
    start(async () => {
      try {
        const p = await uploadProofFile("tests", file);
        const r = await testProof(p, amount ? parseKz(amount) : null);
        if (!r.ok) return setError(r.error);
        setReport(r.data);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <section className={`${cardClass} space-y-4`}>
      <div>
        <h2 className="font-semibold">Testar comprovativo</h2>
        <p className={hintClass}>
          Mostra o que o sistema lê e se aprovaria, como num pedido criado um minuto antes do pagamento. Nada é guardado.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={labelClass} htmlFor="tamount">Valor do pedido (Kz, opcional)</label>
          <input id="tamount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="valor lido" className={`${inputClass} max-w-[12rem]`} />
        </div>
        <FilePicker label="Escolher PDF para testar" busy={busy} onFile={onFile} />
      </div>
      {error && <p className={errorClass}>{error}</p>}
      {report && <ReportView report={report} />}
    </section>
  );
}
