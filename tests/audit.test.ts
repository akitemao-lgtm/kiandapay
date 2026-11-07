import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  parseCsv, parseXlsx, pdfLinesToTable, signedMoney, statementDate, suggestMapping, toMovements, type Movement,
} from "@/lib/audit/parse";
import { reconcile, type PaidOrder } from "@/lib/audit/reconcile";
import type { TextLine } from "@/lib/proofs/analyze";

const CSV = `Banco Exemplo SA;;;;
Extrato de conta 0055 0000 8978;;;;
Data Mov.;Data Valor;Descrição;Débito;Crédito
14/10/2026;14/10/2026;PAG REF 10116 955567206 TRX 21466518;;5.017,00
14/10/2026;14/10/2026;LEVANTAMENTO ATM;20.000,00;
15/10/2026;16/10/2026;PAG REF 10116 955567206;;5.042,00
16/10/2026;16/10/2026;"TRANSF. RECEBIDA; JOAO";;12.000,00
`;

describe("valores e datas do extrato", () => {
  it.each([
    ["5.017,00", 5017],
    ["-3.000,00", -3000],
    ["3.000,00-", -3000],
    ["(1 500,00)", -1500],
    ["2.000,00 D", -2000],
    ["2.000,00 C", 2000],
    ["7500", 7500],
    ["12,000.50", 12000.5],
    ["", null],
  ])("signedMoney(%j) = %s", (input, expected) => expect(signedMoney(input)).toBe(expected));

  it.each([
    ["14/10/2026", "2026-10-14"],
    ["14-10-26", "2026-10-14"],
    ["2026-10-14", "2026-10-14"],
    ["2026-10-14T00:00:00.000Z", "2026-10-14"],
    ["14 Out 2026", "2026-10-14"],
    ["46309", "2026-10-14"], // n.º de série do Excel
    ["31/02/x", null],
  ])("statementDate(%j) = %s", (input, expected) => expect(statementDate(input)).toBe(expected));
});

describe("CSV", () => {
  const t = parseCsv(CSV);

  it("ignora os títulos do banco e encontra o cabeçalho", () => {
    expect(t.headers).toEqual(["Data Mov.", "Data Valor", "Descrição", "Débito", "Crédito"]);
    expect(t.rows).toHaveLength(4);
  });

  it("respeita aspas com o separador lá dentro", () => {
    expect(t.rows[3][2]).toBe("TRANSF. RECEBIDA; JOAO");
  });

  it("sugere data, crédito e descrição", () => {
    expect(suggestMapping(t)).toEqual({ date: 0, amount: 4, description: 2, reference: null, amountMode: "credit" });
  });

  it("só fica com as entradas de dinheiro", () => {
    const mv = toMovements(t, suggestMapping(t));
    expect(mv.map((m) => [m.date, m.amount])).toEqual([
      ["2026-10-14", 5017],
      ["2026-10-15", 5042],
      ["2026-10-16", 12000],
    ]);
  });

  it("aceita vírgula como separador e BOM do Excel", () => {
    const c = parseCsv("﻿Date,Description,Amount\n2026-10-14,Pagamento,5017.00\n2026-10-15,Levantamento,-200.00\n");
    const mv = toMovements(c, suggestMapping(c));
    expect(mv.map((m) => m.amount)).toEqual([5017]);
  });
});

describe("Excel", () => {
  it("lê a folha, ignora o título e usa a coluna Montante (com sinal), não o Saldo", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Movimentos");
    ws.addRow(["Extrato PayPay"]);
    ws.addRow([]);
    ws.addRow(["Data", "Descrição", "Montante", "Saldo"]);
    ws.addRow([new Date(Date.UTC(2026, 9, 14)), "Carregamento", 5017, 10000]);
    ws.addRow([new Date(Date.UTC(2026, 9, 15)), "Pagamento serviço", -3000, 7000]);
    const t = await parseXlsx(new Uint8Array(await wb.xlsx.writeBuffer()));
    const m = suggestMapping(t);
    expect(t.headers).toEqual(["Data", "Descrição", "Montante", "Saldo"]);
    expect(m).toMatchObject({ date: 0, amount: 2, amountMode: "signed" });
    expect(toMovements(t, m).map((x) => [x.date, x.amount])).toEqual([["2026-10-14", 5017]]);
  });
});

