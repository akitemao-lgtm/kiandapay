"use client";

import { useState, useTransition } from "react";
import { approveAccount, reactivateAccount, setProductActive, suspendAccount } from "@/app/admin/(painel)/contas/actions";
import { buttonPrimary } from "@/components/ui/styles";
import { safeAction } from "@/lib/client/safe-action";
import type { AccountStatus } from "@/lib/auth";
import type { ActionResult } from "@/lib/products/types";

const smallBtn = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50";

function useRun() {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) => {
    setResult(null);
    start(async () => setResult(await safeAction(fn)));
  };
  const message = result && (
    <p className={`text-xs ${result.ok ? "text-green-700" : "text-red-600"}`}>{result.ok ? result.message : result.error}</p>
  );
  return { run, pending, message };
}

export function AccountActions({ id, status, name }: { id: string; status: AccountStatus; name: string }) {
  const { run, pending, message } = useRun();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {status === "pending" && (
          <button type="button" disabled={pending} onClick={() => run(() => approveAccount(id))} className={buttonPrimary}>
            Aprovar
          </button>
        )}
        {status === "suspended" && (
          <button type="button" disabled={pending} onClick={() => run(() => reactivateAccount(id))} className={smallBtn}>
            Reativar
          </button>
        )}
        {status !== "suspended" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const reason = prompt(`Suspender "${name || "esta conta"}"? Os checkouts deixam de aceitar pedidos.\n\nMotivo (a pessoa vai vê-lo):`);
              if (reason !== null) run(() => suspendAccount(id, reason));
            }}
            className={`${smallBtn} text-red-700`}
          >
            {status === "pending" ? "Recusar" : "Suspender"}
          </button>
        )}
      </div>
      {message}
    </div>
  );
}

export function ProductToggle({ accountId, productId, active }: { accountId: string; productId: string; active: boolean }) {
  const { run, pending, message } = useRun();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => setProductActive(accountId, productId, !active))}
        className={`${smallBtn} ${active ? "text-red-700" : ""}`}
      >
        {active ? "Desativar" : "Ativar"}
      </button>
      {message}
    </div>
  );
}
