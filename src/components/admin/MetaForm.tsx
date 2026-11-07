"use client";

import { safeAction } from "@/lib/client/safe-action";
import { useState, useTransition } from "react";
import { removeMetaToken, saveMetaSettings, sendTestEvent } from "@/app/admin/(painel)/produtos/[id]/meta/actions";
import { buttonPrimary, buttonSecondary, cardClass, errorClass, hintClass, inputClass, labelClass } from "@/components/ui/styles";
import { formatKz } from "@/lib/format";
import type { ActionResult } from "@/lib/products/types";

const CURRENCIES = ["AOA", "USD", "EUR", "BRL", "ZAR"];

type Props = {
  productId: string;
  price: number;
  initial: { enabled: boolean; pixelId: string; testEventCode: string; currency: string; rate: number | null };
  tokenHint: string | null;
};

export function MetaForm({ productId, price, initial, tokenHint }: Props) {
  const [v, setV] = useState({ ...initial, token: "", rateText: initial.rate ? String(initial.rate) : "" });
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const rate = v.rateText ? Number(v.rateText.replace(",", ".")) : null;

  const run = (fn: () => Promise<ActionResult>) => {
    setResult(null);
    start(async () => {
      const r = await safeAction(fn);
      setResult(r);
      if (r.ok) setV((s) => ({ ...s, token: "" }));
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveMetaSettings(productId, {
          enabled: v.enabled, pixelId: v.pixelId, token: v.token, testEventCode: v.testEventCode, currency: v.currency, rate,
        }));
      }}
      className="space-y-6 pb-8"
    >
      <section className={`${cardClass} space-y-4`}>
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} className="h-5 w-5" />
          <span className="font-medium">Ativar Pixel e API de Conversões neste produto</span>
        </label>
        <div>
          <label className={labelClass} htmlFor="pixel">Pixel ID (ID do conjunto de dados)</label>
          <input id="pixel" inputMode="numeric" value={v.pixelId} onChange={(e) => setV({ ...v, pixelId: e.target.value.replace(/\D/g, "") })} className={`${inputClass} font-mono`} />
          {errors.pixelId && <p className={errorClass}>{errors.pixelId}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="token">Token da API de Conversões</label>
          <input
            id="token"
            type="password"
            autoComplete="off"
            value={v.token}
            onChange={(e) => setV({ ...v, token: e.target.value })}
            placeholder={tokenHint ? `Guardado (termina em …${tokenHint}). Escreva só para substituir.` : "Cole aqui o token"}
            className={`${inputClass} font-mono`}
          />
          <p className={hintClass}>
            Gestor de Eventos → o seu conjunto de dados → Definições → API de Conversões → Gerar token de acesso.
            Fica cifrado no servidor e nunca é mostrado nem enviado ao browser.
          </p>
          {tokenHint && (
            <button type="button" onClick={() => run(() => removeMetaToken(productId))} className="mt-1 text-xs text-red-600 underline">
              Remover token
            </button>
          )}
        </div>
        <div>
          <label className={labelClass} htmlFor="test">Test Event Code (opcional)</label>
          <input id="test" value={v.testEventCode} onChange={(e) => setV({ ...v, testEventCode: e.target.value.trim() })} placeholder="TEST12345" className={`${inputClass} max-w-xs font-mono`} />
          <p className={hintClass}>Enquanto estiver preenchido, os eventos do servidor aparecem em “Testar eventos” e não contam nas campanhas. Apague-o quando terminar os testes.</p>
          {errors.testEventCode && <p className={errorClass}>{errors.testEventCode}</p>}
        </div>
      </section>

      <section className={`${cardClass} space-y-4`}>
        <div>
          <h2 className="font-semibold">Moeda enviada ao Meta</h2>
          <p className={hintClass}>Se a conta de anúncios não aceitar Kwanza, envie noutra moeda com uma taxa fixa.</p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className={labelClass} htmlFor="cur">Moeda</label>
            <select id="cur" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} className={`${inputClass} w-32`}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          {v.currency !== "AOA" && (
            <div>
              <label className={labelClass} htmlFor="rate">1 AOA = ? {v.currency}</label>
              <input id="rate" inputMode="decimal" value={v.rateText} onChange={(e) => setV({ ...v, rateText: e.target.value })} placeholder="0.0011" className={`${inputClass} w-40 font-mono`} />
              {errors.rate && <p className={errorClass}>{errors.rate}</p>}
            </div>
          )}
        </div>
        <p className="text-sm text-gray-600">
          Uma venda de {formatKz(price)} é enviada como{" "}
          <strong>
            {v.currency === "AOA" ? `${price.toFixed(2)} AOA` : rate ? `${(price * rate).toFixed(2)} ${v.currency}` : "—"}
          </strong>
          .
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonPrimary}>{pending ? "A guardar…" : "Guardar"}</button>
        <button type="button" disabled={pending} onClick={() => run(() => sendTestEvent(productId))} className={buttonSecondary}>
          Enviar evento de teste
        </button>
        {result && <p className={`text-sm ${result.ok ? "text-green-700" : "text-red-600"}`}>{result.ok ? result.message : result.error}</p>}
      </div>
    </form>
  );
}
