import { parseMoney } from "@/lib/proofs/extract";
import type { TextLine } from "@/lib/proofs/analyze";

/** Extrato normalizado como tabela de texto (cabeçalhos + linhas). */
export type StatementTable = { headers: string[]; rows: string[][] };

export type Mapping = {
  date: number;
  amount: number;
  description: number | null;
  reference: number | null;
  /** "signed": negativo = saída; "credit": coluna só com entradas. */
  amountMode: "signed" | "credit";
};

export type Movement = {
  row: number;
  date: string; // AAAA-MM-DD (dia em Angola)
  amount: number;
  description: string;
  reference: string | null;
  raw: string[];
};

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------
export function parseCsv(text: string): StatementTable {
  const clean = text.replace(/^﻿/, "");
  const first = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", ",", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(cell.trim()); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return withHeader(rows);
}

/** O cabeçalho é a primeira linha com pelo menos 2 células de texto (ignora títulos do banco por cima). */
function withHeader(rows: string[][]): StatementTable {
  const idx = rows.findIndex((r) => r.filter((c) => c && !/^[\d\s.,/:-]+$/.test(c)).length >= 2 && r.filter(Boolean).length >= 3);
  const headerIdx = idx === -1 ? 0 : idx;
  const width = Math.max(...rows.map((r) => r.length), 0);
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");
  return { headers: pad(rows[headerIdx] ?? []).map((h, i) => h || `Coluna ${i + 1}`), rows: rows.slice(headerIdx + 1).map(pad) };
}

// ---------------------------------------------------------------------
// Excel (.xlsx)
// ---------------------------------------------------------------------
export async function parseXlsx(bytes: Uint8Array): Promise<StatementTable> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheet = wb.worksheets.find((s) => s.actualRowCount > 1) ?? wb.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (r) => {
    const values: string[] = [];
    r.eachCell({ includeEmpty: true }, (cell, col) => {
      values[col - 1] = cellText(cell.value);
    });
    rows.push(Array.from(values, (v) => v ?? ""));
  });
  return withHeader(rows);
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as { text?: string; richText?: { text: string }[]; result?: unknown };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (o.text) return String(o.text);
    if (o.result !== undefined) return cellText(o.result);
  }
  return String(v).trim();
}

// ---------------------------------------------------------------------
// PDF: cada linha com uma data vira uma linha da tabela
// ---------------------------------------------------------------------
const MONEY = /-?\(?\d{1,3}(?:[ . ]\d{3})+(?:,\d{2})\)?-?|-?\(?\d+,\d{2}\)?-?|-?\d{1,3}(?:,\d{3})+\.\d{2}|-?\d+\.\d{2}(?!\d)/g;
const DATE_TOKEN = /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/;

export function pdfLinesToTable(lines: TextLine[]): StatementTable {
  const rows: string[][] = [];
  for (const l of lines) {
    const d = l.text.match(DATE_TOKEN);
    if (!d) continue;
    const rest = l.text.replace(d[0], " ");
    const amounts = rest.match(MONEY) ?? [];
    if (!amounts.length) continue;
    let description = rest;
    for (const a of amounts) description = description.replace(a, " ");
    rows.push([d[0], description.replace(/\s+/g, " ").trim(), amounts[0] ?? "", amounts[1] ?? "", amounts[2] ?? ""]);
  }
  return { headers: ["Data", "Descrição", "1.º valor", "2.º valor", "3.º valor"], rows };
}

// ---------------------------------------------------------------------
// Valores e datas
// ---------------------------------------------------------------------
/** "-5.000,00" | "(5 000,00)" | "5000,00 D" → -5000 ; "5.000,00" → 5000 */
export function signedMoney(input: string): number | null {
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/^-/.test(s) || /-$/.test(s)) { negative = true; s = s.replace(/^-|-$/g, ""); }
  if (/\s*(d|db|deb)\.?$/i.test(s)) { negative = true; s = s.replace(/\s*(d|db|deb)\.?$/i, ""); }
  s = s.replace(/\s*(c|cr|cred)\.?$/i, "");
  const n = parseMoney(s);
  return n === null ? null : negative ? -n : n;
}

const MONTHS: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

/** Data de um movimento → "AAAA-MM-DD" (datas do extrato já estão em hora local). */
export function statementDate(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  let r = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (r) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) {
    [d, m, y] = [+r[1], +r[2], +r[3]];
    if (y < 100) y += 2000;
  } else if ((r = s.match(/^(\d{1,2})[\s-]*([A-Za-zç]{3})[a-zç]*\.?[\s-]*(\d{2,4})/i)) && MONTHS[r[2].toLowerCase()]) {
    [d, m, y] = [+r[1], MONTHS[r[2].toLowerCase()], +r[3]];
    if (y < 100) y += 2000;
  } else if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Número de série do Excel (dias desde 1899-12-30)
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86_400_000).toISOString().slice(0, 10);
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------
// Sugestão de colunas e conversão em movimentos
// ---------------------------------------------------------------------
export function suggestMapping(t: StatementTable): Mapping {
  const find = (re: RegExp, avoid?: RegExp) =>
    t.headers.findIndex((h) => re.test(h) && !(avoid && avoid.test(h)));
  const share = (col: number, fn: (v: string) => unknown) => {
    const sample = t.rows.slice(0, 30).map((r) => r[col]).filter(Boolean);
    return sample.length ? sample.filter((v) => fn(v) !== null).length / sample.length : 0;
  };
  const byContent = (fn: (v: string) => unknown, except: number[] = []) =>
    t.headers.map((_, i) => i).filter((i) => !except.includes(i)).sort((a, b) => share(b, fn) - share(a, fn))[0] ?? 0;

  let date = find(/data|date|dt\b|valor\s*em/i, /valoriza/i);
  if (date === -1) date = byContent(statementDate);
  const credit = find(/cr[eé]dito|credit|entrada/i);
  let amount = credit !== -1 ? credit : find(/montante|valor|amount|import/i, /saldo|balance/i);
  if (amount === -1) amount = byContent(signedMoney, [date]);
  const description = find(/descri|hist[oó]rico|movimento|detalhe|narrat|concept|opera/i);
  const reference = find(/refer|n\.?[ºo°]?\s*doc|transac|documento/i);
  return {
    date,
    amount,
    description: description === -1 ? null : description,
    reference: reference === -1 || reference === description ? null : reference,
    amountMode: credit !== -1 ? "credit" : "signed",
  };
}

/** Só entradas de dinheiro (créditos) interessam para confirmar pagamentos. */
export function toMovements(t: StatementTable, m: Mapping): Movement[] {
  const out: Movement[] = [];
  t.rows.forEach((r, i) => {
    const date = statementDate(r[m.date] ?? "");
    const value = signedMoney(r[m.amount] ?? "");
    if (!date || value === null || value <= 0) return;
    out.push({
      row: i,
      date,
      amount: Math.round(value * 100) / 100,
      description: m.description !== null ? (r[m.description] ?? "").slice(0, 500) : "",
      reference: m.reference !== null ? (r[m.reference] ?? "").slice(0, 120) || null : null,
      raw: r,
    });
  });
  return out;
}
