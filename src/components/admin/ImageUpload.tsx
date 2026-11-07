"use client";

import { useRef, useState } from "react";
import { errorClass, hintClass, labelClass } from "@/components/ui/styles";
import { publicMediaUrl, type MediaKind } from "@/lib/storage";
import { uploadImage } from "@/lib/upload";

type Props = {
  label: string;
  kind: MediaKind;
  value: string | null;
  onChange: (path: string | null) => void;
  hint?: string;
  aspect?: "square" | "wide";
  error?: string;
};

export function ImageUpload({ label, kind, value, onChange, hint, aspect = "square", error }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const url = publicMediaUrl(value);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setUploadError(null);
    try {
      onChange(await uploadImage(kind, file));
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const box = aspect === "wide" ? "aspect-[3/1] w-full" : "h-20 w-20";

  return (
    <div>
      <span className={labelClass}>{label}</span>
      <div className="flex flex-wrap items-center gap-3">
        <div className={`${box} flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 ring-1 ring-gray-200`}>
          {url ? (
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-gray-400">{busy ? "A carregar…" : "Sem imagem"}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {busy ? "A carregar…" : url ? "Trocar" : "Carregar"}
          </button>
          {url && !busy && (
            <button type="button" onClick={() => onChange(null)} className="px-2 text-sm text-red-600">
              Remover
            </button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {hint && <p className={hintClass}>{hint}</p>}
      {(uploadError || error) && <p className={errorClass}>{uploadError ?? error}</p>}
    </div>
  );
}
