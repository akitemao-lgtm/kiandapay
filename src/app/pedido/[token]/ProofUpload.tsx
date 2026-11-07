"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const MAX_BYTES = 5 * 1024 * 1024;

/** Fotografias grandes são reduzidas no telemóvel antes do envio. */
async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

type Props = { token: string; attemptsLeft: number; lastRejection: string | null };

export function ProofUpload({ token, attemptsLeft, lastRejection }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "sending" | "checking">("idle");
  const [error, setError] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(lastRejection);
  const [left, setLeft] = useState(attemptsLeft);

  async function send(original: File | undefined) {
    if (!original) return;
    setError(null);
    setState("sending");
    const file = await shrinkImage(original);
    if (file.size > MAX_BYTES) {
      setState("idle");
      setError("O ficheiro tem de ter no máximo 5 MB.");
      return;
    }
    const body = new FormData();
    body.append("file", file);
    const timer = setTimeout(() => setState("checking"), 800);
    try {
      const res = await fetch(`/pedido/${token}/comprovativo`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Não foi possível enviar. Tente de novo.");
      } else if (data.decision === "rejected") {
        setRejection(data.reason);
        setLeft(data.attemptsLeft);
        router.refresh();
      } else {
        // Aprovado ou em análise: a página passa a mostrar o novo estado.
        router.refresh();
        return;
      }
    } catch {
      setError("Sem ligação. Verifique a internet e tente de novo.");
    } finally {
      clearTimeout(timer);
      if (input.current) input.current.value = "";
    }
    setState("idle");
  }

  const busy = state !== "idle";

  return (
    <div className="space-y-3 text-left">
      {rejection && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Comprovativo rejeitado</p>
          <p className="mt-0.5">{rejection}</p>
        </div>
      )}
      {left > 0 ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="block w-full rounded-xl bg-[var(--c-primary)] px-4 py-3.5 text-center text-base font-bold text-[var(--c-on-primary)] disabled:opacity-70"
          >
            {state === "sending" ? "A enviar…" : state === "checking" ? "A verificar o comprovativo…" : rejection ? "Enviar outro comprovativo" : "Enviar o comprovativo"}
          </button>
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp,image/heic,.pdf"
            className="hidden"
            onChange={(e) => send(e.target.files?.[0])}
          />
        </>
      ) : (
        <p className="text-center text-sm text-gray-600">Atingiu o limite de envios. Contacte o suporte com o número do pedido.</p>
      )}
      {error && <p className="text-center text-sm text-red-600">{error}</p>}
    </div>
  );
}
