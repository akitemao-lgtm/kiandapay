export const WEBHOOK_EVENTS = {
  "order.created": "Pedido criado",
  "order.under_review": "Comprovativo em análise",
  "order.paid": "Pedido pago",
  "order.rejected": "Pedido rejeitado",
  "order.expired": "Pedido expirado",
} as const;
export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;
