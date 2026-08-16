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
  /** Provider-native identity (idRegDocumento). Never the filename: the same
   *  `01ActaReparto.pdf` repeats across thousands of matters. */
  id: string | null;
  nombre: string | null;
  tipo: string | null;
  descripcion: string | null;
  url: string | null;
  fecha_carga: string | null;
  estado: string | null;
}

const ID_KEYS = ["idRegDocumento", "id_reg_documento", "id", "documento_id"];
const NOMBRE_KEYS = ["nombre", "nombre_archivo", "filename", "name"];
const TIPO_KEYS = ["tipo", "tipo_documento", "mime", "content_type"];
const DESC_KEYS = ["descripcion", "description"];
const URL_KEYS = ["url", "gcs_url", "url_descarga", "urlDescarga", "public_url", "url_publica"];
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
    const doc: ActDocumento = {
      id: str(src, ID_KEYS),
      nombre: str(src, NOMBRE_KEYS),
      tipo: str(src, TIPO_KEYS),
      descripcion: str(src, DESC_KEYS),
      url: str(src, URL_KEYS),
      fecha_carga: str(src, FECHA_KEYS),
      estado: str(src, ESTADO_KEYS),
    };
    // A descriptor with neither identity nor URL carries nothing retrievable.
    if (!doc.id && !doc.url) continue;
    out.push(doc);
  }
  // Identity is the provider id, never the filename.
  const seen = new Set<string>();
  return out.filter((d) => {
    const key = d.id ?? d.url ?? "";
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** true when the provider expressed the documents field on this unit. */
export function documentosObserved(raw: unknown): boolean {
  return Array.isArray(raw);
}
