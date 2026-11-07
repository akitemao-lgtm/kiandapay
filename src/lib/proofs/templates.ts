import type { PdfAnalysis } from "./analyze";
import type { Extracted, FieldName, Position } from "./extract";

/**
 * Impressão digital de um formato de comprovativo, construída a partir de
 * comprovativos verdadeiros. Cada amostra nova alarga os valores aceites
 * (ex.: duas versões de fonte da mesma app).
 */
export type Fingerprint = {
  producers: string[];
  creators: string[];
  pdfVersions: string[];
  fonts: string[];
  pageSizes: [number, number][];
  pageCounts: number[];
  maxIncrementalUpdates: number;
  /** Todas as amostras tinham data de modificação = criação. */
  datesEqual: boolean;
  invisibleText: boolean;
  fieldPositions: Partial<Record<FieldName, Position[]>>;
  hasQr: boolean;
  /** Todas as amostras vinham assinadas digitalmente (assinatura válida). */
  signed?: boolean;
  /** SHA-256 dos certificados que assinaram as amostras (o nome pode ser imitado; o certificado não). */
  signerCerts?: string[];
  /** Nome legível de quem assina (só para mostrar). */
  signers?: string[];
  samples: number;
};

export type Detection = { keywords: string[] };

export type TemplateRow = {
  id: string;
  bank_code: string;
  channel: string;
  name: string;
  version: number;
  is_active: boolean;
  allows_auto_approve: boolean;
  detection: Detection;
  fingerprint: Fingerprint;
};

export type CheckOutcome = {
  code: string;
  result: "pass" | "fail" | "warn" | "skip";
  effect: "none" | "reject" | "exception";
  message: string;
  details?: Record<string, unknown>;
};

const POSITION_TOLERANCE = 0.03; // 3% da página
const DATE_TOLERANCE_MS = 2000;

/** Software de edição/conversão que nunca gera comprovativos bancários. */
export const EDITOR_SOFTWARE =
  /(microsoft.*word|word for|libreoffice|openoffice|canva|photoshop|illustrator|inkscape|gimp|sejda|smallpdf|ilovepdf|pdfescape|pdfelement|wondershare|foxit\s*(phantom|editor|pdf\s*editor)|nitro|pdf-?xchange|acrobat\s*(pro|standard)|adobe\s+acrobat(?!\s*reader)|pdf\s*expert|google\s*docs|pdffiller|dochub|formswift|pdf2go|soda\s*pdf|abbyy|pdf\s*candy|xodo|lightpdf|pdfgear|microsoft:\s*print\s*to\s*pdf)/i;

function datesEqual(a: PdfAnalysis) {
  if (!a.creationDate || !a.modDate) return true;
  return Math.abs(new Date(a.creationDate).getTime() - new Date(a.modDate).getTime()) <= DATE_TOLERANCE_MS;
}

const uniq = <T,>(arr: T[]) => [...new Set(arr)];
const sigOk = (a: PdfAnalysis) => a.signature.present && a.signature.valid && a.signature.coversWholeFile;

export function buildFingerprint(a: PdfAnalysis, ex: Extracted, base?: Fingerprint): Fingerprint {
  const positions: Partial<Record<FieldName, Position[]>> = { ...(base?.fieldPositions ?? {}) };
  for (const [field, p] of Object.entries(ex.positions) as [FieldName, Position | undefined][]) {
    if (!p) continue;
    const list = positions[field] ?? [];
    if (!list.some((q) => near(p, q))) list.push(p);
    positions[field] = list;
  }
  const sizes = [...(base?.pageSizes ?? [])];
  if (!sizes.some(([w, h]) => Math.abs(w - a.pageSize[0]) <= 2 && Math.abs(h - a.pageSize[1]) <= 2)) sizes.push(a.pageSize);
  return {
    producers: uniq([...(base?.producers ?? []), a.producer ?? ""]),
    creators: uniq([...(base?.creators ?? []), a.creator ?? ""]),
    pdfVersions: uniq([...(base?.pdfVersions ?? []), a.pdfVersion ?? ""]),
    fonts: uniq([...(base?.fonts ?? []), ...a.fonts]).sort(),
    pageSizes: sizes,
    pageCounts: uniq([...(base?.pageCounts ?? []), a.pageCount]),
    maxIncrementalUpdates: Math.max(base?.maxIncrementalUpdates ?? 0, a.incrementalUpdates),
    datesEqual: (base?.datesEqual ?? true) && datesEqual(a),
    invisibleText: (base?.invisibleText ?? false) || a.invisibleText,
    fieldPositions: positions,
    hasQr: (base?.hasQr ?? false) || a.qr.length > 0,
    signed: (base ? base.signed ?? false : true) && sigOk(a),
    signerCerts: uniq([...(base?.signerCerts ?? []), ...(sigOk(a) && a.signature.certSha256 ? [a.signature.certSha256] : [])]),
    signers: uniq([...(base?.signers ?? []), ...(sigOk(a) && a.signature.signer ? [a.signature.signer] : [])]),
    samples: (base?.samples ?? 0) + 1,
  };
}

