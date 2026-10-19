import { documentObservationAt, mergeDocumentObservation, hasArchiveReading } from './actDocumentObservation.ts';
/**
 * actDocumentos.ts — ITERATION 60.
 *
 * CPNU attaches documents at the ACTUACIÓN level and serves them through two
 * public calls (discovery + download). GCP now ingests them, uploads the bytes
 * to its own bucket and emits the resulting descriptors on each act.
 *
 * There is no canonical documents table in Andromeda: every provider hangs its
 * files off its own act row (SAMAI does it with `anexos_documentos`). CPNU
 * follows the same precedent — `work_item_acts.documentos` (jsonb array) plus
 * `documentos_observados_en`.
 *
 * `documentos_observados_en` is NOT decorative: without it `NULL` and `[]` are
 * indistinguishable, so "the provider says there are none" reads the same as
 * "nobody asked yet" and a half-finished backfill looks like full coverage.
 */

export interface ActDocumento {
  /** Retain provider metadata and provenance, including unlinked descriptors. */
  [key: string]: unknown;
  /** Provider-native identity (idRegDocumento). Never the filename: the same
   *  `01ActaReparto.pdf` repeats across thousands of matters. */
  id: string | null;
  nombre: string | null;
  tipo: string | null;
  descripcion: string | null;
  url: string | null;
  /** ITER66 — provider-authoritative download URL (GCS bucket). */
  gcs_url: string | null;
  /** ITER66 — the provider's own route; public but SPA-broken. Fallback only. */
  url_origen: string | null;
  fecha_carga: string | null;
  estado: string | null;
  /**
   * ITER64 — true when the descriptor carries a retrievable URL.
   * CPNU announces documents on the act (`documentos:[{nombre, url:""}]`,
   * `anexos: 1`) before GCP has resolved the download link. Dropping those
   * descriptors made an announced-but-unlinked PDF read exactly like "the
   * provider says there are none" — a false absence. We keep them and say so.
   */
  disponible: boolean;
}

const ID_KEYS = ["idRegDocumento", "id_reg_documento", "id", "documento_id", "tokenDocumento"];
const NOMBRE_KEYS = ["nombre", "nombre_archivo", "filename", "name"];
const TIPO_KEYS = ["tipo", "tipo_documento", "mime", "content_type", "tipoArchivo"];
const DESC_KEYS = ["descripcion", "description"];
const GCS_KEYS = ["gcs_url", "gcsUrl", "public_url", "url_publica"];
const ORIGEN_KEYS = ["url_origen", "urlOrigen", "urlDescargaOriginal", "url_descarga", "urlDescarga", "urlVer"];
const URL_KEYS = [...GCS_KEYS, "url", "urlDescarga", "url_descarga", "urlVer", ...ORIGEN_KEYS];
const FECHA_KEYS = ["fechaCarga", "fecha_carga", "fecha", "uploaded_at"];
const ESTADO_KEYS = ["estado", "resultado", "status"];

