import { PREFILL_PARAMS } from "@/lib/checkout/prefill";

/**
 * Tira do URL os dados pessoais dos links de pré-preenchimento (?telefone=…).
 * O Meta proíbe recebê-los sem hash. Devolve null se o URL for inválido.
 */
export function stripPersonalParams(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    for (const key of PREFILL_PARAMS) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return null;
  }
}
