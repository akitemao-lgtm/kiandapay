"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { checkoutSchema, type CheckoutInput } from "@/lib/checkout/schema";
import { DEFAULT_CHECKOUT, DEFAULT_PAYMENT_INSTRUCTIONS } from "@/lib/checkout/defaults";
import { fieldErrors, productSchema, type ProductInput } from "@/lib/products/schema";
import type { ActionResult, ProductRow } from "@/lib/products/types";
import { BUCKETS } from "@/lib/storage";

type Db = Awaited<ReturnType<typeof requireAdmin>>["supabase"];
type ParsedProduct = z.output<typeof productSchema>;

const uuid = z.string().uuid();
function invalid(errors: Record<string, string>): ActionResult {
  return { ok: false, error: "Verifique os campos assinalados.", fieldErrors: errors };
}

function toRow(p: ParsedProduct) {
  const pdf = p.deliveryType === "pdf";
  return {
    slug: p.slug,
    name: p.name,
    description: p.description,
    price: p.price,
    image_path: p.imagePath,
    is_active: p.isActive,
    delivery_type: p.deliveryType,
    delivery_file_path: pdf ? p.deliveryFilePath : null,
    delivery_file_name: pdf ? p.deliveryFileName : null,
    delivery_url: pdf ? null : p.deliveryUrl,
    delivery_button_label: pdf ? null : p.deliveryButtonLabel,
  };
}

function dbError(error: { code?: string; message: string }): ActionResult {
  if (error.code === "23505" && error.message.includes("slug")) {
    return invalid({ slug: "Já existe um produto com este endereço." });
  }
  console.error("[produtos]", error);
  return { ok: false, error: "Não foi possível guardar. Tente de novo." };
}

async function productFileExists(supabase: Db, path: string) {
  const [dir, name] = path.split("/");
  const { data } = await supabase.storage.from(BUCKETS.productFiles).list(dir, { search: name });
  return !!data?.some((f) => f.name === name);
}

async function getProduct(supabase: Db, id: string): Promise<ProductRow | null> {
  if (!uuid.safeParse(id).success) return null;
  const { data } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  return data as ProductRow | null;
}

export async function createProduct(input: ProductInput): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  const p = parsed.data;

  if (p.deliveryType === "pdf" && !(await productFileExists(supabase, p.deliveryFilePath!))) {
    return { ok: false, error: "O PDF não foi encontrado no armazenamento. Carregue-o de novo." };
  }

  const { data, error } = await supabase.from("products").insert(toRow(p)).select("id").single();
  if (error) return dbError(error);

  await supabase
    .from("checkout_pages")
    .insert({ product_id: data.id, payment_instructions: DEFAULT_PAYMENT_INSTRUCTIONS, button_text: DEFAULT_CHECKOUT.buttonText });

  revalidatePath("/admin/produtos");
  redirect(`/admin/produtos/${data.id}?criado=1`);
}

export async function updateProduct(id: string, input: ProductInput): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const current = await getProduct(supabase, id);
  if (!current) return { ok: false, error: "Produto não encontrado." };

  // O tipo de entrega é escolhido na criação e não muda depois.
  const parsed = productSchema.safeParse({ ...input, deliveryType: current.delivery_type });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  const p = parsed.data;

  const fileChanged = p.deliveryType === "pdf" && p.deliveryFilePath !== current.delivery_file_path;
  if (fileChanged && !(await productFileExists(supabase, p.deliveryFilePath!))) {
    return { ok: false, error: "O novo PDF não foi encontrado no armazenamento. Carregue-o de novo." };
  }

  const { error } = await supabase
    .from("products")
    .update({
      ...toRow(p),
      delivery_file_version: fileChanged ? current.delivery_file_version + 1 : current.delivery_file_version,
    })
    .eq("id", id);
  if (error) return dbError(error);

  // Quem já comprou passa a receber o ficheiro novo; o antigo deixa de ser necessário.
  if (fileChanged && current.delivery_file_path) {
    await supabase.storage.from(BUCKETS.productFiles).remove([current.delivery_file_path]);
  }

  revalidatePath("/admin/produtos");
  revalidatePath(`/admin/produtos/${id}`);
  return { ok: true, message: fileChanged ? "Produto guardado. O PDF novo já está em uso." : "Produto guardado." };
}

