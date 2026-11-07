import type { Settings } from "@/lib/settings";

/**
 * Camada de pagamento substituível. Hoje só existe "fixed_reference"
 * (Entidade + Referência fixas, confirmação pelo comprovativo). Um gateway
 * com referências dinâmicas implementa a mesma interface e passa a confirmar
 * os pedidos por webhook, sem mudar o checkout nem a página do pedido.
 */
export type CreatedPayment = {
  entity: string;
  reference: string;
  providerPaymentId: string | null;
  data: Record<string, unknown>;
};

export interface PaymentProvider {
  id: string;
  /** true se o pagamento é confirmado por comprovativo carregado pelo cliente. */
  requiresProof: boolean;
  isConfigured(): boolean;
  createPayment(input: { amount: number }): Promise<CreatedPayment>;
}

function fixedReference(settings: Settings): PaymentProvider {
  return {
    id: "fixed_reference",
    requiresProof: true,
    isConfigured: () => /^\d{5}$/.test(settings.payment_entity) && /^\d{9}$/.test(settings.payment_reference),
    async createPayment() {
      return {
        entity: settings.payment_entity,
        reference: settings.payment_reference,
        providerPaymentId: null,
        data: {},
      };
    },
  };
}

export function getPaymentProvider(settings: Settings): PaymentProvider {
  return fixedReference(settings);
}
