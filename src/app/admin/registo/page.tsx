"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthCard } from "@/components/ui/AuthCard";
import { buttonPrimary, errorClass, hintClass, inputClass, labelClass } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/browser";

export default function RegistoPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checkEmail, setCheckEmail] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name")).trim();
    const phone = String(form.get("phone")).trim();
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    if (name.length < 2) return setError("Indique o seu nome ou o nome da loja.");
    if (password.length < 8) return setError("A palavra-passe tem de ter pelo menos 8 caracteres.");
    if (password !== String(form.get("password2"))) return setError("As palavras-passe não coincidem.");
    if (!form.get("terms")) return setError("Aceite os termos para continuar.");

    setPending(true);
    setError(null);
    const { data, error } = await createClient().auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name.slice(0, 80), phone: phone.slice(0, 30) },
        emailRedirectTo: `${window.location.origin}/admin/login`,
      },
    });
    if (error) {
      setPending(false);
      setError(
        /already|registered|exists/i.test(error.message)
          ? "Já existe uma conta com este e-mail. Entre com a palavra-passe."
          : /signups?.*(not allowed|disabled)/i.test(error.message)
            ? "O registo de contas novas está fechado de momento."
            : "Não foi possível criar a conta. Verifique os dados e tente de novo.",
      );
      return;
    }
    if (!data.session) {
      setCheckEmail(email);
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  if (checkEmail) {
    return (
      <AuthCard title="Confirme o seu e-mail">
        <p className="text-sm text-gray-700">
          Enviámos um link para <strong>{checkEmail}</strong>. Abra-o para confirmar a conta e depois entre com o
          e-mail e a palavra-passe. Se não o encontrar (veja também o spam), consegue entrar assim que a conta for
          aprovada.
        </p>
        <Link href="/admin/login" className={`${buttonPrimary} mt-6 block w-full text-center`}>Ir para o login</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Criar conta" subtitle="Venda os seus produtos digitais com pagamento por referência.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="name">Nome ou nome da loja</label>
          <input id="name" name="name" maxLength={80} autoComplete="organization" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="phone">Telefone</label>
          <input id="phone" name="phone" type="tel" maxLength={30} autoComplete="tel" placeholder="9XX XXX XXX" required className={inputClass} />
          <p className={hintClass}>Para o contactarmos sobre a aprovação da conta.</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="password">Palavra-passe</label>
          <input id="password" name="password" type="password" minLength={8} autoComplete="new-password" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="password2">Repetir palavra-passe</label>
          <input id="password2" name="password2" type="password" minLength={8} autoComplete="new-password" required className={inputClass} />
        </div>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" name="terms" className="mt-0.5 h-4 w-4" />
          <span>
            Li e aceito os <a href="/termos" target="_blank" className="underline">termos e condições</a> e a{" "}
            <a href="/privacidade" target="_blank" className="underline">política de privacidade</a>.
          </span>
        </label>
        {error && <p className={errorClass}>{error}</p>}
        <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
          {pending ? "A criar a conta…" : "Criar conta"}
        </button>
        <p className="text-center text-sm text-gray-600">
          Já tem conta? <Link href="/admin/login" className="underline">Entrar</Link>
        </p>
      </form>
    </AuthCard>
  );
}
