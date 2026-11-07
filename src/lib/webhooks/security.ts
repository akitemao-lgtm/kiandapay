import { createHmac, randomBytes } from "node:crypto";
import net from "node:net";

const blocked = new net.BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(ip, bits, "ipv4");
for (const [ip, bits] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(ip, bits, "ipv6");

export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (!family) return false;
  return !blocked.check(ip, family === 6 ? "ipv6" : "ipv4");
}

/** Só https e nunca a rede interna do servidor. O endereço final é revisto ao ligar. */
export function webhookUrlError(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "URL inválido.";
  }
  if (url.protocol !== "https:") return "O URL tem de começar por https://";
  if (raw.length > 500) return "URL demasiado comprido.";
  if (url.username || url.password) return "O URL não pode incluir utilizador nem palavra-passe.";
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIP(host)) return isPublicAddress(host) ? null : "Este endereço não é permitido.";
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host)) {
    return "Este endereço não é permitido.";
  }
  return null;
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

/** Quem recebe recalcula isto sobre "<timestamp>.<corpo>" para confirmar a origem. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

const RETRY_MINUTES = [1, 5, 30, 120, 720];
export const MAX_WEBHOOK_ATTEMPTS = RETRY_MINUTES.length + 1;

/** Minutos até à próxima tentativa, ou null quando já se esgotaram. */
export function retryDelayMinutes(attempts: number): number | null {
  return RETRY_MINUTES[attempts - 1] ?? null;
}
