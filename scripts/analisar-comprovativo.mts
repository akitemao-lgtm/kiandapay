// Corre a mesma análise da app sobre um PDF local e mostra o resultado.
// Uso: npx tsx --conditions=react-server scripts/analisar-comprovativo.mts caminho.pdf
import fs from "node:fs";
// Os módulos da app são CommonJS para o tsx: importar dinamicamente e aceitar as duas formas.
const load = async (p: string) => { const m = await import(p); return m.default ?? m; };
const { analyzePdf } = await load("../src/lib/proofs/analyze.ts");
const { extractFields } = await load("../src/lib/proofs/extract.ts");

const file = process.argv[2];
const bytes = new Uint8Array(fs.readFileSync(file));
const a = await analyzePdf(bytes);
const ex = extractFields(a.lines, a.text);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { lines, text, ...meta } = a;
console.log(JSON.stringify({ meta, extracted: ex }, null, 2));
console.log("--- linhas ---");
for (const l of a.lines as { page: number; x: number; y: number; text: string }[]) console.log(`[p${l.page} x=${l.x.toFixed(2)} y=${l.y.toFixed(2)}] ${l.text}`);
