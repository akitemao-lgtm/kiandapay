"use client";

import { useState, useTransition } from "react";
import {
  removeIntegrationToken, saveIntegrations, testMeta, testUtmify, type IntegrationsInput,
} from "@/app/admin/(painel)/integracoes/actions";
import { buttonPrimary, buttonSecondary, cardClass, errorClass, hintClass, inputClass, labelClass } from "@/components/ui/styles";
import { safeAction } from "@/lib/client/safe-action";
import { rateError } from "@/lib/currency/rate";
import { formatKz } from "@/lib/format";
import type { ActionResult } from "@/lib/products/types";
import { UTMIFY_CURRENCIES } from "@/lib/utmify/payload";

const META_CURRENCIES = ["AOA", "USD", "EUR", "BRL", "ZAR"];
const parseRate = (s: string) => (s ? Number(s.replace(",", ".")) : null);
const SAMPLE_KZ = 10_000;

/** Mostra o resultado da taxa, para se ver logo se está certa. */
function RatePreview({ currency, rate }: { currency: string; rate: number | null }) {
  return (
    <p className="text-sm text-gray-600">
      Uma venda de {formatKz(SAMPLE_KZ)} é enviada como{" "}
      <strong>{currency === "AOA" ? `${SAMPLE_KZ.toFixed(2)} AOA` : rate ? `${(SAMPLE_KZ * rate).toFixed(2)} ${currency}` : "—"}</strong>.
    </p>
  );
}

type Props = {
  metaTokenHint: string | null;
  utmifyTokenHint: string | null;
  lastUtmifyError: string | null;
  productsWithoutToken: string[];
  initial: {
    metaEnabled: boolean; pixelId: string; testEventCode: string; metaCurrency: string; metaRate: number | null;
    utmifyEnabled: boolean; utmifyCurrency: string; utmifyRate: number | null;
  };
};

