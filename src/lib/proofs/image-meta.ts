/**
 * Metadados que o telemóvel grava na captura de ecrã (EXIF): quando foi feita e
 * com que programa. Qualquer pessoa os pode alterar, por isso nunca aprovam nada;
 * servem para apanhar imagens editadas (a captura não pode ser anterior ao
 * pagamento que mostra) e programas de edição.
 */
export type ImageMeta = {
  /** Data e hora locais da captura, "AAAA-MM-DDTHH:MM:SS", sem fuso. */
  takenAt: string | null;
  /** Fuso gravado pelo telemóvel, em minutos (Angola = 60). Os iPhone não o gravam nas capturas. */
  offsetMinutes: number | null;
  software: string | null;
};

const TAG = { software: 0x0131, dateTime: 0x0132, exifIfd: 0x8769, original: 0x9003, offset: 0x9010, offsetOriginal: 0x9011 };

/** Lê as etiquetas de texto de um bloco TIFF (o formato do EXIF). */
function readTiff(b: Buffer): Map<number, string> {
  const tags = new Map<number, string>();
  if (b.length < 8) return tags;
  const order = b.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") return tags;
  const le = order === "II";
  const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));

  const directory = (offset: number, depth: number) => {
    if (depth > 2 || offset + 2 > b.length) return;
    const count = u16(offset);
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      if (entry + 12 > b.length) return;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const length = u32(entry + 4);
      if (tag === TAG.exifIfd && type === 4) directory(u32(entry + 8), depth + 1);
      if (type !== 2 || length > 200) continue; // só texto ASCII curto
      const at = length <= 4 ? entry + 8 : u32(entry + 8);
      if (at + length > b.length) continue;
      tags.set(tag, b.toString("latin1", at, at + length).replace(/\0.*$/, "").trim());
    }
  };
  directory(u32(4), 0);
  return tags;
}

function exifBlock(bytes: Uint8Array): Buffer | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length > 8 && b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG") {
    for (let o = 8; o + 12 <= b.length; ) {
      const length = b.readUInt32BE(o);
      const type = b.toString("latin1", o + 4, o + 8);
      if (type === "eXIf") return b.subarray(o + 8, Math.min(b.length, o + 8 + length));
      if (type === "IDAT" || type === "IEND") return null; // o EXIF vem antes da imagem
      o += 12 + length;
    }
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let o = 2; o + 4 <= b.length && b[o] === 0xff; ) {
      const marker = b[o + 1];
      if (marker === 0xda) return null; // início da imagem
      const length = b.readUInt16BE(o + 2);
      if (marker === 0xe1 && b.toString("latin1", o + 4, o + 10) === "Exif\0\0") return b.subarray(o + 10, Math.min(b.length, o + 2 + length));
      o += 2 + length;
    }
  }
  return null;
}

export function readImageMeta(bytes: Uint8Array): ImageMeta {
  const none: ImageMeta = { takenAt: null, offsetMinutes: null, software: null };
  try {
    const block = exifBlock(bytes);
    if (!block) return none;
    const tags = readTiff(block);
    const stamp = (tags.get(TAG.original) ?? tags.get(TAG.dateTime))?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    const offset = (tags.get(TAG.offsetOriginal) ?? tags.get(TAG.offset))?.match(/^([+-])(\d{2}):(\d{2})$/);
    return {
      takenAt: stamp ? `${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:${stamp[6]}` : null,
      offsetMinutes: offset ? (offset[1] === "-" ? -1 : 1) * (+offset[2] * 60 + +offset[3]) : null,
      software: tags.get(TAG.software) || null,
    };
  } catch {
    return none;
  }
}

/** Programas que editam imagens. As capturas de ecrã trazem "Android …" ou nada. */
export const IMAGE_EDITOR =
  /photoshop|lightroom|adobe|picsart|snapseed|canva|gimp|pixlr|photopea|pixelmator|affinity|inshot|facetune|meitu|paint\.net|photo ?editor|polarr|vsco|fotor|befunky|illustrator|inkscape|figma|sketch/i;

/**
 * Instantes possíveis da captura. Sem fuso gravado (os iPhone não o põem nas capturas)
 * não se sabe onde estava o telemóvel: experimentam-se todos os fusos de hora certa.
 * A margem fica então larga — cerca de um dia —, por isso isto só apanha capturas
 * claramente velhas, não diferenças de horas.
 */
export function captureInstants(meta: Pick<ImageMeta, "takenAt" | "offsetMinutes">): number[] {
  if (!meta.takenAt) return [];
  const naive = Date.parse(`${meta.takenAt}Z`);
  if (Number.isNaN(naive)) return [];
  if (meta.offsetMinutes !== null) return [naive - meta.offsetMinutes * 60_000];
  const out: number[] = [];
  for (let hours = -12; hours <= 14; hours++) out.push(naive - hours * 3_600_000);
  return out;
}
