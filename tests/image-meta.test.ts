import { describe, expect, it } from "vitest";
import { captureInstants, readImageMeta } from "@/lib/proofs/image-meta";

/** Bloco TIFF (o formato do EXIF) com as etiquetas de texto indicadas. */
function tiff(tags: [number, string][]): Buffer {
  const entries = tags.map(([tag, value]) => ({ tag, value: `${value}\0` }));
  const head = Buffer.alloc(8);
  head.write("II", 0, "latin1");
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(8, 4);
  const table = Buffer.alloc(2 + entries.length * 12 + 4);
  table.writeUInt16LE(entries.length, 0);
  let dataAt = head.length + table.length;
  const blobs: Buffer[] = [];
  entries.forEach((e, i) => {
    const at = 2 + i * 12;
    table.writeUInt16LE(e.tag, at);
    table.writeUInt16LE(2, at + 2); // ASCII
    table.writeUInt32LE(e.value.length, at + 4);
    if (e.value.length <= 4) table.write(e.value, at + 8, "latin1");
    else {
      table.writeUInt32LE(dataAt, at + 8);
      blobs.push(Buffer.from(e.value, "latin1"));
      dataAt += e.value.length;
    }
  });
  return Buffer.concat([head, table, ...blobs]);
}

function png(exif: Buffer | null): Uint8Array {
  const chunk = (type: string, body: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    return Buffer.concat([length, Buffer.from(type, "latin1"), body, Buffer.alloc(4)]);
  };
  const ihdr = chunk("IHDR", Buffer.alloc(13));
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    ...(exif ? [chunk("eXIf", exif)] : []),
    chunk("IDAT", Buffer.alloc(4)),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}

function jpeg(exif: Buffer | null): Uint8Array {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (exif) {
    const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), exif]);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(body.length + 2);
    parts.push(Buffer.from([0xff, 0xe1]), length, body);
  }
  parts.push(Buffer.from([0xff, 0xda]), Buffer.from([0x00, 0x02]));
  return new Uint8Array(Buffer.concat(parts));
}

const DATE_TIME_ORIGINAL = 0x9003;
const DATE_TIME = 0x0132;
const OFFSET_ORIGINAL = 0x9011;
const SOFTWARE = 0x0131;

describe("hora da captura", () => {
  it("lê a data e o fuso de uma captura PNG", () => {
    const bytes = png(tiff([[DATE_TIME_ORIGINAL, "2026:11:03 04:37:43"], [OFFSET_ORIGINAL, "+01:00"], [SOFTWARE, "Android BP4A"]]));
    expect(readImageMeta(bytes)).toEqual({ takenAt: "2026-11-03T04:37:43", offsetMinutes: 60, software: "Android BP4A" });
  });

  it("lê a data de uma fotografia JPEG", () => {
    const bytes = jpeg(tiff([[DATE_TIME, "2026:11:03 04:37:43"]]));
    expect(readImageMeta(bytes)).toMatchObject({ takenAt: "2026-11-03T04:37:43", offsetMinutes: null });
  });

  it("uma imagem sem EXIF não traz nada, e não rebenta", () => {
    expect(readImageMeta(png(null))).toEqual({ takenAt: null, offsetMinutes: null, software: null });
    expect(readImageMeta(jpeg(null))).toEqual({ takenAt: null, offsetMinutes: null, software: null });
    expect(readImageMeta(new Uint8Array([1, 2, 3]))).toEqual({ takenAt: null, offsetMinutes: null, software: null });
  });

  it("não se engana com uma data impossível", () => {
    expect(readImageMeta(png(tiff([[DATE_TIME_ORIGINAL, "sem data"]]))).takenAt).toBe(null);
  });
});

describe("instantes possíveis da captura", () => {
  it("com fuso gravado, há só um instante", () => {
    expect(captureInstants({ takenAt: "2026-11-03T04:37:43", offsetMinutes: 60 }))
      .toEqual([Date.parse("2026-11-03T03:37:43Z")]);
  });

  it("sem fuso, consideram-se todos os fusos de hora certa", () => {
    const instants = captureInstants({ takenAt: "2026-11-03T04:37:43", offsetMinutes: null });
    expect(instants).toHaveLength(27);
    expect(instants).toContain(Date.parse("2026-11-03T03:37:43Z"));
    // Mesmo assim, nunca chega a um dia inteiro de diferença.
    const naive = Date.parse("2026-11-03T04:37:43Z");
    expect(Math.max(...instants.map((t) => Math.abs(t - naive)))).toBeLessThan(15 * 3_600_000);
  });

  it("sem data, não há instantes", () => {
    expect(captureInstants({ takenAt: null, offsetMinutes: null })).toEqual([]);
  });
});
