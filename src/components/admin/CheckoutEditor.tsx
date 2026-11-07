"use client";

import { useState, useTransition } from "react";
import { saveCheckoutPage } from "@/app/admin/(painel)/produtos/actions";
import { ImageUpload } from "@/components/admin/ImageUpload";
import { CheckoutView, type CheckoutProduct } from "@/components/checkout/CheckoutView";
import { buttonPrimary, cardClass, errorClass, hintClass, inputClass, labelClass } from "@/components/ui/styles";
import { safeAction } from "@/lib/client/safe-action";
import { DEFAULT_PAYMENT_INSTRUCTIONS, PROOF_REVEAL_MINUTES } from "@/lib/checkout/defaults";
import type { CheckoutConfig, EmailField, InstructionsMode } from "@/lib/checkout/types";
import type { ActionResult } from "@/lib/products/types";

type Props = {
  productId: string;
  product: CheckoutProduct;
  initial: CheckoutConfig;
  entity: string;
  reference: string;
};

const EMAIL_OPTIONS: [EmailField, string][] = [
  ["required", "Obrigatório"],
  ["optional", "Opcional"],
  ["hidden", "Desativado"],
];

const INSTRUCTION_OPTIONS: [InstructionsMode, string, string][] = [
  ["shown", "Visíveis", "Aparecem logo no ecrã de pagamento."],
  ["collapsed", "Minimizadas", "Só aparecem quando o cliente toca em “Ver instruções de como pagar”."],
  ["hidden", "Escondidas", "O ecrã de pagamento não mostra instruções."],
];