export function IntegrationsForm({ metaTokenHint, utmifyTokenHint, lastUtmifyError, productsWithoutToken, initial }: Props) {
  const [v, setV] = useState({
    ...initial,
    metaToken: "",
    utmifyToken: "",
    metaRateText: initial.metaRate ? String(initial.metaRate) : "",
    utmifyRateText: initial.utmifyRate ? String(initial.utmifyRate) : "",
  });
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const metaRate = parseRate(v.metaRateText);
  const utmifyRate = parseRate(v.utmifyRateText);
  const metaRateError = rateError(v.metaCurrency, metaRate) ?? errors.metaRate;
  const utmifyRateError = rateError(v.utmifyCurrency, utmifyRate) ?? errors.utmifyRate;

  const run = (fn: () => Promise<ActionResult>) => {
    setResult(null);
    start(async () => {
      const r = await safeAction(fn);
      setResult(r);
      if (r.ok) setV((s) => ({ ...s, metaToken: "", utmifyToken: "" }));
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveIntegrations({
          metaEnabled: v.metaEnabled, pixelId: v.pixelId, metaToken: v.metaToken, testEventCode: v.testEventCode,
          metaCurrency: v.metaCurrency, metaRate,
          utmifyEnabled: v.utmifyEnabled, utmifyToken: v.utmifyToken,
          utmifyCurrency: v.utmifyCurrency as IntegrationsInput["utmifyCurrency"], utmifyRate,
        }));
      }}
      className="space-y-6 pb-8"
    >
      <section className={`${cardClass} space-y-4`}>
        <div>
          <h2 className="font-semibold">Pixel do Facebook</h2>
          <p className={hintClass}>Pixel no browser e API de Conversões no servidor, com os mesmos eventos deduplicados.</p>
        </div>
        {productsWithoutToken.length > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Pixel próprio sem token legível: {productsWithoutToken.join(", ")}. Com o Pixel da conta ativo, estes produtos usam-no. Para manter o próprio, cole o token de novo no produto.
          </p>
        )}
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={v.metaEnabled} onChange={(e) => setV({ ...v, metaEnabled: e.target.checked })} className="h-5 w-5" />
          <span className="font-medium">Ativar em todos os produtos</span>
        </label>
        <div>
          <label className={labelClass} htmlFor="pixel">Pixel ID (ID do conjunto de dados)</label>
          <input id="pixel" inputMode="numeric" value={v.pixelId} onChange={(e) => setV({ ...v, pixelId: e.target.value.replace(/\D/g, "") })} className={`${inputClass} font-mono`} />
          {errors.pixelId && <p className={errorClass}>{errors.pixelId}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="meta-token">Token da API de Conversões</label>
          <input
            id="meta-token" type="password" autoComplete="off" value={v.metaToken}
            onChange={(e) => setV({ ...v, metaToken: e.target.value })}
            placeholder={metaTokenHint ? `Guardado (termina em …${metaTokenHint}). Escreva só para substituir.` : "Cole aqui o token"}
            className={`${inputClass} font-mono`}
          />
          <p className={hintClass}>Gestor de Eventos → o seu conjunto de dados → Definições → API de Conversões → Gerar token de acesso.</p>
          {metaTokenHint && (
            <button type="button" onClick={() => run(() => removeIntegrationToken("meta"))} className="mt-1 text-xs text-red-600 underline">Remover token</button>
          )}
        </div>
        <div>
          <label className={labelClass} htmlFor="test">Test Event Code (opcional)</label>
          <input id="test" value={v.testEventCode} onChange={(e) => setV({ ...v, testEventCode: e.target.value.trim() })} placeholder="TEST12345" className={`${inputClass} max-w-xs font-mono`} />
          <p className={hintClass}>Serve para ver os eventos em “Testar eventos”, mas o Meta conta-os também nas campanhas. Apague-o quando terminar os testes.</p>
          {errors.testEventCode && <p className={errorClass}>{errors.testEventCode}</p>}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className={labelClass} htmlFor="meta-cur">Moeda</label>
            <select id="meta-cur" value={v.metaCurrency} onChange={(e) => setV({ ...v, metaCurrency: e.target.value })} className={`${inputClass} w-32`}>
              {META_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          {v.metaCurrency !== "AOA" && (
            <div>
              <label className={labelClass} htmlFor="meta-rate">1 AOA = ? {v.metaCurrency}</label>
              <input id="meta-rate" inputMode="decimal" value={v.metaRateText} onChange={(e) => setV({ ...v, metaRateText: e.target.value })} className={`${inputClass} w-40 font-mono`} />
              {metaRateError && <p className={errorClass}>{metaRateError}</p>}
            </div>
          )}
        </div>
        <RatePreview currency={v.metaCurrency} rate={metaRate} />
        <button type="button" disabled={pending} onClick={() => run(testMeta)} className={buttonSecondary}>Enviar evento de teste</button>
      </section>

      <section className={`${cardClass} space-y-4`}>
        <div>
          <h2 className="font-semibold">UTMify</h2>
          <p className={hintClass}>Cada pedido é enviado quando é criado e sempre que muda de estado.</p>
        </div>
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={v.utmifyEnabled} onChange={(e) => setV({ ...v, utmifyEnabled: e.target.checked })} className="h-5 w-5" />
          <span className="font-medium">Ativar em todos os produtos</span>
        </label>
        <div>
          <label className={labelClass} htmlFor="utmify-token">Token da API</label>
          <input
            id="utmify-token" type="password" autoComplete="off" value={v.utmifyToken}
            onChange={(e) => setV({ ...v, utmifyToken: e.target.value })}
            placeholder={utmifyTokenHint ? `Guardado (termina em …${utmifyTokenHint}). Escreva só para substituir.` : "Cole aqui o token"}
            className={`${inputClass} font-mono`}
          />
          <p className={hintClass}>UTMify → Integrações → Webhooks → Credenciais de API → Adicionar Credencial → Criar Credencial.</p>
          {errors.utmifyToken && <p className={errorClass}>{errors.utmifyToken}</p>}
          {utmifyTokenHint && (
            <button type="button" onClick={() => run(() => removeIntegrationToken("utmify"))} className="mt-1 text-xs text-red-600 underline">Remover token</button>
          )}
        </div>
        <div>
          <p className={hintClass}>A UTMify não aceita Kwanza: os valores são convertidos com esta taxa fixa.</p>
          <div className="mt-2 flex flex-wrap items-end gap-4">
            <div>
              <label className={labelClass} htmlFor="utmify-cur">Moeda</label>
              <select id="utmify-cur" value={v.utmifyCurrency} onChange={(e) => setV({ ...v, utmifyCurrency: e.target.value })} className={`${inputClass} w-32`}>
                {UTMIFY_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="utmify-rate">1 AOA = ? {v.utmifyCurrency}</label>
              <input id="utmify-rate" inputMode="decimal" value={v.utmifyRateText} onChange={(e) => setV({ ...v, utmifyRateText: e.target.value })} className={`${inputClass} w-40 font-mono`} />
              {utmifyRateError && <p className={errorClass}>{utmifyRateError}</p>}
            </div>
          </div>
          <div className="mt-2"><RatePreview currency={v.utmifyCurrency} rate={utmifyRate} /></div>
        </div>
        {lastUtmifyError && <p className={errorClass}>Último erro de envio: {lastUtmifyError}</p>}
        <button type="button" disabled={pending} onClick={() => run(testUtmify)} className={buttonSecondary}>Validar formato</button>
        <p className={hintClass}>A UTMify aceita qualquer token sem dar erro. Para confirmar o seu, veja se a próxima venda aparece no painel da UTMify.</p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonPrimary}>{pending ? "A guardar…" : "Guardar"}</button>
        {result && <p className={`text-sm ${result.ok ? "text-green-700" : "text-red-600"}`}>{result.ok ? result.message : result.error}</p>}
      </div>
    </form>
  );
}
