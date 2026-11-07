import "server-only";
import path from "node:path";
import { verifyPdfSignature, type SignatureInfo } from "./signature";

/** Linha de texto reconstruída. Coordenadas normalizadas 0–1, y a partir do topo da página. */
export type TextLine = { text: string; x: number; y: number; page: number };

export type PdfAnalysis = {
  kind: "pdf";
  producer: string | null;
  creator: string | null;
  pdfVersion: string | null;
  creationDate: string | null;
  modDate: string | null;
  encrypted: boolean;
  pageCount: number;
  pageSize: [number, number];
  fonts: string[];
  eofCount: number;
  linearized: boolean;
  /** Secções acrescentadas depois da primeira gravação (edições incrementais). */
  incrementalUpdates: number;
  optionalContent: boolean;
  invisibleText: boolean;
  tinyText: boolean;
  overlappingText: { a: string; b: string }[];
  lines: TextLine[];
  text: string;
  qr: string[];
  signature: SignatureInfo;
};

export type ImageAnalysis = { kind: "image"; qr: string[] };

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<Pdfjs> | null = null;

/** pdfjs corre no próprio processo ("fake worker"), sem Web Worker. */
function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // @ts-expect-error — o módulo do worker não tem declarações de tipos
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return pdfjs;
  })();
  return pdfjsPromise;
}

const STANDARD_FONTS = path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts") + path.sep;

/** "D:20261016171500+01'00'" → ISO */
export function parsePdfDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/);
  if (!m) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00", sign, oh = "00", om = "00"] = m;
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (sign === "+" || sign === "-") ms -= (sign === "+" ? 1 : -1) * (+oh * 60 + +om) * 60_000;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function stripSubset(name: string) {
  return name.replace(/^[A-Z]{6}\+/, "");
}

type Box = { str: string; x: number; y: number; w: number; h: number };

function overlapRatio(a: Box, b: Box) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return smaller > 0 ? (ix * iy) / smaller : 0;
}

async function decodeQrFromCanvas(width: number, height: number, draw: (ctx: import("@napi-rs/canvas").SKRSContext2D) => Promise<void> | void) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const jsQR = (await import("jsqr")).default;
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await draw(ctx);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(new Uint8ClampedArray(img.data.buffer), img.width, img.height);
  return code?.data ? [code.data] : [];
}

