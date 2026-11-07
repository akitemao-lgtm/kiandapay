import { describe, expect, it } from "vitest";
import { readOptions } from "@/lib/checkout/defaults";
import { readCustomer, type CustomerFields } from "@/lib/checkout/customer";

const all = (mode: CustomerFields["nameField"]): CustomerFields => ({ nameField: mode, emailField: mode, phoneField: mode });
const filled = { name: "  Ana   Silva ", email: " ana@x.co ", phone: "923 456 789" };
const empty = { name: "", email: "", phone: "" };

describe("campos do checkout", () => {
  it("por omissão, os checkouts existentes continuam a pedir tudo", () => {
    expect(readOptions(null)).toMatchObject({ nameField: "required", emailField: "required", phoneField: "required" });
    expect(readOptions({ options: { emailField: "hidden" } })).toMatchObject({ nameField: "required", phoneField: "required", emailField: "hidden" });
  });
  it("lê as opções guardadas e ignora valores desconhecidos", () => {
    const o = readOptions({ options: { nameField: "hidden", phoneField: "optional" } });
    expect(o).toMatchObject({ nameField: "hidden", phoneField: "optional" });
    expect(readOptions({ options: { nameField: "x", phoneField: "y" } as never })).toMatchObject({ nameField: "required", phoneField: "required" });
  });
  it("campos obrigatórios têm de vir preenchidos", () => {
    expect(Object.keys(readCustomer(empty, all("required")).errors).sort()).toEqual(["email", "name", "phone"]);
  });
  it("normaliza os valores", () => {
    const { customer, errors } = readCustomer(filled, all("required"));
    expect(errors).toEqual({});
    expect(customer).toEqual({ name: "Ana Silva", email: "ana@x.co", phone: "244923456789" });
  });
  it("campos opcionais podem ficar vazios, mas se vierem têm de ser válidos", () => {
    expect(readCustomer(empty, all("optional"))).toEqual({ customer: { name: null, email: null, phone: null }, errors: {} });
    expect(Object.keys(readCustomer({ name: "A", email: "x", phone: "123" }, all("optional")).errors).sort()).toEqual(["email", "name", "phone"]);
  });
  it("campos desativados são ignorados, mesmo preenchidos ou inválidos", () => {
    expect(readCustomer({ name: "A", email: "x", phone: "123" }, all("hidden"))).toEqual({ customer: { name: null, email: null, phone: null }, errors: {} });
    expect(readCustomer(filled, all("hidden")).customer).toEqual({ name: null, email: null, phone: null });
  });
});