function Choice<T extends string>({ name, value, options, onChange }: {
  name: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="inline-grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-gray-200 p-1 text-sm font-medium">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`rounded-lg px-3 py-1.5 ${value === v ? "bg-white shadow-sm" : "text-gray-600"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const linesToSteps = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export function CheckoutEditor({ productId, product, initial, entity, reference }: Props) {
  const [config, setConfig] = useState<CheckoutConfig>(initial);
  const [stepsText, setStepsText] = useState(initial.paymentInstructions.bank_app.join("\n"));
  const [laterText, setLaterText] = useState(initial.paymentInstructions.later.join("\n"));
  const [screen, setScreen] = useState<"form" | "payment">("form");
  const [showPreview, setShowPreview] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {};

  const set = <K extends keyof CheckoutConfig>(key: K, value: CheckoutConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  // As instruções mostradas no ecrã de pagamento são as de "bank_app"; as outras ficam como estão.
  const previewConfig: CheckoutConfig = {
    ...config,
    paymentInstructions: { ...config.paymentInstructions, bank_app: linesToSteps(stepsText), later: linesToSteps(laterText) },
  };

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => setResult(await safeAction(() => saveCheckoutPage(productId, previewConfig))));
  }

  const view = (
    <CheckoutView
      product={product}
      config={previewConfig}
      screen={screen}
      revealAll={config.proofAlwaysVisible}
      payment={{ entity: entity || "00000", reference: reference || "000000000", amount: product.price, orderNumber: 1001 }}
    />
  );

  const screenToggle = (
    <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-gray-200 p-1 text-sm font-medium">
      {(["form", "payment"] as const).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setScreen(s)}
          className={`rounded-lg px-3 py-1.5 ${screen === s ? "bg-white shadow-sm" : "text-gray-600"}`}
        >
          {s === "form" ? "Formulário" : "Pagamento"}
        </button>
      ))}
    </div>
  );

  return (
    <div className="lg:grid lg:grid-cols-[1fr_380px] lg:gap-8">
      <form onSubmit={onSubmit} className="space-y-6 pb-24">
        <section className={`${cardClass} space-y-4`}>
          <div>
            <h2 className="font-semibold">Aparência</h2>
            <p className={hintClass}>A imagem, o nome e o preço vêm do separador Produto.</p>
          </div>
          <ImageUpload
            label="Banner"
            kind="checkout"
            aspect="wide"
            value={config.bannerPath}
            onChange={(v) => set("bannerPath", v)}
            hint="Aparece no topo do checkout, inteira (sem cortes). Ex.: 1200×630 ou 1080×1080. Substitui a miniatura do produto."
            error={errors.bannerPath}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(
              [
                ["primaryColor", "Cor principal", "Botão, método selecionado e links"],
                ["backgroundColor", "Fundo", "Fundo da página"],
              ] as const
            ).map(([key, label, hint]) => (
              <div key={key}>
                <label className={labelClass} htmlFor={key}>{label}</label>
                <div className="flex items-center gap-2">
                  <input
                    id={key}
                    type="color"
                    value={config[key]}
                    onChange={(e) => set(key, e.target.value.toUpperCase())}
                    className="h-11 w-14 cursor-pointer rounded-lg border border-gray-300 bg-white p-1"
                  />
                  <input
                    value={config[key]}
                    onChange={(e) => set(key, e.target.value)}
                    className={`${inputClass} font-mono`}
                    maxLength={7}
                    aria-label={`${label} (hex)`}
                  />
                </div>
                <p className={errors[key] ? errorClass : hintClass}>{errors[key] ?? hint}</p>
              </div>
            ))}
          </div>
          <div>
            <label className={labelClass} htmlFor="title">Título</label>
            <input id="title" value={config.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder={product.name} className={inputClass} />
            <p className={errors.title ? errorClass : hintClass}>{errors.title ?? "Vazio = nome do produto."}</p>
          </div>
          <div className="max-w-sm">
            <label className={labelClass} htmlFor="buttonText">Texto do botão</label>
            <input id="buttonText" value={config.buttonText} onChange={(e) => set("buttonText", e.target.value)} className={inputClass} />
            {errors.buttonText && <p className={errorClass}>{errors.buttonText}</p>}
          </div>
        </section>

        <section className={`${cardClass} space-y-5`}>
          <h2 className="font-semibold">Formulário e ecrã de pagamento</h2>
          <div>
            <p className={labelClass}>Campo de e-mail</p>
            <Choice name="Campo de e-mail" value={config.emailField} options={EMAIL_OPTIONS} onChange={(v) => { set("emailField", v); setScreen("form"); }} />
          </div>
          <div>
            <p className={labelClass}>Instruções de como pagar</p>
            <Choice
              name="Instruções de como pagar"
              value={config.instructionsMode}
              options={INSTRUCTION_OPTIONS.map(([v, l]) => [v, l] as [InstructionsMode, string])}
              onChange={(v) => { set("instructionsMode", v); setScreen("payment"); }}
            />
            <p className={hintClass}>{INSTRUCTION_OPTIONS.find(([v]) => v === config.instructionsMode)?.[2]}</p>
          </div>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={config.proofAlwaysVisible}
              onChange={(e) => { set("proofAlwaysVisible", e.target.checked); setScreen("payment"); }}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-medium">Botão de enviar comprovativo sempre visível</span>
              <span className={hintClass}>
                Desligado: a caixa do comprovativo e os passos finais só aparecem {PROOF_REVEAL_MINUTES} minutos depois do pedido.
              </span>
            </span>
          </label>
        </section>

        <section className={`${cardClass} space-y-3`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Instruções de pagamento</h2>
              <p className={hintClass}>Um passo por linha. Aparecem logo em “Instruções” no ecrã de pagamento.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setStepsText(DEFAULT_PAYMENT_INSTRUCTIONS.bank_app.join("\n"));
                setLaterText(DEFAULT_PAYMENT_INSTRUCTIONS.later.join("\n"));
              }}
              className="shrink-0 text-xs text-gray-500 underline"
            >
              Repor texto padrão
            </button>
          </div>
          <textarea
            id="steps"
            aria-label="Instruções de pagamento"
            rows={6}
            value={stepsText}
            onFocus={() => setScreen("payment")}
            onChange={(e) => setStepsText(e.target.value)}
            className={inputClass}
          />
          {errors["paymentInstructions.bank_app"] && <p className={errorClass}>{errors["paymentInstructions.bank_app"]}</p>}
          <div>
            <label className={labelClass} htmlFor="later">
              {config.proofAlwaysVisible ? "Passos finais" : `Passos que aparecem ${PROOF_REVEAL_MINUTES} minutos depois`}
            </label>
            <textarea
              id="later"
              rows={3}
              value={laterText}
              onFocus={() => setScreen("payment")}
              onChange={(e) => setLaterText(e.target.value)}
              className={inputClass}
            />
            <p className={hintClass}>
              Continuam a numeração dos passos acima e aparecem junto com a caixa para enviar o comprovativo.
            </p>
            {errors["paymentInstructions.later"] && <p className={errorClass}>{errors["paymentInstructions.later"]}</p>}
          </div>
        </section>

        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-end gap-3">
            {result && (
              <p className={`flex-1 text-sm ${result.ok ? "text-green-700" : "text-red-600"}`}>
                {result.ok ? result.message : result.error}
              </p>
            )}
            <button type="button" onClick={() => setShowPreview(true)} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium lg:hidden">
              Pré-visualizar
            </button>
            <button type="submit" disabled={pending} className={buttonPrimary}>
              {pending ? "A guardar…" : "Guardar"}
            </button>
          </div>
        </div>
      </form>

      {/* Computador: pré-visualização fixa ao lado */}
      <aside className="hidden lg:block">
        <div className="sticky top-20">
          {screenToggle}
          <div className="overflow-hidden rounded-[2rem] border-8 border-gray-900 bg-white shadow-xl">
            <div className="h-[640px] overflow-y-auto">{view}</div>
          </div>
        </div>
      </aside>

      {/* Telemóvel: pré-visualização em ecrã inteiro */}
      {showPreview && (
        <div className="fixed inset-0 z-30 flex flex-col bg-gray-100 lg:hidden">
          <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
            <span className="font-medium">Pré-visualização</span>
            <button type="button" onClick={() => setShowPreview(false)} className="text-sm font-medium">Fechar</button>
          </div>
          <div className="px-4 pt-3">{screenToggle}</div>
          <div className="flex-1 overflow-y-auto">{view}</div>
        </div>
      )}
    </div>
  );
}
