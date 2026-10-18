/**
 * Read-side attachment inventory of an act (ITER70 rev.2).
 *
 * - Provenance: a link counts as an Andromeda copy ONLY when it is stored on
 *   the act row the caller can read under RLS AND points at an allow-listed
 *   Andromeda bucket, exact host, no query string, no path traversal.
 * - Availability: a URL is never "available" by itself. `disponible` /
 *   `parcial` require a byte check (ranged GET → `%PDF-`) done with the
 *   existing public-read state of the object; nothing is made public, signed
 *   or re-permissioned here.
 * - Absence of a link proves nothing: without evidence the state is
 *   `desconocido`.
 */

export type AnexosEstado =
  | "desconocido"
  | "sin_anexos"
  | "enlaces_sin_verificar"
  | "restringido"
  | "sesion_requerida"
  | "error"
  | "inaccesible"
  | "disponible"
  | "parcial";

/** Andromeda-owned buckets (observed in production act descriptors). */
export const ANDROMEDA_DOCUMENT_BUCKETS = ["andromeda-cpnu-documentos-2026"] as const;

export function isAndromedaCopyUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.hostname !== "storage.googleapis.com") return false;
  if (u.search || u.hash || u.username || u.password || u.port) return false;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts.some((p) => p === ".." || p === ".")) return false;
  return (ANDROMEDA_DOCUMENT_BUCKETS as readonly string[]).includes(parts[0]);
}

export type VerificationResult =
  | { status: "pdf"; http: number }
  | { status: "no_pdf"; http: number }
  | { status: "inaccesible"; http: number }
  | { status: "error_red"; detail: string };

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const PDF_HEADER_READ_LIMIT = 1024;

/**
 * HEADER check only: confirms the object is reachable and starts with the
 * `%PDF-` magic bytes. It does NOT verify the full file's integrity. Reads at
 * most PDF_HEADER_READ_LIMIT bytes from the stream even if the server ignores
 * Range, then cancels the body. Never follows redirects off the bucket.
 */
export async function verifyPdfBytes(url: string, fetchImpl: FetchLike, timeoutMs = 8000): Promise<VerificationResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "GET", headers: { Range: `bytes=0-${PDF_HEADER_READ_LIMIT - 1}` }, redirect: "manual", signal: ctrl.signal });
    if (res.status !== 200 && res.status !== 206) {
      await res.body?.cancel().catch(() => {});
      return { status: "inaccesible", http: res.status };
    }
    const head = new Uint8Array(PDF_HEADER_READ_LIMIT);
    let got = 0;
    const reader = res.body?.getReader();
    if (reader) {
      try {
        while (got < 5) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          const take = Math.min(value.length, PDF_HEADER_READ_LIMIT - got);
          head.set(value.subarray(0, take), got);
          got += take;
          if (got >= PDF_HEADER_READ_LIMIT) break;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
    const magic = String.fromCharCode(...head.subarray(0, Math.min(got, 5)));
    return magic === "%PDF-" ? { status: "pdf", http: res.status } : { status: "no_pdf", http: res.status };
  } catch (e) {
    return { status: "error_red", detail: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

interface ActRow {
  documentos?: unknown;
  documentos_observados_en?: string | null;
  raw_data?: Record<string, unknown> | null;
}

export interface ArchivoResumen {
  nombre: string | null;
  url: string | null;
  verificacion: VerificationResult["status"] | "no_verificado" | "origen_no_permitido";
}

export function ownCopyCandidates(act: ActRow) {
  const docs = Array.isArray(act.documentos) ? (act.documentos as Array<Record<string, unknown>>) : null;
  return (docs ?? []).map((d) => {
    const raw = [d.gcs_url, d.url].find((u) => typeof u === "string" && u.trim()) as string | undefined;
    return { nombre: (d.nombre as string) ?? null, raw: raw ?? null, own: isAndromedaCopyUrl(raw) ? raw!.trim() : null };
  });
}

export function summarizeActAttachments(act: ActRow, verifications: Record<string, VerificationResult> = {}) {
  const rd = (act.raw_data ?? {}) as Record<string, unknown>;
  const inv = (rd.anexos_inventario ?? null) as
    | { anunciados?: number | null; estado?: string; causa?: string }
    | null;
  const docs = Array.isArray(act.documentos) ? (act.documentos as unknown[]) : null;
  const cands = ownCopyCandidates(act);
  const archivos: ArchivoResumen[] = cands.map((c) => ({
    nombre: c.nombre,
    url: null,
    verificacion: !c.own ? "origen_no_permitido" : verifications[c.own]?.status ?? "no_verificado",
  }));
  cands.forEach((c, i) => {
    if (c.own && verifications[c.own]?.status === "pdf") archivos[i].url = c.own;
  });
  const verificados = archivos.filter((a) => a.verificacion === "pdf").length;
  const owned = cands.filter((c) => c.own).length;
  const anunciados: number | null = inv?.anunciados ?? (docs && docs.length > 0 ? docs.length : null);
  const faltantes = anunciados !== null ? Math.max(0, anunciados - verificados) : null;

  let estado: AnexosEstado;
  let causa: string;
  if (verificados > 0 && anunciados !== null && verificados < anunciados) {
    estado = "parcial";
    causa = `Disponibles ${verificados} de ${anunciados}; faltan ${faltantes}.`;
  } else if (verificados > 0) {
    estado = "disponible";
    causa = anunciados !== null
      ? `Disponibles ${verificados} de ${anunciados} (PDF verificado).`
      : `${verificados} PDF verificado(s); el proveedor no informa el total.`;
  } else if (owned > 0 && Object.keys(verifications).length > 0) {
    estado = "inaccesible";
    causa = `Hay ${owned} enlace(s) registrado(s) a copias de Andromeda, pero ninguno respondió con un PDF legible.`;
  } else if (owned > 0) {
    estado = "enlaces_sin_verificar";
    causa = `${owned} enlace(s) registrado(s); contenido no verificado.`;
  } else if (inv?.estado && ["restringido", "sesion_requerida", "error", "sin_anexos"].includes(inv.estado)) {
    estado = inv.estado as AnexosEstado;
    causa = inv.causa ?? "";
  } else if (docs && docs.length === 0 && act.documentos_observados_en) {
    estado = "sin_anexos";
    causa = "El proveedor informó cero documentos para esta actuación.";
  } else {
    estado = "desconocido";
    causa = anunciados
      ? `La actuación anuncia ${anunciados} anexo(s); no hay evidencia de consulta documental ni copia propia.`
      : "Sin evidencia de consulta documental para esta actuación.";
  }
  return {
    estado,
    causa,
    anunciados,
    verificados,
    faltantes,
    archivos,
    observado_en: act.documentos_observados_en ?? null,
  };
}
