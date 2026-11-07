import type { ActionResult } from "@/lib/products/types";

const STALE =
  "Não foi possível guardar: a página está desatualizada ou a ligação falhou. Recarregue a página e tente de novo.";

/**
 * Chama uma server action sem deixar um erro de rede (ou uma página aberta
 * antes de um deploy, cujas ações já não existem) rebentar o formulário.
 * Redirecionamentos do Next continuam a funcionar.
 */
export async function safeAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    const digest = (e as { digest?: string })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) throw e;
    console.error("[ação]", e);
    return { ok: false, error: STALE };
  }
}
