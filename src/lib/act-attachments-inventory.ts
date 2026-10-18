/**
 * Read-side summary of an act's attachments (ITER70). Mirrors the states of
 * supabase/functions/_shared/actOriginIdentity.ts. Links are returned only for
 * Andromeda-held copies (GCS); the court's own route is never presented as
 * available (see act-documentos.ts).
 */
export type AnexosEstado =
  | "no_consultado" | "restringido" | "sesion_requerida" | "error" | "disponible" | "sin_anexos";

interface ActRow {
  documentos?: unknown;
  documentos_observados_en?: string | null;
  raw_data?: Record<string, unknown> | null;
}

const OWN_COPY = /^https:\/\/storage\.googleapis\.com\//i;

export function summarizeActAttachments(act: ActRow) {
  const rd = (act.raw_data ?? {}) as Record<string, unknown>;
  const inv = (rd.anexos_inventario ?? null) as
    | { anunciados?: number | null; estado?: AnexosEstado; causa?: string }
    | null;
  const docs = Array.isArray(act.documentos) ? (act.documentos as Array<Record<string, unknown>>) : null;
  const archivos = (docs ?? [])
    .map((d) => {
      const own = [d.gcs_url, d.url].find((u) => typeof u === "string" && OWN_COPY.test(u)) as string | undefined;
      return { nombre: (d.nombre as string) ?? null, url: own ?? null, disponible: !!own };
    });
  const enlazados = archivos.filter((a) => a.disponible).length;

  let estado: AnexosEstado;
  let causa: string;
  if (enlazados > 0) {
    estado = "disponible";
    causa = `${enlazados} archivo(s) con copia en Andromeda.`;
  } else if (inv?.estado && inv.estado !== "disponible") {
    estado = inv.estado;
    causa = inv.causa ?? "";
  } else if (docs && docs.length === 0 && act.documentos_observados_en) {
    estado = "sin_anexos";
    causa = "El proveedor informó cero documentos para esta actuación.";
  } else {
    estado = "no_consultado";
    causa = docs === null
      ? "Sin inventario documental registrado; la consulta de anexos no se ha realizado."
      : "El proveedor anunció documentos sin enlace descargable.";
  }
  return {
    estado,
    causa,
    anunciados: inv?.anunciados ?? (docs ? docs.length : null),
    enlazados,
    archivos: archivos.filter((a) => a.disponible),
    observado_en: act.documentos_observados_en ?? null,
  };
}
