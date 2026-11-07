"use client";

import { useEffect } from "react";

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue: unknown[][]; loaded: boolean; version: string; push: unknown };
type W = Window & { fbq?: Fbq; _fbq?: Fbq; __fbqReady?: boolean; __fbqInit?: Set<string>; __fbqLast?: Record<string, number> };

/** Evita repetir o mesmo evento na mesma página em poucos segundos (montagens duplas, refresh). */
function once(key: string, ms = 3000) {
  const w = window as W;
  w.__fbqLast ??= {};
  const now = Date.now();
  if (now - (w.__fbqLast[key] ?? 0) < ms) return false;
  w.__fbqLast[key] = now;
  return true;
}

/** Snippet oficial do Pixel, carregado uma única vez por página. */
function getFbq(): Fbq {
  const w = window as W;
  if (w.fbq) return w.fbq;
  const n = function (...args: unknown[]) {
    if (n.callMethod) n.callMethod(...args);
    else n.queue.push(args);
  } as Fbq;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  w.fbq = n;
  w._fbq ??= n;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  s.onload = () => (w.__fbqReady = true);
  document.head.appendChild(s);
  return n;
}

export type PixelProps = {
  pixelId: string;
  currency: string;
  value: number;
  productId: string;
  productName: string;
  /** Página do checkout: PageView + ViewContent, e InitiateCheckout quando o pedido é criado. */
  checkout?: boolean;
  /** Página do pedido pago: Purchase com o mesmo event_id do servidor. */
  purchase?: { token: string; eventId: string; orderId: string } | null;
  advancedMatching?: { ph?: string; external_id?: string } | null;
};

function report(token: string, event: "InitiateCheckout" | "Purchase") {
  // Regista no histórico do pedido que o Pixel disparou (sem dados pessoais).
  fetch(`/pedido/${token}/pixel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
    keepalive: true,
  }).catch(() => {});
}

export function MetaPixel({ pixelId, currency, value, productId, productName, checkout, purchase, advancedMatching }: PixelProps) {
  const ph = advancedMatching?.ph;
  const externalId = advancedMatching?.external_id;

  // Init + PageView (+ ViewContent e InitiateCheckout no checkout): uma vez por página.
  useEffect(() => {
    const w = window as W;
    const fbq = getFbq();
    w.__fbqInit ??= new Set();
    if (!w.__fbqInit.has(pixelId)) {
      fbq("init", pixelId, { ...(ph ? { ph } : {}), ...(externalId ? { external_id: externalId } : {}) });
      w.__fbqInit.add(pixelId);
    }
    if (once(`${pixelId}:PageView:${location.pathname}`)) fbq("trackSingle", pixelId, "PageView");
    if (!checkout) return;

    const params = { value, currency, content_ids: [productId], content_name: productName, content_type: "product" };
    if (once(`${pixelId}:ViewContent:${location.pathname}`)) fbq("trackSingle", pixelId, "ViewContent", params);
    const onOrder = (e: Event) => {
      const d = (e as CustomEvent<{ token: string; initiateCheckoutEventId: string }>).detail;
      fbq("trackSingle", pixelId, "InitiateCheckout", { ...params, num_items: 1 }, { eventID: d.initiateCheckoutEventId });
      report(d.token, "InitiateCheckout");
    };
    window.addEventListener("checkout:order", onOrder);
    return () => window.removeEventListener("checkout:order", onOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelId, checkout]);

  // Purchase: quando a página passa a "pago" (o event_id é o mesmo do envio pelo servidor).
  const purchaseEventId = purchase?.eventId;
  useEffect(() => {
    if (!purchase) return;
    const w = window as W;
    if (!once(`${pixelId}:Purchase:${purchase.eventId}`, 60_000)) return;
    getFbq()(
      "trackSingle", pixelId, "Purchase",
      { value, currency, content_ids: [productId], content_name: productName, content_type: "product", order_id: purchase.orderId },
      { eventID: purchase.eventId },
    );
    // Só marca como disparado se o script do Meta carregou (bloqueadores de anúncios).
    const timer = setTimeout(() => w.__fbqReady && report(purchase.token, "Purchase"), 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelId, purchaseEventId]);

  return null;
}
