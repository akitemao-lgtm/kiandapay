// Gera comprovativos FALSOS para testar a verificação (nunca usar como comprovativo real).
// Uso: node scripts/gerar-comprovativo-teste.mjs saida.pdf txn=TX1 "date=16/10/2026 17:20" [amount=5.000,00] [entity=10116] [edit=50.000,00] [appendEof=1]
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "node:fs";
const [out, ...rest] = process.argv.slice(2);
const o = Object.fromEntries(rest.map((a) => a.split("=")));
const fixed = new Date("2026-10-16T10:00:00Z");
const doc = await PDFDocument.create({ updateMetadata: false });
doc.setProducer("BancoTeste PDF Engine 2.1"); doc.setCreator("BancoTeste App Android");
doc.setCreationDate(fixed); doc.setModificationDate(fixed);
const page = doc.addPage([360, 640]);
const reg = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
let y = 590;
const line = (t, f = reg, s = 11) => { page.drawText(t, { x: 30, y, size: s, font: f }); y -= 26; };
line("BancoTeste", bold, 18); line("Comprovativo de Pagamento", bold, 12); line("Pagamento por Referência");
line(`Entidade: ${o.entity ?? "10116"}`); line(`Referência: ${o.ref ?? "955 567 206"}`);
line(`Montante: ${o.amount ?? "5.000,00"} Kz`); line(`Data: ${o.date}`);
line(`Nº Transação: ${o.txn}`); line("Ordenante: Cliente Teste");
let bytes = await doc.save({ useObjectStreams: false });
if (o.edit) { // falsificação típica: tapar o valor com um rectângulo branco e escrever outro
  const d = await PDFDocument.load(bytes); // updateMetadata por omissão: Producer pdf-lib + ModDate
  const p = d.getPage(0); const f = await d.embedFont(StandardFonts.Helvetica);
  p.drawRectangle({ x: 28, y: 432, width: 200, height: 16, color: rgb(1, 1, 1) });
  p.drawText(`Montante: ${o.edit} Kz`, { x: 30, y: 434, size: 11, font: f });
  bytes = await d.save();
}
if (o.appendEof) bytes = Buffer.concat([Buffer.from(bytes), Buffer.from("\n% atualizacao\nstartxref\n0\n%%EOF\n")]);
fs.writeFileSync(out, bytes);
console.log("ok", out);