function near(p: Position, q: Position) {
  return p.page === q.page && Math.abs(p.x - q.x) <= POSITION_TOLERANCE && Math.abs(p.y - q.y) <= POSITION_TOLERANCE;
}

function jaccard(a: string[], b: string[]) {
  if (!a.length && !b.length) return 1;
  const sa = new Set(a);
  const inter = b.filter((x) => sa.has(x)).length;
  return inter / new Set([...a, ...b]).size;
}

/** Escolhe o modelo activo mais parecido; null = formato desconhecido. */
export function matchTemplate(a: PdfAnalysis, templates: TemplateRow[]): TemplateRow | null {
  const text = a.text.toLowerCase();
  let best: { t: TemplateRow; score: number } | null = null;
  for (const t of templates) {
    if (!t.is_active) continue;
    const kw = t.detection?.keywords ?? [];
    if (kw.length && !kw.every((k) => text.includes(k.toLowerCase()))) continue;
    const f = t.fingerprint;
    let score = 0;
    if (f.producers.includes(a.producer ?? "")) score += 3;
    if (f.creators.includes(a.creator ?? "")) score += 2;
    if (f.pageSizes.some(([w, h]) => Math.abs(w - a.pageSize[0]) <= 2 && Math.abs(h - a.pageSize[1]) <= 2)) score += 2;
    if (jaccard(f.fonts, a.fonts) >= 0.6) score += 2;
    if (kw.length) score += 2;
    if (score >= 5 && (!best || score > best.score)) best = { t, score };
  }
  return best?.t ?? null;
}

