import type { TextLine } from "./analyze";

/**
 * Extracção genérica por rótulos ("Entidade", "Montante", "Nº Transacção"…),
 * comum a todos os bancos. Para cada campo guarda também a posição na página,
 * que o modelo de referência usa para confirmar o layout.
 */
export type FieldName = "entity" | "reference" | "amount" | "paidAt" | "transactionId" | "payerName";
export type Position = { x: number; y: number; page: number };

export type Extracted = {
  entity: string | null;
  reference: string | null;
  amount: number | null;
  paidAt: string | null; // ISO
  transactionId: string | null;
  payerName: string | null;
  positions: Partial<Record<FieldName, Position>>;
  bankGuess: string | null;
};

// ---------------------------------------------------------------------
// Valores
// ---------------------------------------------------------------------

/** "5.000,00" | "5 000,00" | "5,000.00" | "5000" | "AOA 5.000,00" → 5000 */
export function parseMoney(input: string): number | null {
  const s = input.replace(/(kz|aoa|kwanzas?)/gi, "").replace(/[\s ]/g, "").trim();
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    normalized = s.split(thou).join("").replace(dec, ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    normalized = parts.length === 2 && tail.length <= 2 ? `${parts[0]}.${tail}` : parts.join("");
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  feb: 2, apr: 4, may: 5, aug: 8, sep: 9, oct: 10, dec: 12,
};

/** Hora local de Angola (UTC+1, sem horário de verão) → ISO. */
export function luandaIso(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h - 1, mi, s);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const TIME = String.raw`(\d{1,2})[:hH](\d{2})(?::(\d{2}))?`;
const DATE_PATTERNS: { re: RegExp; map: (m: RegExpMatchArray) => string | null }[] = [
  { // 16/10/2026 17:05[:30]  ou 16-10-2026 às 17:05
    re: new RegExp(String.raw`(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\D{1,6}?${TIME})?`),
    map: (m) => luandaIso(+m[3], +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)),
  },
  { // 2026-10-16 17:05
    re: new RegExp(String.raw`(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:\D{1,6}?${TIME})?`),
    map: (m) => luandaIso(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)),
  },
  { // 16 Out 2026 17:05 / 16 de Outubro de 2026
    re: new RegExp(String.raw`(\d{1,2})\s*(?:de\s+)?([A-Za-zç]{3})[a-zç]*\.?\s*(?:de\s+)?(\d{4})(?:\D{1,6}?${TIME})?`, "i"),
    map: (m) => {
      const mo = MONTHS[m[2].toLowerCase()];
      return mo ? luandaIso(+m[3], mo, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) : null;
    },
  },
];

