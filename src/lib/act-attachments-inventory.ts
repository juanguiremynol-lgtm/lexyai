/** Read-side evidence levels. A reachable PDF header is not a recovered PDF. */
export type AnexosEstado =
  | "desconocido" | "sin_anexos" | "enlaces_sin_verificar" | "cabeceras_verificadas"
  | "pdf_sin_atribuir" | "restringido" | "sesion_requerida" | "error" | "inaccesible" | "disponible" | "parcial";

export const ANDROMEDA_DOCUMENT_BUCKETS = [
  "andromeda-cpnu-documentos-2026", "andromeda-samai-documentos-2026",
] as const;

export function isAndromedaCopyUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  // Inspect the original path too: URL normalises dot segments before exposing pathname.
  if (/%2f|%5c|\\|(?:\/|%2f)(?:\.|%2e){1,2}(?:\/|%2f|$)/i.test(url)) return false;
  let u: URL;
  try { u = new URL(url.trim()); } catch { return false; }
  if (u.protocol !== "https:" || u.hostname !== "storage.googleapis.com") return false;
  if (u.search || u.hash || u.username || u.password || u.port) return false;
  const parts = u.pathname.split("/").filter(Boolean);
  return parts.length >= 2 && (ANDROMEDA_DOCUMENT_BUCKETS as readonly string[]).includes(parts[0]);
}

/** Only a trusted full-file verifier may supply this result, never a provider descriptor. */
export interface FullPdfVerification {
  status: "pdf_verificado";
  http: number;
  descarga_completa: true;
  paginas_legibles: number;
  paginas_totales: number;
  sha256: string;
  bytes: number;
  atribucion: { act_id: string; documento_id: string; evidencia: string };
}
export type VerificationResult =
  | { status: "cabecera_pdf"; http: number }
  | FullPdfVerification
  | { status: "no_pdf"; http: number }
  | { status: "inaccesible"; http: number }
  | { status: "error_red"; detail: string };
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export const PDF_HEADER_READ_LIMIT = 1024;

/** Operational observations become explanations, never tasks for the lawyer. */
export function knownDocumentPendingCause(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const doc = value as Record<string, unknown>;
  if (doc.descarga_estado === 'sin_enlace_de_descarga_autorizado') return 'El origen todavía no ofrece un enlace de descarga utilizable por Andrómeda.';
  if (doc.descarga_estado !== 'no_verificada') return null;
  const recovery = doc.recuperacion_cache as { cacheIssue?: string } | undefined;
  if (recovery?.cacheIssue && recovery.cacheIssue !== 'pointer_missing') {
    return 'La copia almacenada no pudo validarse y todavía no se ha recuperado una sustituta.';
  }
  const error = doc.descarga_error as { kind?: string } | undefined;
  switch (error?.kind) {
    case 'network': case 'http_transient':
      return 'Los intentos automáticos fallaron por un problema temporal de conexión o del portal. Recuperación pendiente en Andrómeda.';
    case 'http_access':
      return 'No recuperado por la vía pública consultada: el portal rechazó esta descarga. No se ha determinado una causa definitiva.';
    case 'token_expired':
      return 'El enlace público caducó y no se obtuvo uno nuevo utilizable en esta consulta.';
    case 'validation':
      return 'El archivo obtenido no superó la comprobación de lectura. Su recuperación sigue pendiente.';
    case 'storage': case 'concurrency':
      return 'Andrómeda no pudo confirmar una copia almacenada válida de este archivo. Recuperación pendiente.';
    default: return 'La descarga automática no obtuvo una copia verificada. Recuperación pendiente en Andrómeda.';
  }
}

/** Bounded HEADER check only. No full download, parsing or attribution is performed here. */
export async function verifyPdfBytes(url: string, fetchImpl: FetchLike, timeoutMs = 8000): Promise<VerificationResult> {
  if (!isAndromedaCopyUrl(url)) return { status: "error_red", detail: "Origen de copia no permitido." };
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
        }
      } finally { await reader.cancel().catch(() => {}); }
    }
    return String.fromCharCode(...head.subarray(0, Math.min(got, 5))) === "%PDF-"
      ? { status: "cabecera_pdf", http: res.status } : { status: "no_pdf", http: res.status };
  } catch (e) {
    return { status: "error_red", detail: (e as Error).message };
  } finally { clearTimeout(t); }
}

