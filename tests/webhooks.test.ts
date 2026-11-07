import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { postWebhook } from "@/lib/webhooks/send";
import { isPublicAddress, MAX_WEBHOOK_ATTEMPTS, retryDelayMinutes, signWebhook, webhookUrlError } from "@/lib/webhooks/security";

describe("endereços bloqueados", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
    "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "não-é-ip",
  ])("%s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("%s é público", (ip) => expect(isPublicAddress(ip)).toBe(true));
});

describe("validação do URL", () => {
  it.each([
    "http://exemplo.com/x", "ftp://exemplo.com", "nada", "https://localhost/x", "https://servidor/x", "https://db.internal/x",
    "https://user:senha@exemplo.com", "https://127.0.0.1/x", "https://[::1]/x", "https://2130706433/x", "https://0x7f.0.0.1/x",
    "https://169.254.169.254/latest/meta-data",
  ])("recusa %s", (url) => expect(webhookUrlError(url)).not.toBeNull());

  it.each(["https://exemplo.com/webhook?a=1", "https://hooks.zapier.com/hooks/catch/1/2", "https://n8n.exemplo.com:8443/webhook"])(
    "aceita %s",
    (url) => expect(webhookUrlError(url)).toBeNull(),
  );
});

describe("envio", () => {
  it("nunca liga a um endereço interno", async () => {
    await expect(postWebhook("https://127.0.0.1:9/x", "{}", {})).resolves.toMatchObject({ ok: false, status: null });
  });

  it("bloqueia um domínio que aponta para a rede interna ao ligar", async () => {
    // "localhost." passa na validação do texto; o bloqueio tem de vir do DNS ao ligar.
    expect(webhookUrlError("https://localhost./x")).toBeNull();
    await expect(postWebhook("https://localhost.:9/x", "{}", {})).resolves.toMatchObject({ ok: false, error: "Endereço não permitido" });
  });
});

describe("assinatura e tentativas", () => {
  it("assina o timestamp e o corpo", () => {
    const expected = createHmac("sha256", "s").update("123.{}").digest("hex");
    expect(signWebhook("s", 123, "{}")).toBe(`sha256=${expected}`);
    expect(signWebhook("s", 124, "{}")).not.toBe(signWebhook("s", 123, "{}"));
  });

  it("para ao fim de 6 tentativas", () => {
    expect(MAX_WEBHOOK_ATTEMPTS).toBe(6);
    expect(retryDelayMinutes(1)).toBe(1);
    expect(retryDelayMinutes(5)).toBe(720);
    expect(retryDelayMinutes(6)).toBeNull();
  });
});
