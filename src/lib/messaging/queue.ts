import "server-only";
import { formatKz } from "@/lib/format";
import type { Settings } from "@/lib/settings";
import { orderStatusUrl } from "@/lib/site";
import type { ServiceDb } from "@/lib/supabase/service";
import { getSender } from "./providers";

type OrderForMessages = {
  id: string;
  order_number: number;
  public_token: string;
  customer_phone: string | null;
  customer_email: string | null;
  amount_due: number;
  product_name: string;
};

/** SMS e WhatsApp, só para quem deixou telefone. */
function phoneMessages(settings: Settings, phone: string | null) {
  if (!phone) return [];
  return settings.lead_channels.filter((c) => c !== "email").map((channel) => ({ channel, recipient: phone }));
}

/** Link da página do pedido (imediato) + lembrete opcional (agendado). */
export async function queueOrderMessages(db: ServiceDb, order: OrderForMessages, settings: Settings) {
  const link = orderStatusUrl(order.public_token);
  // Agendar com o relógio da app (o mesmo que o envio usa), não com o now() da BD:
  // uma pequena diferença entre os dois relógios atrasaria o envio imediato.
  const now = new Date().toISOString();
  const shop = settings.site_name || "Loja";
  const amount = formatKz(order.amount_due);
  const text =
    `${shop}: o seu pedido #${order.order_number} (${amount}) foi criado. ` +
    `Pague por referência e envie o comprovativo nesta página: ${link}`;

  const rows: Record<string, unknown>[] = phoneMessages(settings, order.customer_phone).map((to) => ({
    ...to, order_id: order.id, audience: "lead", template: "status_link", body: text, scheduled_for: now,
  }));

  if (order.customer_email) {
    rows.push({
      order_id: order.id, audience: "lead", channel: "email", template: "status_link",
      recipient: order.customer_email, scheduled_for: now,
      body:
        `Olá,\n\nO seu pedido #${order.order_number} — ${order.product_name} (${amount}) foi criado.\n\n` +
        `Guarde este link. É nele que paga, envia o comprovativo e, depois de confirmado, acede ao produto:\n${link}\n\n${shop}`,
    });
  }

  if (settings.reminder_enabled) {
    const at = new Date(Date.now() + settings.reminder_after_minutes * 60_000).toISOString();
    for (const to of phoneMessages(settings, order.customer_phone)) {
      rows.push({
        ...to, order_id: order.id, audience: "lead", template: "reminder",
        scheduled_for: at,
        body: `${shop}: ainda não recebemos o comprovativo do pedido #${order.order_number}. Já pagou? Envie aqui: ${link}`,
      });
    }
  }

  if (rows.length) {
    const { error } = await db.from("outbound_messages").insert(rows);
    if (error) console.error("[mensagens] fila", error);
  }
}

type LeadContact = { id: string; order_number: number; public_token: string; customer_phone: string | null; customer_email: string | null };

/** Mensagem curta ao lead, com o link da página do pedido, pelos canais configurados. */
export async function queueLeadNotice(db: ServiceDb, order: LeadContact, settings: Settings, template: string, text: string) {
  const link = orderStatusUrl(order.public_token);
  const shop = settings.site_name || "Loja";
  const body = `${shop}: ${text} ${link}`;
  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = phoneMessages(settings, order.customer_phone).map((to) => ({
    ...to, order_id: order.id, audience: "lead", template, body, scheduled_for: now,
  }));
  if (order.customer_email) {
    rows.push({ order_id: order.id, audience: "lead", channel: "email", template, recipient: order.customer_email, body, scheduled_for: now });
  }
  if (rows.length) await db.from("outbound_messages").insert(rows);
}

/** Pagamento confirmado (útil sobretudo quando é aprovado nas Exceções e o lead já saiu da página). */
export async function queuePaidMessage(db: ServiceDb, order: LeadContact, settings: Settings) {
  await queueLeadNotice(db, order, settings, "paid", `pagamento do pedido #${order.order_number} confirmado. Aceda ao seu produto aqui:`);
}

/** Notificação ao administrador pelos canais escolhidos nas Configurações. */
export async function queueAdminMessage(
  db: ServiceDb,
  settings: Settings,
  msg: { template: string; body: string; orderId?: string | null },
) {
  const now = new Date().toISOString();
  const rows = settings.admin_channels
    .map((channel) => {
      const recipient = channel === "email" ? settings.admin_email : settings.admin_phone?.replace(/\D/g, "");
      return recipient
        ? { order_id: msg.orderId ?? null, audience: "admin", channel, template: msg.template, recipient, body: msg.body, scheduled_for: now }
        : null;
    })
    .filter(Boolean);
  if (rows.length) await db.from("outbound_messages").insert(rows);
}

/** Cancela lembretes pendentes (o lead já enviou comprovativo ou o pedido foi pago). */
export async function cancelReminders(db: ServiceDb, orderId: string) {
  await db
    .from("outbound_messages")
    .update({ status: "cancelled" })
    .eq("order_id", orderId)
    .eq("template", "reminder")
    .eq("status", "scheduled");
}

const SUBJECTS: Record<string, string> = {
  status_link: "O seu pedido",
  reminder: "Falta enviar o comprovativo",
  paid: "Pagamento confirmado",
  admin_exception: "Comprovativo para analisar",
  rejected: "Comprovativo não confirmado",
};

/** Envia mensagens agendadas que já estão no prazo. Seguro para correr em paralelo. */
export async function dispatchDueMessages(db: ServiceDb, limit = 25): Promise<number> {
  const { data: due } = await db
    .from("outbound_messages")
    .select("id, order_id, channel, template, recipient, body")
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for")
    .limit(limit);

  let sent = 0;
  for (const m of due ?? []) {
    // Reivindica a mensagem: só um processo consegue passar de scheduled → sent.
    const { data: claimed } = await db
      .from("outbound_messages")
      .update({ status: "sent" })
      .eq("id", m.id)
      .eq("status", "scheduled")
      .select("id");
    if (!claimed?.length) continue;

    if (m.template === "reminder" && m.order_id) {
      const { data: o } = await db.from("orders").select("status, upload_count").eq("id", m.order_id).maybeSingle();
      if (!o || o.status !== "awaiting_payment" || o.upload_count > 0) {
        await db.from("outbound_messages").update({ status: "cancelled" }).eq("id", m.id);
        continue;
      }
    }

    const sender = getSender(m.channel);
    try {
      if (!sender) throw new Error(`Canal ${m.channel} sem provedor configurado`);
      const r = await sender(m.recipient, m.body, SUBJECTS[m.template] ?? "Mensagem");
      await db
        .from("outbound_messages")
        .update({ sent_at: new Date().toISOString(), provider: r.provider, provider_message_id: r.id })
        .eq("id", m.id);
      sent++;
    } catch (e) {
      await db.from("outbound_messages").update({ status: "failed", error: (e as Error).message.slice(0, 500) }).eq("id", m.id);
    }
  }
  return sent;
}
