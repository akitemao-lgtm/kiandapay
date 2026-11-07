/** Aceita "923 456 789", "+244 923456789", "00244923456789" → "244923456789". */
export function normalizeAngolanPhone(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 9) d = `244${d}`;
  return /^2449\d{8}$/.test(d) ? d : null;
}

/** "244923456789" → "+244 923 456 789" */
export function formatAngolanPhone(n: string | null | undefined): string {
  if (!n) return "—";
  return `+244 ${n.slice(3, 6)} ${n.slice(6, 9)} ${n.slice(9)}`;
}
