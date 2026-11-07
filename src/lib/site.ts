export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function orderStatusUrl(token: string): string {
  return `${siteUrl()}/pedido/${token}`;
}
