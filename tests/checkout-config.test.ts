import { describe, expect, it } from "vitest";
import { DEFAULT_PAYMENT_INSTRUCTIONS, toCheckoutConfig } from "@/lib/checkout/defaults";
import type { CheckoutPageRow } from "@/lib/checkout/types";

const row = (payment_instructions: CheckoutPageRow["payment_instructions"]): CheckoutPageRow => ({
  product_id: "p", logo_path: null, banner_path: null, primary_color: "#0F766E", accent_color: "#F59E0B",
  background_color: "#FFFFFF", title: null, description: null, testimonials: [], guarantee_text: null,
  timer_enabled: false, timer_minutes: null, button_text: "Confirmar e Pagar", payment_instructions, updated_at: "",
});

describe("instruções de pagamento", () => {
  it("o texto padrão antigo passa a ter o passo 4 curto e os passos finais adiados", () => {
    const old = [
      "Aceda ao Multicaixa Express, à app do seu banco ou a um ATM.",
      "Escolha a opção Pagamentos por Referência.",
      "Insira a Entidade, a Referência e o Valor exatamente como mostrado acima.",
      "Confirme o pagamento e guarde o comprovativo em PDF.",
      "Volte a esta página e carregue o comprovativo.",
    ];
    const pi = toCheckoutConfig(row({ bank_app: old })).paymentInstructions;
    expect(pi.bank_app[3]).toBe("Confirme o pagamento.");
    expect(pi.bank_app).toHaveLength(4);
    expect(pi.later).toEqual(DEFAULT_PAYMENT_INSTRUCTIONS.later);
  });

  it("instruções personalizadas ficam como estão", () => {
    const pi = toCheckoutConfig(row({ bank_app: ["Passo A", "Passo B"], later: ["Depois C"] })).paymentInstructions;
    expect(pi.bank_app).toEqual(["Passo A", "Passo B"]);
    expect(pi.later).toEqual(["Depois C"]);
  });

  it("aceita não ter passos adiados", () => {
    expect(toCheckoutConfig(row({ bank_app: ["Passo A"], later: [] })).paymentInstructions.later).toEqual([]);
  });

  it("sem página guardada usa os padrões", () => {
    expect(toCheckoutConfig(null).paymentInstructions).toEqual(DEFAULT_PAYMENT_INSTRUCTIONS);
  });
});

describe("opções do checkout", () => {
  it("sem opções guardadas: e-mail obrigatório, instruções visíveis, comprovativo aos 5 minutos", () => {
    const c = toCheckoutConfig(row({ bank_app: ["A"] }));
    expect(c).toMatchObject({ emailField: "required", instructionsMode: "shown", proofAlwaysVisible: false });
  });

  it("lê as opções guardadas junto das instruções", () => {
    const c = toCheckoutConfig(
      row({ bank_app: ["A"], options: { emailField: "hidden", instructionsMode: "collapsed", proofAlwaysVisible: true } }),
    );
    expect(c).toMatchObject({ emailField: "hidden", instructionsMode: "collapsed", proofAlwaysVisible: true });
  });

  it("valores desconhecidos voltam ao padrão", () => {
    const c = toCheckoutConfig(
      row({ bank_app: ["A"], options: { emailField: "x", instructionsMode: "y", proofAlwaysVisible: "sim" } as never }),
    );
    expect(c).toMatchObject({ emailField: "required", instructionsMode: "shown", proofAlwaysVisible: false });
  });
});