export async function analyzePdf(bytes: Uint8Array): Promise<PdfAnalysis> {
  const pdfjs = await loadPdfjs();
  const raw = Buffer.from(bytes).toString("latin1");
  const eofCount = (raw.match(/%%EOF/g) ?? []).length;
  const signature = await verifyPdfSignature(bytes);

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes), // pdfjs transfere o buffer: passar uma cópia
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS,
    verbosity: 0,
  }).promise;

  try {
    const meta = await doc.getMetadata();
    const info = (meta.info ?? {}) as Record<string, unknown>;
    const linearized = info.IsLinearized === true;
    const optional = await doc.getOptionalContentConfig().catch(() => null);
    const optionalContent = optional ? [...optional].length > 0 : false;

    const fonts = new Set<string>();
    const lines: TextLine[] = [];
    const overlapping: { a: string; b: string }[] = [];
    let invisibleText = false;
    let tinyText = false;
    let pageSize: [number, number] = [0, 0];
    const qr: string[] = [];

    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const [x0, y0, x1, y1] = page.view;
      const pw = x1 - x0;
      const ph = y1 - y0;
      if (n === 1) pageSize = [Math.round(pw), Math.round(ph)];

      const ops = await page.getOperatorList();
      ops.fnArray.forEach((fn, i) => {
        if (fn === pdfjs.OPS.setFont) {
          const id = ops.argsArray[i][0] as string;
          if (page.commonObjs.has(id)) {
            const font = page.commonObjs.get(id) as { name?: string };
            if (font?.name) fonts.add(stripSubset(font.name));
          }
        } else if (fn === pdfjs.OPS.setTextRenderingMode && ops.argsArray[i][0] === 3) {
          invisibleText = true;
        }
      });

      const content = await page.getTextContent();
      const boxes: Box[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const [a, b, , d, e, f] = item.transform as number[];
        const size = Math.hypot(a, b) || Math.abs(d);
        if (size < 2) tinyText = true;
        boxes.push({ str: item.str, x: e - x0, y: f - y0, w: item.width, h: item.height || size });
      }

      for (let i = 0; i < boxes.length && overlapping.length < 5; i++) {
        for (let j = i + 1; j < boxes.length && overlapping.length < 5; j++) {
          if (boxes[i].str.trim() !== boxes[j].str.trim() && overlapRatio(boxes[i], boxes[j]) > 0.5) {
            overlapping.push({ a: boxes[i].str, b: boxes[j].str });
          }
        }
      }

      // Agrupar em linhas: mesma linha de base (±2pt), da esquerda para a direita.
      boxes.sort((p, q) => q.y - p.y || p.x - q.x);
      const grouped: Box[][] = [];
      for (const box of boxes) {
        const line = grouped.find((l) => Math.abs(l[0].y - box.y) <= 2);
        if (line) line.push(box);
        else grouped.push([box]);
      }
      for (const line of grouped) {
        line.sort((p, q) => p.x - q.x);
        lines.push({
          text: line.map((b) => b.str.trim()).join(" ").replace(/\s+/g, " "),
          x: line[0].x / pw,
          y: 1 - line[0].y / ph,
          page: n,
        });
      }

      if (n <= 2 && qr.length === 0) {
        const viewport = page.getViewport({ scale: 2.5 });
        const found = await decodeQrFromCanvas(viewport.width, viewport.height, async (ctx) => {
          await page.render({
            canvasContext: ctx as unknown as CanvasRenderingContext2D,
            viewport,
            canvas: ctx.canvas as unknown as HTMLCanvasElement,
          }).promise;
        }).catch(() => []);
        qr.push(...found);
      }
      page.cleanup();
    }

    lines.sort((p, q) => p.page - q.page || p.y - q.y || p.x - q.x);

    return {
      kind: "pdf",
      producer: (info.Producer as string) || null,
      creator: (info.Creator as string) || null,
      pdfVersion: (info.PDFFormatVersion as string) || null,
      creationDate: parsePdfDate(info.CreationDate),
      modDate: parsePdfDate(info.ModDate),
      encrypted: !!info.EncryptFilterName,
      pageCount: doc.numPages,
      pageSize,
      fonts: [...fonts].sort(),
      eofCount,
      linearized,
      incrementalUpdates: Math.max(
        0,
        eofCount - 1 - (linearized ? 1 : 0) - (signature.valid && signature.coversWholeFile ? signature.count : 0),
      ),
      optionalContent,
      invisibleText,
      tinyText,
      overlappingText: overlapping,
      lines,
      text: lines.map((l) => l.text).join("\n"),
      qr,
      signature,
    };
  } finally {
    await doc.destroy();
  }
}

/** Imagens não são lidas (vão sempre para Exceções); só se tenta ler um QR code. */
export async function analyzeImage(bytes: Uint8Array): Promise<ImageAnalysis> {
  try {
    const { loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(Buffer.from(bytes));
    const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
    const qr = await decodeQrFromCanvas(img.width * scale, img.height * scale, (ctx) =>
      ctx.drawImage(img, 0, 0, img.width * scale, img.height * scale),
    );
    return { kind: "image", qr };
  } catch {
    return { kind: "image", qr: [] };
  }
}

/** Página do PDF em PNG (pré-visualização no painel, que funciona também no telemóvel). */
export async function renderPdfPage(bytes: Uint8Array, pageNumber: number, scale = 2): Promise<Buffer | null> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS, verbosity: 0,
  }).promise;
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) return null;
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;
    return canvas.toBuffer("image/png");
  } finally {
    await doc.destroy();
  }
}
