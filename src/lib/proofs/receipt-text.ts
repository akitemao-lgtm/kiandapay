import { luandaIso } from "./extract";

/**
 * Leitura do texto de um comprovativo sem assinatura digital: o OCR de uma
 * imagem ou o texto de um PDF. Só lê os modelos conhecidos, tirados dos
 * comprovativos aprovados à mão, e lê o que o comprovativo diz sem olhar para
 * o pedido.
 *
 * O OCR troca caracteres, por isso a mesma imagem é lida várias vezes com
 * tratamentos diferentes e cada campo só vale quando pelo menos duas leituras
 * dão o mesmo valor. Onde o modelo repete um dado (no campo e no texto do
 * recibo), os dois sítios têm de coincidir.
 */
export type ReceiptLayout = "express_success" | "express_detail" | "express_pdf" | "bai_directo";

export const LAYOUT_LABELS: Record<ReceiptLayout, string> = {
  express_success: "Multicaixa Express, pagamento realizado",
  express_detail: "Multicaixa Express, detalhe do pagamento",
  express_pdf: "Multicaixa Express, comprovativo digital",
  bai_directo: "BAI Directo, pagamento por referência",
};

export type ReceiptField = "success" | "entity" | "reference" | "amount" | "paidAt";

export const FIELD_LABELS: Record<ReceiptField, string> = {
  success: "o estado da operação",
  entity: "a entidade",
  reference: "a referência",
  amount: "o valor",
  paidAt: "a data e a hora",
};

export type ReceiptReading = {
  layout: ReceiptLayout | null;
  /** O comprovativo diz que a operação foi concluída ("realizado com sucesso", "Estado: Sucesso"). */
  success: boolean;
  entity: string | null;
  reference: string | null;
  amount: number | null;
  /** ISO. No detalhe do pagamento só há horas e minutos. */
  paidAt: string | null;
  /** Só serve para reconhecer o mesmo pagamento noutro comprovativo. */
  transactionId: string | null;
  /** Dados que aparecem com valores diferentes dentro do mesmo comprovativo. */
  conflicts: ReceiptField[];
  /** Dados que o modelo mostra e não foram lidos com segurança. */
  missing: ReceiptField[];
};

/** Nome com que a entidade aparece nos comprovativos que não mostram o número. */
const ENTITY_BY_SERVICE: Record<string, string> = { "PAYPAY AFRICA": "10116" };

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** Lixo que o OCR deixa à volta de um valor (barras da tabela, pontuação solta). */
const tidy = (s: string) => s.replace(/^[\s|:;.\-–—_*]+/, "").replace(/[\s|:;.\-–—_*]+$/, "");

const STAMP = /(?<!\d)(?:(\d{4})-(\d{2})-(\d{2})|(\d{2})[-/](\d{2})[-/](\d{4})) (\d{2})[:.](\d{2})(?:[:.](\d{2}))?(?!\d)/g;

/** Datas com hora escritas no texto: "2026-11-03 12:02:13", "03-11-2026 04:37:43", "05/11/2026 13:34:59". */
function stamps(text: string, needSeconds: boolean): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(STAMP)) {
    if (needSeconds && m[9] === undefined) continue;
    const [y, mo, d] = m[1] ? [m[1], m[2], m[3]] : [m[6], m[5], m[4]];
    const iso = luandaIso(+y, +mo, +d, +m[7], +m[8], +(m[9] ?? 0));
    if (iso) out.push(iso);
  }
  return out;
}

/** "9.900,00", "9 900,00", "Kz 9 900,00", "9.900,00 Kz" → 9900. Nada de adivinhar: outro formato é null. */
function money(value: string): number | null {
  const m = tidy(value).replace(/^KZ ?/, "").replace(/ ?KZ$/, "").match(/^(\d{1,3}(?:[. ]\d{3})*|\d+),(\d{2})$/);
  return m ? Number(`${m[1].replace(/[. ]/g, "")}.${m[2]}`) : null;
}

const reference = (value: string) => tidy(value).match(/^(\d{3}) ?(\d{3}) ?(\d{3})$/)?.slice(1).join("") ?? null;
const entityNumber = (value: string) => tidy(value).match(/^(\d{5})(?: ?- ?[A-Z .]+)?$/)?.[1] ?? null;
const transaction = (value: string) => tidy(value).match(/^\d{5,14}$/)?.[0] ?? null;

type Row = { index: number; value: string };

/** Linhas "Rótulo | valor" ou "Rótulo: valor", pela ordem em que aparecem. */
function rows(lines: string[], label: RegExp): Row[] {
  const out: Row[] = [];
  lines.forEach((line, index) => {
    const m = line.match(label);
    if (m) out.push({ index, value: tidy(line.slice((m.index ?? 0) + m[0].length)) });
  });
  return out;
}

