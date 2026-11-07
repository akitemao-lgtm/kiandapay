import { describe, expect, it } from "vitest";
import { kzTextFromRate, rateError, rateFromKzText } from "@/lib/currency/rate";

describe("taxa de conversão", () => {
  it("1200 Kz por USD dá o valor certo", () => {
    expect(10_000 * rateFromKzText("1200")!).toBeCloseTo(8.33, 2);
    expect(rateError("USD", rateFromKzText("1200"))).toBeNull();
  });
  it("aceita as formas habituais de escrever o número", () => {
    for (const text of ["1200", "1 200", "1.200", "1200,00", "1200.00"]) expect(rateFromKzText(text)).toBeCloseTo(1 / 1200, 10);
    expect(rateFromKzText("1200,5")).toBeCloseTo(1 / 1200.5, 10);
  });
  it("não aceita texto vazio, inválido ou zero", () => {
    for (const text of ["", "abc", "0", "-5"]) expect(rateFromKzText(text)).toBeNull();
  });
  it("mostra de novo o valor escrito, depois de guardado com 8 casas", () => {
    expect(kzTextFromRate(0.00083333)).toBe("1200");
    expect(kzTextFromRate(null)).toBe("");
  });
  it("avisa quando o valor escrito foi a taxa inversa", () => {
    expect(rateError("USD", rateFromKzText("0,00083333"))).toContain("1 USD");
    expect(rateError("USD", 1200)).not.toBeNull();
  });
  it("aceita moedas em que 1 Kz vale mais de 1", () => {
    expect(rateError("COP", rateFromKzText("0,22"))).toBeNull();
    expect(rateError("PYG", rateFromKzText("0,12"))).toBeNull();
    expect(rateError("COP", 1200)).not.toBeNull();
  });
  it("ignora Kwanza e taxas por preencher", () => {
    expect(rateError("AOA", 1200)).toBeNull();
    expect(rateError("USD", null)).toBeNull();
  });
});
