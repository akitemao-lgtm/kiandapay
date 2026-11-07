"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthCard } from "@/components/ui/AuthCard";
import { buttonPrimary, errorClass, inputClass, labelClass } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/browser";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(
    params.get("erro") === "sem-acesso" ? "Esta conta não tem acesso ao painel." : null,
  );
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      setPending(false);
      setError(
        error.code === "email_not_confirmed"
          ? "O seu e-mail ainda não foi confirmado. Abra o link que lhe enviámos (veja também o spam) ou aguarde a aprovação da conta: quando for aprovada, já consegue entrar."
          : "Email ou palavra-passe incorrectos.",
      );
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className={labelClass} htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="password">Palavra-passe</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </div>
      {error && <p className={errorClass}>{error}</p>}
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "A entrar…" : "Entrar"}
      </button>
      <p className="text-center text-sm text-gray-600">
        Ainda não tem conta? <Link href="/admin/registo" className="underline">Criar conta</Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthCard title="Painel" subtitle="Entre na sua conta.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}
