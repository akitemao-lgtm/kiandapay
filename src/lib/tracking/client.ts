"use client";

import { stripPersonalParams } from "./url";

/** Dados de rastreamento recolhidos no browser e enviados ao servidor. */
export type ClientTracking = {
  visitorId: string;
  fbclid: string | null;
  fbp: string | null;
  fbc: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  landingUrl: string;
  referrer: string | null;
};

const DAY = 24 * 60 * 60;

/** Limpa os dados pessoais da barra de endereço antes de o Pixel ler o URL. */
export function scrubPersonalParams() {
  const clean = stripPersonalParams(location.href);
  if (clean && clean !== location.href) history.replaceState(history.state, "", clean);
}

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function setCookie(name: string, value: string, maxAgeSeconds: number) {
  const https = location.protocol === "https:";
  // Dentro de um iframe de outro site, o navegador recusa cookies SameSite=Lax.
  const attrs = https && window.self !== window.top ? "SameSite=None; Secure; Partitioned" : `SameSite=Lax${https ? "; Secure" : ""}`;
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; ${attrs}`;
}

/**
 * Lê fbclid/UTMs do URL e os cookies _fbp/_fbc. Cria _fbc a partir do fbclid
 * (formato do Meta: fb.1.<ms>.<fbclid>) e _fbp se ainda não existirem — o
 * Pixel reutiliza cookies existentes. Guarda o primeiro toque da sessão, para
 * não se perder se o lead recarregar a página sem os parâmetros.
 */
export function collectTracking(): ClientTracking {
  scrubPersonalParams();
  const params = new URLSearchParams(location.search);
  const now = Date.now();

  let visitorId = getCookie("vid");
  if (!visitorId || !/^[0-9a-f-]{36}$/.test(visitorId)) visitorId = crypto.randomUUID();
  setCookie("vid", visitorId, 365 * DAY);

  const fbclid = params.get("fbclid");
  let fbc = getCookie("_fbc");
  if (fbclid && (!fbc || !fbc.endsWith(`.${fbclid}`))) {
    fbc = `fb.1.${now}.${fbclid}`;
    setCookie("_fbc", fbc, 90 * DAY);
  }
  let fbp = getCookie("_fbp");
  if (!fbp) {
    fbp = `fb.1.${now}.${Math.floor(Math.random() * 1e10)}`;
    setCookie("_fbp", fbp, 90 * DAY);
  }

  const fromUrl = {
    fbclid,
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
    utmContent: params.get("utm_content"),
    utmTerm: params.get("utm_term"),
    landingUrl: location.href,
    referrer: document.referrer || null,
  };

  let firstTouch = fromUrl;
  try {
    const key = `trk:${location.pathname}`;
    const saved = sessionStorage.getItem(key);
    if (saved && !fromUrl.fbclid && !fromUrl.utmSource) firstTouch = JSON.parse(saved);
    else sessionStorage.setItem(key, JSON.stringify(fromUrl));
  } catch {
    // sessionStorage indisponível (modo privado): usa o URL actual.
  }

  return { visitorId, fbp, fbc, ...firstTouch };
}
