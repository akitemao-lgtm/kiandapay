import "server-only";
import { tmpdir } from "node:os";

const MAX_SIDE = 2000;
// Um de cada vez: o OCR usa cerca de 200 MB e o servidor tem pouca memória.
let queue: Promise<unknown> = Promise.resolve();

/** Converte para PNG e limita o tamanho. Se não conseguir, tenta com o ficheiro original. */
async function toPng(bytes: Uint8Array): Promise<Buffer> {
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(Buffer.from(bytes));
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const canvas = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toBuffer("image/png");
  } catch {
    return Buffer.from(bytes);
  }
}

export function readImageText(bytes: Uint8Array): Promise<string> {
  const job = queue.then(async () => {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("por+eng", 1, { cachePath: tmpdir() });
    try {
      const { data } = await worker.recognize(await toPng(bytes));
      return data.text;
    } finally {
      await worker.terminate();
    }
  });
  queue = job.catch(() => {});
  return job;
}