/** Verificações de autenticidade. Qualquer falha impede a aprovação automática. */
export function authenticityChecks(
  a: PdfAnalysis,
  ex: Extracted,
  template: TemplateRow | null,
  qrMatches: (payload: string) => boolean,
): CheckOutcome[] {
  const out: CheckOutcome[] = [];
  const fail = (code: string, message: string, details?: Record<string, unknown>) =>
    out.push({ code, result: "fail", effect: "exception", message, details });
  const pass = (code: string, message: string, details?: Record<string, unknown>) =>
    out.push({ code, result: "pass", effect: "none", message, details });
  const skip = (code: string, message: string) => out.push({ code, result: "skip", effect: "none", message });

  // Independentes do modelo
  const software = [a.producer, a.creator].filter(Boolean).join(" / ");
  if (EDITOR_SOFTWARE.test(software)) fail("editor_software", `Criado/alterado por software de edição: ${software}`);
  else pass("editor_software", "Sem sinais de software de edição", { producer: a.producer, creator: a.creator });

  if (a.encrypted) fail("encrypted", "PDF cifrado/protegido");

  const sig = a.signature;
  if (sig.present) {
    if (!sig.valid) fail("digital_signature", `Assinatura digital inválida: o PDF foi alterado depois de assinado${sig.error ? ` (${sig.error})` : ""}`);
    else if (!sig.coversWholeFile) fail("digital_signature", "Foi acrescentado conteúdo ao PDF depois da assinatura digital");
    else if (template?.fingerprint.signerCerts?.length && !template.fingerprint.signerCerts.includes(sig.certSha256 ?? "")) {
      fail("digital_signature", `Assinado com um certificado desconhecido (${sig.signer ?? "?"})`, { cert: sig.certSha256 });
    } else pass("digital_signature", `Assinatura digital válida: ${sig.signer ?? "?"}`, { issuer: sig.issuer, cert: sig.certSha256 });
  } else if (template?.fingerprint.signed) {
    fail("digital_signature", "Este formato é sempre assinado digitalmente, mas este PDF não tem assinatura");
  } else {
    skip("digital_signature", "PDF sem assinatura digital");
  }

  const hidden: string[] = [];
  if (a.optionalContent) hidden.push("camadas (optional content)");
  if (a.tinyText) hidden.push("texto minúsculo");
  if (a.overlappingText.length) hidden.push(`texto sobreposto (“${a.overlappingText[0].a}” / “${a.overlappingText[0].b}”)`);
  if (a.invisibleText && !template?.fingerprint.invisibleText) hidden.push("texto invisível");
  if (hidden.length) fail("hidden_text", `Elementos escondidos ou sobrepostos: ${hidden.join(", ")}`, { overlapping: a.overlappingText });
  else pass("hidden_text", "Sem texto sobreposto nem camadas escondidas");

  if (!template) {
    fail("template_known", "Formato de comprovativo sem modelo de referência");
    for (const c of ["producer", "pdf_version", "fonts", "page_layout", "incremental_updates", "mod_date", "field_positions", "qr_match"]) {
      skip(c, "Sem modelo para comparar");
    }
    return out;
  }
  pass("template_known", `Modelo: ${template.name}`, { templateId: template.id });
  const f = template.fingerprint;

  if (f.producers.includes(a.producer ?? "") && f.creators.includes(a.creator ?? "")) {
    pass("producer", "Produtor/criador iguais ao modelo");
  } else {
    fail("producer", `Produtor/criador diferentes do modelo (${software || "vazio"})`, { expected: f.producers });
  }

  if (f.pdfVersions.includes(a.pdfVersion ?? "")) pass("pdf_version", `Versão PDF ${a.pdfVersion}`);
  else fail("pdf_version", `Versão PDF ${a.pdfVersion ?? "?"} diferente do modelo`, { expected: f.pdfVersions });

  const extraFonts = a.fonts.filter((x) => !f.fonts.includes(x));
  if (extraFonts.length) fail("fonts", `Fontes que o modelo não usa: ${extraFonts.join(", ")}`, { fonts: a.fonts });
  else pass("fonts", "Fontes iguais às do modelo");

  const sizeOk = f.pageSizes.some(([w, h]) => Math.abs(w - a.pageSize[0]) <= 2 && Math.abs(h - a.pageSize[1]) <= 2);
  if (sizeOk && f.pageCounts.includes(a.pageCount)) pass("page_layout", "Tamanho e n.º de páginas iguais ao modelo");
  else fail("page_layout", `Página ${a.pageSize.join("×")} / ${a.pageCount} pág. diferente do modelo`);

  if (a.incrementalUpdates > f.maxIncrementalUpdates) {
    fail("incremental_updates", `O PDF foi gravado ${a.incrementalUpdates + 1} vezes (edição posterior)`);
  } else pass("incremental_updates", "Sem gravações posteriores");

  if (f.datesEqual && !datesEqual(a)) {
    fail("mod_date", "Data de modificação diferente da data de criação", { created: a.creationDate, modified: a.modDate });
  } else pass("mod_date", "Datas de criação/modificação coerentes");

  const misplaced = (Object.entries(f.fieldPositions) as [FieldName, Position[]][])
    .filter(([field, list]) => {
      const p = ex.positions[field];
      return p && !list.some((q) => near(p, q));
    })
    .map(([field]) => field);
  if (misplaced.length) fail("field_positions", `Campos fora da posição do modelo: ${misplaced.join(", ")}`);
  else pass("field_positions", "Campos nas posições do modelo");

  if (!f.hasQr) skip("qr_match", "Este formato não tem QR code");
  else if (!a.qr.length) fail("qr_match", "O modelo tem QR code mas não foi possível lê-lo neste comprovativo");
  else if (!a.qr.some(qrMatches)) fail("qr_match", "O QR code não corresponde aos dados do comprovativo", { qr: a.qr });
  else pass("qr_match", "QR code confere com os dados");

  return out;
}
