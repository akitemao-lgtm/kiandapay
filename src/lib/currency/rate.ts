// Quanto 1 Kwanza pode valer, no máximo, em cada moeda. Nas outras moedas aceites, vale sempre menos de 1.
const MAX_RATE: Record<string, number> = { ARS: 20, CLP: 20, COP: 50, PYG: 100 };

/** Apanha a taxa escrita ao contrário (ex.: 1200 em vez de 0,00083333). Devolve o erro, ou null se estiver bem. */
export function rateError(currency: string, rate: number | null | undefined): string | null {
  if (currency === "AOA" || !rate) return null;
  const max = MAX_RATE[currency] ?? 1;
  if (rate <= max) return null;
  const inverse = Number((1 / rate).toFixed(8));
  const hint = inverse > 0 ? ` Se 1 ${currency} = ${rate} Kz, escreva ${inverse}.` : "";
  return `Esta taxa parece estar ao contrário: 1 Kz vale menos de ${max} ${currency}.${hint}`;
}