interface ActRow {
  id?: string;
  description?: string | null;
  documentos?: unknown;
  documentos_observados_en?: string | null;
  raw_data?: Record<string, unknown> | null;
}
function finiteAttachmentCount(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value.trim()))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
/** Protected description takes precedence over possibly contaminated raw annotation. */
export function announcedAttachmentCount(act: ActRow): number | null {
  const text = String(act.description ?? "");
  const m = text.match(/Documentos\s+anexos:\s*(\d+)/i)
    ?? text.match(/(?:-\s*)?(\d+)\s*-?\s*archivos?\b/i);
  if (m) return finiteAttachmentCount(m[1]);
  const rd = act.raw_data ?? {};
  const inv = rd.anexos_inventario as { anunciados?: unknown; fuente_conteo?: unknown } | undefined;
  // Older inventories inferred the total from the links they happened to
  // receive. That count cannot establish how many annexes the source announced.
  return finiteAttachmentCount(rd.anexos)
    ?? (inv?.fuente_conteo === "descriptores" ? null : finiteAttachmentCount(inv?.anunciados));
}

export function ownCopyCandidates(act: ActRow) {
  const docs = Array.isArray(act.documentos) ? act.documentos : [];
  return docs.filter((d): d is Record<string, unknown> => !!d && typeof d === "object").map((d) => {
    const urls = [d.gcs_url, d.url].filter((u): u is string => typeof u === "string" && !!u.trim());
    const own = urls.find(isAndromedaCopyUrl)?.trim() ?? null;
    return {
      id: typeof d.id === "string" ? d.id : null,
      nombre: typeof d.nombre === "string" ? d.nombre : typeof d.descripcion === "string" ? d.descripcion : null,
      raw: urls[0] ?? null, own,
      causa_pendiente: knownDocumentPendingCause(d),
    };
  });
}
function fullFile(v: VerificationResult | undefined): v is FullPdfVerification {
  return v?.status === "pdf_verificado" && v.descarga_completa === true
    && Number.isSafeInteger(v.paginas_totales) && v.paginas_totales > 0
    && v.paginas_legibles === v.paginas_totales && Number.isSafeInteger(v.bytes) && v.bytes > 5
    && /^[a-f0-9]{64}$/i.test(v.sha256);
}

