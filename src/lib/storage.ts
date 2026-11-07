import { SUPABASE_URL } from "@/lib/env";

export const BUCKETS = {
  media: "product-media", // público: imagens, logos, banners
  productFiles: "product-files", // privado: PDFs vendidos
} as const;

export const MEDIA_KINDS = ["products", "checkout", "testimonials"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const LIMITS = {
  imageBytes: 5 * 1024 * 1024,
  pdfBytes: 100 * 1024 * 1024,
  imageTypes: ["image/png", "image/jpeg", "image/webp"],
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const NAME = "[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+)?";

export const PRODUCT_FILE_PATH = new RegExp(`^${UUID}/${NAME}$`);
export const MEDIA_PATH = new RegExp(`^(?:${MEDIA_KINDS.join("|")})/${UUID}/${NAME}$`);

export function publicMediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKETS.media}/${path}`;
}
