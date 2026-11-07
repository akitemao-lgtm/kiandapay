"use client";

import { useState } from "react";
import { siteUrl } from "@/lib/site";

/** Link público do checkout de um produto, com botões para copiar e abrir. */
export function CheckoutLink({ slug, showUrl = false }: { slug: string; showUrl?: boolean }) {
  const url = `${siteUrl()}/${slug}`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Sem permissão de clipboard: seleciona o texto para copiar à mão.
      window.prompt("Copie o link do checkout:", url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {showUrl && <code className="min-w-0 truncate rounded bg-gray-100 px-2 py-1 text-xs">{url}</code>}
      <button type="button" onClick={copy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
        {copied ? "Copiado ✓" : "Copiar link"}
      </button>
      <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
        Abrir
      </a>
    </div>
  );
}