/** Nos ecrãs do Multicaixa Express o valor fica na linha por cima do rótulo. */
function above(lines: string[], label: string): Row[] {
  const out: Row[] = [];
  lines.forEach((line, index) => {
    if (line === label && index > 0) out.push({ index: index - 1, value: lines[index - 1] });
  });
  return out;
}

const start = (label: string) => new RegExp(`^[^A-Z0-9]*${label}`);
const LABEL = {
  stamp: start("DATA ?- ?HORA\\b"),
  operation: start("OPERACAO\\b"),
  entity: start("ENTIDADE\\b"),
  reference: start("REFERENCIA\\b"),
  amount: start("MONTANTE\\b(?: ?\\(KZ\\))?"),
  state: start("ESTADO\\b"),
  transaction: start("TRANSAC[A-Z]{1,5}\\b"),
  service: start("SERVI[CG]O\\b"),
  paidOn: start("DATA DO PAGAMENTO\\b"),
  operationNumber: start("NUMERO DE OPERACAO\\b"),
};

/** O texto do recibo da entidade: "PAYPAY AFRICA REFERÊNCIA: 955 567 206 MONTANTE: 9900.00 CARREGAMENTO PAGO …". */
const BLOCK_REFERENCE = /\bREFERENCIA ?[:;] ?(\d{3} ?\d{3} ?\d{3})(?!\d)/g;
const BLOCK_AMOUNT = /\bMONTANTE ?[:;] ?(\d{1,9})\.(\d{2})(?![\d.,])/g;

function detect(lines: string[], flat: string): ReceiptLayout | null {
  if (/\bDETALHE DO PAGAMENTO\b/.test(flat) && lines.some((l) => LABEL.state.test(l))) return "express_detail";
  if (/\bCANAL MULTICAIXA EXPRESS\b/.test(flat) && lines.some((l) => LABEL.stamp.test(l))) return "express_pdf";
  if (/\bBAI DIRECTO\b/.test(flat) && /\bDADOS DA OPERACAO\b/.test(flat)) return "bai_directo";
  if (/\bREALIZADO COM SUCESSO\b/.test(flat) && ["MONTANTE", "REFERENCIA", "ENTIDADE"].every((l) => lines.includes(l))) {
    return "express_success";
  }
  return null;
}

/** O que uma leitura encontrou em cada sítio do comprovativo. Mais de um valor = a própria leitura contradiz-se. */
type Scan = {
  layout: ReceiptLayout;
  success: boolean[];
  entity: string[];
  referenceField: string[];
  referenceBlock: string[];
  amountField: number[];
  amountBlock: number[];
  paidAt: string[];
  transactionId: string[];
};
type Place = Exclude<keyof Scan, "layout">;

const keep = <T,>(values: (T | null)[]) => values.filter((v): v is T => v !== null);
const distinct = <T,>(values: T[]) => [...new Set(values)];

function scan(text: string): Scan | null {
  const lines = text.split("\n").map(fold).filter(Boolean);
  const flat = lines.join(" ");
  const layout = detect(lines, flat);
  if (!layout) return null;

  const used = new Set<number>();
  const take = (found: Row[], first = false) => {
    const list = first ? found.slice(0, 1) : found;
    list.forEach((r) => used.add(r.index));
    return list.map((r) => r.value);
  };
  const s: Scan = {
    layout, success: [], entity: [], referenceField: [], referenceBlock: [], amountField: [], amountBlock: [], paidAt: [], transactionId: [],
  };

  if (layout === "express_success") {
    s.success = [true]; // "REALIZADO COM SUCESSO" faz parte do reconhecimento do modelo
    s.amountField = keep(take(above(lines, "MONTANTE")).map((v) => (/ ?KZ$/.test(v) ? money(v) : null)));
    s.referenceField = keep(take(above(lines, "REFERENCIA")).map(reference));
    s.entity = keep(take(above(lines, "ENTIDADE")).map(entityNumber));
    s.paidAt = stamps(flat, true);
  } else if (layout === "express_detail") {
    s.success = take(rows(lines, LABEL.state)).map((v) => v === "SUCESSO");
    s.amountField = keep(take(rows(lines, LABEL.amount)).map(money));
    s.referenceField = keep(take(rows(lines, LABEL.reference)).map(reference));
    s.entity = keep(take(rows(lines, LABEL.entity)).map(entityNumber));
    s.transactionId = keep(take(rows(lines, LABEL.transaction)).map(transaction));
    s.paidAt = take(rows(lines, LABEL.stamp)).flatMap((v) => stamps(v, false).slice(0, 1));
  } else if (layout === "express_pdf") {
    s.success = take(rows(lines, LABEL.operation)).map((v) => v === "PAGAMENTO DE SERVICOS");
    s.amountField = keep(take(rows(lines, LABEL.amount)).map((v) => (/ ?KZ$/.test(v) ? money(v) : null)));
    s.referenceField = keep(take(rows(lines, LABEL.reference)).map(reference));
    s.entity = keep(take(rows(lines, LABEL.entity)).map(entityNumber));
    s.transactionId = keep(take(rows(lines, LABEL.transaction)).map(transaction));
    s.paidAt = take(rows(lines, LABEL.stamp)).flatMap((v) => stamps(v, true).slice(0, 1));
  } else {
    // BAI Directo: as linhas do recibo repetem os rótulos "Referência:" e "Montante:"; a primeira é o campo.
    const state = take(rows(lines, LABEL.state)).map((v) => v === "SUCESSO");
    const byReference = take(rows(lines, LABEL.entity)).map((v) => v === "PAGAMENTOS POR REFERENCIA");
    s.success = state.length && byReference.length ? [...state, ...byReference] : [];
    s.amountField = keep(take(rows(lines, LABEL.amount), true).map((v) => (/^KZ ?\d/.test(v) ? money(v) : null)));
    s.referenceField = keep(take(rows(lines, LABEL.reference), true).map(reference));
    s.entity = keep(take(rows(lines, LABEL.service)).map((v) => ENTITY_BY_SERVICE[v] ?? null));
    s.transactionId = keep(take(rows(lines, LABEL.operationNumber)).map(transaction));
    s.paidAt = take(rows(lines, LABEL.paidOn)).flatMap((v) => stamps(v, true).slice(0, 1));
  }

  if (layout !== "express_detail") {
    const rest = lines.filter((_, i) => !used.has(i)).join(" ");
    s.referenceBlock = [...rest.matchAll(BLOCK_REFERENCE)].map((m) => m[1].replace(/ /g, ""));
    s.amountBlock = [...rest.matchAll(BLOCK_AMOUNT)].map((m) => Number(`${m[1]}.${m[2]}`));
  }
  return s;
}

