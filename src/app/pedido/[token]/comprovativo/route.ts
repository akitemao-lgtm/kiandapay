import { NextResponse } from "next/server";
import { TOKEN_REGEX } from "@/lib/orders/public";
import { MAX_PROOF_BYTES, processProofUpload } from "@/lib/proofs/process";
import { requestMeta } from "@/lib/request";
import { createServiceClient } from "@/lib/supabase/service";
import { kickWebhooks } from "@/lib/webhooks/dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** Recebe o comprovativo, verifica-o e devolve a decisão em segundos. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_REGEX.test(token)) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_PROOF_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "O ficheiro tem de ter no máximo 5 MB." }, { status: 413 });
  }

  const db = createServiceClient();
  const { ip, userAgent } = await requestMeta();
  if (ip) {
    const { data: allowed } = await db.rpc("rate_limit_hit", { p_key: `proof:ip:${ip}`, p_window_seconds: 3600, p_max: 20 });
    if (allowed === false) return NextResponse.json({ error: "Muitas tentativas. Aguarde um pouco." }, { status: 429 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    file = null;
  }
  if (!file || file.size === 0) return NextResponse.json({ error: "Escolha o ficheiro do comprovativo." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await processProofUpload(db, { token, bytes, filename: file.name || null, ip, userAgent });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  kickWebhooks();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
