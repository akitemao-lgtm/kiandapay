export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Caminhos de topo usados pela própria aplicação. */
export const RESERVED_SLUGS = new Set([
  "admin", "api", "pedido", "pedidos", "privacidade", "termos", "c", "p",
  "login", "_next", "favicon.ico", "robots.txt", "sitemap.xml",
]);

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export function safeFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const cleanBase = slugify(base) || "ficheiro";
  return ext ? `${cleanBase}.${ext}` : cleanBase;
}