describe("PDF", () => {
  it("transforma as linhas com data em movimentos", () => {
    const lines: TextLine[] = [
      "EXTRATO DE CONTA",
      "14/10/2026 PAG REF 955567206 TRX 21466518 5.017,00 10.000,00",
      "16/10/2026 PAG REF 955567206 5.042,00 12.042,00",
    ].map((text, i) => ({ text, x: 0, y: i / 10, page: 1 }));
    const t = pdfLinesToTable(lines);
    expect(t.rows).toEqual([
      ["14/10/2026", "PAG REF 955567206 TRX 21466518", "5.017,00", "10.000,00", ""],
      ["16/10/2026", "PAG REF 955567206", "5.042,00", "12.042,00", ""],
    ]);
  });
});

describe("cruzamento com os pedidos", () => {
  const mv = (row: number, date: string, amount: number, description = ""): Movement => ({ row, date, amount, description, reference: null, raw: [] });
  const order = (id: string, amount: number, paidDate: string, transactionId: string | null = null): PaidOrder => ({ id, amount, paidDate, transactionId });

  it("confirma, deteta em falta e deixa de fora o que está fora do período", () => {
    const r = reconcile(
      [order("A", 5017, "2026-10-14"), order("B", 5042, "2026-10-15"), order("C", 5033, "2026-10-15"), order("D", 5000, "2026-09-01")],
      [mv(0, "2026-10-14", 5017), mv(1, "2026-10-16", 5042), mv(2, "2026-10-16", 12000), mv(3, "2026-10-20", 900)],
    );
    expect(r.matches).toEqual([{ orderId: "A", row: 0 }, { orderId: "B", row: 1 }]);
    expect(r.missing).toEqual(["C"]);
    expect(r.outside).toEqual(["D"]);
    expect(r.unmatchedRows).toEqual([2, 3]);
    expect(r.period).toEqual({ from: "2026-10-14", to: "2026-10-20" });
  });

  it("o valor tem de ser exato ao cêntimo", () => {
    const r = reconcile([order("A", 5017, "2026-10-14")], [mv(0, "2026-10-14", 5017.01), mv(1, "2026-10-21", 1)]);
    expect(r.missing).toEqual(["A"]);
  });

  it("aceita até 3 dias de diferença, não mais", () => {
    // Pago a 14, lançado pelo banco a 17 (primeiro dia do extrato): confirmado.
    expect(reconcile([order("A", 5000, "2026-10-14")], [mv(0, "2026-10-17", 5000)]).matches).toHaveLength(1);
    // Pago a 14, entrada só a 18: não corresponde; como já devia ter aparecido, fica em falta.
    const far = reconcile([order("A", 5000, "2026-10-14")], [mv(0, "2026-10-10", 1), mv(1, "2026-10-18", 5000), mv(2, "2026-10-25", 1)]);
    expect(far.missing).toEqual(["A"]);
  });

  it("não acusa falta de pedidos pagos nos últimos dias do extrato (o banco pode lançar depois)", () => {
    const r = reconcile([order("A", 5000, "2026-10-19")], [mv(0, "2026-10-14", 1), mv(1, "2026-10-20", 2)]);
    expect(r.missing).toEqual([]);
    expect(r.outside).toEqual(["A"]);
  });

  it("um movimento só serve um pedido (dois pedidos iguais, uma entrada)", () => {
    const r = reconcile([order("A", 5000, "2026-10-14"), order("B", 5000, "2026-10-14")], [mv(0, "2026-10-14", 5000), mv(1, "2026-10-21", 1)]);
    expect(r.matches).toHaveLength(1);
    expect(r.missing).toHaveLength(1);
  });

  it("o n.º da transação na descrição tem prioridade sobre a data mais próxima", () => {
    const r = reconcile(
      [order("A", 5000, "2026-10-14", "TRX-21466518")],
      [mv(0, "2026-10-14", 5000, "PAGAMENTO"), mv(1, "2026-10-15", 5000, "PAG TRX 21466518")],
    );
    expect(r.matches).toEqual([{ orderId: "A", row: 1 }]);
  });

  it("pedidos com menos alternativas escolhem primeiro", () => {
    // A só pode usar a linha 0; B pode usar 0 ou 1 → ambos ficam confirmados.
    const r = reconcile(
      [order("B", 5000, "2026-10-15"), order("A", 5000, "2026-10-11")],
      [mv(0, "2026-10-13", 5000), mv(1, "2026-10-17", 5000)],
    );
    expect(r.missing).toEqual([]);
    expect(r.matches).toHaveLength(2);
  });

  it("extrato vazio: nada é avaliado", () => {
    expect(reconcile([order("A", 1, "2026-10-14")], [])).toMatchObject({ matches: [], missing: [], outside: ["A"], period: null });
  });
});
