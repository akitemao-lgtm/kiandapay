"use client";

import { safeAction } from "@/lib/client/safe-action";
import { useState, useTransition } from "react";
import { resendPurchase } from "@/app/admin/(painel)/pedidos/actions";
import type { ActionResult } from "@/lib/products/types";

export function ResendPurchaseButton({ orderId }: { orderId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await safeAction(() => resendPurchase(orderId))))}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "A enviar…" : "Reenviar Purchase"}
      </button>
      {result && <span className={`text-sm ${result.ok ? "text-green-700" : "text-red-600"}`}>{result.ok ? result.message : result.error}</span>}
    </div>
  );
}
