"use client";

import { safeAction } from "@/lib/client/safe-action";
import { useState, useTransition } from "react";
import { saveLegalPage, saveSettings } from "@/app/admin/(painel)/configuracoes/actions";
import { buttonPrimary, cardClass, errorClass, hintClass, inputClass, labelClass } from "@/components/ui/styles";
import { CHANNEL_LABELS, type MessageChannel } from "@/lib/messaging/types";
import type { ActionResult } from "@/lib/products/types";
import { formatReference, type Settings } from "@/lib/settings";
import type { SettingsInput } from "@/lib/settings-schema";

type Legal = { slug: "privacidade" | "termos"; title: string; body_md: string };

function NumberField({
  id, label, value, onChange, hint, error, min, suffix,
}: {
  id: string; label: string; value: number; onChange: (n: number) => void;
  hint?: string; error?: string; min?: number; suffix?: string;
}) {
  return (
    <div>
      <label className={labelClass} htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          value={Number.isNaN(value) ? "" : value}
          onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
          className={`${inputClass} max-w-[8rem]`}
        />
        {suffix && <span className="text-sm text-gray-500">{suffix}</span>}
      </div>
      {error ? <p className={errorClass}>{error}</p> : hint && <p className={hintClass}>{hint}</p>}
    </div>
  );
}

function ChannelPicker({
  value, options, onChange,
}: { value: MessageChannel[]; options: MessageChannel[]; onChange: (v: MessageChannel[]) => void }) {
  return (
    <div className="flex flex-wrap gap-3">
      {options.map((c) => (
        <label key={c} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={value.includes(c)}
            onChange={(e) => onChange(e.target.checked ? [...value, c] : value.filter((x) => x !== c))}
            className="h-4 w-4"
          />
          {CHANNEL_LABELS[c]}
        </label>
      ))}
    </div>
  );
}

