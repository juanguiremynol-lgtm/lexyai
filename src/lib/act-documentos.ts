/**
 * act-documentos — the single place where an act-level document descriptor is
 * turned into (a) an openable URL and (b) a render state.
 *
 * Provider contract (CPNU via GCP): the download URL lives in `gcs_url`, the
 * provider's own route in `url_origen`, and the materialisation state in
 * `estado` (DESCARGADO / PENDIENTE / FALLIDO / INVALIDO / NO_DISPONIBLE).
 * `url` is our normalised alias and may be absent on rows written before the
 * contract was bound — never read it alone.
 */

export interface ActDocumentoLike {
  id?: string | null;
  nombre?: string | null;
  tipo?: string | null;
  descripcion?: string | null;
  url?: string | null;
  gcs_url?: string | null;
  url_origen?: string | null;
  fecha_carga?: string | null;
  estado?: string | null;
  disponible?: boolean | null;
}

export type ActDocumentoState =
  | "DESCARGADO"
  | "PENDIENTE"
  | "FALLIDO"
  | "INVALIDO"
  | "NO_DISPONIBLE"
  | "SIN_ENLACE";

function abs(value: unknown): string | null {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim())
    ? value.trim()
    : null;
}

/** gcs_url is authoritative; url is our alias; url_origen is the fallback. */
export function resolveActDocumentoUrl(doc: ActDocumentoLike | null | undefined): string | null {
  if (!doc) return null;
  return abs(doc.gcs_url) ?? abs(doc.url) ?? abs(doc.url_origen) ?? null;
}

export function actDocumentoState(doc: ActDocumentoLike | null | undefined): ActDocumentoState {
  if (!doc) return "SIN_ENLACE";
  const estado = String(doc.estado ?? "").toUpperCase();
  if (resolveActDocumentoUrl(doc)) return "DESCARGADO";
  if (estado.includes("PENDIENTE")) return "PENDIENTE";
  if (estado.includes("FALLIDO")) return "FALLIDO";
  if (estado.includes("INVALIDO")) return "INVALIDO";
  if (estado.includes("NO_DISPONIBLE")) return "NO_DISPONIBLE";
  return "SIN_ENLACE";
}

/** Spanish, user-facing reason shown when there is nothing to download yet. */
export function actDocumentoStateLabel(state: ActDocumentoState): string {
  switch (state) {
    case "DESCARGADO":
      return "Disponible";
    case "PENDIENTE":
      return "En descarga";
    case "FALLIDO":
      return "Descarga fallida";
    case "INVALIDO":
      return "Documento inválido";
    case "NO_DISPONIBLE":
      return "No disponible en el proveedor";
    default:
      return "Sin enlace del proveedor";
  }
}

export function actDocumentoLabel(doc: ActDocumentoLike, idx = 0): string {
  return (
    (typeof doc.nombre === "string" && doc.nombre.trim()) ||
    (typeof doc.descripcion === "string" && doc.descripcion.trim()) ||
    `Documento ${idx + 1}`
  );
}

export function extractActDocumentos(raw: unknown): ActDocumentoLike[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((d): d is ActDocumentoLike => !!d && typeof d === "object");
}

/**
 * `null` documentos_observados_en means nobody asked the provider yet — that is
 * NOT "no documents", and surfaces must say so.
 */
export function documentosNotAskedYet(observedAt: string | null | undefined): boolean {
  return !observedAt;
}