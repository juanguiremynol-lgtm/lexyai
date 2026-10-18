/**
 * actOriginIdentity.ts — ITER70.
 *
 * Root cause this module closes: SAMAI's read API (external, samai-read-api on
 * GCP) returns memoriales with NO `indice`, NO `fechaRegistro`, `anexos: null`
 * and no URL. Our two identity layers (canonical fingerprint = date + title
 * head, and the semantic key = date + title + fecha_registro) therefore saw two
 * different "RECIBE MEMORIALES ONLINE" filings of the same day as ONE act, and
 * the "longer anotación wins" backfill grafted solicitud B onto row A.
 *
 * The provider does carry an origin identity — inside the text: the ventanilla
 * virtual "solicitud No. NNNN" and its exact radicación timestamp. We extract it
 * here, verbatim, and use it ONLY to refuse a merge between two different
 * origins. Fingerprints are never redefined (fingerprint-immutability rule):
 * when — and only when — an origin conflict is found, a versioned fingerprint
 * (`<v1>_o<hash>`) identifies the second act.
 */

export interface ActOriginIdentity {
  /** Stable key, e.g. `indice:132`, `solicitud:3435550`. null = unknown. */
  key: string | null;
  indice: string | null;
  solicitud: string | null;
  /** Verbatim "dd/mm/yyyy hh:mm:ss" from the text, when present. */
  radicada_en: string | null;
}

const SOLICITUD_RE = /solicitud\s+No\.?\s*(\d{4,})/i;
const RADICADA_EN_RE = /de\s+fecha:\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?)/i;
const ANEXOS_RE = /Documentos\s+anexos:\s*(\d+)/i;
const ARCHIVOS_RE = /-\s*(\d+)\s+archivos?\b/i;

function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined" ? s : null;
}

export function extractActOrigin(input: {
  indice?: unknown;
  anotacion?: unknown;
  description?: unknown;
}): ActOriginIdentity {
  const indice = clean(input.indice);
  const text = `${clean(input.anotacion) ?? ""} ${clean(input.description) ?? ""}`;
  const solicitud = text.match(SOLICITUD_RE)?.[1] ?? null;
  const radicadaEn = text.match(RADICADA_EN_RE)?.[1] ?? null;
  const key = indice
    ? `indice:${indice}`
    : solicitud
      ? `solicitud:${solicitud}`
      : radicadaEn
        ? `radicada:${radicadaEn}`
        : null;
  return { key, indice, solicitud, radicada_en: radicadaEn };
}

/** Origin of an already-stored row (raw_data first, then visible text). */
export function originFromRow(row: {
  description?: string | null;
  raw_data?: Record<string, unknown> | null;
}): ActOriginIdentity {
  const rd = (row.raw_data ?? {}) as Record<string, unknown>;
  const stored = clean(rd.origen_clave);
  if (stored) {
    return {
      key: stored,
      indice: clean(rd.indice),
      solicitud: clean(rd.origen_solicitud),
      radicada_en: clean(rd.origen_radicada_en),
    };
  }
  // The protected `description` is the first text ever written for the row —
  // the most faithful origin. raw_data.anotacion may already be contaminated.
  const fromDesc = extractActOrigin({ indice: rd.indice, description: row.description });
  if (fromDesc.key) return fromDesc;
  return extractActOrigin({ indice: rd.indice, anotacion: rd.anotacion });
}

/**
 * true only when BOTH sides have an origin identity and they differ.
 * Unknown on either side is never treated as a conflict (no new duplicates
 * for providers that do not expose any origin).
 */
export function originsConflict(a: ActOriginIdentity, b: ActOriginIdentity): boolean {
  if (!a.key || !b.key) return false;
  if (a.indice && b.indice) return a.indice !== b.indice;
  if (a.solicitud && b.solicitud) return a.solicitud !== b.solicitud;
  return a.key !== b.key;
}

function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Versioned fingerprint used only after an origin conflict on v1. */
export function originVersionedFingerprint(v1: string, origin: ActOriginIdentity): string {
  if (!origin.key) return v1;
  return `${v1}_o${hash32(origin.key)}`;
}

// ─────────────── Attachment inventory per act ───────────────

export type AnexosEstado =
  | "no_consultado"
  | "restringido"
  | "sesion_requerida"
  | "error"
  | "disponible"
  | "sin_anexos";

export interface AnexosInventario {
  /** Count the provider ANNOUNCED for this act. null = not announced. */
  anunciados: number | null;
  /** Descriptors with a retrievable URL that we actually hold. */
  enlazados: number;
  estado: AnexosEstado;
  causa: string;
  fuente_conteo: "campo_anexos" | "texto_actuacion" | "descriptores" | null;
}

/**
 * Explicit, honest inventory. `sin_anexos` only when the provider SAID zero;
 * a null count is never read as "no attachments".
 */
export function buildAnexosInventario(input: {
  anexos?: unknown;
  anotacion?: unknown;
  documentos?: Array<{ url?: string | null; gcs_url?: string | null }> | null;
  providerError?: string | null;
  reserved?: boolean;
}): AnexosInventario {
  const text = clean(input.anotacion) ?? "";
  const field = Number(input.anexos);
  let anunciados: number | null = null;
  let fuente: AnexosInventario["fuente_conteo"] = null;
  if (input.anexos !== null && input.anexos !== undefined && Number.isFinite(field)) {
    anunciados = field;
    fuente = "campo_anexos";
  } else {
    const m = text.match(ANEXOS_RE) ?? text.match(ARCHIVOS_RE);
    if (m) {
      anunciados = Number(m[1]);
      fuente = "texto_actuacion";
    }
  }
  const docs = Array.isArray(input.documentos) ? input.documentos : null;
  const enlazados = (docs ?? []).filter((d) => !!(d?.gcs_url || d?.url)).length;
  if (docs && anunciados === null && docs.length > 0) {
    anunciados = docs.length;
    fuente = "descriptores";
  }

  let estado: AnexosEstado;
  let causa: string;
  if (input.reserved) {
    estado = "restringido";
    causa = "Expediente o actuación con reserva; no se consultan anexos.";
  } else if (input.providerError) {
    estado = "error";
    causa = `Error del proveedor al consultar anexos: ${input.providerError}`;
  } else if (enlazados > 0) {
    estado = "disponible";
    causa = anunciados !== null && enlazados < anunciados
      ? `Disponibles ${enlazados} de ${anunciados} anunciados.`
      : "Anexos con enlace del proveedor.";
  } else if (anunciados === 0) {
    estado = "sin_anexos";
    causa = "El proveedor informa cero anexos.";
  } else {
    estado = "no_consultado";
    causa = anunciados
      ? `El proveedor anuncia ${anunciados} anexo(s) pero su respuesta no trae enlaces ni descriptores; la consulta documental no se ha realizado.`
      : "El proveedor no informa anexos ni enlaces; sin consulta documental.";
  }
  return { anunciados, enlazados, estado, causa, fuente_conteo: fuente };
}