function str(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Normalize the provider's `documentos` payload.
 * Returns `null` when the provider did not express the field at all — that is
 * "not observed", and it must never be flattened into an empty array.
 */
export function normalizeActDocumentos(raw: unknown): ActDocumento[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: ActDocumento[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const src = item as Record<string, unknown>;
    const gcs = str(src, GCS_KEYS);
    const origen = str(src, ORIGEN_KEYS);
    const url = gcs ?? str(src, URL_KEYS);
    const doc: ActDocumento = {
      ...src,
      id: str(src, ID_KEYS),
      nombre: str(src, NOMBRE_KEYS),
      tipo: str(src, TIPO_KEYS),
      descripcion: str(src, DESC_KEYS),
      url,
      gcs_url: gcs,
      url_origen: origen,
      fecha_carga: str(src, FECHA_KEYS),
      estado: str(src, ESTADO_KEYS) ?? (url ? null : "SIN_ENLACE_DEL_PROVEEDOR"),
      disponible: documentObservationAt(src) == null ? !!url : src.descarga_estado === 'descargado_y_leido' && !!(src.pdf_verificacion || hasArchiveReading(src)) && !!url,
    };
    // A descriptor with no identity, no URL and no filename carries nothing.
    if (Object.keys(src).length === 0) continue;
    out.push(doc);
  }
  // Preserve uncertain name-only announcements; a filename cannot establish
  // that a later linked descriptor is the same document.
  return mergeActDocumentos([], out) ?? [];
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Additive union: filenames alone cannot identify two different documents. */
export function mergeActDocumentos(existing: unknown, incoming: unknown): ActDocumento[] | null {
  if (!Array.isArray(existing) && !Array.isArray(incoming)) return null;
  const out: ActDocumento[] = [];
  for (const value of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!value || typeof value !== 'object') continue;
    const doc = { ...value } as ActDocumento;
    const index = out.findIndex((old) => {
      if (old.sha256 && doc.sha256 && old.sha256 !== doc.sha256) return false;
      if (old.id && doc.id && old.id !== doc.id) return false;
      if (old.id && doc.id) return old.id === doc.id;
      const links = [old.url, old.gcs_url, old.url_origen].filter(Boolean);
      return [doc.url, doc.gcs_url, doc.url_origen].some((url) => url && links.includes(url)) || stable(old) === stable(doc);
    });
    if (index < 0) { out.push(doc); continue; }
    const old = out[index];
    let merged = { ...doc, ...old };
    for (const [key, value] of Object.entries(doc)) {
      if (merged[key] === null || merged[key] === undefined || merged[key] === '') merged[key] = value;
    }
    const urls = [...new Set([...(Array.isArray(old.url_alternativas) ? old.url_alternativas : []), ...(Array.isArray(doc.url_alternativas) ? doc.url_alternativas : []), old.url, old.gcs_url, old.url_origen, doc.url, doc.gcs_url, doc.url_origen].filter((url): url is string => typeof url === 'string' && !!url))];
    if (urls.some((url) => ![merged.url, merged.gcs_url, merged.url_origen].includes(url))) merged.url_alternativas = urls;
    merged.disponible = !!(merged.url || merged.gcs_url || merged.url_origen);
    if (merged.disponible && merged.estado === 'SIN_ENLACE_DEL_PROVEEDOR') merged.estado = doc.estado === 'SIN_ENLACE_DEL_PROVEEDOR' ? null : doc.estado;
    merged = mergeDocumentObservation(old, doc, merged) as ActDocumento;
    out[index] = merged;
  }
  return out;
}

/** true when the provider expressed the documents field on this unit. */
export function documentosObserved(raw: unknown): boolean {
  return Array.isArray(raw);
}

/**
 * ITER67 — the read API now emits its OWN `documentos_observados_en`, which is
 * when the provider actually looked, not when we happened to sync. Prefer it;
 * fall back to our sync clock only when the provider stays silent about it.
 */
export function resolveDocumentosObservadosEn(
  raw: unknown,
  providerObservedAt: unknown,
  now: string = new Date().toISOString(),
): string | null {
  if (typeof providerObservedAt === "string" && providerObservedAt.trim()) {
    const parsed = Date.parse(providerObservedAt);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return documentosObserved(raw) ? now : null;
}

/**
 * ITER67 — an act already stored is still allowed to LEARN documents. The old
 * sync skipped duplicates wholesale, so a PDF that materialised after the first
 * read stayed forever as "sin enlace del proveedor". Enrichment only: never
 * replace linked descriptors with poorer ones, never flatten to `[]`.
 */
export function documentosEnrichmentPatch(
  existing: unknown,
  existingObservedAt: string | null,
  incomingRaw: unknown,
  providerObservedAt: unknown,
  now: string = new Date().toISOString(),
): { documentos: ActDocumento[]; documentos_observados_en: string | null } | null {
  const incoming = normalizeActDocumentos(incomingRaw);
  if (!incoming) return null;

  const current = Array.isArray(existing)
    ? (normalizeActDocumentos(existing) ?? [])
    : null;

  const merged = mergeActDocumentos(current, incoming)!;
  const improves = current === null || stable(merged) !== stable(current);

  if (!improves) return null;

  return {
    documentos: merged,
    documentos_observados_en:
      resolveDocumentosObservadosEn(incomingRaw, providerObservedAt, now) ??
      existingObservedAt,
  };
}
