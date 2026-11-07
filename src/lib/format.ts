export const TIMEZONE = "Africa/Luanda";

const kz = new Intl.NumberFormat("pt-AO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 15000 → "15 000,00 Kz" */
export function formatKz(value: number | string): string {
  return `${kz.format(Number(value))} Kz`;
}

const dateTime = new Intl.DateTimeFormat("pt-AO", {
  timeZone: TIMEZONE,
  dateStyle: "short",
  timeStyle: "short",
});

export function formatDateTime(value: string | Date): string {
  return dateTime.format(new Date(value));
}

/**
 * Aceita "15000", "15 000", "15.000", "15.000,50", "15000.50".
 * Devolve null se não for um valor válido.
 */
export function parseKz(input: string): number | null {
  let s = input.replace(/\s|kz/gi, "");
  if (!s) return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}
