/**
 * canonicalPublicacionMapper.ts — ITERATION 22, item 1.
 *
 * THE SINGLE CANONICAL TRANSFORMATION from a Publicaciones-family provider
 * payload to a `work_item_publicaciones` row.
 *
 * Why this file exists
 * ────────────────────
 * Until iteration 21 two routes mapped the same provider payload independently:
 *
 *   • `providerAdapters/publicacionesAdapter.ts` → emitted one bare row per raw
 *     actuación with `tipo = "Estado"`, `fecha_fijacion = ""`, title = the raw
 *     `titulo`.
 *   • `sync-publicaciones-by-work-item/index.ts` → exploded each actuación into
 *     an *estado* row plus an *individual/providencia* row, with
 *     `tipo = "Providencia"`, `fecha_fijacion = 2025-12-16`, and a dated title.
 *
 * Both then hashed their own version of the fact, so the same publication had
 * two different `hash_fingerprint` values depending on which route produced it.
 * `bridge-reconcile` compared the two and reported a phantom gap (provider 3 /
 * local 6 / missing 3 — arithmetic that cannot describe real data loss).
 *
 * The invariant this module enforces
 * ──────────────────────────────────
 *   1. Explosion (raw actuación → 1..2 canonical units) happens EXACTLY ONCE,
 *      here, and is shared by every route.
 *   2. The canonical row's `hash_fingerprint` is recomputable from the stored
 *      row alone: fingerprint date = `fecha_fijacion ?? published_at` (date
 *      part), fingerprint tipo = the stored `tipo_publicacion`, fingerprint
 *      title = the stored `title`. Any reader (bridge, MCP, a human) can
 *      re-derive identity without knowing which route wrote the row.
 *
 * Routes that MUST use this module (see canonicalMappers_test.ts):
 *   - sync-publicaciones-by-work-item  (cron + manual + retry-queue callers)
 *   - providerAdapters/publicacionesAdapter (demo, wizard, bridge inventory)
 *   - bridge-reconcile (identity comparison)
 *   - provider-sync-external-provider (via providerNormalize.ts)
 */

import { canonicalPubFingerprint } from "./canonicalFingerprint.ts";

// ───────────────────────── date / string helpers ─────────────────────────

export const SPANISH_MONTHS: Record<string, string> = {
  ENERO: "01", FEBRERO: "02", MARZO: "03", ABRIL: "04",
  MAYO: "05", JUNIO: "06", JULIO: "07", AGOSTO: "08",
  SEPTIEMBRE: "09", OCTUBRE: "10", NOVIEMBRE: "11", DICIEMBRE: "12",
};

export function parseDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.slice(0, 10);

  for (const pattern of [/^(\d{2})\/(\d{2})\/(\d{4})$/, /^(\d{2})-(\d{2})-(\d{4})$/]) {
    const m = dateStr.match(pattern);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }

  const spanishLong = dateStr.match(
    /^(\d{1,2})[\s-]+(?:de\s+)?([A-Za-zñÑáéíóúÁÉÍÓÚ]+)[\s-]+(?:de\s+)?(\d{4})$/,
  );
  if (spanishLong) {
    const day = spanishLong[1].padStart(2, "0");
    const month = SPANISH_MONTHS[
      spanishLong[2].toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    ];
    if (month) return `${spanishLong[3]}-${month}-${day}`;
  }
  return null;
}

