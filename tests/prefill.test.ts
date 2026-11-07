import { describe, expect, it } from "vitest";
import { readPrefill } from "@/lib/checkout/prefill";

describe("readPrefill", () => {
  it("lê nome e telefone em português", () => {
    expect(readPrefill({ nome: "Daniel da Silva", telefone: "921234567" })).toEqual({
      name: "Daniel da Silva",
      email: "",
      phone: "921234567",
    });
  });

  it("aceita os nomes alternativos e o primeiro valor repetido", () => {
    expect(readPrefill({ name: ["Ana", "Outra"], phone: "+244 923 000 111", email: "ana@x.ao" })).toEqual({
      name: "Ana",
      email: "ana@x.ao",
      phone: "+244 923 000 111",
    });
  });

  it("limpa espaços e caracteres de controlo e corta valores compridos", () => {
    const r = readPrefill({ nome: "  Ana\n\tMaria  ", telefone: "9".repeat(50) });
    expect(r.name).toBe("Ana Maria");
    expect(r.phone).toHaveLength(20);
  });

  it("devolve vazio sem parâmetros", () => {
    expect(readPrefill({})).toEqual({ name: "", email: "", phone: "" });
  });
});
