export type MessageChannel = "sms" | "whatsapp" | "email";
export const CHANNEL_LABELS: Record<MessageChannel, string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
};