export function parseDateTime(text: string): string | null {
  for (const p of DATE_PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      const v = p.map(m);
      if (v) return v;
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------

const LABELS: Record<FieldName, RegExp> = {
  entity: /\bentidade\b/i,
  reference: /\brefer[eê]ncia\b(?!\s*(?:da|de|do)\s*(?:transa|opera|pagamento|movimento))/i,
  amount: /\b(montante|valor|import[aâ]ncia|quantia|total)\b/i,
  paidAt: /\b(data|hora|efectuad[oa]|efetuad[oa]|realizad[oa])\b/i,
  transactionId:
    /(^\s*transac?[cç][aã]o\b|\b(?:n\.?\s*[ºo°]?\s*(?:d[aeo]\s+)?(?:transac?[cç][aã]o|opera[cç][aã]o|movimento|documento|comprovativo|talão)|(?:id|c[oó]digo|refer[eê]ncia|n[uú]mero)\s+(?:da|de|do)\s+(?:transac?[cç][aã]o|opera[cç][aã]o|movimento|pagamento)|transac?[cç][aã]o\s*n\.?\s*[ºo°]?|id\s+transac?[cç][aã]o))/i,
  payerName: /\b(ordenante|nome\s+do\s+ordenante|titular|pagador|nome\s+do\s+cliente|cliente|de\s*:)/i,
};

/** Rótulos que parecem "valor" mas não são o montante pago. */
const NOT_AMOUNT = /(taxa|comiss|imposto|iva|saldo|limite|dispon)/i;

const VALUE: Record<FieldName, RegExp> = {
  entity: /(?<!\d)(\d{5})(?!\d)/,
  reference: /(?<!\d)(\d{3}[\s.]?\d{3}[\s.]?\d{3})(?!\d)/,
  amount: /(\d{1,3}(?:[\s .,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:kz|aoa)?/i,
  paidAt: /./,
  transactionId: /([A-Z0-9][A-Z0-9\-/]{5,39})/i,
  payerName: /([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' .-]{3,80})/,
};

/** Texto depois do rótulo na mesma linha; se vazio, a linha seguinte. */
function candidates(lines: TextLine[], i: number, label: RegExp): { text: string; line: TextLine }[] {
  const line = lines[i];
  const m = line.text.match(label);
  const after = m ? line.text.slice((m.index ?? 0) + m[0].length).replace(/^[\s:.\-–]+/, "") : "";
  const out = [];
  if (after) out.push({ text: after, line });
  if (lines[i + 1] && lines[i + 1].page === line.page) out.push({ text: lines[i + 1].text, line: lines[i + 1] });
  return out;
}

function findField(lines: TextLine[], field: FieldName, reject?: (v: string) => boolean) {
  for (let i = 0; i < lines.length; i++) {
    if (!LABELS[field].test(lines[i].text)) continue;
    if (field === "amount" && NOT_AMOUNT.test(lines[i].text)) continue;
    for (const c of candidates(lines, i, LABELS[field])) {
      if (field === "paidAt") {
        const v = parseDateTime(c.text);
        if (v) return { value: v, line: c.line };
        continue;
      }
      const m = c.text.match(VALUE[field]);
      if (m && !(reject && reject(m[1]))) return { value: m[1].trim(), line: c.line };
    }
  }
  return null;
}

const BANKS: [RegExp, string][] = [
  [/multicaixa\s*express/i, "mcx_express"],
  [/\bBAI\b|banco\s+angolano\s+de\s+investimentos/i, "bai"],
  [/\bBFA\b|banco\s+de\s+fomento\s+angola/i, "bfa"],
  [/\bBIC\b|banco\s+bic/i, "bic"],
  [/atl[aâ]ntico/i, "atlantico"],
  [/millennium/i, "millennium"],
  [/banco\s+sol\b/i, "sol"],
  [/\bkeve\b/i, "keve"],
  [/\bBPC\b|banco\s+de\s+poupan[cç]a/i, "bpc"],
  [/standard\s+bank/i, "standard"],
  [/\byetu\b/i, "yetu"],
  [/\bBCI\b|banco\s+de\s+com[eé]rcio\s+e\s+ind[uú]stria/i, "bci"],
  [/\bBNI\b|banco\s+de\s+neg[oó]cios/i, "bni"],
  [/caixa\s+angola|\bCGD\b/i, "caixa_angola"],
  [/econ[oó]mico/i, "economico"],
  [/access\s+bank/i, "access"],
];

export function guessBank(text: string): string | null {
  return BANKS.find(([re]) => re.test(text))?.[1] ?? null;
}

export function extractFields(lines: TextLine[], text: string): Extracted {
  const pos = (l: TextLine | undefined): Position | undefined =>
    l ? { x: Math.round(l.x * 1000) / 1000, y: Math.round(l.y * 1000) / 1000, page: l.page } : undefined;

  const entity = findField(lines, "entity");
  const reference = findField(lines, "reference");
  const refDigits = reference?.value.replace(/\D/g, "") ?? null;
  const amount = findField(lines, "amount", (v) => parseMoney(v) === null);
  const paidAt = findField(lines, "paidAt") ?? (() => {
    const v = parseDateTime(text);
    return v ? { value: v, line: undefined } : null;
  })();
  const transactionId = findField(lines, "transactionId", (v) => {
    const d = v.replace(/\D/g, "");
    const looksLikeDate = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(v);
    return d === entity?.value || d === refDigits || !/\d/.test(v) || looksLikeDate;
  });
  const payer = findField(lines, "payerName", (v) => /\d/.test(v));

  return {
    entity: entity?.value ?? null,
    reference: refDigits,
    amount: amount ? parseMoney(amount.value) : null,
    paidAt: paidAt?.value ?? null,
    transactionId: transactionId ? transactionId.value.toUpperCase().replace(/\s+/g, "") : null,
    payerName: payer?.value.replace(/\s+/g, " ").trim() ?? null,
    positions: {
      entity: pos(entity?.line),
      reference: pos(reference?.line),
      amount: pos(amount?.line),
      paidAt: pos(paidAt?.line),
      transactionId: pos(transactionId?.line),
      payerName: pos(payer?.line),
    },
    bankGuess: guessBank(text),
  };
}