export function extractDateFromTitle(title: string): string | undefined {
  if (!title) return undefined;

  const yyyymmddMatch = title.match(/(\d{4})(\d{2})(\d{2})\.pdf/i);
  if (yyyymmddMatch) {
    const [, y, mo, d] = yyyymmddMatch;
    if (+y >= 2020 && +y <= 2030 && +mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) {
      return `${y}-${mo}-${d}`;
    }
  }
  const anywhere = title.match(/(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  if (anywhere) return `${anywhere[1]}-${anywhere[2]}-${anywhere[3]}`;

  const spanishMatch = title.match(/(\d{1,2})\s+(?:DE\s+)?(\w+)\s+(?:DE\s+)?(\d{4})/i);
  if (spanishMatch) {
    const month = SPANISH_MONTHS[spanishMatch[2].toUpperCase()];
    if (month) return `${spanishMatch[3]}-${month}-${spanishMatch[1].padStart(2, "0")}`;
  }
  const slashMatch = title.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (slashMatch) return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
  return undefined;
}

export function extractAutoDateFromText(texto: unknown): string | null {
  if (!texto || typeof texto !== "string") return null;
  const src = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const re =
    /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(?:dos\s+mil\s+\w+\s*(?:\((\d{4})\))?|(\d{4}))/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) last = m;
  if (!last) return null;
  const month = SPANISH_MONTHS[last[2].toUpperCase()];
  const year = last[3] || last[4];
  if (!month || !year) return null;
  return `${year}-${month}-${last[1].padStart(2, "0")}`;
}

export function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

export function isProxyPdfUrl(url: string | null | undefined): boolean {
  return !!url && /https:\/\/publicaciones-procesales-api-[^/]+\/pdf\//i.test(url);
}

export function findDocumentByType(raw: any, type: string): any | null {
  if (!Array.isArray(raw?.documentos_pdf)) return null;
  const expected = type.toLowerCase();
  return raw.documentos_pdf.find((doc: any) => {
    const docType = (doc?.tipo || "").toString().toLowerCase();
    const title = (doc?.titulo || "").toString().toLowerCase();
    return docType === expected || title.includes(expected);
  }) || null;
}

// ───────────────────────── canonical unit (post-explosion) ─────────────────

/** One publication as the provider means it, before row-shaping. */
export interface ProviderPubUnit {
  key: string;
  tipo: string;
  asset_id?: string;
  url?: string;
  titulo: string;
  fecha_publicacion?: string | null;
  fecha_hora_inicio?: string | null;
  tipo_evento?: string;
  pdf_url?: string;
  fecha_estado_raw?: string | null;
  fecha_auto_raw?: string | null;
  clasificacion?: { categoria?: string; descripcion?: string; es_descargable?: boolean };
  /** Provider that emitted the unit (`publicaciones` | `samai_estados` | …). */
  _source_provider?: string;
  parte?: string | null;
  raw_data?: Record<string, unknown>;
}

function buildEstadoUnit(raw: any): ProviderPubUnit | null {
  const estadoObj = raw?.estado && typeof raw.estado === "object" ? raw.estado : null;
  const estadoDoc = findDocumentByType(raw, "estado");
  if (!estadoObj && !estadoDoc) return null;

  const estadoPdfUrl = firstNonEmptyString(
    estadoDoc?.pdf_url, estadoObj?.pdf_url, raw?.gcs_url_pdf_estado,
  );
  const estadoTitle = firstNonEmptyString(
    estadoDoc?.titulo, estadoObj?.pdf_nombre, estadoObj?.titulo_original,
  );
  // Estados sync: never repoint an estado row at an auto PDF.
  if (!estadoPdfUrl) return null;

  const estadoDateRaw = firstNonEmptyString(
    estadoDoc?.fecha, estadoObj?.fecha_publicacion, estadoObj?.fecha,
    raw?.fecha_estado, raw?.fecha_fijacion,
  ) || null;
  const autoDoc = findDocumentByType(raw, "auto");
  const autoDateRaw = firstNonEmptyString(
    extractAutoDateFromText(raw?.texto_auto), raw?.fecha_auto, autoDoc?.fecha,
  ) || null;

  return {
    key: `estado:${estadoObj?.article_id || ""}:${estadoObj?.numero || ""}:${estadoDateRaw || ""}:${estadoTitle || ""}`,
    tipo: "Estado Electrónico",
    asset_id: firstNonEmptyString(estadoObj?.article_id, estadoObj?.numero, estadoTitle, estadoDateRaw),
    url: firstNonEmptyString(raw?.entry_url, raw?.url, raw?.enlace, raw?.pdf_referencia_url),
    titulo: estadoTitle || estadoObj?.titulo_original || "Estado Electrónico",
    fecha_publicacion: estadoDateRaw,
    fecha_hora_inicio: null,
    tipo_evento: "Estado Electrónico",
    pdf_url: estadoPdfUrl,
    fecha_estado_raw: estadoDateRaw,
    fecha_auto_raw: autoDateRaw,
    clasificacion: {
      categoria: "Estado Electrónico",
      descripcion: estadoObj?.titulo_original || raw?.descripcion || estadoTitle || "Estado Electrónico",
      es_descargable: !!estadoPdfUrl,
    },
    parte: raw?.parte ?? null,
    raw_data: raw,
  };
}

function buildIndividualUnit(raw: any): ProviderPubUnit | null {
  const autoDoc = findDocumentByType(raw, "auto");
  const individualNombre = firstNonEmptyString(autoDoc?.titulo, raw?.pdf_individual_nombre);
  const individualPdfUrl = firstNonEmptyString(
    autoDoc?.pdf_url,
    isProxyPdfUrl(raw?.pdf_url) ? raw?.pdf_url : undefined,
  );
  if (!individualNombre || !individualPdfUrl) return null;
  if (!isProxyPdfUrl(individualPdfUrl)) return null;

  const fechaActuacion = firstNonEmptyString(autoDoc?.fecha, raw?.fecha, raw?.fecha_auto) || null;
  const estadoObj = raw?.estado && typeof raw.estado === "object" ? raw.estado : null;
  const estadoDateRaw = firstNonEmptyString(
    estadoObj?.fecha_publicacion, estadoObj?.fecha, raw?.fecha_estado, raw?.fecha_fijacion,
  ) || null;

  const displayFecha = fechaActuacion || estadoDateRaw || "";
  const titulo = displayFecha
    ? `Providencia ${individualNombre} — ${displayFecha}`
    : `Providencia ${individualNombre}`;

  return {
    key: `individual:${estadoObj?.article_id || ""}:${individualNombre}:${fechaActuacion || ""}`,
    tipo: "Providencia",
    asset_id: firstNonEmptyString(
      autoDoc?.asset_id, `${estadoObj?.article_id || ""}:${fechaActuacion || ""}:individual`,
    ),
    url: firstNonEmptyString(raw?.entry_url, raw?.url, raw?.pdf_referencia_url),
    titulo,
    fecha_publicacion: fechaActuacion,
    fecha_hora_inicio: null,
    tipo_evento: "Providencia",
    pdf_url: individualPdfUrl,
    fecha_estado_raw: estadoDateRaw,
    fecha_auto_raw: fechaActuacion,
    clasificacion: {
      categoria: "Providencia",
      descripcion: raw?.descripcion || `Providencia ${individualNombre}`,
      es_descargable: true,
    },
    parte: raw?.parte ?? null,
    raw_data: raw,
  };
}

/**
 * Explode a raw provider payload (either `{ actuaciones: [] }`,
 * `{ publicaciones: [] }` or a bare array) into canonical provider units.
 * One raw actuación may yield the estado planilla AND the individual
 * providencia — both are juridically distinct publications.
 */
export function explodeProviderPublicaciones(data: any): ProviderPubUnit[] {
  const rawRows: any[] = Array.isArray(data?.publicaciones)
    ? data.publicaciones
    : Array.isArray(data?.actuaciones)
      ? data.actuaciones
      : Array.isArray(data)
        ? data
        : [];

  return rawRows.flatMap((p: any): ProviderPubUnit[] => {
    const estado = buildEstadoUnit(p);
    const individual = buildIndividualUnit(p);
    const combined: ProviderPubUnit[] = [];
    if (estado) combined.push(estado);
    if (individual) combined.push(individual);
    if (combined.length > 0) return combined;

    // An actuación carrying an embedded `estado` object but no estado PDF
    // belongs to actuaciones/attachments, not to work_item_publicaciones.
    if (p?.estado && typeof p.estado === "object") return [];

    const titulo = p.titulo || p.title || p.actuacion || p.descripcion || p.anotacion
      || p.clasificacion?.descripcion || "Estado";
    const pdfUrl = p.pdf_url || p.pdfUrl || p.url_pdf || p.documento_url || p.documentUrl
      || p.enlace || p.url;
    const key = String(
      p.key || p.id || p.asset_id || p.hash_documento
        || `${p.fecha_publicacion || p.fecha || ""}_${titulo}`,
    );
    const autoFromDocs = Array.isArray(p.documentos_pdf)
      ? (p.documentos_pdf.find((d: any) => (d?.tipo || "").toLowerCase() === "auto")?.fecha ?? null)
      : null;

    return [{
      key,
      tipo: p.tipo || p.tipo_evento || p.tipo_actuacion || p.actuacion || "Estado",
      asset_id: p.asset_id || p.id || p.hash_documento || key,
      url: p.entry_url || p.url || p.enlace,
      titulo,
      fecha_publicacion: p.fecha_publicacion || p.fecha_hora_inicio || p.fechaFijacion
        || p.fechaPublicacion || p.fecha || p.fecha_actuacion || p.fecha_estado || null,
      fecha_hora_inicio: p.fecha_hora_inicio || null,
      tipo_evento: p.tipo_evento || p.tipo || "Estado Electrónico",
      pdf_url: typeof pdfUrl === "string" ? pdfUrl : undefined,
      fecha_estado_raw: p.fecha_estado || p.fecha_fijacion || null,
      fecha_auto_raw: extractAutoDateFromText(p.texto_auto) || p.fecha_auto || autoFromDocs || null,
      clasificacion: p.clasificacion || {
        categoria: p.tipo_evento || p.tipo || "Estado Electrónico",
        descripcion: p.descripcion || p.anotacion || titulo,
        es_descargable: typeof pdfUrl === "string" && pdfUrl.length > 0,
      },
      parte: p.parte ?? null,
      raw_data: p,
    }];
  });
}

// ───────────────────────── canonical row ─────────────────────────

export interface CanonicalPubContext {
  work_item_id: string;
  organization_id: string | null;
  /** Provider key that produced the unit — decides SAMAI date semantics. */
  source?: string;
}

/** Exactly the payload shape accepted by `rpc_upsert_work_item_publicaciones`. */
export interface CanonicalPubRow {
  work_item_id: string;
  organization_id: string | null;
  source: string;
  title: string;
  annotation: string | null;
  pdf_url: string | null;
  entry_url: string | null;
  pdf_available: boolean;
  published_at: string | null;
  fecha_fijacion: string | null;
  fecha_desfijacion: string | null;
  fecha_providencia: string | null;
  tipo_publicacion: string | null;
  hash_fingerprint: string;
  raw_data: unknown;
  date_source: string;
  date_confidence: string;
  raw_schema_version: string;
  sources: string[];
}

function isoAtNoon(d: string | null): string | null {
  return d ? new Date(`${d}T12:00:00Z`).toISOString() : null;
}

/**
 * Map one provider unit to the canonical row. This is the ONLY place a
 * `work_item_publicaciones` payload may be constructed from provider data.
 */
export function toCanonicalPubRow(
  unit: ProviderPubUnit,
  ctx: CanonicalPubContext,
): CanonicalPubRow {
  const sourceProvider = unit._source_provider || ctx.source || "publicaciones";
  const isSamai = sourceProvider === "samai_estados";

  const fechaFromTitle = extractDateFromTitle(unit.titulo || "");
  const parsedFecha = parseDate(unit.fecha_publicacion ?? undefined) || fechaFromTitle || null;
  const parsedEstadoDate = parseDate(unit.fecha_estado_raw ?? undefined);
  const parsedAutoDate = parseDate(unit.fecha_auto_raw ?? undefined);

  // RATIFICADO 6.2 — SAMAI reports providencia dates, never fijación.
  const effectiveEstadoDate = isSamai ? null : parsedEstadoDate;
  const samaiProvidenciaDate = parsedAutoDate || parsedFecha;

  const title = unit.titulo || unit.key || "Sin título";
  const tipo = unit.tipo || unit.clasificacion?.categoria || null;

  // IDENTITY DATE — must be re-derivable from the stored row:
  // fecha_fijacion (date part) when present, else published_at (date part).
  const identityDate = isSamai
    ? samaiProvidenciaDate
    : (effectiveEstadoDate || parsedFecha);

  const hash_fingerprint = canonicalPubFingerprint({
    work_item_id: ctx.work_item_id,
    pub_date: identityDate,
    tipo_publicacion: tipo,
    title,
    party_hint: unit.parte ?? (unit.raw_data as any)?.parte
      ?? (unit.raw_data as any)?.["Docum. a notif."] ?? null,
  });

  const dateSource = parsedFecha
    ? "api_explicit"
    : (fechaFromTitle ? "parsed_title" : "inferred_sync");

  return {
    work_item_id: ctx.work_item_id,
    organization_id: ctx.organization_id,
    source: sourceProvider,
    title,
    annotation: unit.clasificacion?.descripcion || null,
    pdf_url: unit.pdf_url || null,
    entry_url: unit.url || null,
    pdf_available: unit.clasificacion?.es_descargable === true || !!unit.pdf_url,
    published_at: isSamai
      // 00:00 America/Bogota for SAMAI providencia rows.
      ? (samaiProvidenciaDate ? new Date(`${samaiProvidenciaDate}T05:00:00Z`).toISOString() : null)
      : isoAtNoon(parsedFecha),
    fecha_fijacion: isSamai ? null : isoAtNoon(effectiveEstadoDate || parsedFecha),
    fecha_desfijacion: null,
    fecha_providencia: isSamai
      ? (isoAtNoon(parsedAutoDate) || (samaiProvidenciaDate ? new Date(`${samaiProvidenciaDate}T05:00:00Z`).toISOString() : null))
      : isoAtNoon(parsedAutoDate),
    tipo_publicacion: tipo,
    hash_fingerprint,
    raw_data: unit,
    date_source: isSamai ? "api_explicit" : dateSource,
    date_confidence: isSamai ? "medium" : (parsedFecha ? "high" : "low"),
    raw_schema_version: "publicaciones_v3",
    sources: [sourceProvider],
  };
}

/** Full route: provider payload → canonical rows. Used by every ingestion path. */
export function mapProviderPayloadToCanonicalPubRows(
  data: any,
  ctx: CanonicalPubContext,
): CanonicalPubRow[] {
  return explodeProviderPublicaciones(data).map((u) => toCanonicalPubRow(u, ctx));
}

/**
 * Identity of an already-stored canonical row, recomputed from the row itself.
 * `bridge-reconcile` uses this on both sides of the comparison.
 */
export function canonicalPubIdentityFromRow(
  row: { fecha_fijacion?: string | null; published_at?: string | null; tipo_publicacion?: string | null; title?: string | null; raw_data?: any },
  workItemId: string,
): string {
  return canonicalPubFingerprint({
    work_item_id: workItemId,
    pub_date: row.fecha_fijacion ?? row.published_at ?? null,
    tipo_publicacion: row.tipo_publicacion ?? null,
    title: row.title ?? null,
    party_hint: (row.raw_data as any)?.parte ?? null,
  });
}