export async function setProductActive(id: string, active: boolean): Promise<void> {
  const { supabase } = await requireAdmin();
  if (!uuid.safeParse(id).success) return;
  await supabase.from("products").update({ is_active: active }).eq("id", id);
  revalidatePath("/admin/produtos");
  revalidatePath(`/admin/produtos/${id}`);
}

export async function duplicateProduct(id: string): Promise<void> {
  const { supabase } = await requireAdmin();
  const current = await getProduct(supabase, id);
  if (!current) return;

  const base = `${current.slug}-copia`.slice(0, 74);
  const { data: taken } = await supabase.from("products").select("slug").like("slug", `${base}%`);
  const used = new Set((taken ?? []).map((r: { slug: string }) => r.slug));
  let slug = base;
  for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;

  // O PDF é copiado para que trocar o ficheiro de um produto não afecte o outro.
  let filePath: string | null = null;
  if (current.delivery_file_path) {
    filePath = `${crypto.randomUUID()}/${current.delivery_file_path.split("/")[1]}`;
    const { error } = await supabase.storage
      .from(BUCKETS.productFiles)
      .copy(current.delivery_file_path, filePath);
    if (error) {
      console.error("[produtos] copiar PDF", error);
      return;
    }
  }

  const { data: created, error } = await supabase
    .from("products")
    .insert({
      slug,
      name: `${current.name} (cópia)`.slice(0, 120),
      description: current.description,
      price: current.price,
      image_path: current.image_path,
      is_active: false,
      delivery_type: current.delivery_type,
      delivery_file_path: filePath,
      delivery_file_name: current.delivery_file_name,
      delivery_url: current.delivery_url,
      delivery_button_label: current.delivery_button_label,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[produtos] duplicar", error);
    if (filePath) await supabase.storage.from(BUCKETS.productFiles).remove([filePath]);
    return;
  }

  const { data: page } = await supabase.from("checkout_pages").select("*").eq("product_id", id).maybeSingle();
  if (page) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { product_id, updated_at, ...rest } = page;
    await supabase.from("checkout_pages").insert({ ...rest, product_id: created.id });
  } else {
    await supabase
      .from("checkout_pages")
      .insert({ product_id: created.id, payment_instructions: DEFAULT_PAYMENT_INSTRUCTIONS, button_text: DEFAULT_CHECKOUT.buttonText });
  }

  revalidatePath("/admin/produtos");
  redirect(`/admin/produtos/${created.id}?duplicado=1`);
}

/** Link assinado de 60 s para o administrador abrir o PDF actual do produto. */
export async function getProductFileUrl(id: string): Promise<string | null> {
  const { supabase } = await requireAdmin();
  const product = await getProduct(supabase, id);
  if (!product?.delivery_file_path) return null;
  const { data } = await supabase.storage
    .from(BUCKETS.productFiles)
    .createSignedUrl(product.delivery_file_path, 60, { download: product.delivery_file_name ?? true });
  return data?.signedUrl ?? null;
}

export async function saveCheckoutPage(productId: string, input: CheckoutInput): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  if (!(await getProduct(supabase, productId))) return { ok: false, error: "Produto não encontrado." };

  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  const c = parsed.data;

  const { error } = await supabase.from("checkout_pages").upsert({
    product_id: productId,
    logo_path: c.logoPath,
    banner_path: c.bannerPath,
    primary_color: c.primaryColor.toUpperCase(),
    accent_color: c.accentColor.toUpperCase(),
    background_color: c.backgroundColor.toUpperCase(),
    title: c.title,
    description: c.description,
    testimonials: c.testimonials,
    guarantee_text: c.guaranteeText,
    timer_enabled: c.timerEnabled,
    timer_minutes: c.timerEnabled ? c.timerMinutes : null,
    button_text: c.buttonText,
    // As opções vão junto das instruções (campo jsonb), sem precisar de colunas novas.
    payment_instructions: {
      ...c.paymentInstructions,
      options: { nameField: c.nameField, emailField: c.emailField, phoneField: c.phoneField, proofAlwaysVisible: c.proofAlwaysVisible, instructionsMode: c.instructionsMode },
    },
  });
  if (error) {
    console.error("[checkout]", error);
    return { ok: false, error: "Não foi possível guardar. Tente de novo." };
  }

  revalidatePath(`/admin/produtos/${productId}/checkout`);
  return { ok: true, message: "Checkout guardado." };
}
