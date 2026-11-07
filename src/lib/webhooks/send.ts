import "server-only";
import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import { isPublicAddress, webhookUrlError } from "./security";

const TIMEOUT_MS = 10_000;

export type SendResult = { ok: boolean; status: number | null; error: string | null };

/** Valida o IP no momento de ligar: um domínio não pode apontar depois para a rede interna. */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
      return callback(Object.assign(new Error("endereço não permitido"), { code: "EBLOCKED" }), "", 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

/** Não segue redirecionamentos: podiam levar a um endereço interno. */
export function postWebhook(rawUrl: string, body: string, headers: Record<string, string>): Promise<SendResult> {
  const invalid = webhookUrlError(rawUrl);
  if (invalid) return Promise.resolve({ ok: false, status: null, error: invalid });
  const url = new URL(rawUrl);

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: url.hostname.replace(/^\[|\]$/g, ""), port: url.port || 443, path: url.pathname + url.search,
        method: "POST", lookup: guardedLookup, agent: false,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "User-Agent": "KiandaPay-Webhook/1.0", ...headers },
      },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        const ok = status >= 200 && status < 300;
        clearTimeout(timer);
        req.destroy();
        resolve({ ok, status, error: ok ? null : `O servidor respondeu ${status}` });
      },
    );
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), TIMEOUT_MS);
    req.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ ok: false, status: null, error: describeError(e) });
    });
    req.end(body);
  });
}

function describeError(e: NodeJS.ErrnoException): string {
  if (e.code === "EBLOCKED") return "Endereço não permitido";
  if (e.code === "ETIMEOUT") return "Sem resposta em 10 segundos";
  if (e.code === "ENOTFOUND" || e.code === "EAI_AGAIN") return "Domínio não encontrado";
  if (e.code === "ECONNREFUSED") return "Ligação recusada";
  if (e.code?.startsWith("ERR_TLS") || e.code?.includes("CERT")) return "Certificado HTTPS inválido";
  return "Não foi possível ligar ao servidor";
}
