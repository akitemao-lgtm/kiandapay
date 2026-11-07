import { describe, expect, it } from "vitest";
import { rateError } from "@/lib/currency/rate";

describe("taxa de conversão", () => {
  it("recusa a taxa escrita ao contrário e sugere a certa", () => {
    expect(rateError("USD", 1200)).toContain("escreva 0.00083333");
    expect(rateError("EUR", 1000)).toContain("escreva 0.001");
  });
  it("aceita taxas plausíveis", () => {
    expect(rateError("USD", 0.00083333)).toBeNull();
    expect(rateError("BRL", 0.006)).toBeNull();
    expect(rateError("ZAR", 0.02)).toBeNull();
  });
  it("aceita moedas em que 1 Kz vale mais de 1", () => {
    expect(rateError("COP", 4.5)).toBeNull();
    expect(rateError("PYG", 8)).toBeNull();
    expect(rateError("ARS", 1.5)).toBeNull();
    expect(rateError("COP", 1200)).not.toBeNull();
  });
  it("ignora Kwanza e taxas por preencher", () => {
    expect(rateError("AOA", 1200)).toBeNull();
    expect(rateError("USD", null)).toBeNull();
  });
});
