export type DeliveryType = "pdf" | "link";

export type ProductRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  image_path: string | null;
  is_active: boolean;
  delivery_type: DeliveryType;
  delivery_file_path: string | null;
  delivery_file_name: string | null;
  delivery_file_version: number;
  delivery_url: string | null;
  delivery_button_label: string | null;
  created_at: string;
  updated_at: string;
};

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