function SaveBar({ pending, result }: { pending: boolean; result: ActionResult | null }) {
  return (
    <div className="flex items-center justify-end gap-3 pt-2">
      {result && (
        <p className={`flex-1 text-sm ${result.ok ? "text-green-700" : "text-red-600"}`}>
          {result.ok ? result.message : result.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={buttonPrimary}>
        {pending ? "A guardar…" : "Guardar"}
      </button>
    </div>
  );
}

export function SettingsForm({
  settings, legal, showPaymentFields,
}: { settings: Settings; legal: Legal[]; showPaymentFields: boolean }) {
  const [v, setV] = useState<SettingsInput>({
    paymentEntity: settings.payment_entity,
    paymentReference: formatReference(settings.payment_reference),
    orderTtlMinutes: settings.order_ttl_minutes,
    uploadGraceHours: settings.upload_grace_hours,
    uniqueAmountEnabled: settings.unique_amount_enabled,
    maxUploadsPerOrder: settings.max_uploads_per_order,
    maxUploadsPerPhone: settings.max_uploads_per_phone,
    phoneUploadWindowHours: settings.phone_upload_window_hours,
    leadChannels: settings.lead_channels.filter((c): c is "sms" | "whatsapp" => c !== "email"),
    reminderEnabled: settings.reminder_enabled,
    reminderAfterMinutes: settings.reminder_after_minutes,
    adminChannels: settings.admin_channels,
    adminEmail: settings.admin_email ?? "",
    adminPhone: settings.admin_phone ?? "",
    siteName: settings.site_name,
    supportPhone: settings.support_phone ?? "",
  });
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const set = <K extends keyof SettingsInput>(k: K, value: SettingsInput[K]) => setV((s) => ({ ...s, [k]: value }));
  const notConfigured = !settings.payment_entity || !settings.payment_reference;

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setResult(null);
          const input = showPaymentFields ? v : { ...v, paymentEntity: undefined, paymentReference: undefined };
          start(async () => setResult(await safeAction(() => saveSettings(input))));
        }}
        className="space-y-6"
      >
        {showPaymentFields && <section className={`${cardClass} space-y-4`}>
          <div>
            <h2 className="font-semibold">Pagamento por referência</h2>
            <p className={hintClass}>Iguais para todos os pedidos. Aparecem no ecrã de pagamento.</p>
          </div>
          {notConfigured && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Enquanto a Entidade e a Referência não estiverem preenchidas, o checkout não aceita pedidos.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="entity">Entidade</label>
              <input id="entity" inputMode="numeric" value={v.paymentEntity} onChange={(e) => set("paymentEntity", e.target.value)} placeholder="00000" className={`${inputClass} font-mono`} />
              {errors.paymentEntity && <p className={errorClass}>{errors.paymentEntity}</p>}
            </div>
            <div>
              <label className={labelClass} htmlFor="reference">Referência</label>
              <input id="reference" inputMode="numeric" value={v.paymentReference} onChange={(e) => set("paymentReference", e.target.value)} placeholder="000 000 000" className={`${inputClass} font-mono`} />
              {errors.paymentReference && <p className={errorClass}>{errors.paymentReference}</p>}
            </div>
          </div>
        </section>}

        <section className={`${cardClass} space-y-4`}>
          <h2 className="font-semibold">Pedidos</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField id="ttl" label="Validade do pedido" suffix="minutos" value={v.orderTtlMinutes} onChange={(n) => set("orderTtlMinutes", n)} hint="1440 = 24 horas. Pagamentos depois deste prazo não são aprovados automaticamente." error={errors.orderTtlMinutes} />
            <NumberField id="grace" label="Tolerância para enviar comprovativo" suffix="horas" value={v.uploadGraceHours} onChange={(n) => set("uploadGraceHours", n)} hint="Quem pagou dentro do prazo ainda pode enviar o comprovativo durante este tempo." error={errors.uploadGraceHours} />
          </div>
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={v.uniqueAmountEnabled} onChange={(e) => set("uniqueAmountEnabled", e.target.checked)} className="mt-0.5 h-5 w-5" />
            <span className="text-sm">
              <span className="font-medium">Valor único por pedido</span>
              <span className="block text-gray-500">Soma 1 a 99 Kz aleatórios ao preço, sem repetir entre pedidos pendentes. Ajuda a cruzar com o extrato.</span>
            </span>
          </label>
        </section>

        <section className={`${cardClass} space-y-4`}>
          <h2 className="font-semibold">Proteção contra abuso</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField id="upo" label="Envios por pedido" min={1} value={v.maxUploadsPerOrder} onChange={(n) => set("maxUploadsPerOrder", n)} error={errors.maxUploadsPerOrder} />
            <NumberField id="upp" label="Envios por telefone" min={1} value={v.maxUploadsPerPhone} onChange={(n) => set("maxUploadsPerPhone", n)} error={errors.maxUploadsPerPhone} />
            <NumberField id="upw" label="Janela por telefone" suffix="horas" min={1} value={v.phoneUploadWindowHours} onChange={(n) => set("phoneUploadWindowHours", n)} error={errors.phoneUploadWindowHours} />
          </div>
        </section>

        <section className={`${cardClass} space-y-4`}>
          <div>
            <h2 className="font-semibold">Mensagens ao cliente</h2>
            <p className={hintClass}>Enviamos sempre o link da página do pedido, nunca o produto. Por email, só se o cliente o indicar.</p>
          </div>
          <ChannelPicker value={v.leadChannels as MessageChannel[]} options={["sms", "whatsapp"]} onChange={(c) => set("leadChannels", c as ("sms" | "whatsapp")[])} />
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={v.reminderEnabled} onChange={(e) => set("reminderEnabled", e.target.checked)} className="h-5 w-5" />
            <span className="text-sm">Enviar lembrete se o pedido continuar sem comprovativo</span>
          </label>
          {v.reminderEnabled && (
            <NumberField id="rem" label="Lembrete após" suffix="minutos" min={5} value={v.reminderAfterMinutes} onChange={(n) => set("reminderAfterMinutes", n)} error={errors.reminderAfterMinutes} />
          )}
        </section>

        <section className={`${cardClass} space-y-4`}>
          <div>
            <h2 className="font-semibold">Notificações para mim</h2>
            <p className={hintClass}>Comprovativos em análise, erros no Meta e bloqueios por fraude.</p>
          </div>
          <ChannelPicker value={v.adminChannels} options={["email", "whatsapp", "sms"]} onChange={(c) => set("adminChannels", c)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="aemail">Email</label>
              <input id="aemail" type="email" value={v.adminEmail ?? ""} onChange={(e) => set("adminEmail", e.target.value)} className={inputClass} />
              {errors.adminEmail && <p className={errorClass}>{errors.adminEmail}</p>}
            </div>
            <div>
              <label className={labelClass} htmlFor="aphone">Telefone</label>
              <input id="aphone" type="tel" value={v.adminPhone ?? ""} onChange={(e) => set("adminPhone", e.target.value)} placeholder="+244 9XX XXX XXX" className={inputClass} />
              {errors.adminPhone && <p className={errorClass}>{errors.adminPhone}</p>}
            </div>
          </div>
        </section>

        <section className={`${cardClass} space-y-4`}>
          <h2 className="font-semibold">Geral</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="site">Nome da loja</label>
              <input id="site" value={v.siteName} onChange={(e) => set("siteName", e.target.value)} className={inputClass} />
              <p className={hintClass}>Usado nas mensagens e no rodapé.</p>
            </div>
            <div>
              <label className={labelClass} htmlFor="support">Telefone de suporte</label>
              <input id="support" type="tel" value={v.supportPhone ?? ""} onChange={(e) => set("supportPhone", e.target.value)} placeholder="+244 9XX XXX XXX" className={inputClass} />
              <p className={hintClass}>Mostrado ao cliente quando algo corre mal.</p>
            </div>
          </div>
          <SaveBar pending={pending} result={result} />
        </section>
      </form>

      {legal.map((page) => (
        <LegalEditor key={page.slug} page={page} />
      ))}
    </div>
  );
}

function LegalEditor({ page }: { page: Legal }) {
  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(page.body_md);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        start(async () => setResult(await safeAction(() => saveLegalPage({ slug: page.slug, title, body }))));
      }}
      className={`${cardClass} space-y-4`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">{page.slug === "privacidade" ? "Política de privacidade" : "Termos e condições"}</h2>
        <a href={`/${page.slug}`} target="_blank" className="text-sm underline">Ver página</a>
      </div>
      <div>
        <label className={labelClass} htmlFor={`lt-${page.slug}`}>Título</label>
        <input id={`lt-${page.slug}`} value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`lb-${page.slug}`}>Texto</label>
        <textarea id={`lb-${page.slug}`} rows={10} value={body} onChange={(e) => setBody(e.target.value)} className={inputClass} />
        <p className={hintClass}>Linhas em branco separam parágrafos. Linhas que começam por “# ” são títulos.</p>
      </div>
      <SaveBar pending={pending} result={result} />
    </form>
  );
}
