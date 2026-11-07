/** Valores que um link pode trazer para pré-preencher o formulário do checkout. */
export type Prefill = { name: string; email: string; phone: string };

type SearchParams = Record<string, string | string[] | undefined>;

const ALIASES: Record<keyof Prefill, string[]> = {
  name: ["nome", "name"],
  email: ["email", "e-mail"],
  phone: ["telefone", "phone", "tel", "telemovel"],
};

/** Parâmetros do link que trazem dados pessoais. */
export const PREFILL_PARAMS = Object.values(ALIASES).flat();

const MAX = { name: 120, email: 160, phone: 20 };

function pick(params: SearchParams, keys: string[]): string {
  for (const key of keys) {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value?.trim()) return value;
  }
  return "";
}

export function readPrefill(params: SearchParams): Prefill {
  const clean = (k: keyof Prefill) =>
    pick(params, ALIASES[k]).replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim().slice(0, MAX[k]);
  return { name: clean("name"), email: clean("email"), phone: clean("phone") };
}
