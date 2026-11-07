import type { CheckoutConfig, CheckoutOptions, CheckoutPageRow, PaymentInstructions } from "./types";

export const PAYMENT_METHOD_LABELS: Record<"bank_app" | "express" | "atm", string> = {
  bank_app: "App do banco",
  express: "Multicaixa Express",
  atm: "ATM",
};

export const DEFAULT_PAYMENT_INSTRUCTIONS: PaymentInstructions = {
  bank_app: [
    "Aceda ao Multicaixa Express, à app do seu banco ou a um ATM.",
    "Escolha a opção Pagamentos por Referência.",
    "Insira a Entidade, a Referência e o Valor exatamente como mostrado acima.",
    "Confirme o pagamento.",
  ],
  express: [
    "Abra o Multicaixa Express.",
    "Toque em Pagamentos e escolha Pagamento por Referência.",
    "Introduza a Entidade, a Referência e o Montante exactamente como aparecem acima.",
    "Confirme com o seu PIN e partilhe/guarde o comprovativo em PDF.",
    "Volte a esta página e carregue o comprovativo.",
  ],
  atm: [
    "Insira o cartão e marque o PIN.",
    "Escolha Pagamentos → Pagamentos por Referência.",
    "Introduza a Entidade, a Referência e o Montante exactamente como aparecem acima.",
    "Confirme e guarde o talão.",
    "Fotografe o talão e carregue a imagem nesta página (a confirmação pode demorar um pouco mais).",
  ],
  later: ["Guarde o comprovativo em PDF.", "Volte a esta página e carregue o comprovativo."],
};

/** Minutos depois da criação do pedido em que aparecem os passos finais e o envio do comprovativo. */
export const PROOF_REVEAL_MINUTES = 5;

/** Texto padrão anterior (passos 4 e 5 juntos), convertido para o novo formato ao ler. */
const PREVIOUS_DEFAULT_BANK_APP = [
  "Aceda ao Multicaixa Express, à app do seu banco ou a um ATM.",
  "Escolha a opção Pagamentos por Referência.",
  "Insira a Entidade, a Referência e o Valor exatamente como mostrado acima.",
  "Confirme o pagamento e guarde o comprovativo em PDF.",
  "Volte a esta página e carregue o comprovativo.",
];

export const DEFAULT_OPTIONS: CheckoutOptions = {
  emailField: "required",
  proofAlwaysVisible: false,
  instructionsMode: "shown",
};

/** Lê as opções guardadas, ignorando valores desconhecidos. */
export function readOptions(pi: CheckoutPageRow["payment_instructions"]): CheckoutOptions {
  const o = pi?.options ?? {};
  return {
    emailField: o.emailField === "optional" || o.emailField === "hidden" ? o.emailField : DEFAULT_OPTIONS.emailField,
    proofAlwaysVisible: o.proofAlwaysVisible === true,
    instructionsMode:
      o.instructionsMode === "collapsed" || o.instructionsMode === "hidden" ? o.instructionsMode : DEFAULT_OPTIONS.instructionsMode,
  };
}

export const DEFAULT_CHECKOUT: CheckoutConfig = {
  ...DEFAULT_OPTIONS,
  logoPath: null,
  bannerPath: null,
  primaryColor: "#0F766E",
  accentColor: "#F59E0B",
  backgroundColor: "#FFFFFF",
  title: null,
  description: null,
  testimonials: [],
  guaranteeText: null,
  timerEnabled: false,
  timerMinutes: null,
  buttonText: "Confirmar e Pagar",
  paymentInstructions: DEFAULT_PAYMENT_INSTRUCTIONS,
};

export function toCheckoutConfig(row: CheckoutPageRow | null): CheckoutConfig {
  if (!row) return DEFAULT_CHECKOUT;
  let pi: Partial<PaymentInstructions> = row.payment_instructions ?? {};
  const options = readOptions(row.payment_instructions);
  // Páginas ainda com o texto padrão antigo passam a usar o novo (passo 4 curto + passos depois).
  if (!pi.later && JSON.stringify(pi.bank_app) === JSON.stringify(PREVIOUS_DEFAULT_BANK_APP)) {
    pi = { ...pi, bank_app: DEFAULT_PAYMENT_INSTRUCTIONS.bank_app, later: DEFAULT_PAYMENT_INSTRUCTIONS.later };
  }
  const steps = (k: keyof PaymentInstructions) =>
    pi[k] && (pi[k]!.length > 0 || k === "later") ? pi[k]! : DEFAULT_PAYMENT_INSTRUCTIONS[k];
  return {
    ...options,
    logoPath: row.logo_path,
    bannerPath: row.banner_path,
    primaryColor: row.primary_color,
    accentColor: row.accent_color,
    backgroundColor: row.background_color,
    title: row.title,
    description: row.description,
    testimonials: row.testimonials ?? [],
    guaranteeText: row.guarantee_text,
    timerEnabled: row.timer_enabled,
    timerMinutes: row.timer_minutes,
    buttonText: row.button_text,
    paymentInstructions: { bank_app: steps("bank_app"), express: steps("express"), atm: steps("atm"), later: steps("later") },
  };
}

/** Preto ou branco, o que tiver melhor contraste sobre a cor dada. */
export function readableOn(hex: string): "#000000" | "#FFFFFF" {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#000000" : "#FFFFFF";
}
