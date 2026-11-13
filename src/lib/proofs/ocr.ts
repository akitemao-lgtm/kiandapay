import "server-only";
import { tmpdir } from "node:os";

/**
 * Leitura do texto de uma imagem. O OCR troca caracteres conforme o contraste,
 * por isso cada imagem é lida três vezes, com tratamentos diferentes, e só se
 * aceita o que pelo menos duas leituras disserem igual (ver receipt-text.ts).
 *
 * - "bin": a preto e branco, bom para texto escuro sobre fundo claro;
 * - "gamma": escurece os meios-tons, para os valores a cinzento claro;
 * - "up15": amplia as imagens pequenas, para letra miúda.
 */
export const OCR_VARIANTS = ["bin", "gamma", "up15"] as const;
export type OcrVariant = (typeof OCR_VARIANTS)[number];

/**
 * Limite do lado maior antes de ler. É o que mais pesa na memória: medido sobre os
 * comprovativos reais desta plataforma, 2000 px aprova 40 dos 80 que o administrador
 * aprovou à mão, 1400 px aprova 31 e 1100 px aprova 27 — em nenhum caso passa algum
 * dos que ele recusou. Se a instância vier a ficar sem memória, baixar para 1400
 * devolve-a ao nível do que já corria antes, à custa de nove aprovações.
 */
const MAX_SIDE = 2000;
const UPSCALED_SIDE = 2600;

// Um de cada vez: o OCR usa cerca de 200 MB e o servidor tem pouca memória.
let queue: Promise<unknown> = Promise.resolve();

const gammaTable = (gamma: number) => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) table[i] = Math.round(255 * (i / 255) ** gamma);
  return table;
};
const DARKEN = gammaTable(2.5);
const UPSCALE_DARKEN = gammaTable(2.0);

type Canvas = import("@napi-rs/canvas").Canvas;
type Image = Awaited<ReturnType<typeof import("@napi-rs/canvas").loadImage>>;

async function draw(image: Image, scale: number): Promise<Canvas> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; // as imagens transparentes ficariam pretas
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function prepare(image: Image, variant: OcrVariant): Promise<Buffer> {
  const longest = Math.max(image.width, image.height);
  const scale = variant === "up15"
    ? Math.min(UPSCALED_SIDE / longest, Math.max(Math.min(1, MAX_SIDE / longest), 1.5))
    : Math.min(1, MAX_SIDE / longest);
  const canvas = await draw(image, scale);
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i];
    const g = p[i + 1];
    const b = p[i + 2];
    const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    let value: number;
    if (variant === "bin") {
      const max = Math.max(r, g, b);
      const saturation = max ? (max - Math.min(r, g, b)) / max : 0;
      // Texto escuro, ou colorido forte (os rótulos cor de laranja do Multicaixa).
      value = luma < 200 || (saturation > 0.45 && max < 250) ? 0 : 255;
    } else {
      value = (variant === "up15" ? UPSCALE_DARKEN : DARKEN)[luma];
    }
    p[i] = p[i + 1] = p[i + 2] = value;
    p[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toBuffer("image/png");
}

/** Uma passagem do OCR, com o motor criado e largado só para ela. */
async function recognize(input: Buffer): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  // "por+eng": o modelo inglês não é para as palavras (os comprovativos não as têm),
  // é para os algarismos — sem ele a leitura dos valores piora muito.
  const worker = await createWorker("por+eng", 1, { cachePath: tmpdir() });
  try {
    const { data } = await worker.recognize(input);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

/**
 * Lê a imagem uma vez por tratamento, pela mesma ordem de OCR_VARIANTS.
 *
 * O motor é largado entre passagens, não no fim: segura cerca de 150 MB e, mantendo-o
 * aberto para as três, o pico sobe o suficiente para arriscar a instância (512 MB, com
 * o servidor a ocupar já uma boa parte). Custa cerca de meio segundo por passagem, que
 * não se nota porque isto corre depois de o cliente ter resposta.
 *
 * `enough` permite parar mais cedo — quando as duas primeiras leituras já concordam
 * em tudo, a terceira não acrescenta nada.
 */
export function readImageTexts(bytes: Uint8Array, enough?: (texts: string[]) => boolean): Promise<string[]> {
  const job = queue.then(async () => {
    const { loadImage } = await import("@napi-rs/canvas");
    let image: Image | null = null;
    try {
      image = await loadImage(Buffer.from(bytes));
    } catch {
      image = null; // formato que o canvas não abre (ex.: HEIC): tenta-se o ficheiro como veio
    }
    const texts: string[] = [];
    for (const variant of OCR_VARIANTS) {
      const input = image ? await prepare(image, variant) : Buffer.from(bytes);
      texts.push(await recognize(input));
      if (!image) break; // sem canvas, os tratamentos dariam todos o mesmo
      if (texts.length >= 2 && enough?.(texts)) break;
    }
    return texts;
  });
  queue = job.catch(() => {});
  return job;
}
