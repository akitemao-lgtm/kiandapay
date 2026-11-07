// Cria (ou alarga) um modelo de comprovativo a partir de um PDF verdadeiro, como a página Modelos.
// Uso: npx tsx --conditions=react-server scripts/criar-modelo.mts ficheiro.pdf <bank_code> <canal> "<nome>" "<palavra1,palavra2>"
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const load = async (p: string) => { const m = await import(p); return m.default ?? m; };
const { analyzePdf } = await load("../src/lib/proofs/analyze.ts");
const { extractFields } = await load("../src/lib/proofs/extract.ts");
const { saveTemplateSample } = await load("../src/lib/proofs/template-admin.ts");

const [file, bankCode, channel, name, keywords = ""] = process.argv.slice(2);
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const bytes = new Uint8Array(fs.readFileSync(file));
const analysis = await analyzePdf(bytes);
const extracted = extractFields(analysis.lines, analysis.text);
const { data: existing } = await db.from("proof_templates").select("id, name").eq("bank_code", bankCode).eq("channel", channel).eq("is_active", true).limit(1);
const target = existing?.length
  ? { templateId: existing[0].id }
  : { bankCode, channel, name, keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean) };

const r = await saveTemplateSample(db, { analysis, extracted, bytes, target });
console.log(r.ok ? `${"templateId" in target ? "Acrescentado a" : "Criado"} modelo ${r.templateId}` : `Erro: ${r.error}`);
console.log("assinatura:", analysis.signature.valid && analysis.signature.coversWholeFile ? `válida — ${analysis.signature.signer}` : "sem/ inválida");
