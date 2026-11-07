// Quanto 1 Kwanza pode valer, no máximo, em cada moeda. Nas outras moedas aceites, vale sempre menos de 1.
const MAX_RATE: Record<string, number> = { ARS: 20, CLP: 20, COP: 50, PYG: 100 };

/** Apanha uma taxa ao contrário. A taxa guardada é o valor de 1 Kz na moeda (ex.: 0,00083333 USD). */
export function rateError(currency: string, rate: number | null | undefined): string | null {
  if (currency === "AOA" || !rate) return null;
  if (rate <= (MAX_RATE[currency] ?? 1)) return null;
  return `Escreva quantos Kwanzas vale 1 ${currency} (por exemplo, 1200 se 1 ${currency} = 1200 Kz).`;
}

/** Lê "1200", "1 200", "1.200" ou "1200,50" e devolve a taxa guardada: 1 Kz na moeda. */
export function rateFromKzText(text: string): number | null {
  const compact = text.replace(/\s/g, "");
  if (!compact) return null;
  const plain = /^\d{1,3}(\.\d{3})+$/.test(compact) ? compact.replace(/\./g, "") : compact.replace(",", ".");
  const kz = Number(plain);
  return Number.isFinite(kz) && kz > 0 ? 1 / kz : null;
}

/** O inverso, para mostrar a taxa guardada no formulário. */
export function kzTextFromRate(rate: number | null | undefined): string {
  return rate ? String(Number((1 / rate).toPrecision(6))) : "";
}
