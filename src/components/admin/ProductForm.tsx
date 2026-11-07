"use client";

import { safeAction } from "@/lib/client/safe-action";
import { useRef, useState, useTransition } from "react";
import { createProduct, getProductFileUrl, updateProduct } from "@/app/admin/(painel)/produtos/actions";
import { ImageUpload } from "@/components/admin/ImageUpload";
import {
  buttonPrimary,
  cardClass,
  errorClass,
  hintClass,
  inputClass,
  labelClass,
} from "@/components/ui/styles";
import { formatKz, parseKz } from "@/lib/format";
import type { ProductInput } from "@/lib/products/schema";
import type { ActionResult, DeliveryType, ProductRow } from "@/lib/products/types";
import { slugify } from "@/lib/slug";
import { uploadProductPdf } from "@/lib/upload";

function priceToText(price: number) {
  return String(price).replace(".", ",");
}

export function ProductForm({ product }: { product?: ProductRow }) {
  const editing = !!product;
  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(editing);
  const [description, setDescription] = useState(product?.description ?? "");
  const [priceText, setPriceText] = useState(product ? priceToText(product.price) : "");
  const [imagePath, setImagePath] = useState<string | null>(product?.image_path ?? null);
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const [deliveryType, setDeliveryType] = useState<DeliveryType>(product?.delivery_type ?? "pdf");
  const [filePath, setFilePath] = useState<string | null>(product?.delivery_file_path ?? null);
  const [fileName, setFileName] = useState<string | null>(product?.delivery_file_name ?? null);
  const [deliveryUrl, setDeliveryUrl] = useState(product?.delivery_url ?? "");
  const [buttonLabel, setButtonLabel] = useState(product?.delivery_button_label ?? "");

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const price = parseKz(priceText);
  const fileReplaced = editing && filePath !== product.delivery_file_path;

  function onNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  }

  async function onPdf(file: File | undefined) {
    if (!file) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      setFilePath(await uploadProductPdf(file));
      setFileName(file.name.slice(0, 200));
    } catch (e) {
      setPdfError((e as Error).message);
    } finally {
      setPdfBusy(false);
      if (pdfInput.current) pdfInput.current.value = "";
    }
  }

  async function openCurrentPdf() {
    if (!product) return;
    // Abrir a janela já no clique evita o bloqueio de pop-ups depois do await.
    const win = window.open("", "_blank");
    const url = await getProductFileUrl(product.id);
    if (!win) return;
    win.opener = null;
    if (url) win.location.href = url;
    else win.close();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input: ProductInput = {
      name,
      slug,
      description,
      price: price ?? Number.NaN,
      imagePath,
      isActive,
      deliveryType,
      deliveryFilePath: deliveryType === "pdf" ? filePath : null,
      deliveryFileName: deliveryType === "pdf" ? fileName : null,
      deliveryUrl: deliveryType === "link" ? deliveryUrl.trim() || null : null,
      deliveryButtonLabel: deliveryType === "link" ? buttonLabel.trim() || null : null,
    };
    setResult(null);
    startTransition(async () => {
      const res = await safeAction(() => (editing ? updateProduct(product.id, input) : createProduct(input)));
      if (res) setResult(res);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 pb-24">
      <section className={`${cardClass} space-y-4`}>
        <h2 className="font-semibold">Informação</h2>
        <div>
          <label className={labelClass} htmlFor="name">Nome</label>
          <input id="name" value={name} onChange={(e) => onNameChange(e.target.value)} className={inputClass} required />
          {errors.name && <p className={errorClass}>{errors.name}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="slug">Endereço do checkout</label>
          <div className="flex items-center rounded-lg border border-gray-300 bg-white focus-within:border-gray-900">
            <span className="pl-3 text-sm text-gray-500">/</span>
            <input
              id="slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              className="w-full rounded-lg bg-transparent px-1 py-2.5 text-base outline-none sm:text-sm"
              required
            />
          </div>
          {errors.slug ? (
            <p className={errorClass}>{errors.slug}</p>
          ) : (
            editing && slug !== product.slug && (
              <p className={hintClass}>Atenção: anúncios com o endereço antigo deixam de funcionar.</p>
            )
          )}
        </div>
        <div>
          <label className={labelClass} htmlFor="description">Descrição</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className={inputClass}
          />
          {errors.description && <p className={errorClass}>{errors.description}</p>}
        </div>
        <div className="max-w-xs">
          <label className={labelClass} htmlFor="price">Preço (Kz)</label>
          <input
            id="price"
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            inputMode="decimal"
            placeholder="15000"
            className={inputClass}
            required
          />
          {errors.price ? (
            <p className={errorClass}>{errors.price}</p>
          ) : priceText && price === null ? (
            <p className={errorClass}>Valor inválido. Exemplo: 15000 ou 15 000,50</p>
          ) : (
            price !== null && <p className={hintClass}>{formatKz(price)}</p>
          )}
        </div>
        <ImageUpload
          label="Imagem do produto"
          kind="products"
          value={imagePath}
          onChange={setImagePath}
          hint="Quadrada, pelo menos 600×600. PNG, JPG ou WebP até 5 MB."
          error={errors.imagePath}
        />
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-5 w-5 rounded border-gray-300"
          />
          <span className="text-sm">Produto ativo (o checkout aceita pedidos)</span>
        </label>
      </section>

      <section className={`${cardClass} space-y-4`}>
        <div>
          <h2 className="font-semibold">Entrega</h2>
          <p className={hintClass}>
            {editing
              ? "O tipo de entrega foi escolhido na criação e não pode ser mudado."
              : "Escolha como o cliente recebe o produto depois do pagamento confirmado. Não pode ser mudado depois."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(["pdf", "link"] as const).map((t) => (
            <label
              key={t}
              className={`flex cursor-pointer flex-col rounded-xl border-2 p-3 ${
                deliveryType === t ? "border-gray-900 bg-gray-50" : "border-gray-200"
              } ${editing && deliveryType !== t ? "cursor-not-allowed opacity-40" : ""}`}
            >
              <input
                type="radio"
                name="deliveryType"
                value={t}
                checked={deliveryType === t}
                disabled={editing}
                onChange={() => setDeliveryType(t)}
                className="sr-only"
              />
              <span className="font-medium">{t === "pdf" ? "PDF" : "Link"}</span>
              <span className="text-xs text-gray-500">
                {t === "pdf" ? "Ficheiro descarregado na página do pedido" : "Botão que abre um URL (curso, grupo…)"}
              </span>
            </label>
          ))}
        </div>

        {deliveryType === "pdf" ? (
          <div>
            <span className={labelClass}>Ficheiro PDF</span>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 p-3">
              <div className="min-w-0 flex-1">
                {filePath ? (
                  <>
                    <p className="truncate text-sm font-medium">{fileName ?? filePath.split("/")[1]}</p>
                    <p className="text-xs text-gray-500">
                      {fileReplaced
                        ? "Novo ficheiro carregado — fica em uso quando guardar."
                        : editing
                          ? `Versão ${product.delivery_file_version} · guardado em armazenamento privado`
                          : "Carregado · guardado em armazenamento privado"}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-gray-500">{pdfBusy ? "A carregar…" : "Nenhum ficheiro"}</p>
                )}
              </div>
              {editing && product.delivery_file_path && !fileReplaced && (
                <button type="button" onClick={openCurrentPdf} className="text-sm underline">
                  Abrir
                </button>
              )}
              <button
                type="button"
                disabled={pdfBusy}
                onClick={() => pdfInput.current?.click()}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                {pdfBusy ? "A carregar…" : filePath ? "Substituir" : "Carregar PDF"}
              </button>
            </div>
            <input
              ref={pdfInput}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => onPdf(e.target.files?.[0])}
            />
            <p className={hintClass}>
              Até 100 MB. Se substituir o PDF, quem já comprou passa a descarregar a versão nova.
            </p>
            {(pdfError || errors.deliveryFilePath) && (
              <p className={errorClass}>{pdfError ?? errors.deliveryFilePath}</p>
            )}
          </div>
        ) : (
          <>
            <div>
              <label className={labelClass} htmlFor="deliveryUrl">Link de acesso</label>
              <input
                id="deliveryUrl"
                type="url"
                value={deliveryUrl}
                onChange={(e) => setDeliveryUrl(e.target.value)}
                placeholder="https://"
                className={inputClass}
              />
              <p className={hintClass}>Só é enviado ao browser depois do pagamento confirmado.</p>
              {errors.deliveryUrl && <p className={errorClass}>{errors.deliveryUrl}</p>}
            </div>
            <div className="max-w-sm">
              <label className={labelClass} htmlFor="buttonLabel">Texto do botão</label>
              <input
                id="buttonLabel"
                value={buttonLabel}
                onChange={(e) => setButtonLabel(e.target.value)}
                placeholder="Aceder ao curso"
                className={inputClass}
              />
              {errors.deliveryButtonLabel && <p className={errorClass}>{errors.deliveryButtonLabel}</p>}
            </div>
          </>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-4">
          {result && (
            <p className={`flex-1 text-sm ${result.ok ? "text-green-700" : "text-red-600"}`}>
              {result.ok ? result.message : result.error}
            </p>
          )}
          <button type="submit" disabled={pending || pdfBusy} className={buttonPrimary}>
            {pending ? "A guardar…" : editing ? "Guardar alterações" : "Criar produto"}
          </button>
        </div>
      </div>
    </form>
  );
}
