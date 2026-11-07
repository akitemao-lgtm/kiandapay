"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fieldClass, PayButton, PaymentMethodOption, TermsNote } from "@/components/checkout/CheckoutView";
import { readCustomer, type CustomerFields } from "@/lib/checkout/customer";
import type { Prefill } from "@/lib/checkout/prefill";
import { collectTracking, type ClientTracking } from "@/lib/tracking/client";
import { createOrder, recordVisit } from "./actions";

type Props = { slug: string; buttonText: string; price: number; fields: CustomerFields; prefill?: Prefill };

export function CheckoutForm({ slug, buttonText, price, fields, prefill }: Props) {
  const router = useRouter();
  const [name, setName] = useState(prefill?.name ?? "");
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [phone, setPhone] = useState(prefill?.phone ?? "");
  const [method, setMethod] = useState(false);
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const tracking = useRef<ClientTracking | null>(null);
  const visitId = useRef<string | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    tracking.current = collectTracking();
    recordVisit(slug, tracking.current)
      .then((v) => {
        visitId.current = v?.visitId ?? null;
        if (v) window.dispatchEvent(new CustomEvent("checkout:visit", { detail: v }));
      })
      .catch(() => {});
  }, [slug]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !method) return;
    const local = readCustomer({ name, email, phone }, fields).errors;
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;

    setPending(true);
    try {
      const res = await createOrder({
        slug, name, phone, email, website,
        startedAt: startedAt.current,
        visitId: visitId.current,
        tracking: tracking.current ?? collectTracking(),
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
        setPending(false);
        return;
      }
      try {
        sessionStorage.setItem(`ic:${res.token}`, res.initiateCheckoutEventId);
      } catch {}
      window.dispatchEvent(new CustomEvent("checkout:order", { detail: res }));
      router.push(`/pedido/${res.token}`);
    } catch {
      setFormError("Sem ligação. Verifique a internet e tente de novo.");
      setPending(false);
    }
  }

  const err = (k: string) => errors[k] && <p className="mt-1 text-sm text-red-600">{errors[k]}</p>;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {fields.nameField !== "hidden" && (
        <div>
          <input id="name" aria-label="Nome completo" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={fields.nameField === "optional" ? "Nome completo (opcional)" : "Nome completo"} className={fieldClass} aria-invalid={!!errors.name} />
          {err("name")}
        </div>
      )}
      {fields.emailField !== "hidden" && (
        <div>
          <input id="email" aria-label="E-mail" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={fields.emailField === "optional" ? "E-mail (opcional)" : "E-mail"} className={fieldClass} aria-invalid={!!errors.email} />
          {err("email")}
        </div>
      )}
      {fields.phoneField !== "hidden" && (
        <div>
          <input id="phone" aria-label="Número de telefone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={fields.phoneField === "optional" ? "Número de telefone (opcional)" : "Número de telefone"} className={fieldClass} aria-invalid={!!errors.phone} />
          {err("phone")}
        </div>
      )}
      {/* Honeypot: escondido de pessoas, preenchido por bots. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      <div className="pt-2">
        <PaymentMethodOption selected={method} onSelect={() => setMethod(true)} />
      </div>
      {formError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
      <PayButton price={price} text={buttonText} disabled={!method} pending={pending} />
      <TermsNote />
    </form>
  );
}
