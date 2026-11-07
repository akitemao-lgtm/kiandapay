"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Recarrega a página quando o estado do pedido muda (ex.: aprovado nas Exceções). */
export function StatusPoller({ token, view, uploads }: { token: string; view: string; uploads: number }) {
  const router = useRouter();
  useEffect(() => {
    if (view === "paid" || view === "expired") return;
    const interval = view === "under_review" ? 5000 : 15000;
    let stopped = false;
    async function check() {
      if (document.hidden) return;
      try {
        const res = await fetch(`/pedido/${token}/estado`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { view: string; uploads: number };
        if (!stopped && (data.view !== view || data.uploads !== uploads)) router.refresh();
      } catch {
        // Sem rede: tenta de novo no próximo ciclo.
      }
    }
    const t = setInterval(check, interval);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", check);
    };
  }, [token, view, uploads, router]);
  return null;
}
