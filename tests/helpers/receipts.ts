import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Comprovativo sintético com o layout do Multicaixa Express (sem assinatura). */
export async function expressLikeReceipt(opts: {
  amount?: string;
  reference?: string;
  transaction?: string;
  dateTime?: string;
  producer?: string;
} = {}): Promise<Uint8Array> {
  const fixed = new Date("2026-10-16T16:32:35Z");
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer(opts.producer ?? "iText® 7.0.5 ©2000-2017 iText Group NV (AGPL-version)");
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);
  const page = doc.addPage([595, 842]);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const line = (t: string, y: number, font = reg) => page.drawText(t, { x: 140, y, size: 10, font });
  line("Comprovativo Digital", 724, bold);
  line("Detalhe da operação realizada através do canal MULTICAIXA Express.", 674);
  line(`Data - Hora ${opts.dateTime ?? "2026-10-16 15:13:58"}`, 590);
  line("Operação Pagamento de Serviços", 563);
  line("Entidade 10116 - PAYPAY ÁFRICA", 545);
  line(`Referência ${opts.reference ?? "955567206"}`, 522);
  line(`Montante ${opts.amount ?? "5.000,00"} Kz`, 500);
  line(`Transacção ${opts.transaction ?? "21466518"}`, 480);
  return doc.save({ useObjectStreams: false });
}

/** Falsificação típica: tapa o montante com um rectângulo branco e escreve outro por cima. */
export async function tamperAmount(bytes: Uint8Array, newAmount: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes); // atualiza Producer e ModDate, como um editor faria
  const page = doc.getPage(0);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 138, y: 497, width: 160, height: 14, color: rgb(1, 1, 1) });
  page.drawText(`Montante ${newAmount} Kz`, { x: 140, y: 500, size: 10, font });
  return doc.save();
}

/** Gravação incremental acrescentada no fim do ficheiro. */
export function appendIncrementalUpdate(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(Buffer.concat([Buffer.from(bytes), Buffer.from("\n% edicao\nstartxref\n0\n%%EOF\n")]));
}