const EMPTY: ReceiptReading = {
  layout: null, success: false, entity: null, reference: null, amount: null, paidAt: null, transactionId: null, conflicts: [], missing: [],
};

/** O valor em que pelo menos `quorum` leituras concordam. `clash` = o comprovativo mostra dois valores no mesmo sítio. */
function vote<T>(readings: T[][], quorum: number): { value: T | null; clash: boolean } {
  const tally = new Map<T, number>();
  let contradictory = 0;
  for (const values of readings.map(distinct)) {
    if (values.length > 1) contradictory++;
    else if (values.length === 1) tally.set(values[0], (tally.get(values[0]) ?? 0) + 1);
  }
  const winners = [...tally].filter(([, n]) => n >= quorum).map(([v]) => v);
  return { value: winners.length === 1 ? winners[0] : null, clash: contradictory >= quorum || winners.length > 1 };
}

/**
 * Junta as leituras do mesmo comprovativo. Com várias leituras de OCR, cada dado precisa
 * de duas iguais; o texto de um PDF é exato e basta uma (`quorum` 1).
 */
export function readReceiptText(texts: string[], quorum = Math.min(2, texts.length)): ReceiptReading {
  const scans = keep(texts.map(scan));
  const layout = vote(scans.map((s) => [s.layout]), quorum).value;
  if (!layout) return EMPTY;
  const same = scans.filter((s) => s.layout === layout);
  const at = <P extends Place>(place: P) => vote(same.map((s) => s[place] as Scan[P][number][]), quorum);

  const conflicts: ReceiptField[] = [];
  const missing: ReceiptField[] = [];
  /** Um dado lido num só sítio. */
  const single = <T,>(field: ReceiptField | null, v: { value: T | null; clash: boolean }): T | null => {
    if (field && v.clash) conflicts.push(field);
    else if (field && v.value === null) missing.push(field);
    return v.clash ? null : v.value;
  };
  /** Um dado que o modelo repete: campo e texto do recibo têm de ser lidos e coincidir. */
  const twice = <T,>(field: ReceiptField, a: { value: T | null; clash: boolean }, b: { value: T | null; clash: boolean }): T | null => {
    if (a.clash || b.clash || (a.value !== null && b.value !== null && a.value !== b.value)) {
      conflicts.push(field);
      return null;
    }
    if (a.value === null || b.value === null) missing.push(field);
    return a.value ?? b.value;
  };
  const repeats = layout !== "express_detail"; // os outros modelos repetem a referência e o valor no texto do recibo

  const success = single("success", at("success")) === true;
  if (!success && !conflicts.includes("success") && !missing.includes("success")) missing.push("success");
  return {
    layout,
    success,
    entity: single("entity", at("entity")),
    reference: repeats ? twice("reference", at("referenceField"), at("referenceBlock")) : single("reference", at("referenceField")),
    amount: repeats ? twice("amount", at("amountField"), at("amountBlock")) : single("amount", at("amountField")),
    paidAt: single("paidAt", at("paidAt")),
    transactionId: single(null, at("transactionId")),
    conflicts,
    missing,
  };
}
