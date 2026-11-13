/**
 * Corre o aprovador automático sobre os comprovativos que já estão na base de dados
 * e compara a decisão com a que foi tomada na realidade. É a forma de confirmar, sempre
 * que as regras mudam, que nada do que foi recusado passaria a ser aprovado.
 *
 * Uso: npx tsx --conditions=react-server scripts/validar-aprovacao.mts [--limite 200]
 * Precisa de .env.local com NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
 *
 * Os ficheiros descarregados ficam em .cache/comprovativos (fora do Git) e são
 * reutilizados nas corridas seguintes.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const load = async (p: string) => { const m = await import(p); return m.default ?? m; };
const { readImageTexts } = await load("../src/lib/proofs/ocr.ts");
const { readReceiptText } = await load("../src/lib/proofs/receipt-text.ts");
const { readImageMeta } = await load("../src/lib/proofs/image-meta.ts");
const { receiptApproved, receiptChecks } = await load("../src/lib/proofs/receipt-checks.ts");

const limite = Number(process.argv[process.argv.indexOf("--limite") + 1]) || 500;
const CACHE = ".cache/comprovativos";
const GRACE_MS = 24 * 3_600_000;

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

type Row = Record<string, string | number | null> & { orders: Record<string, string | number> };

async function todos(table: string, select: string, order = "created_at"): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(select).order(order).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }
  return out;
}

const proofs = await todos("payment_proofs",
  "id, kind, decision, decision_source, created_at, file_sha256, order_id, ext_paid_at, ext_amount, storage_path, " +
  "orders!payment_proofs_order_id_fkey(order_number, owner_id, amount_due, payment_entity, payment_reference, created_at, expires_at, lead_id)");
const orders = await todos("orders",
  "id, order_number, status, amount_due, payment_entity, payment_reference, created_at, expires_at, lead_id");
// `*` para a validação correr também antes de a migração 0014 estar aplicada.
const settings = await todos("settings", "*", "owner_id");

const imagens = proofs.filter((p) => p.kind === "image");
console.log(`${proofs.length} comprovativos, ${imagens.length} em imagem. A ler…\n`);
fs.mkdirSync(CACHE, { recursive: true });

const capturas = new Map<string, { takenAt: string; order: number }[]>();
const contagem: Record<string, string[]> = {};

for (const p of imagens.slice(-limite)) {
  const o = p.orders;
  const ficheiro = path.join(CACHE, `${p.id}${path.extname(String(p.storage_path))}`);
  if (!fs.existsSync(ficheiro)) {
    const { data, error } = await db.storage.from("payment-proofs").download(String(p.storage_path));
    if (error || !data) { console.error(`#${o.order_number}: ${error?.message}`); continue; }
    fs.writeFileSync(ficheiro, Buffer.from(await data.arrayBuffer()));
  }
  const bytes = new Uint8Array(fs.readFileSync(ficheiro));
  const reading = readReceiptText(await readImageTexts(bytes));
  const capture = readImageMeta(bytes);
  const conta = String(o.owner_id);
  const config = settings.find((s) => s.owner_id === conta);

  const vistas = capturas.get(conta) ?? [];
  const repetida = capture.takenAt ? vistas.find((v) => v.takenAt === capture.takenAt && v.order !== o.order_number) : null;
  if (capture.takenAt) { vistas.push({ takenAt: capture.takenAt, order: Number(o.order_number) }); capturas.set(conta, vistas); }

  const anteriores = orders.filter((x) =>
    x.lead_id === o.lead_id && x.id !== p.order_id && Number(x.amount_due) === Number(o.amount_due) &&
    Date.parse(String(x.created_at)) < Date.parse(String(o.created_at)) &&
    Date.parse(String(x.expires_at)) + GRACE_MS > Date.parse(String(p.created_at)) && x.status !== "paid");

  const repetido = reading.paidAt && reading.amount !== null
    ? proofs.find((q) => q.id !== p.id && q.order_id !== p.order_id && q.decision !== "rejected" &&
        q.orders.owner_id === conta && q.ext_paid_at !== null && q.ext_amount !== null &&
        Math.abs(Date.parse(String(q.ext_paid_at)) - Date.parse(reading.paidAt!)) < 1000 &&
        Math.abs(Number(q.ext_amount) - reading.amount!) < 0.005)
    : null;

  const checks = receiptChecks(reading, {
    order: { ...o, order_number: Number(o.order_number), amount_due: Number(o.amount_due) },
    earlier: anteriores,
    uploadedAt: String(p.created_at),
    reuse: repetido ? { orderNumber: Number(repetido.orders.order_number), sameTransaction: false } : null,
    capture,
    captureReuse: repetida ? { orderNumber: repetida.order } : null,
    allowCaptureTime: config?.allow_screenshot_time !== false,
  });
  // O ficheiro repetido é rejeitado antes destas verificações (regra 5).
  const jaEnviado = proofs.some((q) => q.file_sha256 === p.file_sha256 && Date.parse(String(q.created_at)) < Date.parse(String(p.created_at)));
  const aprova = !jaEnviado && receiptApproved(checks);

  const real = p.decision === "approved" ? "aprovado" : p.decision === "rejected" ? "recusado" : "pendente";
  const chave = `${real} (${p.decision_source}) → ${aprova ? "APROVA" : "manual"}`;
  (contagem[chave] ??= []).push(`#${o.order_number}`);
  if (real === "recusado" && aprova) {
    console.error(`!! #${o.order_number} foi RECUSADO e seria aprovado — ${checks.map((c) => `${c.code}:${c.result}`).join(" ")}`);
  }
}

console.log();
for (const [chave, lista] of Object.entries(contagem).sort()) {
  console.log(String(lista.length).padStart(4), chave, lista.length <= 30 ? lista.join(" ") : "");
}
const errados = Object.entries(contagem).filter(([k]) => k.startsWith("recusado") && k.endsWith("APROVA"));
console.log(errados.length ? "\nFALHA: há comprovativos recusados que passariam." : "\nNenhum comprovativo recusado passaria.");
process.exit(errados.length ? 1 : 0);
