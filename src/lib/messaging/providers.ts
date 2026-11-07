import "server-only";
import type { MessageChannel } from "./types";

export type SendResult = { provider: string; id: string | null };
type Sender = (to: string, body: string, subject: string) => Promise<SendResult>;

/**
 * Provedores configuráveis por variável de ambiente:
 *   SMS_PROVIDER      = twilio | log
 *   WHATSAPP_PROVIDER = twilio | log
 *   EMAIL_PROVIDER    = resend | log
 * "log" só escreve na consola do servidor (útil em desenvolvimento).
 */
const log: Sender = async (to, body, subject) => {
  console.info(`[mensagem] para ${to}${subject ? ` — ${subject}` : ""}\n${body}`);
  return { provider: "log", id: null };
};

function twilio(channel: "sms" | "whatsapp"): Sender {
  return async (to, body) => {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = channel === "sms" ? process.env.TWILIO_SMS_FROM : process.env.TWILIO_WHATSAPP_FROM;
    if (!sid || !token || !from) throw new Error(`Twilio (${channel}) sem credenciais`);
    const prefix = channel === "whatsapp" ? "whatsapp:" : "";
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: `${prefix}+${to}`, From: `${prefix}${from}`, Body: body }),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${json.message ?? "erro"}`);
    return { provider: "twilio", id: json.sid ?? null };
  };
}

const resend: Sender = async (to, body, subject) => {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) throw new Error("Resend sem RESEND_API_KEY/EMAIL_FROM");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text: body }),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) throw new Error(`Resend ${res.status}: ${json.message ?? "erro"}`);
  return { provider: "resend", id: json.id ?? null };
};

export function getSender(channel: MessageChannel): Sender | null {
  const name = {
    sms: process.env.SMS_PROVIDER,
    whatsapp: process.env.WHATSAPP_PROVIDER,
    email: process.env.EMAIL_PROVIDER,
  }[channel];
  if (name === "log") return log;
  if (name === "twilio" && channel !== "email") return twilio(channel);
  if (name === "resend" && channel === "email") return resend;
  return null;
}
