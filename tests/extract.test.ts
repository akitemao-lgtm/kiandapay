import { describe, expect, it } from "vitest";
import type { TextLine } from "@/lib/proofs/analyze";
import { extractFields, guessBank, parseDateTime, parseMoney } from "@/lib/proofs/extract";
import { formatAngolanPhone, normalizeAngolanPhone } from "@/lib/phone";

const lines = (texts: string[]): TextLine[] => texts.map((text, i) => ({ text, x: 0.23, y: 0.1 + i * 0.03, page: 1 }));

describe("parseMoney", () => {
  it.each([
    ["5.000,00", 5000],
    ["5 000,00", 5000],
    ["5 000,00", 5000],
    ["5,000.00", 5000],
    ["5000", 5000],
    ["5.000", 5000],
    ["5000.5", 5000.5],
    ["AOA 5.000,50", 5000.5],
    ["5.000,00 Kz", 5000],
    ["1.250.000,99", 1250000.99],
  ])("%s → %d", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(["", "abc", "Kz", "12-34"])("rejeita %j", (input) => {
    expect(parseMoney(input)).toBeNull();
  });
});

describe("parseDateTime (hora de Angola → UTC)", () => {
  it.each([
    ["16/10/2026 17:05", "2026-10-16T16:05:00.000Z"],
    ["16-10-2026 às 17:05:30", "2026-10-16T16:05:30.000Z"],
    ["2026-10-16 15:13:58", "2026-10-16T14:13:58.000Z"],
    ["16 Out 2026 10:00", "2026-10-16T09:00:00.000Z"],
    ["16 de Outubro de 2026", "2026-10-15T23:00:00.000Z"],
    ["01/01/2027 00:30", "2026-12-31T23:30:00.000Z"],
  ])("%s → %s", (input, expected) => {
    expect(parseDateTime(input)).toBe(expected);
  });

  it("rejeita datas impossíveis", () => {
    expect(parseDateTime("32/13/2026")).toBeNull();
    expect(parseDateTime("sem data")).toBeNull();
  });
});

describe("extractFields", () => {
  it("lê um comprovativo do Multicaixa Express", () => {
    const l = lines([
      "Comprovativo Digital",
      "Detalhe da operação realizada através do canal MULTICAIXA Express.",
      "Data - Hora 2026-10-16 15:13:58",
      "Operação Pagamento de Serviços",
      "Entidade 10116 - PAYPAY ÁFRICA",
      "Referência 955567206",
      "Montante 5.000,00 Kz",
      "Transacção 21466518",
      "Descrição ** PAYPAY AFRICA REFERÊNCIA: 955 567 206 MONTANTE:",
    ]);
    const ex = extractFields(l, l.map((x) => x.text).join("\n"));
    expect(ex).toMatchObject({
      entity: "10116",
      reference: "955567206",
      amount: 5000,
      paidAt: "2026-10-16T14:13:58.000Z",
      transactionId: "21466518",
      bankGuess: "mcx_express",
    });
    expect(ex.positions.amount).toEqual({ x: 0.23, y: 0.28, page: 1 });
  });

  it("valor na linha seguinte ao rótulo e n.º de transação com outra grafia", () => {
    const l = lines([
      "BAI Directo",
      "Entidade:",
      "10116",
      "Referência:",
      "955 567 206",
      "Valor",
      "5 017,00 AOA",
      "Data da operação: 16/10/2026 17:20",
      "N.º da Transação: TRX-778899",
      "Ordenante: Maria João",
    ]);
    const ex = extractFields(l, l.map((x) => x.text).join("\n"));
    expect(ex).toMatchObject({
      entity: "10116",
      reference: "955567206",
      amount: 5017,
      paidAt: "2026-10-16T16:20:00.000Z",
      transactionId: "TRX-778899",
      payerName: "Maria João",
      bankGuess: "bai",
    });
  });

  it("ignora taxas, comissões e saldos ao procurar o montante", () => {
    const l = lines(["Comissão 150,00 Kz", "Saldo disponível 90.000,00", "Montante 5.000,00"]);
    expect(extractFields(l, "").amount).toBe(5000);
  });

  it("não confunde a referência nem a entidade com o n.º da transação", () => {
    const l = lines(["Entidade 10116", "Referência 955567206", "N.º Operação 955567206", "Transacção 4455667"]);
    expect(extractFields(l, "").transactionId).toBe("4455667");
  });

  it("devolve null para o que não encontra", () => {
    const ex = extractFields(lines(["Um documento qualquer"]), "Um documento qualquer");
    expect(ex).toMatchObject({ entity: null, reference: null, amount: null, paidAt: null, transactionId: null });
  });
});

describe("guessBank", () => {
  it.each([
    ["Operação no canal MULTICAIXA Express", "mcx_express"],
    ["Banco BIC — comprovativo", "bic"],
    ["Millennium Atlântico", "atlantico"],
    ["Texto sem banco", null],
  ])("%s → %s", (text, expected) => {
    expect(guessBank(text)).toBe(expected);
  });
});

describe("telefone angolano", () => {
  it.each([
    ["923 456 789", "244923456789"],
    ["+244 923456789", "244923456789"],
    ["00244923456789", "244923456789"],
    ["244923456789", "244923456789"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeAngolanPhone(input)).toBe(expected);
  });

  it.each(["823456789", "92345678", "+351912345678", ""])("rejeita %j", (input) => {
    expect(normalizeAngolanPhone(input)).toBeNull();
  });

  it("formata para mostrar", () => {
    expect(formatAngolanPhone("244923456789")).toBe("+244 923 456 789");
  });
});
