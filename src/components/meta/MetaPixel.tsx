"use client";

import { useEffect } from "react";
import { scrubPersonalParams } from "@/lib/tracking/client";

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...a: unknown[]) => void;
  queue: unknown[][];
  loaded: boolean;
  version: string;
  push: unknown;
  disablePushState?: boolean;
};
type W = Window & { fbq?: Fbq; _fbq?: Fbq; __fbqLoaded?: Promise<boolean>; __fbqInit?: Set<string>; __fbqLast?: Record<string, number> };

/** Evita repetir o mesmo evento na mesma página em poucos segundos (montagens duplas, refresh). */
function once(key: string, ms = 3000) {
  const w = window as W;
  w.__fbqLast ??= {};
  const now = Date.now();
  if (now - (w.__fbqLast[key] ?? 0) < ms) return false;
  w.__fbqLast[key] = now;
  return true;
}

/** Snippet oficial do Pixel, carregado uma única vez por janela. */
function getFbq(w: W): Fbq {
  if (w.fbq) return w.fbq;
  const n = function (...args: unknown[]) {
    if (n.callMethod) n.callMethod(...args);
    else n.queue.push(args);
  } as Fbq;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  // Sem isto, o Pixel envia um PageView sozinho ao mudar de página, com o link secreto do pedido.
  n.disablePushState = true;
  w.fbq = n;
  w._fbq ??= n;
  const doc = w.document;
  const s = doc.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  w.__fbqLoaded = new Promise((resolve) => {
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false); // bloqueadores de anúncios
  });
  doc.head.appendChild(s);
  return n;
}

function initPixel(w: W, pixelId: string, userData: Record<string, string> = {}) {
  const fbq = getFbq(w);
  w.__fbqInit ??= new Set();
  if (w.__fbqInit.has(pixelId)) return fbq;
  // Sem eventos automáticos: enviariam o URL e os textos dos botões da página.
  fbq("set", "autoConfig", false, pixelId);
  fbq("init", pixelId, userData);
  w.__fbqInit.add(pixelId);
  return fbq;
}

/** Enquanto o Pixel não tiver a configuração, os eventos ficam à espera e levariam o URL da página seguinte. */
function pixelReady(pixelId: string) {
  return performance.getEntriesByType("resource").some((e) => e.name.includes(`/signals/config/${pixelId}`));
}

function report(token: string, event: "InitiateCheckout" | "Purchase") {
  // Regista no histórico do pedido que o Pixel disparou (sem dados pessoais).
  fetch(`/pedido/${token}/pixel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
    keepalive: true,
  }).catch(() => {});
}

type CheckoutProps = {
  pixelId: string;
  currency: string;
  value: number;
  productId: string;
  productName: string;
};

/** Página do checkout: PageView + ViewContent, e InitiateCheckout quando o pedido é criado. */
export function MetaPixel({ pixelId, currency, value, productId, productName }: CheckoutProps) {
  useEffect(() => {
    // Antes do Pixel: ele lê o URL da página.
    scrubPersonalParams();
    const fbq = initPixel(window as W, pixelId);
    if (once(`${pixelId}:PageView:${location.pathname}`)) fbq("trackSingle", pixelId, "PageView");

    const params = { value, currency, content_ids: [productId], content_name: productName, content_type: "product" };
    if (once(`${pixelId}:ViewContent:${location.pathname}`)) fbq("trackSingle", pixelId, "ViewContent", params);
    const onOrder = (e: Event) => {
      // O pedido abre já a seguir. Sem o Pixel pronto, fica só o evento do servidor.
      if (!pixelReady(pixelId)) return;
      const d = (e as CustomEvent<{ token: string; initiateCheckoutEventId: string }>).detail;
      fbq("trackSingle", pixelId, "InitiateCheckout", { ...params, num_items: 1 }, { eventID: d.initiateCheckoutEventId });
      report(d.token, "InitiateCheckout");
    };
    window.addEventListener("checkout:order", onOrder);
    return () => window.removeEventListener("checkout:order", onOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelId]);

  return null;
}

type PurchaseProps = CheckoutProps & {
  token: string;
  eventId: string;
  orderId: string;
  phone: string | null;
  externalId: string;
};

/**
 * Purchase com o mesmo event_id do servidor. Corre num iframe da mesma origem
 * com um URL neutro, porque o Pixel envia o URL ao Meta e o da página do pedido
 * é secreto. O iframe partilha os cookies _fbp/_fbc com a página.
 */
export function MetaPurchasePixel({ pixelId, currency, value, productId, productName, token, eventId, orderId, phone, externalId }: PurchaseProps) {
  useEffect(() => {
    if (!once(`${pixelId}:Purchase:${eventId}`, 60_000)) return;
    const frame = document.createElement("iframe");
    frame.src = "/pixel.html";
    frame.referrerPolicy = "no-referrer";
    frame.hidden = true;
    frame.onload = () => {
      const w = frame.contentWindow as W | null;
      if (!w) return;
      initPixel(w, pixelId, { ...(phone ? { ph: phone } : {}), external_id: externalId })(
        "trackSingle", pixelId, "Purchase",
        { value, currency, content_ids: [productId], content_name: productName, content_type: "product", order_id: orderId },
        { eventID: eventId },
      );
      // Só marca como disparado se o script do Meta carregou.
      w.__fbqLoaded?.then((loaded) => loaded && report(token, "Purchase"));
    };
    document.body.appendChild(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelId, eventId]);

  return null;
}
