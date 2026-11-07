import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { renderPdfPage } from "@/lib/proofs/analyze";
import { PROOF_BUCKET } from "@/lib/proofs/process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** PNG de uma página do comprovativo, só para o administrador. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const { supabase } = await requireAdmin();
  const { data: proof } = await supabase.from("payment_proofs").select("storage_path, kind").eq("id", id).maybeSingle();
  if (!proof || proof.kind !== "pdf") return new NextResponse(null, { status: 404 });
  const { data: blob } = await supabase.storage.from(PROOF_BUCKET).download(proof.storage_path);
  if (!blob) return new NextResponse(null, { status: 404 });
  const png = await renderPdfPage(new Uint8Array(await blob.arrayBuffer()), Number(n) || 1).catch(() => null);
  if (!png) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=600" },
  });
}
