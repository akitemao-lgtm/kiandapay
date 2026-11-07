"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { PROOF_REVEAL_MINUTES, readableOn } from "@/lib/checkout/defaults";
import type { CheckoutConfig, CheckoutOptions, FieldMode, InstructionsMode } from "@/lib/checkout/types";
import { formatKz } from "@/lib/format";
import { publicMediaUrl } from "@/lib/storage";

export type CheckoutProduct = {
  name: string;
  description: string;
  price: number;
  imageUrl: string | null;
};

export type PaymentDetails = {
  entity: string;
  reference: string;
  amount: number;
  orderNumber: string | number;
};

type Props = {
  product: CheckoutProduct;
  config: CheckoutConfig;
  screen: "form" | "payment" | "status";
  /** Formulário real. Sem ele mostra-se um formulário de exemplo, desativado (pré-visualização). */
  formSlot?: ReactNode;
  payment?: PaymentDetails;
  /** Zona de envio do comprovativo. Sem ela mostra-se o botão de exemplo. */
  uploadSlot?: ReactNode;
  footerSlot?: ReactNode;
  /** Conteúdo do ecrã "status" (pedido em análise, pago, expirado…). */
  statusSlot?: ReactNode;
  /** Mostrado acima do ecrã de pagamento (ex.: aviso de prazo terminado). */
  paymentHeader?: ReactNode;
  /** Criação do pedido (ISO) e hora do servidor: base da barra de progresso e dos 5 minutos. */
  createdAt?: string;
  serverNow?: number;
  /** Mostrar já os passos finais e o envio do comprovativo (pré-visualização, reenvio, prazo terminado). */
  revealAll?: boolean;
};

const SAMPLE_PAYMENT: PaymentDetails = { entity: "00000", reference: "000000000", amount: 0, orderNumber: 1001 };

export function CheckoutView({
  product, config, screen, formSlot, payment, uploadSlot, footerSlot, statusSlot, paymentHeader,
  createdAt, serverNow, revealAll = false,
}: Props) {
  const vars = {
    "--c-primary": config.primaryColor,
    "--c-on-primary": readableOn(config.primaryColor),
    "--c-bg": config.backgroundColor,
  } as CSSProperties;

  return (
    <div style={vars} className="min-h-full bg-[var(--c-bg)] pb-10 text-gray-900">
      <div className="mx-auto w-full max-w-md space-y-4 px-4 pt-4">
        {screen === "form" ? (
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/10">
            <ProductHeader product={product} title={config.title || product.name} banner={publicMediaUrl(config.bannerPath)} />
            <div className="mt-6">{formSlot ?? <SampleForm price={product.price} buttonText={config.buttonText} fields={config} />}</div>
          </section>
        ) : screen === "status" ? (
          statusSlot
        ) : (
          <>
            {paymentHeader}
            <PaymentScreen
              payment={payment ?? { ...SAMPLE_PAYMENT, amount: product.price }}
              steps={config.paymentInstructions.bank_app}
              laterSteps={config.paymentInstructions.later}
              uploadSlot={uploadSlot}
              createdAt={createdAt}
              serverNow={serverNow}
              revealAll={revealAll || config.proofAlwaysVisible}
              instructionsMode={config.instructionsMode}
            />
          </>
        )}
        {footerSlot}
      </div>
    </div>
  );
}

function ProductHeader({ product, title, banner }: { product: CheckoutProduct; title: string; banner: string | null }) {
  return (
    <>
      {/* Banner: imagem inteira, sem cortes, no topo do cartão; substitui a miniatura do produto. */}
      {banner && <img src={banner} alt="" className="-mx-5 -mt-5 mb-5 block h-auto w-[calc(100%+2.5rem)] max-w-none rounded-t-2xl" />}
      <div className="flex items-center gap-4">
        {product.imageUrl && !banner && (
          <img src={product.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-medium leading-snug">{title}</h1>
          <p className="mt-1 text-2xl font-bold tabular-nums">{formatKz(product.price)}</p>
        </div>
      </div>
    </>
  );
}

export const fieldClass =
  "block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base outline-none placeholder:text-gray-500 focus:border-[var(--c-primary)] focus:ring-2 focus:ring-[var(--c-primary)]/20";

/** Pré-visualização do formulário no painel (não envia nada). */
function SampleForm({ price, buttonText, fields }: { price: number; buttonText: string; fields: CheckoutOptions }) {
  const label = (text: string, mode: FieldMode) => mode !== "hidden" && (
    <div className={`${fieldClass} text-gray-500`}>{mode === "optional" ? `${text} (opcional)` : text}</div>
  );
  return (
    <div className="space-y-4" aria-hidden>
      {label("Nome completo", fields.nameField)}
      {label("E-mail", fields.emailField)}
      {label("Número de telefone", fields.phoneField)}
      <PaymentMethodOption selected onSelect={() => {}} />
      <PayButton price={price} text={buttonText} disabled={false} />
      <TermsNote />
    </div>
  );
}

export function PaymentMethodOption({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-gray-600">Método de pagamento</p>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className={`flex w-full items-center gap-4 rounded-xl border-2 bg-white px-4 py-3 text-left ${
          selected ? "border-[var(--c-primary)]" : "border-gray-200"
        }`}
      >
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-[var(--c-primary)]" : "border-blue-600"}`}>
          {selected && <span className="h-2.5 w-2.5 rounded-full bg-[var(--c-primary)]" />}
        </span>
        <svg viewBox="0 0 24 24" className="h-8 w-8 shrink-0 text-purple-600" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5M9 13h6M9 17h6" />
        </svg>
        <span className="min-w-0">
          <span className="block font-medium">Pagamento por Referência</span>
          <span className="block text-sm text-gray-500">Referência bancária para pagamento</span>
        </span>
      </button>
    </div>
  );
}

export function PayButton({ price, text, disabled, pending }: { price: number; text: string; disabled: boolean; pending?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="flex w-full items-center justify-between gap-3 rounded-lg bg-[var(--c-primary)] px-4 py-3.5 text-base font-semibold text-[var(--c-on-primary)] disabled:opacity-50"
    >
      <span>{pending ? "A criar pedido…" : text}</span>
      <span className="tabular-nums">{formatKz(price)}</span>
    </button>
  );
}

export function TermsNote() {
  return (
    <p className="text-center text-sm text-gray-500">
      Ao pagar, concorda com os{" "}
      <a href="/termos" target="_blank" className="text-[var(--c-primary)]">Termos e políticas</a>
    </p>
  );
}

/** Hora "do servidor" a contar no browser (não depende do relógio do telemóvel estar certo). */
function useServerClock(serverNow?: number) {
  const [offset] = useState(() => (serverNow ?? Date.now()) - Date.now());
  const [now, setNow] = useState(() => serverNow ?? Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), 500);
    return () => clearInterval(t);
  }, [offset]);
  return now;
}

