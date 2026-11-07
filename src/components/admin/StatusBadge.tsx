const STATUS: Record<string, { label: string; c: string }> = {
  awaiting_payment: { label: "Aguarda pagamento", c: "bg-gray-100 text-gray-700" },
  under_review: { label: "Em análise", c: "bg-amber-100 text-amber-800" },
  paid: { label: "Pago", c: "bg-green-100 text-green-800" },
  rejected: { label: "Rejeitado", c: "bg-red-100 text-red-800" },
  expired: { label: "Expirado", c: "bg-gray-100 text-gray-500" },
};

export const ORDER_STATUSES = Object.entries(STATUS).map(([value, { label }]) => ({ value, label }));

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, c: "bg-gray-100" };
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.c}`}>{s.label}</span>;
}
