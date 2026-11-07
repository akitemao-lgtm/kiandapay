"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard } from "@/components/ui/AuthCard";
import { buttonPrimary, buttonSecondary, errorClass, hintClass, inputClass, labelClass } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/browser";

type State =
  | { step: "loading" }
  | { step: "enroll"; factorId: string; qr: string; secret: string }
  | { step: "verify"; factorId: string }
  | { step: "error"; message: string };

export default function MfaPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ step: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setState({ step: "error", message: "Não foi possível verificar o 2FA." });

      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) return setState({ step: "verify", factorId: verified.id });

      // Sem 2FA: só a configura o dono da plataforma (obrigatória) ou quem escolheu ativá-la.
      const wantsToEnable = new URLSearchParams(window.location.search).has("ativar");
      if (!wantsToEnable) {
        const { data: user } = await supabase.auth.getUser();
        const { data: profile } = await supabase
          .from("profiles").select("is_platform_admin").eq("user_id", user.user?.id ?? "").maybeSingle();
        if (!profile?.is_platform_admin) {
          router.replace("/admin");
          return;
        }
      }

      // Primeira vez: remover tentativas antigas não concluídas e registar uma nova app.
      for (const f of data.all.filter((f) => f.status === "unverified")) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Autenticador" });
      if (enrolled.error) return setState({ step: "error", message: "Não foi possível configurar o 2FA." });
      setState({
        step: "enroll",
        factorId: enrolled.data.id,
        qr: enrolled.data.totp.qr_code,
        secret: enrolled.data.totp.secret,
      });
    })();
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state.step !== "enroll" && state.step !== "verify") return;
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.mfa.challengeAndVerify({
      factorId: state.factorId,
      code: code.replace(/\s/g, ""),
    });
    if (error) {
      setPending(false);
      setError("Código inválido ou expirado. Tente de novo.");
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/admin/login");
  }

  if (state.step === "loading") {
    return <AuthCard title="Verificação em dois passos"><p className="text-sm text-gray-500">A carregar…</p></AuthCard>;
  }
  if (state.step === "error") {
    return (
      <AuthCard title="Verificação em dois passos">
        <p className={errorClass}>{state.message}</p>
        <button onClick={signOut} className={`${buttonSecondary} mt-4 w-full`}>Voltar ao login</button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Verificação em dois passos"
      subtitle={
        state.step === "enroll"
          ? "Leia o código QR com uma app autenticadora (Google Authenticator, Authy, 1Password…)."
          : "Introduza o código de 6 dígitos da sua app autenticadora."
      }
    >
      {state.step === "enroll" && (
        <div className="mb-6 text-center">
          <img src={state.qr} alt="Código QR para a app autenticadora" className="mx-auto h-48 w-48" />
          <p className={hintClass}>Sem câmara? Introduza esta chave na app:</p>
          <code className="mt-1 block break-all rounded bg-gray-100 px-2 py-1 text-xs">{state.secret}</code>
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="code">Código</label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            required
            autoFocus
            className={`${inputClass} text-center text-lg tracking-[0.4em]`}
          />
        </div>
        {error && <p className={errorClass}>{error}</p>}
        <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
          {pending ? "A verificar…" : "Confirmar"}
        </button>
        <button type="button" onClick={signOut} className="w-full text-sm text-gray-500 underline">
          Sair
        </button>
      </form>
    </AuthCard>
  );
}