function PaymentScreen({
  payment, steps, laterSteps, uploadSlot, createdAt, serverNow, revealAll, instructionsMode,
}: {
  payment: PaymentDetails;
  steps: string[];
  laterSteps: string[];
  uploadSlot?: ReactNode;
  createdAt?: string;
  serverNow?: number;
  revealAll: boolean;
  instructionsMode: InstructionsMode;
}) {
  const now = useServerClock(serverNow);
  const [start] = useState(() => (createdAt ? Date.parse(createdAt) : (serverNow ?? Date.now())));
  const elapsed = Math.max(0, now - start);
  const revealed = revealAll || elapsed >= PROOF_REVEAL_MINUTES * 60_000;
  // Cresce depressa no início e cada vez mais devagar; nunca chega ao fim antes da confirmação.
  const progress = 4 + 91 * (1 - Math.exp(-elapsed / 240_000));
  const shownSteps = instructionsMode === "hidden" ? [] : revealed ? [...steps, ...laterSteps] : steps;
  const [stepsOpen, setStepsOpen] = useState(false);

  const rows = [
    { label: "Entidade", value: payment.entity, copy: payment.entity.replace(/\s/g, "") },
    { label: "Referência", value: payment.reference.replace(/\s/g, ""), copy: payment.reference.replace(/\s/g, "") },
    { label: "Valor", value: formatKz(payment.amount), copy: payment.amount.toFixed(2).replace(".", ",") },
  ];

  return (
    <>
      <section className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-5">
        <div className="flex gap-3">
          <svg viewBox="0 0 24 24" className="mt-1 h-6 w-6 shrink-0 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <div>
            <h2 className="text-lg font-semibold text-amber-600">Aguardando Confirmação</h2>
            <p className="text-gray-700">Aguardando confirmação do seu pagamento por referência</p>
          </div>
        </div>
        <p className="mt-4 text-gray-700">Verificando pagamento...</p>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          aria-label="Verificando pagamento"
        >
          <div className="h-full rounded-full bg-blue-600 transition-[width] duration-500 ease-linear" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-3 text-center text-sm text-gray-500">Pagamento por referência criado</p>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/10">
        <h1 className="text-2xl font-bold leading-tight">Detalhes do Pagamento por Referência</h1>
        <p className="mt-1 text-gray-500">Use estes dados para completar o pagamento através do seu banco</p>
        <div className="mt-5 space-y-3">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3">
              <div className="min-w-0">
                <p className="text-gray-500">{r.label}</p>
                <p className="truncate text-xl font-semibold tabular-nums">{r.value}</p>
              </div>
              <CopyIconButton text={r.copy} label={r.label} />
            </div>
          ))}
        </div>
        {shownSteps.length > 0 && instructionsMode === "shown" && (
          <div className="mt-5 text-gray-600">
            <p>Instruções:</p>
            <StepList steps={shownSteps} className="mt-2" />
          </div>
        )}
        {revealed && (
          <div className="mt-5">
            {uploadSlot ?? (
              <div className="w-full rounded-xl bg-[var(--c-primary)] px-4 py-3.5 text-center text-base font-bold text-[var(--c-on-primary)]">
                Enviar o comprovativo
              </div>
            )}
          </div>
        )}
      </section>

      {/* Minimizadas: botão pequeno fora do cartão; os passos abrem por baixo. */}
      {shownSteps.length > 0 && instructionsMode === "collapsed" && (
        <div className="text-center">
          <button
            type="button"
            aria-expanded={stepsOpen}
            onClick={() => setStepsOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700"
          >
            {stepsOpen ? "Esconder instruções" : "Ver instruções de como pagar"}
            <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${stepsOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {stepsOpen && (
            <div className="mt-3 rounded-2xl bg-white p-4 text-left text-gray-600 shadow-sm ring-1 ring-black/10">
              <StepList steps={shownSteps} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function StepList({ steps, className = "" }: { steps: string[]; className?: string }) {
  return (
    <ol className={`space-y-2 ${className}`}>
      {steps.map((s, i) => (
        <li key={i}>
          {i + 1}. {s}
        </li>
      ))}
    </ol>
  );
}

function CopyIconButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? `${label} copiado` : `Copiar ${label.toLowerCase()}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Sem permissão de clipboard: o lead ainda pode copiar à mão.
        }
      }}
      className="shrink-0 rounded-lg p-2 text-gray-700 hover:bg-gray-200"
    >
      {copied ? (
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M5 12l5 5 9-10" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V6a2 2 0 0 1 2-2h9" />
        </svg>
      )}
    </button>
  );
}
