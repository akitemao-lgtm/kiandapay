/** O Meta só deduplica durante 48 h; depois disso, um Purchase repetido no browser contaria duas vezes. */
const BROWSER_PURCHASE_WINDOW_MS = 24 * 3_600_000;

export function shouldFireBrowserPurchase(
  order: { paidAt: string | null; pixelFiredAt: string | null },
  now = Date.now(),
): boolean {
  if (!order.paidAt || order.pixelFiredAt) return false;
  return now - new Date(order.paidAt).getTime() < BROWSER_PURCHASE_WINDOW_MS;
}