export function summarizeActAttachments(act: ActRow, verifications: Record<string, VerificationResult> = {}) {
  const observation = act.raw_data?.anexos_observacion as { estado?: string; causa?: string; observado_en?: string; error?: { kind?: string } } | undefined;
  const inv = act.raw_data?.anexos_inventario as { estado?: string; causa?: string } | undefined;
  const cands = ownCopyCandidates(act);
  const archivos = cands.map((c) => {
    const v = c.own ? verifications[c.own] : undefined;
    const completo = fullFile(v);
    const atribuido = completo && !!act.id && v.atribucion?.act_id === act.id
      && !!c.id && v.atribucion.documento_id === c.id && !!v.atribucion.evidencia?.trim();
    return {
      nombre: c.nombre,
      url: c.own && (v?.status === "cabecera_pdf" || completo) ? c.own : null,
      verificacion: !c.own ? (c.raw ? "origen_no_permitido" : "sin_enlace")
        : v?.status === "pdf_verificado" && !completo ? "verificacion_incompleta" : v?.status ?? "no_verificado",
      descarga_completa_y_legible: completo,
      atribuido_a_actuacion: atribuido,
      recuperado: atribuido,
      sha256: completo ? v.sha256 : null,
      causa_pendiente: atribuido ? null : c.causa_pendiente,
    };
  });
  // Duplicate descriptors for the same object never increase the recovered count.
  const uniqueCount = (predicate: (a: typeof archivos[number]) => boolean) =>
    new Set(archivos.filter(predicate).map((a) => a.sha256 ?? a.url)).size;
  const verificados = uniqueCount((a) => a.recuperado);
  const descargados_completos = uniqueCount((a) => a.descarga_completa_y_legible);
  const cabeceras_verificadas = uniqueCount((a) => a.verificacion === "cabecera_pdf");
  const owned = new Set(cands.map((c) => c.own).filter(Boolean)).size;
  const anunciados = announcedAttachmentCount(act);
  const faltantes = anunciados !== null ? Math.max(0, anunciados - verificados) : null;
  // A source count can be stale or inconsistent with the retained inventory.
  // Known documents still lacking verification prevent a completeness claim.
  const recuperacion_completa = anunciados !== null && anunciados > 0
    && verificados === anunciados && archivos.every((a) => a.recuperado);
  let estado: AnexosEstado;
  let causa: string;
  if (recuperacion_completa) {
    estado = "disponible";
    causa = `${verificados} de ${anunciados} PDF completos, legibles y vinculados a esta actuación.`;
  } else if (verificados > 0) {
    estado = "parcial";
    causa = anunciados === null
      ? `${verificados} PDF completos y vinculados; total de anexos desconocido. Recuperación completa no acreditada.`
      : `${verificados} de ${anunciados} PDF completos y vinculados; recuperación completa no acreditada.`;
  } else if (cabeceras_verificadas > 0 || descargados_completos > 0) {
    estado = descargados_completos > 0 ? "pdf_sin_atribuir" : "cabeceras_verificadas";
    causa = descargados_completos > 0
      ? `${descargados_completos} PDF legible(s); falta verificar su vínculo con esta actuación.`
      : `${cabeceras_verificadas} enlace(s) responden con cabecera PDF; archivo completo y vínculo con la actuación sin verificar.`;
  } else if (owned > 0) {
    const allFailed = cands.filter((c) => c.own).every((c) =>
      ["inaccesible", "no_pdf", "error_red"].includes(verifications[c.own!]?.status ?? ""));
    estado = allFailed ? "inaccesible" : "enlaces_sin_verificar";
    causa = allFailed ? "Los enlaces consultados no devolvieron una cabecera PDF; no se acreditó recuperación."
      : `${owned} enlace(s) a copias registrado(s); contenido y vínculo con la actuación sin verificar.`;
  } else if (inv?.estado && ["restringido", "sesion_requerida", "error"].includes(inv.estado)) {
    estado = inv.estado as AnexosEstado;
    causa = inv.causa ?? "Consulta documental registrada por el proveedor.";
  } else if (observation?.estado === 'detalle_sin_inventario') {
    estado = 'desconocido';
    causa = 'No recuperados por la vía pública consultada: el detalle no devolvió un inventario documental. Esto no acredita que los anexos no existan.';
  } else if (observation?.estado === 'respuesta_acceso_denegado') {
    estado = 'restringido';
    causa = 'El portal rechazó esta consulta automática del detalle. La recuperación de sus documentos sigue pendiente.';
  } else if (observation?.estado === 'error_consulta') {
    estado = 'error';
    causa = ['network', 'http_transient'].includes(observation.error?.kind || '')
      ? 'Los intentos automáticos de consultar los documentos fallaron por un problema temporal. Recuperación pendiente en Andrómeda.'
      : 'Andrómeda no pudo obtener una respuesta verificable del detalle documental. Recuperación pendiente.';
  } else if (observation?.estado === 'error_interpretacion' || observation?.estado === 'control_no_disponible') {
    estado = 'desconocido';
    causa = 'Andrómeda no pudo identificar los documentos anunciados en la respuesta del portal. Recuperación pendiente.';
  } else if (observation?.estado === 'detalle_no_consultado_por_presupuesto') {
    estado = 'desconocido';
    causa = 'La consulta automática alcanzó su límite de ejecución antes de obtener estos documentos. Recuperación pendiente en Andrómeda.';
  } else if (anunciados === 0 && cands.length === 0) {
    estado = "sin_anexos";
    causa = "El proveedor declara cero anexos para esta actuación.";
  } else {
    estado = "desconocido";
    causa = anunciados !== null
      ? `La actuación anuncia ${anunciados} anexo(s); sin archivos recuperados y verificados.`
      : "Total de anexos y recuperación de archivos sin verificar.";
  }
  const knownCauses = [...new Set(archivos.map(a => a.causa_pendiente).filter(Boolean))];
  // A retained link is historical evidence. It must not hide what happened in
  // the latest automatic detail lookup, even when no new descriptor arrived.
  const detailCause = observation?.estado === 'detalle_sin_inventario'
    ? 'La última consulta automática no devolvió el inventario documental; recuperación pendiente.'
    : observation?.estado === 'respuesta_acceso_denegado'
    ? 'El portal rechazó la última consulta automática del detalle; recuperación pendiente.'
    : observation?.estado === 'error_consulta'
    ? 'La última consulta automática del detalle falló; recuperación pendiente en Andrómeda.'
    : observation?.estado === 'detalle_no_consultado_por_presupuesto'
    ? 'La consulta automática alcanzó su límite de ejecución antes de obtener estos documentos. Recuperación pendiente en Andrómeda.' : null;
  if (detailCause && owned > 0) knownCauses.push(detailCause);
  if (!recuperacion_completa && knownCauses.length) causa += ` ${knownCauses.join(' ')}`;
  return { estado, causa, anunciados, enlaces_registrados: owned, cabeceras_verificadas,
    documentos_identificados: cands.length, descriptores_sin_enlace: cands.filter(c => !c.raw).length,
    asociaciones_verificadas: archivos.filter(a => a.recuperado).length,
    descargados_completos, verificados, faltantes, recuperacion_completa, archivos,
    observado_en: observation?.observado_en ?? act.documentos_observados_en ?? null };
}
