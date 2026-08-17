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

const ID_KEYS = ["idRegDocumento", "id_reg_documento", "id", "documento_id"];
const NOMBRE_KEYS = ["nombre", "nombre_archivo", "filename", "name"];
const TIPO_KEYS = ["tipo", "tipo_documento", "mime", "content_type"];
const DESC_KEYS = ["descripcion", "description"];
const GCS_KEYS = ["gcs_url", "gcsUrl", "public_url", "url_publica"];
const ORIGEN_KEYS = ["url_origen", "urlOrigen", "url_descarga", "urlDescarga"];
const URL_KEYS = [...GCS_KEYS, "url", ...ORIGEN_KEYS];
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
      id: str(src, ID_KEYS),
      nombre: str(src, NOMBRE_KEYS),
      tipo: str(src, TIPO_KEYS),
      descripcion: str(src, DESC_KEYS),
      url,
      gcs_url: gcs,
      url_origen: origen,
      fecha_carga: str(src, FECHA_KEYS),
      estado: str(src, ESTADO_KEYS) ?? (url ? null : "SIN_ENLACE_DEL_PROVEEDOR"),
      disponible: !!url,
    };
    // A descriptor with no identity, no URL and no filename carries nothing.
    if (!doc.id && !doc.url && !doc.url_origen && !doc.nombre) continue;
    out.push(doc);
  }
  // Identity is the provider id or URL; the filename is the last resort so a
  // name-only announcement is still deduplicated instead of discarded.
  const seen = new Set<string>();
  return out.filter((d) => {
    const key = d.id ?? d.url ?? d.nombre ?? "";
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** true when the provider expressed the documents field on this unit. */
export function documentosObserved(raw: unknown): boolean {
  return Array.isArray(raw);
}
