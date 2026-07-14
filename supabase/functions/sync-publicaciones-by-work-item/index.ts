/**
 * sync-publicaciones-by-work-item Edge Function
 * 
 * Syncs court publications (estados electrónicos, edictos, PDFs) for registered work items.
 * 
 * ============================================================
 * v3 SYNCHRONOUS API — NO JOB QUEUES, NO POLLING
 * ============================================================
 * The publicaciones API (pp-scraper v3.1.0) is synchronous:
 *   GET  /historico/{radicado}     → returns actuaciones/publicaciones directly
 *   POST /procesar-radicado        → full processing fallback
 * 
 * Features:
 * - Multi-tenant safe: validates user is member of work_item's organization
 * - Only for work items with a valid 23-digit radicado
 * - Fetches from PUBLICACIONES_BASE_URL using EXTERNAL_X_API_KEY
 * - Stores metadata + PDF URLs + DEADLINE FIELDS in work_item_publicaciones table
 * - Idempotent: uses hash_fingerprint to prevent duplicates
 * - Creates alert_instances for new estados with deadline tracking
 * 
 * Input: { work_item_id: string }
 * Output: { ok, inserted_count, skipped_count, newest_publication_date, warnings, errors }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { withSyncTimeline } from "../_shared/syncTimeline.ts";
import { canonicalPubFingerprint } from "../_shared/canonicalFingerprint.ts";
import {
  fetchFromSamaiEstados,
  formatRadicadoForSamai,
} from "../_shared/providerAdapters/samaiEstadosAdapter.ts";
import {
  isOnlineSyncEligible,
  SYNC_COOLDOWN_MS,
} from "../_shared/onlineSyncEligibility.ts";
import { resolveProviders } from "../_shared/providerRouting.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= TYPES =============

type SyncRequest = {
  work_item_id: string;
  _scheduled?: boolean;
};

type InsertedPublication = {
  id: string;
  title: string;
  pdf_url: string | null;
  entry_url: string | null;
  fecha_fijacion: string | null;
  fecha_desfijacion: string | null;
  tipo_publicacion: string | null;
  terminos_inician: string | null;
};

type SyncResult = {
  ok: boolean;
  work_item_id: string;
  inserted_count: number;
  skipped_count: number;
  alerts_created: number;
  attachment_enqueued?: number;
  attachment_enqueue_failed?: number;
  newest_publication_date: string | null;
  warnings: string[];
  errors: string[];
  inserted: InsertedPublication[];
  status?: 'SUCCESS' | 'EMPTY' | 'NO_DATA' | 'ERROR';
  // New canonical taxonomy — replaces the ambiguous SUCCESS + 0/0 outcome
  // that hid the SAMAI Estados contract mismatch for ~3 months.
  result_code?:
    | 'SUCCESS_WITH_DATA'
    | 'SUCCESS_EMPTY'
    | 'PENDING_UPSTREAM'
    | 'CONTRACT_MISMATCH'
    | 'ERROR';
  provider_latency_ms?: number;
  samai_estados_summary?: {
    called: boolean;
    status?: string;
    http_status?: number;
    duration_ms?: number;
    raw_count?: number;
    merged_new?: number;
    contract_mismatch?: boolean;
    error?: string;
  };
};

type PublicacionV3 = {
  key: string;
  tipo: string;
  asset_id?: string;
  url?: string;
  titulo?: string;
  fecha_publicacion?: string | null;
  fecha_hora_inicio?: string | null;
  tipo_evento?: string | null;
  pdf_url?: string;
  // /historico aditivo (2026-07-08): estado.fecha_publicacion → fecha_fijacion;
  // fecha del auto extraída de texto_auto/documentos_pdf → fecha_providencia.
  fecha_estado_raw?: string | null;
  fecha_auto_raw?: string | null;
  clasificacion?: {
    categoria?: string;
    descripcion?: string;
    prioridad?: number;
    es_descargable?: boolean;
  };
};

type FetchResultV3 = {
  ok: boolean;
  publicaciones: PublicacionV3[];
  error?: string;
  latencyMs: number;
  httpStatus?: number;
  found?: boolean;
  resultCode?: 'NO_DATA' | 'SUCCESS' | 'ERROR';
};

// ── Fix B (Paso 3) — Re-scrape gate types ──
type RescrapeDecision = {
  triggered: boolean;
  reason:
    | 'gate_suppressed'
    | 'trigger_accepted'
    | 'trigger_error'
    | 'not_evaluated';
  httpStatus?: number;
  error?: string;
};

const RESCRAPE_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours per work_item

/**
 * Check whether we may fire POST /procesar-radicado for this work_item.
 * Uses `cron_state` as a per-work-item cooldown ledger — SUPPRESS if the
 * last trigger was < RESCRAPE_COOLDOWN_MS ago. Best-effort: on read error
 * we default to ALLOW so a transient DB glitch cannot freeze re-scrapes.
 */
async function checkRescrapeGate(
  supabase: any,
  workItemId: string,
): Promise<{ allow: boolean; lastTriggeredAt: string | null; hoursSince: number | null }> {
  const key = `pub_rescrape:${workItemId}`;
  try {
    const { data } = await supabase
      .from('cron_state')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    const lastIso = data?.value?.last_triggered_at as string | undefined;
    if (!lastIso) return { allow: true, lastTriggeredAt: null, hoursSince: null };
    const lastMs = Date.parse(lastIso);
    if (!Number.isFinite(lastMs)) return { allow: true, lastTriggeredAt: null, hoursSince: null };
    const deltaMs = Date.now() - lastMs;
    const hours = deltaMs / 3_600_000;
    return {
      allow: deltaMs >= RESCRAPE_COOLDOWN_MS,
      lastTriggeredAt: lastIso,
      hoursSince: Number(hours.toFixed(2)),
    };
  } catch (_e) {
    return { allow: true, lastTriggeredAt: null, hoursSince: null };
  }
}

/**
 * Persist the gate ledger (best-effort). Called ONLY when we actually
 * fired the /procesar-radicado trigger, so the cooldown reflects real
 * upstream calls — not suppressed decisions.
 */
async function recordRescrapeTrigger(
  supabase: any,
  workItemId: string,
  radicado: string,
  decision: RescrapeDecision,
): Promise<void> {
  const key = `pub_rescrape:${workItemId}`;
  try {
    // Read current attempts counter for observability
    const { data: existing } = await supabase
      .from('cron_state')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    const attempts = ((existing?.value?.attempts as number | undefined) ?? 0) + 1;
    await supabase
      .from('cron_state')
      .upsert(
        {
          key,
          value: {
            last_triggered_at: new Date().toISOString(),
            radicado,
            attempts,
            last_decision: decision.reason,
            last_http_status: decision.httpStatus ?? null,
            last_error: decision.error ?? null,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' } as any,
      );
  } catch (e: any) {
    console.warn(`[sync-pub] Failed to persist rescrape gate: ${e?.message}`);
  }
}

// ============= HELPERS =============

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Best-effort attempt-row writer. ALWAYS write an external_sync_runs row for
 * publicaciones so CGP/eligible work items are never silently omitted from
 * observability — even on early empty/error returns. Never throws.
 */
async function writePublicacionesAttemptRow(
  supabase: any,
  workItem: any,
  workItemId: string,
  result: any,
  scheduled: boolean | undefined,
  isServiceRole: boolean,
  outcome: 'success' | 'empty' | 'error',
): Promise<void> {
  try {
    const invokedBy = (scheduled || isServiceRole) ? 'CRON' : 'MANUAL';
    const status =
      outcome === 'error' ? 'FAILED'
      : outcome === 'empty' ? 'PARTIAL'
      : 'SUCCESS';
    await supabase.from('external_sync_runs').insert({
      work_item_id: workItemId,
      organization_id: workItem?.organization_id,
      invoked_by: invokedBy,
      trigger_source: 'sync-publicaciones-by-work-item',
      started_at: new Date(Date.now() - (result?.provider_latency_ms || 0)).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: result?.provider_latency_ms || 0,
      status,
      provider_attempts: [
        {
          provider: 'publicaciones',
          data_kind: 'ESTADOS',
          status: outcome,
          latency_ms: result?.provider_latency_ms || 0,
          inserted_count: result?.inserted_count || 0,
          skipped_count: result?.skipped_count || 0,
          result_code: result?.result_code,
        },
        // TUTELA UNION / CPACA: include SAMAI_ESTADOS attempt when present so
        // every early-return path (empty / error) still records per-provider
        // trace evidence for audit ("cuántos trajo cada proveedor").
        ...(result?.samai_estados_summary?.called
          ? [{
              provider: 'samai_estados',
              data_kind: 'ESTADOS',
              status: result.samai_estados_summary.status || 'unknown',
              http_status: result.samai_estados_summary.http_status,
              latency_ms: result.samai_estados_summary.duration_ms || 0,
              raw_count: result.samai_estados_summary.raw_count,
              merged_new: result.samai_estados_summary.merged_new,
              contract_mismatch: result.samai_estados_summary.contract_mismatch || false,
              error: result.samai_estados_summary.error,
            }]
          : []),
      ],
      total_inserted_pubs: result?.inserted_count || 0,
      total_skipped_pubs: result?.skipped_count || 0,
      error_message: result?.errors?.length ? result.errors.join('; ').slice(0, 500) : null,
    });
  } catch (_e) { /* best-effort */ }
}

function errorResponse(code: string, message: string, status: number = 400): Response {
  return jsonResponse({
    ok: false,
    code,
    message,
    timestamp: new Date().toISOString(),
  }, status);
}

function isValidRadicado(radicado: string): boolean {
  const normalized = normalizeRadicado(radicado);
  return normalized.length === 23;
}

/**
 * Normalize radicado input:
 * - Trims whitespace
 * - If starts with 'T' (tutela code), keeps the 'T' prefix and removes spaces
 * - Otherwise removes all non-digits
 */
function normalizeRadicado(radicado: string): string {
  if (!radicado) return '';
  const trimmed = radicado.trim();
  
  // Tutela codes start with T followed by digits
  if (/^[Tt]\d/.test(trimmed)) {
    return trimmed.toUpperCase().replace(/\s+/g, '');
  }
  
  // Standard radicado: remove all non-digits
  return trimmed.replace(/\D/g, '');
}

function parseDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  
  // If already ISO format, return as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 10);
  }
  
  const patterns = [
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    /^(\d{2})-(\d{2})-(\d{4})$/,
  ];

  for (const pattern of patterns) {
    const match = dateStr.match(pattern);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
  }

  // Spanish long form: "3-julio-2026", "18-junio-2026", "3 de julio de 2026"
  const spanishLong = dateStr.match(/^(\d{1,2})[\s-]+(?:de\s+)?([A-Za-zñÑáéíóúÁÉÍÓÚ]+)[\s-]+(?:de\s+)?(\d{4})$/);
  if (spanishLong) {
    const day = spanishLong[1].padStart(2, '0');
    const month = SPANISH_MONTHS[spanishLong[2].toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
    if (month) return `${spanishLong[3]}-${month}-${day}`;
  }

  return null;
}

/**
 * Calculate the next business day after a given date
 * In Colombian legal terms, términos begin the day AFTER fecha_desfijacion
 * Skip weekends (Saturday = 6, Sunday = 0)
 */
function calculateNextBusinessDay(dateStr: string | undefined | null): string | null {
  const parsed = parseDate(dateStr);
  if (!parsed) return null;
  
  const d = new Date(parsed + 'T12:00:00Z');
  d.setDate(d.getDate() + 1);
  
  // Skip weekends (0 = Sunday, 6 = Saturday)
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  
  return d.toISOString().split('T')[0];
}

// Spanish month names for date extraction from titles
const SPANISH_MONTHS: Record<string, string> = {
  'ENERO': '01', 'FEBRERO': '02', 'MARZO': '03', 'ABRIL': '04',
  'MAYO': '05', 'JUNIO': '06', 'JULIO': '07', 'AGOSTO': '08',
  'SEPTIEMBRE': '09', 'OCTUBRE': '10', 'NOVIEMBRE': '11', 'DICIEMBRE': '12'
};

/**
 * Extract date from title - handles multiple formats:
 * - "003Estados20260122.pdf" → 2026-01-22 (YYYYMMDD in filename)
 * - "REGISTRO 1 DE JULIO DE 2024.pdf" → 2024-07-01 (Spanish format)
 * - "22/01/2026" → 2026-01-22 (DD/MM/YYYY)
 */
function extractDateFromTitle(title: string): string | undefined {
  if (!title) return undefined;

  // Pattern 1: "XXXEstadosYYYYMMDD.pdf" (e.g., "003Estados20260122.pdf")
  const yyyymmddMatch = title.match(/(\d{4})(\d{2})(\d{2})\.pdf/i);
  if (yyyymmddMatch) {
    const year = parseInt(yyyymmddMatch[1]);
    const month = parseInt(yyyymmddMatch[2]);
    const day = parseInt(yyyymmddMatch[3]);
    if (year >= 2020 && year <= 2030 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${yyyymmddMatch[1]}-${yyyymmddMatch[2]}-${yyyymmddMatch[3]}`;
    }
  }

  // Pattern 2: "YYYYMMDD" anywhere in string
  const yyyymmddAnywhere = title.match(/(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  if (yyyymmddAnywhere) {
    return `${yyyymmddAnywhere[1]}-${yyyymmddAnywhere[2]}-${yyyymmddAnywhere[3]}`;
  }

  // Pattern 3: "DD DE MONTH_NAME DE YYYY" (Spanish)
  const spanishMatch = title.match(/(\d{1,2})\s+(?:DE\s+)?(\w+)\s+(?:DE\s+)?(\d{4})/i);
  if (spanishMatch) {
    const day = spanishMatch[1].padStart(2, '0');
    const monthName = spanishMatch[2].toUpperCase();
    const year = spanishMatch[3];
    const month = SPANISH_MONTHS[monthName];
    if (month) return `${year}-${month}-${day}`;
  }

  // Pattern 4: "DD/MM/YYYY" or "DD-MM-YYYY"
  const slashMatch = title.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
  }

  return undefined;
}

/**
 * Extract the "fecha del auto" from a texto_auto blob. The judicial texts
 * typically contain phrases like:
 *   "Pasa a Despacho ... hoy 02 de julio de 2026"
 *   "A despacho hoy 17 de junio de 2026"
 *   "Pereira, ... diecisiete (17) de junio de dos mil veintiséis (2026)"
 * The most reliable signal is the "(DD)" or "DD de mes" near the closing of
 * the header/salutation. We scan for "DD de mes de YYYY" (or bare 4-digit year)
 * and return the LAST match — that's usually the auto's own date, not older
 * dates cited within the ruling body.
 */
function extractAutoDateFromText(texto: unknown): string | null {
  if (!texto || typeof texto !== 'string') return null;
  const src = texto
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const re = /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(?:dos\s+mil\s+\w+\s*(?:\((\d{4})\))?|(\d{4}))/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) last = m;
  if (!last) return null;
  const day = last[1].padStart(2, '0');
  const month = SPANISH_MONTHS[last[2].toUpperCase()];
  const year = last[3] || last[4];
  if (!month || !year) return null;
  return `${year}-${month}-${day}`;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function isProxyPdfUrl(url: string | null | undefined): boolean {
  return !!url && /https:\/\/publicaciones-procesales-api-[^/]+\/pdf\//i.test(url);
}

function isLegacyPortalUrl(url: string | null | undefined): boolean {
  return !!url && /ramajudicial\.gov\.co/i.test(url);
}

function normalizeLooseTitle(title: string | null | undefined): string {
  return (title || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\.pdf$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  return value.slice(0, 10);
}

function findDocumentByType(raw: any, type: string): any | null {
  if (!Array.isArray(raw?.documentos_pdf)) return null;
  const expected = type.toLowerCase();
  return raw.documentos_pdf.find((doc: any) => {
    const docType = (doc?.tipo || '').toString().toLowerCase();
    const title = (doc?.titulo || '').toString().toLowerCase();
    return docType === expected || title.includes(expected);
  }) || null;
}

function buildEstadoPublicationFromActuacion(raw: any): PublicacionV3 | null {
  const estadoObj = raw?.estado && typeof raw.estado === 'object' ? raw.estado : null;
  const estadoDoc = findDocumentByType(raw, 'estado');

  if (!estadoObj && !estadoDoc) return null;

  const estadoPdfUrl = firstNonEmptyString(
    estadoDoc?.pdf_url,
    estadoObj?.pdf_url,
    raw?.gcs_url_pdf_estado,
  );
  const estadoTitle = firstNonEmptyString(
    estadoDoc?.titulo,
    estadoObj?.pdf_nombre,
    estadoObj?.titulo_original,
  );

  // This function syncs estados, not autos. If the scraper only has an auto
  // PDF for an actuación and no estado PDF, do not repoint an estado row to
  // the auto PDF and do not create a no-PDF duplicate.
  if (!estadoPdfUrl) return null;

  const estadoDateRaw = firstNonEmptyString(
    estadoDoc?.fecha,
    estadoObj?.fecha_publicacion,
    estadoObj?.fecha,
    raw?.fecha_estado,
    raw?.fecha_fijacion,
  ) || null;
  const autoDoc = findDocumentByType(raw, 'auto');
  const autoDateRaw = firstNonEmptyString(
    extractAutoDateFromText(raw?.texto_auto),
    raw?.fecha_auto,
    autoDoc?.fecha,
  ) || null;

  return {
    key: String(firstNonEmptyString(
      `estado:${estadoObj?.article_id || ''}:${estadoObj?.numero || ''}:${estadoDateRaw || ''}:${estadoTitle || ''}`,
    )),
    tipo: 'Estado Electrónico',
    asset_id: firstNonEmptyString(estadoObj?.article_id, estadoObj?.numero, estadoTitle, estadoDateRaw),
    url: firstNonEmptyString(raw?.entry_url, raw?.url, raw?.enlace, raw?.pdf_referencia_url),
    titulo: estadoTitle || estadoObj?.titulo_original || 'Estado Electrónico',
    fecha_publicacion: estadoDateRaw,
    fecha_hora_inicio: null,
    tipo_evento: 'Estado Electrónico',
    pdf_url: estadoPdfUrl,
    fecha_estado_raw: estadoDateRaw,
    fecha_auto_raw: autoDateRaw,
    clasificacion: {
      categoria: 'Estado Electrónico',
      descripcion: estadoObj?.titulo_original || raw?.descripcion || estadoTitle || 'Estado Electrónico',
      es_descargable: !!estadoPdfUrl,
    },
  };
}

/**
 * Build a SECOND publication row for the "individual" (per-radicado) document
 * that PP's /historico returns alongside the planilla-de-estados. Each
 * actuación exposes:
 *   documentos_pdf[{ tipo: 'estado',  ... }]   ← the planilla (public)
 *   documentos_pdf[{ tipo: 'auto',    ... }]   ← the individual providencia
 *
 * Historically we only ingested the estado and dropped the individual, so
 * the jurídically-relevant document ("No repone auto, concede apelación",
 * etc.) was never visible in Andromeda. This helper emits the individual as
 * its own work_item_publicaciones row with a distinct proxy pdf_url. The
 * fecha_estado_raw is kept identical to the sibling estado so the two rows
 * stay associated on the same fijación event; fecha_auto_raw carries the
 * date of the actuación (which is also the providencia date).
 *
 * The title always includes the actuación date to guarantee unique
 * fingerprints across the 3+ actuaciones a radicado may accumulate
 * (individual filenames like "2026-00521.pdf" repeat across dates).
 */
function buildIndividualPublicationFromActuacion(raw: any): PublicacionV3 | null {
  const autoDoc = findDocumentByType(raw, 'auto');
  const individualNombre = firstNonEmptyString(
    autoDoc?.titulo,
    raw?.pdf_individual_nombre,
  );
  const individualPdfUrl = firstNonEmptyString(
    autoDoc?.pdf_url,
    // raw.pdf_url on the actuación itself points to the actuación PDF in the
    // proxy (Cloud Run) — use it as fallback when documentos_pdf lacks 'auto'.
    isProxyPdfUrl(raw?.pdf_url) ? raw?.pdf_url : undefined,
  );
  if (!individualNombre || !individualPdfUrl) return null;
  // Only ingest proxy URLs — legacy portal links are unauthenticated and
  // become 401/404 after a few days.
  if (!isProxyPdfUrl(individualPdfUrl)) return null;

  const fechaActuacion = firstNonEmptyString(
    autoDoc?.fecha,
    raw?.fecha,
    raw?.fecha_auto,
  ) || null;

  const estadoObj = raw?.estado && typeof raw.estado === 'object' ? raw.estado : null;
  const estadoDateRaw = firstNonEmptyString(
    estadoObj?.fecha_publicacion,
    estadoObj?.fecha,
    raw?.fecha_estado,
    raw?.fecha_fijacion,
  ) || null;

  const displayFecha = fechaActuacion || estadoDateRaw || '';
  const title = displayFecha
    ? `Providencia ${individualNombre} — ${displayFecha}`
    : `Providencia ${individualNombre}`;

  return {
    key: `individual:${estadoObj?.article_id || ''}:${individualNombre}:${fechaActuacion || ''}`,
    tipo: 'Providencia',
    asset_id: firstNonEmptyString(
      autoDoc?.asset_id,
      `${estadoObj?.article_id || ''}:${fechaActuacion || ''}:individual`,
    ),
    url: firstNonEmptyString(raw?.entry_url, raw?.url, raw?.pdf_referencia_url),
    titulo: title,
    fecha_publicacion: fechaActuacion,
    fecha_hora_inicio: null,
    tipo_evento: 'Providencia',
    pdf_url: individualPdfUrl,
    // Keep the fijación date so both rows share the same estado event on the
    // feed; the individual's own date lives in fecha_auto_raw → fecha_providencia.
    fecha_estado_raw: estadoDateRaw,
    fecha_auto_raw: fechaActuacion,
    clasificacion: {
      categoria: 'Providencia',
      descripcion: raw?.descripcion || `Providencia ${individualNombre}`,
      es_descargable: true,
    },
  };
}

async function refreshLegacyPdfRowsForProxy(
  supabase: any,
  workItemId: string,
  organizationId: string,
  fingerprint: string,
  pub: PublicacionV3,
  parsedFecha: string | null,
): Promise<string[]> {
  if (!isProxyPdfUrl(pub.pdf_url)) return [];

  const incomingTitle = normalizeLooseTitle(pub.titulo);
  const incomingDate = parsedFecha || parseDate(pub.fecha_estado_raw) || extractDateFromTitle(pub.titulo || '') || null;

  const { data: candidates, error } = await supabase
    .from('work_item_publicaciones')
    .select('id,title,fecha_fijacion,pdf_url,hash_fingerprint')
    .eq('work_item_id', workItemId)
    .eq('is_archived', false)
    .limit(100);

  if (error || !Array.isArray(candidates)) {
    if (error) console.warn(`[sync-pub] legacy pdf refresh lookup failed: ${error.message}`);
    return [];
  }

  const matched = candidates.filter((row: any) => {
    if (!isLegacyPortalUrl(row?.pdf_url)) return false;
    const existingTitle = normalizeLooseTitle(row?.title);
    const existingDate = dateOnly(row?.fecha_fijacion) || extractDateFromTitle(row?.title || '');
    return row?.hash_fingerprint === fingerprint ||
      (!!incomingTitle && existingTitle === incomingTitle) ||
      (!!incomingDate && existingDate === incomingDate && (
        !incomingTitle || !existingTitle || incomingTitle.includes(existingTitle) || existingTitle.includes(incomingTitle)
      ));
  });

  const refreshedIds: string[] = [];
  for (const row of matched) {
    const { error: updateError } = await supabase
      .from('work_item_publicaciones')
      .update({
        pdf_url: pub.pdf_url,
        pdf_available: true,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    if (updateError) {
      console.warn(`[sync-pub] legacy pdf refresh update failed for ${row.id}: ${updateError.message}`);
      continue;
    }

    refreshedIds.push(row.id);

    try {
      const filename = (pub.pdf_url!.split('/').pop() || pub.titulo || 'attachment.pdf').slice(0, 255);
      await supabase
        .from('estado_attachment_queue')
        .update({
          remote_url: pub.pdf_url,
          status: 'pending',
          attempt_count: 0,
          last_error: null,
          next_retry_at: new Date().toISOString(),
        })
        .eq('publicacion_id', row.id)
        .neq('remote_url', pub.pdf_url)
        .in('status', ['pending', 'failed']);

      await supabase
        .from('estado_attachment_queue')
        .upsert({
          work_item_id: workItemId,
          publicacion_id: row.id,
          organization_id: organizationId,
          remote_url: pub.pdf_url,
          filename,
          status: 'pending',
          attempt_count: 0,
          max_attempts: 5,
          next_retry_at: new Date().toISOString(),
        }, { onConflict: 'publicacion_id,remote_url' } as any);
    } catch (queueErr: any) {
      console.warn(`[sync-pub] legacy pdf refresh queue update failed for ${row.id}: ${queueErr?.message}`);
    }
  }

  if (refreshedIds.length > 0) {
    console.log(`[sync-pub] 🔁 Refreshed ${refreshedIds.length} legacy portal pdf_url row(s) to proxy for ${pub.titulo}`);
  }
  return refreshedIds;
}

/**
 * Try POST /procesar-radicado as final fallback for the pp-scraper v3.1.0 API.
 */
async function tryProcesarFallback(
  baseUrl: string,
  radicado: string,
  headers: Record<string, string>
): Promise<FetchResultV3 | null> {
  const startTime = Date.now();
  const processingTriggeredMessage = 'PROCESSING_TRIGGERED: scrape started; data expected on next /historico read';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  
  try {
    const procesarUrl = `${baseUrl}/procesar-radicado`;
    console.log(`[sync-pub] Trying POST /procesar-radicado`);
    
    const procesarResponse = await fetch(procesarUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ radicado }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!procesarResponse.ok) {
      console.log(`[sync-pub] /procesar-radicado returned ${procesarResponse.status}`);
      const latencyMs = Date.now() - startTime;
      if (procesarResponse.status >= 500) {
        return {
          ok: false,
          publicaciones: [],
          error: `HTTP ${procesarResponse.status}`,
          latencyMs,
          httpStatus: procesarResponse.status,
          found: false,
          resultCode: 'ERROR',
        };
      }

      // /procesar-radicado is a trigger. Non-5xx responses without immediate data
      // are treated as accepted/no-data so remediation does not churn on live scrapes.
      return {
        ok: true,
        publicaciones: [],
        error: processingTriggeredMessage,
        latencyMs,
        httpStatus: procesarResponse.status,
        found: false,
        resultCode: 'NO_DATA',
      };
    }

    let procesarData: any = null;
    try {
      procesarData = await procesarResponse.json();
    } catch (_jsonErr) {
      console.log(`[sync-pub] /procesar-radicado returned ${procesarResponse.status} without JSON body`);
    }

    const extracted = extractPublicacionesFromResponse(procesarData, Date.now() - startTime);
    if (extracted.publicaciones.length === 0) {
      return {
        ok: true,
        publicaciones: [],
        error: processingTriggeredMessage,
        latencyMs: Date.now() - startTime,
        httpStatus: procesarResponse.status,
        found: false,
        resultCode: 'NO_DATA',
      };
    }

    return extracted;
    
  } catch (err: any) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;
    if (err?.name === 'AbortError') {
      console.log(`[sync-pub] /procesar-radicado trigger timed out after 60000ms; treating as processing started`);
      return {
        ok: true,
        publicaciones: [],
        error: processingTriggeredMessage,
        latencyMs,
        found: false,
        resultCode: 'NO_DATA',
      };
    }

    const message = err?.message || String(err);
    if (message.toLowerCase().includes('connection refused')) {
        return {
          ok: false,
          publicaciones: [],
          error: `Connection refused: ${message}`,
          latencyMs,
          httpStatus: 503,
          found: false,
          resultCode: 'ERROR',
        };
      }

    console.warn(`[sync-pub] /procesar-radicado fallback error:`, err);
    return {
      ok: false,
      publicaciones: [],
      error: message,
      latencyMs,
      found: false,
      resultCode: 'ERROR',
    };
  }
}

// ============= v3 SYNCHRONOUS API FETCH =============

/**
 * Fetch publications using v3 synchronous API
 * 
 * Strategy: Call /historico/{radicado} directly (synchronous scraping)
 * This may take 10-90 seconds as it scrapes Rama Judicial live.
 * If that route is not available, try POST /procesar-radicado.
 */
/**
 * Fetch a single endpoint with timeout and retry
 */
async function fetchWithTimeoutAndRetry(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number = 45000,
  maxAttempts: number = 2,
): Promise<{ ok: boolean; response?: Response; error?: string; latencyMs: number; httpStatus?: number }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startMs = Date.now();

    try {
      console.log(`[sync-pub] Attempt ${attempt}/${maxAttempts}: ${url}`);
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startMs;

      if (response.ok) {
        return { ok: true, response, latencyMs, httpStatus: response.status };
      }

      if (response.status === 404) {
        console.log(`[sync-pub] 404 from ${url}`);
        return { ok: false, error: `HTTP 404`, latencyMs, httpStatus: 404 };
      }

      // Server error — retry after delay
      if (response.status >= 500 && attempt < maxAttempts) {
        console.log(`[sync-pub] ${response.status} from ${url}, retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      return { ok: false, error: `HTTP ${response.status}`, latencyMs, httpStatus: response.status };
    } catch (error: any) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startMs;
      if (error.name === 'AbortError') {
        console.error(`[sync-pub] Timeout on ${url} attempt ${attempt} after ${timeoutMs}ms`);
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        return { ok: false, error: `TIMEOUT after ${timeoutMs}ms`, latencyMs };
      }
      return { ok: false, error: error.message || 'Network error', latencyMs };
    }
  }
  return { ok: false, error: 'All attempts exhausted', latencyMs: 0 };
}

async function fetchPublicaciones(
  radicado: string,
  baseUrl: string,
  apiKey: string,
  rescrapeGate?: { allow: boolean; onDecision?: (decision: RescrapeDecision) => void },
): Promise<FetchResultV3> {
  const startTime = Date.now();
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Clean base URL
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');

  // pp-scraper v3.1.0 route contract (verified by OpenAPI):
  //   GET /historico/{radicado}
  // Legacy /snapshot, /search and /buscar routes return 404 on this service.
  const endpoints = [
    `${cleanBaseUrl}/historico/${radicado}`,
  ];

  const endpointStatuses: Array<number | null> = [];

  // Track the last successful /historico empty response so we can decide
  // whether to fire the /procesar-radicado deep-scrape trigger below.
  // Historically the code only triggered when /historico returned 404 or
  // all endpoints failed — but PP frequently answers 200 with an EMPTY
  // publicaciones list when it has never scraped the radicado. In that
  // case the estados feed stayed empty forever because no deep-scrape
  // was ever kicked off. Doctor's rule: on 200-empty from /historico we
  // also fall through to /procesar-radicado (gated), and if that too is
  // empty we return NO_DATA cleanly. The NEXT scheduled sync picks up
  // whatever the trigger produced.
  let historicoEmptyResult: FetchResultV3 | null = null;

  for (const url of endpoints) {
    const result = await fetchWithTimeoutAndRetry(url, headers, 30000, 1);
    endpointStatuses.push(result.httpStatus ?? null);

    if (result.ok && result.response) {
      try {
        const data = await result.response.json();
        const latencyMs = Date.now() - startTime;
        console.log(`[sync-pub] Success from ${url}: total_actuaciones=${data.total_actuaciones_encontradas}, totalResultados=${data.totalResultados}`);
        const extracted = extractPublicacionesFromResponse(data, latencyMs);
        if (extracted.publicaciones.length > 0) {
          return extracted;
        }
        // 200 + empty → keep looking, and if nothing else works fall through
        // to /procesar-radicado so PP is told to actually scrape.
        historicoEmptyResult = extracted;
        break;
      } catch (_jsonErr) {
        console.warn(`[sync-pub] Invalid JSON from ${url}`);
        continue;
      }
    }

    // 404 means try next endpoint; timeout/5xx already retried
    if (result.error?.startsWith('HTTP 404')) {
      console.log(`[sync-pub] ${url} returned 404, trying next endpoint`);
      continue;
    }

    // Timeout or server error after retries — try next endpoint
    console.log(`[sync-pub] ${url} failed: ${result.error}, trying next endpoint`);
  }

  // All primary endpoints exhausted — try POST /procesar-radicado as last resort.
  //
  // Fix B (Paso 3) — RE-SCRAPE GUARDRAIL: only fire this trigger when the
  // caller says the gate allows it. The gate is time-boxed (see cron_state
  // `pub_rescrape:<work_item_id>`) so we cannot hammer the upstream. When
  // suppressed we return NO_DATA cleanly — the NEXT scheduled sync will
  // re-read /historico and pick up whatever the trigger produced. There is
  // NO in-run re-fetch, so this cannot loop.
  if (rescrapeGate && !rescrapeGate.allow) {
    const decision: RescrapeDecision = {
      triggered: false,
      reason: 'gate_suppressed',
    };
    rescrapeGate.onDecision?.(decision);
    console.log(`[sync-pub] Re-scrape gate SUPPRESSED for ${radicado} (cooldown active)`);
    const totalLatency = Date.now() - startTime;
    return historicoEmptyResult ?? {
      ok: true,
      publicaciones: [],
      error: 'NO_DATA: /historico cold; re-scrape suppressed by gate (cooldown active)',
      latencyMs: totalLatency,
      httpStatus: 200,
      found: false,
      resultCode: 'NO_DATA',
    };
  }

  console.log(`[sync-pub] /historico ${historicoEmptyResult ? 'returned 200 EMPTY' : 'exhausted'}, trying /procesar-radicado fallback (gate=${rescrapeGate ? 'allowed' : 'ungated'})`);
  const procesarResult = await tryProcesarFallback(cleanBaseUrl, radicado, headers);
  if (procesarResult) {
    const decision: RescrapeDecision = {
      triggered: true,
      reason: procesarResult.ok ? 'trigger_accepted' : 'trigger_error',
      httpStatus: procesarResult.httpStatus,
      error: procesarResult.error,
    };
    rescrapeGate?.onDecision?.(decision);
    // If /procesar-radicado also came back empty and /historico had already
    // answered 200-empty, prefer the earlier empty (has the correct 200 status)
    // so downstream logs reflect that PP itself has no data — not an error.
    if (procesarResult.publicaciones.length === 0 && historicoEmptyResult) {
      return historicoEmptyResult;
    }
    return procesarResult;
  }

  if (historicoEmptyResult) {
    return historicoEmptyResult;
  }

  const totalLatency = Date.now() - startTime;
  const only404 = endpointStatuses.length > 0 && endpointStatuses.every(status => status === 404);
  if (only404) {
    console.log(`[sync-pub] All endpoints returned 404 for radicado ${radicado}; treating as NO_DATA (${totalLatency}ms)`);
    return {
      ok: true,
      publicaciones: [],
      error: 'NO_DATA: all endpoints returned 404',
      latencyMs: totalLatency,
      httpStatus: 404,
      found: false,
      resultCode: 'NO_DATA',
    };
  }

  console.error(`[sync-pub] ALL endpoints exhausted for radicado ${radicado} (${totalLatency}ms)`);
  return {
    ok: false,
    publicaciones: [],
    error: `All endpoints exhausted (tried /historico, /procesar-radicado) after ${totalLatency}ms`,
    latencyMs: totalLatency,
    resultCode: 'ERROR',
  };
}

/**
 * Extract publications from v3 API response
 */
function extractPublicacionesFromResponse(
  data: any,
  latencyMs: number
): FetchResultV3 {
  // pp-scraper returns { actuaciones: [], total_actuaciones_encontradas }.
  // Older adapters returned { publicaciones: [], found, totalResultados }.
  const rawPublicaciones = Array.isArray(data?.publicaciones)
    ? data.publicaciones
    : Array.isArray(data?.actuaciones)
      ? data.actuaciones
      : Array.isArray(data)
        ? data
        : [];

  if (rawPublicaciones.length === 0) {
    console.log(`[sync-pub] No publications found for this radicado`);
    return { 
      ok: true, 
      publicaciones: [], 
      latencyMs,
      found: false,
      httpStatus: 200,
      resultCode: 'NO_DATA',
    };
    // NOTE: ok=true because the API responded correctly, there are just no publications
  }

  const publicaciones = rawPublicaciones.flatMap((p: any): PublicacionV3[] => {
    const estadoPub = buildEstadoPublicationFromActuacion(p);
    const individualPub = buildIndividualPublicationFromActuacion(p);
    const combined: PublicacionV3[] = [];
    if (estadoPub) combined.push(estadoPub);
    if (individualPub) combined.push(individualPub);
    if (combined.length > 0) return combined;

    // /historico may return actuación-level PDFs with an embedded `estado`
    // object. For this ESTADOS sync, those auto PDFs must not be stored as
    // work_item_publicaciones. They belong to actuaciones/attachments, not the
    // estado publication row.
    if (p?.estado && typeof p.estado === 'object') return [];

    const title = p.titulo || p.title || p.actuacion || p.descripcion || p.anotacion || p.clasificacion?.descripcion || 'Estado';
    const pdfUrl = p.pdf_url || p.pdfUrl || p.url_pdf || p.documento_url || p.documentUrl || p.enlace || p.url;
    const key = String(p.key || p.id || p.asset_id || p.hash_documento || `${p.fecha_publicacion || p.fecha || ''}_${title}`);
    // /historico aditivo: state (fijación) date + auto date
    const estadoObj = p.estado && typeof p.estado === 'object' ? p.estado : null;
    const fechaEstadoRaw =
      estadoObj?.fecha_publicacion || estadoObj?.fecha || p.fecha_estado || p.fecha_fijacion || null;
    const autoFromDocs = Array.isArray(p.documentos_pdf)
      ? (p.documentos_pdf.find((d: any) => (d?.tipo || '').toLowerCase() === 'auto')?.fecha ?? null)
      : null;
    const fechaAutoRaw =
      extractAutoDateFromText(p.texto_auto) || p.fecha_auto || autoFromDocs || null;
    return [{
      key,
      tipo: p.tipo || p.tipo_evento || p.tipo_actuacion || p.actuacion || 'Estado',
      asset_id: p.asset_id || p.id || p.hash_documento || key,
      url: p.entry_url || p.url || p.enlace,
      titulo: title,
      fecha_publicacion: p.fecha_publicacion || p.fecha_hora_inicio || p.fechaFijacion || p.fechaPublicacion || p.fecha || p.fecha_actuacion || p.fecha_estado || null,
      fecha_hora_inicio: p.fecha_hora_inicio || null,
      tipo_evento: p.tipo_evento || p.tipo || 'Estado Electrónico',
      pdf_url: typeof pdfUrl === 'string' ? pdfUrl : undefined,
      fecha_estado_raw: fechaEstadoRaw,
      fecha_auto_raw: fechaAutoRaw,
      clasificacion: p.clasificacion || {
        categoria: p.tipo_evento || p.tipo || 'Estado Electrónico',
        descripcion: p.descripcion || p.anotacion || title,
        es_descargable: typeof pdfUrl === 'string' && pdfUrl.length > 0,
      },
    }];
  });

  console.log(`[sync-pub] Found ${publicaciones.length} publications`);
  return { 
    ok: true, 
    publicaciones, 
    latencyMs,
    found: true,
    httpStatus: 200,
    resultCode: 'SUCCESS',
  };
}

/**
 * Generate unique fingerprint for publication deduplication
 * Uses asset_id (guaranteed unique per publication) or falls back to key/title
 */
function generatePublicacionFingerprint(
  workItemId: string,
  assetId: string | undefined,
  key: string | undefined,
  title: string,
  opts?: { pubDate?: string | null; tipo?: string | null; partyHint?: string | null },
): string {
  // Assets/keys drift across snapshots — intentionally ignored.
  void assetId; void key;
  // Delegate to source-agnostic canonical fingerprint so all write paths
  // share the same identity model (party discriminator + normalized title).
  return canonicalPubFingerprint({
    work_item_id: workItemId,
    pub_date: opts?.pubDate ?? null,
    tipo_publicacion: opts?.tipo ?? null,
    title: (title || 'untitled').replace(/\.pdf$/i, ''),
    party_hint: opts?.partyHint ?? null,
  });
}

// ============= MAIN HANDLER =============

Deno.serve(withSyncTimeline(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check short-circuit
  try {
    const cloned = req.clone();
    let maybeBody: any = null;
    try { maybeBody = await cloned.json(); } catch (_e) { /* not JSON */ }
    if (maybeBody?.health_check) {
      return new Response(JSON.stringify({ status: 'OK', function: 'sync-publicaciones-by-work-item' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch (_healthErr) { /* not JSON, proceed normally */ }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('MISSING_ENV', 'Missing Supabase environment variables', 500);
    }

    // Auth check - support both user tokens and service role (for scheduled jobs)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace('Bearer ', '');
    
    // Check if this is a service role call (scheduled job)
    const isServiceRole = token === supabaseServiceKey;
    
    // Parse request first to check for _scheduled flag
    let payload: SyncRequest;
    try {
      payload = await req.json();
    } catch (_parseErr) {
      return errorResponse('INVALID_JSON', 'Could not parse request body', 400);
    }

    const { work_item_id, _scheduled } = payload;
    
    if (!work_item_id) {
      return errorResponse('MISSING_WORK_ITEM_ID', 'work_item_id is required', 400);
    }

    let userId: string | null = null;
    
    // For scheduled jobs with service role, skip user auth and membership check
    if (isServiceRole && _scheduled) {
      console.log(`[sync-pub] Scheduled job invocation for work_item_id=${work_item_id}`);
    } else {
      // Regular user auth check — use getUser with the JWT token
      const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '', {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user: authUser }, error: authError } = await anonClient.auth.getUser();
      
      if (authError || !authUser?.id) {
        console.error(`[sync-pub] Auth error:`, authError?.message);
        return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401);
      }

      userId = authUser.id;
      console.log(`[sync-pub] Starting sync for work_item_id=${work_item_id}, user=${userId}`);
    }

    // Fetch work item
    const { data: workItem, error: workItemError } = await supabase
      .from('work_items')
      .select('id, owner_id, organization_id, workflow_type, radicado, last_synced_at, monitoring_enabled, deleted_at')
      .eq('id', work_item_id)
      .maybeSingle();

    if (workItemError || !workItem) {
      console.log(`[sync-pub] Work item not found: ${work_item_id}`);
      return errorResponse('WORK_ITEM_NOT_FOUND', 'Work item not found or access denied', 404);
    }

    // ============= BUG 2 fix — PAUSE GATE (monitoring_enabled) =============
    // Symmetric with sync-by-work-item: a paused/deleted WI is not synced for
    // any data kind. No provider call, no persistence, no external_sync_runs
    // row, no false SUCCESS.
    if ((workItem as any).monitoring_enabled === false || (workItem as any).deleted_at) {
      const reason = (workItem as any).deleted_at ? 'WORK_ITEM_DELETED' : 'MONITORING_PAUSED';
      console.log(`[sync-pub] SKIP paused/deleted wi=${work_item_id} reason=${reason}`);
      return jsonResponse({
        ok: true,
        status: 'skipped_paused',
        reason,
        work_item_id,
        workflow_type: workItem.workflow_type,
        inserted_count: 0,
        skipped_count: 0,
      });
    }

    // ============= CATEGORY ELIGIBILITY GATE =============
    // GOV_PROCEDURE / PETICION / unknown categories must never be dispatched
    // to Cloud Run. Return ok:true, status:not_applicable — this is a
    // successful coordinator outcome, NOT a failure. Callers must not count it.
    if (!isOnlineSyncEligible(workItem.workflow_type)) {
      console.log(`[sync-pub] Category not eligible: ${workItem.workflow_type} (wi=${work_item_id})`);
      return jsonResponse({
        ok: true,
        status: 'not_applicable',
        reason: 'category_not_online_sync_eligible',
        work_item_id,
        workflow_type: workItem.workflow_type,
        inserted_count: 0,
        skipped_count: 0,
      });
    }

    // ============= MULTI-TENANT SECURITY: Verify user is member of org =============
    // Skip for scheduled jobs (service role)
    if (!isServiceRole || !_scheduled) {
      const { data: membership, error: membershipError } = await supabase
        .from('organization_memberships')
        .select('id, role')
        .eq('organization_id', workItem.organization_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (membershipError || !membership) {
        console.log(`[sync-pub] ACCESS DENIED: User ${userId} is not member of org ${workItem.organization_id}`);
        return errorResponse(
          'ACCESS_DENIED', 
          'You do not have permission to sync this work item. You must be a member of the organization.', 
          403
        );
      }

      console.log(`[sync-pub] Access verified: user ${userId} has role ${membership.role}`);
    }

    // ============= COOLDOWN GATE =============
    // Prevent stampede on Cloud Run after outage recovery. Scheduled jobs and
    // login-triggered syncs respect the cooldown. Manual "refresh now" bypasses
    // via a future flag; today _scheduled=false counts as manual.
    const manualBypass = (payload as any)?._force === true && (!isServiceRole || _scheduled === true);
    if (!manualBypass && workItem.last_synced_at) {
      const ageMs = Date.now() - new Date(workItem.last_synced_at as string).getTime();
      if (ageMs >= 0 && ageMs < SYNC_COOLDOWN_MS) {
        console.log(`[sync-pub] Cooldown active (age=${Math.round(ageMs/1000)}s < ${SYNC_COOLDOWN_MS/1000}s) wi=${work_item_id}`);
        return jsonResponse({
          ok: true,
          status: 'skipped_recent_sync',
          reason: 'cooldown_active',
          work_item_id,
          workflow_type: workItem.workflow_type,
          last_synced_at: workItem.last_synced_at,
          inserted_count: 0,
          skipped_count: 0,
        });
      }
    }

    // ============= VALIDATE RADICADO =============
    if (!workItem.radicado || !isValidRadicado(workItem.radicado)) {
      return errorResponse(
        'MISSING_RADICADO',
        'Publicaciones sync is only available for registered processes with a valid 23-digit radicado. Please edit the work item to add a radicado.',
        400
      );
    }

    const normalizedRadicado = normalizeRadicado(workItem.radicado);

    // ============= DEFENSIVE ROUTING GUARD (Doctor's rule) =============
    // sync-publicaciones-by-work-item is the PP (Publicaciones Procesales)
    // dispatcher. Under the deterministic routing rule, only categories whose
    // estados provider is PP may hit this fetch. CPACA (estados=SAMAI_ESTADOS)
    // must never call PP even if invoked directly.
    //
    // We DO NOT early-return the whole function for CPACA, because the SAMAI
    // Estados enrichment block below is the correct path for CPACA. We only
    // suppress the PP HTTP fetch and synthesize an empty result so the merge
    // pipeline still runs against SAMAI data.
    const routing = resolveProviders(workItem.workflow_type);
    // PP is invoked whenever it appears in the estados cascade (PRIMARY for
    // CGP/LABORAL/PENAL_906, PRIMARY for TUTELA, absent for CPACA).
    const shouldFetchPP = routing.estados.includes("PP");
    if (!shouldFetchPP) {
      console.log(
        `[sync-pub] ROUTING_SKIP wt=${workItem.workflow_type} reason=estados_source_is_${routing.estados.join('|') || "NONE"} — skipping PP HTTP fetch`,
      );
    }

    // ============= CHECK API CONFIGURATION =============
    const baseUrl = Deno.env.get('PUBLICACIONES_BASE_URL');
    const apiKey = Deno.env.get('PUBLICACIONES_X_API_KEY') || Deno.env.get('EXTERNAL_X_API_KEY');

    if (!baseUrl) {
      // Never surface 500 for config problems — degrade cleanly.
      return jsonResponse({
        ok: false,
        status: 'configuration_error',
        reason: 'missing_base_url',
        work_item_id,
        workflow_type: workItem.workflow_type,
      }, 200);
    }

    if (!apiKey) {
      return jsonResponse({
        ok: false,
        status: 'auth_error',
        reason: 'missing_api_key',
        work_item_id,
        workflow_type: workItem.workflow_type,
      }, 200);
    }

    const result: SyncResult = {
      ok: false,
      work_item_id,
      inserted_count: 0,
      skipped_count: 0,
      alerts_created: 0,
      attachment_enqueued: 0,
      attachment_enqueue_failed: 0,
      newest_publication_date: null,
      warnings: [],
      errors: [],
      inserted: [],
    };

    // ============= FETCH PUBLICACIONES (v3 SYNCHRONOUS API) =============
    // Safety timeout: abort fetch if we're approaching edge function hard limit (~150s).
    // This prevents the entire function from timing out and producing an unrecoverable error.
    const PUB_SAFETY_TIMEOUT_MS = 110_000; // 110s — leave 40s buffer for DB writes + response
    const functionStartTime = Date.now();

    // ── Fix B (Paso 3): evaluate re-scrape gate BEFORE the fetch, so the
    // decision travels with the request. We capture the decision via callback
    // and log it to provider_sync_traces below.
    const gateStatus = await checkRescrapeGate(supabase, work_item_id);
    let rescrapeDecision: RescrapeDecision = { triggered: false, reason: 'not_evaluated' };
    console.log(
      `[sync-pub][rescrape-gate] wi=${work_item_id} allow=${gateStatus.allow} ` +
        `last=${gateStatus.lastTriggeredAt ?? 'never'} hours_since=${gateStatus.hoursSince ?? 'n/a'}`,
    );

    let fetchResult: FetchResultV3;
    if (!shouldFetchPP) {
      // ROUTING_SKIP: synthesize an empty, ok PP result so downstream merge
      // logic runs unchanged. For CPACA the SAMAI Estados block below fills
      // in the real estados data; for other non-PP categories nothing is
      // fetched and the run ends as SUCCESS_EMPTY.
      rescrapeDecision = { triggered: false, reason: 'routing_skip_non_pp_category' };
      fetchResult = {
        ok: true,
        publicaciones: [],
        latencyMs: 0,
        found: false,
        resultCode: 'NO_DATA',
      };
    } else {
      try {
        fetchResult = await Promise.race([
        fetchPublicaciones(normalizedRadicado, baseUrl, apiKey, {
          allow: gateStatus.allow,
          onDecision: (d) => { rescrapeDecision = d; },
        }),
        new Promise<FetchResultV3>((_, reject) => 
          setTimeout(() => reject(new Error('PUB_SAFETY_TIMEOUT')), PUB_SAFETY_TIMEOUT_MS)
        ),
      ]);
      } catch (raceErr: unknown) {
      const elapsed = Date.now() - functionStartTime;
      const errMsg = raceErr instanceof Error ? raceErr.message : String(raceErr);
      console.warn(`[sync-pub] Safety timeout hit after ${elapsed}ms for ${normalizedRadicado}: ${errMsg}`);
      
      fetchResult = {
        ok: true,
        publicaciones: [],
        error: 'PROCESSING_TRIGGERED: scrape started; data expected on next /historico read',
        latencyMs: elapsed,
        found: false,
        resultCode: 'NO_DATA',
      };
      }
    }
    result.provider_latency_ms = fetchResult.latencyMs;

    // ── Persist gate ledger + trace ONLY when we actually fired the trigger ──
    if (rescrapeDecision.triggered) {
      await recordRescrapeTrigger(supabase, work_item_id, normalizedRadicado, rescrapeDecision);
    }
    try {
      await supabase.from('provider_sync_traces' as any).insert({
        work_item_id,
        organization_id: workItem.organization_id,
        stage: rescrapeDecision.triggered
          ? 'RESCRAPE_TRIGGERED'
          : (rescrapeDecision.reason === 'gate_suppressed' ? 'RESCRAPE_SUPPRESSED' : 'RESCRAPE_NOT_NEEDED'),
        result_code: rescrapeDecision.reason,
        ok: rescrapeDecision.reason !== 'trigger_error',
        latency_ms: fetchResult.latencyMs,
        payload: {
          provider_key: 'publicaciones',
          subchain_kind: 'ESTADOS',
          data_kind: 'ESTADOS',
          http_status: rescrapeDecision.httpStatus ?? fetchResult.httpStatus ?? null,
          radicado: normalizedRadicado,
          workflow: workItem.workflow_type,
          gate_allow: gateStatus.allow,
          gate_last_triggered_at: gateStatus.lastTriggeredAt,
          gate_hours_since_last: gateStatus.hoursSince,
          cooldown_hours: RESCRAPE_COOLDOWN_MS / 3_600_000,
          fetch_result_code: fetchResult.resultCode,
          decision_error: rescrapeDecision.error ?? null,
        },
      } as any);
    } catch (traceErr: any) {
      console.warn(`[sync-pub] Failed to write rescrape trace: ${traceErr?.message}`);
    }

    // ============= CPACA WORKFLOW: SAMAI ESTADOS ENRICHMENT =============
    // For CPACA, SAMAI Estados is PRIMARY for estados data. We ALWAYS call it
    // via the shared adapter (fetchFromSamaiEstados) so the sync pipeline uses
    // the exact same contract as admin-diagnose-estados. Records are merged
    // with Publicaciones results and deduplicated downstream by hash_fingerprint.
    //
    // History: from ~Apr 2026 to Jul 2026 this block issued a hand-rolled
    //   GET /snapshot?radicado=... call whose response shape never matched the
    //   real API. Every run reported `SUCCESS inserted_pubs=0 skipped_pubs=0`
    //   without any error signal, freezing every CPACA estados feed silently.
    //   The wrapper below enforces a strict contract check so that a CONTRACT
    //   MISMATCH can never again masquerade as "no news".
    // ============= CPACA (exclusive) + TUTELA (UNION) SAMAI ESTADOS =============
    // For CPACA, SAMAI Estados is the exclusive estados source (invoked always).
    // For TUTELA, estados are the UNION of PP + SAMAI_ESTADOS: SAMAI_ESTADOS is
    // invoked on EVERY sync, regardless of PP's outcome (success, empty, or
    // transient error). Results merge downstream by hash_fingerprint so the
    // same estado from both providers collapses to a single row.
    // If PP errors and SAMAI succeeds with data, we continue and report PARTIAL
    // (never SUCCESS while a provider errored — see error-return branch below).
    const isCpaca = workItem.workflow_type === 'CPACA';
    const isTutelaUnion = workItem.workflow_type === 'TUTELA';
    if (isCpaca || isTutelaUnion) {
      if (isTutelaUnion) {
        console.log(
          `[sync-pub][samai_estados] TUTELA union: querying SAMAI_ESTADOS alongside PP for wi=${work_item_id} ` +
          `(pp_ok=${fetchResult.ok}, pp_count=${fetchResult.publicaciones?.length ?? 0})`
        );
      }
      const samaiEstadosBaseUrl = Deno.env.get('SAMAI_ESTADOS_BASE_URL');
      const samaiStart = Date.now();
      const samaiSummary: NonNullable<SyncResult['samai_estados_summary']> = {
        called: false,
      };

      if (!samaiEstadosBaseUrl) {
        console.warn(
          `[sync-pub][samai_estados] SAMAI_ESTADOS_BASE_URL not configured — CPACA estados enrichment DISABLED. wi=${work_item_id}`
        );
        samaiSummary.error = 'SAMAI_ESTADOS_BASE_URL not configured';
        result.samai_estados_summary = samaiSummary;
      } else {
        samaiSummary.called = true;
        // formatRadicadoForSamai is exported by the adapter for logging parity
        // with admin-diagnose-estados; the adapter itself forwards the raw
        // radicado inside the POST body.
        const formattedForLog = formatRadicadoForSamai(normalizedRadicado);
        console.log(
          `[sync-pub][samai_estados] START wi=${work_item_id} radicado=${normalizedRadicado} formatted=${formattedForLog}`
        );

        try {
          const samaiRes = await fetchFromSamaiEstados({
            radicado: normalizedRadicado,
            mode: 'monitoring',
            workItemId: work_item_id,
            timeoutMs: 90_000,
          });

          samaiSummary.status = samaiRes.status;
          samaiSummary.http_status = samaiRes.httpStatus;
          samaiSummary.duration_ms = samaiRes.durationMs;
          samaiSummary.raw_count = samaiRes.publicaciones.length;
          samaiSummary.error = samaiRes.errorMessage;

          console.log(
            `[sync-pub][samai_estados] END wi=${work_item_id} status=${samaiRes.status} ` +
              `http=${samaiRes.httpStatus ?? 'n/a'} duration_ms=${samaiRes.durationMs} ` +
              `raw_count=${samaiRes.publicaciones.length}` +
              (samaiRes.errorMessage ? ` error="${samaiRes.errorMessage}"` : '')
          );

          // ── Contract-mismatch sanity check ────────────────────────────
          // If the adapter reports EMPTY but this work_item's actuaciones
          // feed has a recent "Fijación estado" act (last 45 days) that has
          // NO matching row in work_item_publicaciones, we treat this as a
          // CONTRACT_MISMATCH rather than "no news". A silent 0/0 is what
          // let the previous bug hide for 3 months.
          if (samaiRes.status === 'EMPTY' && samaiRes.publicaciones.length === 0) {
            try {
              const cutoffIso = new Date(Date.now() - 45 * 86400_000).toISOString();
              const { data: recentFijaciones } = await supabase
                .from('work_item_acts' as any)
                .select('act_date, description')
                .eq('work_item_id', work_item_id)
                .gte('act_date', cutoffIso.slice(0, 10))
                .or(
                  "description.ilike.%fijaci_n%estado%,description.ilike.%fijaci_n en estado%,description.ilike.%fija estado%"
                )
                .limit(3);

              if (recentFijaciones && recentFijaciones.length > 0) {
                samaiSummary.contract_mismatch = true;
                const msg =
                  `[CONTRACT_MISMATCH] SAMAI Estados returned EMPTY but ${recentFijaciones.length} recent ` +
                  `"Fijación estado" actuacion(es) exist for wi=${work_item_id}. Upstream contract likely changed.`;
                console.error(msg);
                result.warnings.push(msg);
              }
            } catch (mismatchErr: any) {
              console.warn(
                `[sync-pub][samai_estados] contract-mismatch probe failed (non-blocking): ${mismatchErr?.message}`
              );
            }
          }

          // ── Merge results into fetchResult.publicaciones (PublicacionV3) ──
          if (samaiRes.publicaciones.length > 0) {
            const existingKeys = new Set(
              fetchResult.publicaciones.map((p) => {
                const pFecha = p.fecha_publicacion || '';
                const pTitle = (p.titulo || '').slice(0, 30).toLowerCase();
                return `${pFecha}|${pTitle}`;
              })
            );

            let mergedNew = 0;
            for (const np of samaiRes.publicaciones) {
              const pubFecha = np.fecha_fijacion || '';
              const pubTitle = (np.title || '').slice(0, 30).toLowerCase();
              const key = `${pubFecha}|${pubTitle}`;
              if (existingKeys.has(key)) continue;

              const hashDoc = np.hash_fingerprint;
              const v3: PublicacionV3 = {
                key: `samai_estado_${pubFecha}_${(np.tipo_publicacion || '').slice(0, 30)}`,
                tipo: np.tipo_publicacion || 'Estado',
                titulo: np.title || np.tipo_publicacion || 'Estado SAMAI',
                fecha_publicacion: pubFecha || null,
                fecha_estado_raw: pubFecha || null,
                fecha_auto_raw:
                  (np as any).fecha_providencia ||
                  (np as any).raw_data?.fecha_providencia_normalizada ||
                  null,
                pdf_url: np.pdf_url,
                tipo_evento: 'Estado Electrónico',
                asset_id: `samai_${hashDoc}`,
                clasificacion: {
                  categoria: 'Estado Electrónico',
                  descripcion:
                    (np as any).raw_data?.['Anotación'] ||
                    (np as any).raw_data?.anotacion ||
                    np.tipo_publicacion,
                  es_descargable: !!(np.pdf_url && np.pdf_url.toLowerCase().includes('.pdf')),
                },
                raw_data: (np as any).raw_data,
                _source_provider: 'samai_estados',
              } as PublicacionV3;
              fetchResult.publicaciones.push(v3);
              existingKeys.add(key);
              mergedNew++;
            }
            samaiSummary.merged_new = mergedNew;
            if (mergedNew > 0) {
              fetchResult.found = true;
              fetchResult.ok = true;
            }
            console.log(
              `[sync-pub][samai_estados] MERGE wi=${work_item_id} candidates=${samaiRes.publicaciones.length} ` +
                `merged_new=${mergedNew} total_after=${fetchResult.publicaciones.length}`
            );
          }
        } catch (samaiErr: any) {
          samaiSummary.error = samaiErr?.message || String(samaiErr);
          samaiSummary.duration_ms = Date.now() - samaiStart;
          console.warn(
            `[sync-pub][samai_estados] adapter threw (non-blocking): ${samaiSummary.error}`
          );
        }

        result.samai_estados_summary = samaiSummary;
      }
    }

    // Handle error response
    // TUTELA UNION exception: if PP errored but SAMAI_ESTADOS successfully
    // merged records into fetchResult.publicaciones (see block above), do NOT
    // return early — continue processing so those estados land in the DB, and
    // downgrade the final classification to PARTIAL (never SUCCESS) so the
    // PP error is retried.
    const tutelaSalvagedFromSamai =
      workItem.workflow_type === 'TUTELA' &&
      !fetchResult.ok &&
      (result.samai_estados_summary?.merged_new ?? 0) > 0;
    if (tutelaSalvagedFromSamai) {
      const ppErr = fetchResult.error || 'Publicaciones fetch failed';
      console.warn(
        `[sync-pub] TUTELA union: PP errored ("${ppErr}") but SAMAI_ESTADOS ` +
        `contributed ${result.samai_estados_summary?.merged_new} record(s) — continuing as PARTIAL`
      );
      result.warnings.push(`PP provider failed (${ppErr}); estados union salvaged from SAMAI_ESTADOS — retry scheduled for PP`);
      // Register the PP error so downstream classification lands on PARTIAL
      // (errors.length > 0 + inserted_count > 0 → SUCCESS_WITH_DATA + warning).
      result.errors.push(`publicaciones: ${ppErr}`);
      // Pretend the fetch is OK so the ingest path processes the SAMAI-merged
      // publicaciones we already have in fetchResult.publicaciones.
      fetchResult.ok = true;
      fetchResult.found = fetchResult.publicaciones.length > 0;
    }
    if (!fetchResult.ok) {
      console.error(`[sync-pub] Fetch error: ${fetchResult.error}`);
      result.errors.push(fetchResult.error || 'Failed to fetch publications');
      result.status = 'ERROR';
      // Never propagate upstream 5xx/unreachable as our own 500 —
      // callers (login sync, work-item creation) must degrade gracefully.
      const upstream = fetchResult.httpStatus;
      const structuredStatus =
        upstream === 401 || upstream === 403 ? 'auth_error' :
        upstream === 404 ? 'route_mismatch' :
        upstream && upstream >= 500 ? 'provider_5xx' :
        'provider_unavailable';
      (result as any).status = structuredStatus;
      (result as any).reason = fetchResult.error;
      await writePublicacionesAttemptRow(supabase, workItem, work_item_id, result, _scheduled, isServiceRole, 'error');
      return jsonResponse(result, 200);
    }

    // Handle empty result (valid response but no publications)
    if (fetchResult.publicaciones.length === 0) {
      result.ok = true;
      result.status = fetchResult.resultCode === 'NO_DATA' ? 'NO_DATA' : 'EMPTY';
      // Canonical taxonomy:
      //   PENDING_UPSTREAM   → /historico still cold (NO_DATA) and SAMAI Estados
          //                     didn't fill the gap (Step 3 will schedule a re-scrape)
      //   CONTRACT_MISMATCH  → SAMAI Estados adapter flagged shape drift
      //   SUCCESS_EMPTY      → both sources answered and confirmed no news
      if (result.samai_estados_summary?.contract_mismatch) {
        result.result_code = 'CONTRACT_MISMATCH';
      } else if (fetchResult.resultCode === 'NO_DATA') {
        result.result_code = 'PENDING_UPSTREAM';
      } else {
        result.result_code = 'SUCCESS_EMPTY';
      }
      result.warnings.push(`No publications found (result_code=${result.result_code})`);
      console.log(
        `[sync-pub] EMPTY for ${normalizedRadicado} → result_code=${result.result_code} ` +
        `samai_raw=${result.samai_estados_summary?.raw_count ?? 'n/a'}`
      );

      // ============= COVERAGE GAP DETECTION =============
      // Primary provider returned empty — check if any fallback providers return data
      // If not, this is a COVERAGE_GAP: the platform is working correctly but the
      // external provider does not index this court/radicado.
      const coverageGapOutcome = 'COVERAGE_GAP';
      console.log(`[sync-pub] COVERAGE_GAP_DETECTED: workflow=${workItem.workflow_type}, radicado=${normalizedRadicado}, provider=publicaciones`);

      // Persist coverage gap signal — single upsert with atomic occurrences increment.
      // Previous impl called a non-existent RPC then did an update with `occurrences: undefined`
      // which nulled the counter; consolidated into one correct upsert here.
      try {
        const nowIso = new Date().toISOString();
        const responsePayload = {
          found: false,
          totalResultados: 0,
          latency_ms: fetchResult.latencyMs,
          timestamp: nowIso,
        };

        // Read current occurrences (if any) so we can increment atomically on upsert
        const { data: existingGap } = await supabase
          .from('work_item_coverage_gaps' as any)
          .select('occurrences')
          .eq('work_item_id', work_item_id)
          .eq('data_kind', 'ESTADOS')
          .eq('provider_key', 'publicaciones')
          .maybeSingle();

        const nextOccurrences = ((existingGap as any)?.occurrences ?? 0) + 1;

        await supabase
          .from('work_item_coverage_gaps' as any)
          .upsert({
            work_item_id,
            org_id: workItem.organization_id,
            workflow: workItem.workflow_type || 'CGP',
            data_kind: 'ESTADOS',
            provider_key: 'publicaciones',
            radicado: normalizedRadicado,
            despacho: null,
            last_seen_at: nowIso,
            occurrences: nextOccurrences,
            last_http_status: fetchResult.httpStatus || 200,
            last_response_redacted: responsePayload,
            status: 'OPEN',
          } as any, { onConflict: 'work_item_id,data_kind,provider_key' } as any);

        console.log(`[sync-pub] Coverage gap persisted for ${work_item_id}`);
      } catch (gapErr: any) {
        console.warn(`[sync-pub] Failed to persist coverage gap:`, gapErr?.message);
      }

      // Create idempotent alert for coverage gap
      try {
        const alertFingerprint = `coverage_gap_${work_item_id}_ESTADOS_publicaciones`;
        const { data: existingAlert } = await supabase
          .from('alert_instances')
          .select('id')
          .eq('entity_id', work_item_id)
          .eq('entity_type', 'WORK_ITEM')
          .eq('alert_type', 'BRECHA_COBERTURA_ESTADOS')
          .eq('status', 'PENDING')
          .maybeSingle();

        if (!existingAlert) {
          await supabase.from('alert_instances').insert({
            owner_id: workItem.owner_id,
            organization_id: workItem.organization_id,
            entity_id: work_item_id,
            entity_type: 'WORK_ITEM',
            severity: 'WARNING',
            alert_type: 'BRECHA_COBERTURA_ESTADOS',
            title: 'Brecha de cobertura: Estados no disponibles',
            message: `El proveedor Publicaciones Procesales no retornó estados para el radicado ${normalizedRadicado}. Esto puede indicar que el juzgado no publica estados electrónicos en este portal.`,
            status: 'PENDING',
            fingerprint: alertFingerprint,
            payload: {
              workflow: workItem.workflow_type,
              radicado: normalizedRadicado,
              provider_key: 'publicaciones',
              data_kind: 'ESTADOS',
              outcome: coverageGapOutcome,
              latency_ms: fetchResult.latencyMs,
            },
          });
          console.log(`[sync-pub] Coverage gap alert created for ${work_item_id}`);
        }
      } catch (alertErr: any) {
        console.warn(`[sync-pub] Failed to create coverage gap alert:`, alertErr?.message);
      }

      // Write trace stage for coverage gap
      try {
        await supabase.from('provider_sync_traces' as any).insert({
          work_item_id,
          organization_id: workItem.organization_id,
          provider_key: 'publicaciones',
          stage: 'COVERAGE_GAP_DETECTED',
          subchain_kind: 'ESTADOS',
          data_kind: 'ESTADOS',
          outcome: coverageGapOutcome,
          http_status: fetchResult.httpStatus || 200,
          latency_ms: fetchResult.latencyMs,
          metadata: {
            workflow: workItem.workflow_type,
            radicado: normalizedRadicado,
            found: false,
            totalResultados: 0,
            provider_order_reason: 'PRIMARY_EMPTY',
            remediation_hint: 'Publicaciones Procesales API does not index this court/radicado. Consider manual PDF upload or coverage expansion request.',
          },
        } as any);
      } catch (traceErr: any) {
        console.warn(`[sync-pub] Failed to write coverage gap trace:`, traceErr?.message);
      }

      await writePublicacionesAttemptRow(supabase, workItem, work_item_id, result, _scheduled, isServiceRole, 'empty');
      return jsonResponse({
        ...result,
        coverage_gap: {
          detected: true,
          outcome: coverageGapOutcome,
          provider_key: 'publicaciones',
          data_kind: 'ESTADOS',
          workflow: workItem.workflow_type,
          radicado: normalizedRadicado,
          latency_ms: fetchResult.latencyMs,
        },
      });
    }

    console.log(`[sync-pub] Processing ${fetchResult.publicaciones.length} publications`);

    // ============= INGEST PUBLICATIONS WITH DEDUPLICATION =============
    let newestDate: string | null = null;
    let newestInsertedFingerprint: string | null = null;
    const attemptedPubFingerprints: string[] = []; // Track fingerprints for post-insert verification

    for (const pub of fetchResult.publicaciones) {
      // Extract date from title if fecha_publicacion is null
      const fechaFromTitle = extractDateFromTitle(pub.titulo || '');
      const fechaPublicacion = pub.fecha_publicacion || fechaFromTitle || null;
      const parsedFecha = parseDate(fechaPublicacion);

      // Generate unique fingerprint using asset_id (guaranteed unique per publication)
      // Include event date so that repeated titles across different dates
      // (e.g. "Auto que ordena requerir" on 2024-11-29 and 2025-02-07) do NOT collide.
      const dateKey = parsedFecha || fechaFromTitle || '0000-00-00';
      const partyHint = (pub as any)?.parte
        ?? (pub as any)?.raw_data?.parte
        ?? (pub as any)?.raw_data?.["Docum. a notif."]
        ?? null;
      const fingerprint = generatePublicacionFingerprint(
        work_item_id,
        pub.asset_id,
        pub.key,
        pub.titulo || 'untitled',
        { pubDate: dateKey, tipo: (pub as any)?.tipo_publicacion ?? null, partyHint },
      );

      // NOTE: Inline dedup removed — the RPC handles dedup internally via
      // (work_item_id, hash_fingerprint) lookup. The previous inline check caused
      // phantom skips when the table was empty but the else-branch fallthrough
      // incorrectly incremented skipped_count.

      // LOG: What we're about to insert
      console.log('[sync-pub] Upserting record:', {
        title: pub.titulo?.slice(0, 50),
        asset_id: pub.asset_id,
        fecha_publicacion: fechaPublicacion,
        pdf_url: pub.pdf_url?.slice(0, 80),
      });

      // Insert new publication
      // FIX 2.2: Derive date_confidence from date_source
      // BUG FIX: 'inferred' is NOT a valid value for check_pub_date_source constraint.
      // Must use 'inferred_sync' (when no date extracted) or 'parsed_filename'/'parsed_title' (when extracted from title).
      const dateSource = parsedFecha 
        ? 'api_explicit' 
        : (fechaFromTitle ? 'parsed_title' : 'inferred_sync');
      const dateConfidence = parsedFecha ? 'high' : (fechaFromTitle ? 'low' : 'low');

      // ── Upsert via RPC with explicit sources[] array merge ──
      // Date semantics (2026-07-06 fix):
      //  * SAMAI (samai_estados) reports the fecha del auto, NOT the fijacion date.
      //    Route it to fecha_providencia and leave fecha_fijacion NULL so terms
      //    computation does not treat it as a fijación.
      //  * Publicaciones reports the real fijacion date → fecha_fijacion.
      const sourceProvider = (pub as any)._source_provider || 'publicaciones';
      const isSamai = sourceProvider === 'samai_estados';
      const isoDate = parsedFecha ? new Date(parsedFecha + 'T12:00:00Z').toISOString() : null;

      // /historico aditivo (2026-07-08): pull estado (fijación) date and auto date
      // when the provider surfaces them explicitly. Falls back to the single
      // `parsedFecha` above so behavior stays identical for legacy responses.
      const parsedEstadoDate = parseDate(pub.fecha_estado_raw);
      const parsedAutoDate = parseDate(pub.fecha_auto_raw);
      const fijacionIso = parsedEstadoDate
        ? new Date(parsedEstadoDate + 'T12:00:00Z').toISOString()
        : isoDate;
      const providenciaIso = parsedAutoDate
        ? new Date(parsedAutoDate + 'T12:00:00Z').toISOString()
        : null;

      const refreshedLegacyIds = await refreshLegacyPdfRowsForProxy(
        supabase,
        work_item_id,
        workItem.organization_id,
        fingerprint,
        pub,
        parsedFecha,
      );

      if (refreshedLegacyIds.length > 0) {
        result.skipped_count += refreshedLegacyIds.length;
        continue;
      }

      const { data: rpcResult, error: insertError } = await supabase.rpc('rpc_upsert_work_item_publicaciones', {
        records: JSON.stringify([{
          work_item_id,
          organization_id: workItem.organization_id,
          source: sourceProvider,
          title: pub.titulo || pub.key || 'Sin título',
          annotation: pub.clasificacion?.descripcion || null,
          pdf_url: pub.pdf_url || null,
          entry_url: pub.url || null,
          pdf_available: pub.clasificacion?.es_descargable === true || !!pub.pdf_url,
          published_at: isoDate,
          fecha_fijacion: isSamai ? (parsedEstadoDate ? fijacionIso : null) : fijacionIso,
          fecha_providencia: isSamai
            ? (providenciaIso || (!parsedEstadoDate ? isoDate : null))
            : providenciaIso,
          tipo_publicacion: pub.tipo || pub.clasificacion?.categoria || null,
          hash_fingerprint: fingerprint,
          raw_data: pub,
          date_source: dateSource,
          date_confidence: dateConfidence,
          raw_schema_version: 'publicaciones_v3',
          sources: [sourceProvider],
        }]),
      });

      if (insertError) {
        console.error(`[sync-pub] RPC client error: ${JSON.stringify(insertError)}`);
        result.errors.push(`Upsert failed for ${pub.titulo}: ${insertError.message}`);
      } else {
        const counts = rpcResult as { inserted_count: number; updated_count: number; skipped_count: number; errors?: string[] };
        
        // ── Check for RPC-internal errors (caught by EXCEPTION handler inside RPC) ──
        if (counts.errors && counts.errors.length > 0 && counts.errors.some((e: string) => e.length > 0)) {
          const rpcErrors = counts.errors.filter((e: string) => e.length > 0);
          console.error(`[sync-pub] RPC internal errors for ${pub.titulo}:`, rpcErrors);
          result.errors.push(`RPC error for ${pub.titulo}: ${rpcErrors.join('; ')}`);
        }
        
        if (counts.inserted_count > 0) {
          console.log(`[sync-pub] ✅ Inserted: ${pub.titulo} (fecha: ${fechaPublicacion})`);
          result.inserted_count++;
          attemptedPubFingerprints.push(fingerprint);
          
          if (parsedFecha && (!newestDate || parsedFecha > newestDate)) {
            newestDate = parsedFecha;
            newestInsertedFingerprint = fingerprint;
          }

          // Track inserted publication for response
          result.inserted.push({
            id: 'rpc-inserted',
            title: pub.titulo || pub.key || 'Sin título',
            pdf_url: pub.pdf_url || null,
            entry_url: pub.url || null,
            fecha_fijacion: parsedFecha,
            fecha_desfijacion: null,
            tipo_publicacion: pub.tipo || pub.clasificacion?.categoria || null,
            terminos_inician: null,
          });

          // ============= CREATE ALERT FOR NEW ESTADOS =============
          try {
            await supabase.from('alert_instances').insert({
              owner_id: workItem.owner_id,
              organization_id: workItem.organization_id,
              entity_id: workItem.id,
              entity_type: 'WORK_ITEM',
              severity: 'INFO',
              title: `Nuevo Estado: ${pub.tipo || pub.clasificacion?.categoria || 'Publicación'}`,
              message: `${pub.titulo || pub.key}`,
              status: 'PENDING',
              payload: {
                fecha_publicacion: fechaPublicacion,
                asset_id: pub.asset_id,
                pdf_url: pub.pdf_url,
              },
            });
            result.alerts_created++;
            console.log(`[sync-pub] Created alert for: ${pub.titulo}`);
          } catch (alertErr) {
            console.warn('[sync-pub] Failed to create alert:', alertErr);
          }

        } else if (counts.updated_count > 0) {
          console.log(`[sync-pub] ♻️ Provenance merged for: ${pub.titulo}`);
          result.skipped_count++;
        } else if (counts.skipped_count > 0) {
          console.log(`[sync-pub] ⏭️ Dedup skipped: ${pub.titulo}`);
          result.skipped_count++;
        } else {
          // Neither inserted, updated, nor skipped — this is an anomaly
          console.warn(`[sync-pub] ⚠️ RPC returned zero counts for ${pub.titulo}: ${JSON.stringify(counts)}`);
          result.errors.push(`Anomaly: zero counts for ${pub.titulo}`);
        }

        // ============= QUEUE ATTACHMENT DOWNLOAD (DURABLE) =============
        // Runs on ANY successful RPC outcome (inserted / updated / skipped) so
        // idempotent re-syncs still materialize PDFs that were missing before.
        // The enqueue itself is idempotent via UNIQUE(publicacion_id, remote_url).
        const rowExists =
          (counts.inserted_count || 0) +
            (counts.updated_count || 0) +
            (counts.skipped_count || 0) >
          0;
        if (
          rowExists &&
          pub.pdf_url &&
          typeof pub.pdf_url === 'string' &&
          pub.pdf_url.startsWith('https')
        ) {
          try {
            const filename =
              pub.pdf_url.split('/').pop() || pub.titulo || 'attachment.pdf';

            // Resolve the real publicacion UUID via the natural key
            // (work_item_id + fingerprint). The RPC does not return row ids,
            // so we look it up post-upsert. Required because
            // estado_attachment_queue.publicacion_id is a UUID FK — passing a
            // literal string silently failed the upsert (onConflict included
            // publicacion_id).
            const { data: pubRow, error: pubLookupErr } = await supabase
              .from('work_item_publicaciones')
              .select('id')
              .eq('work_item_id', work_item_id)
              .eq('hash_fingerprint', fingerprint)
              .maybeSingle();

            if (pubLookupErr || !pubRow?.id) {
              result.attachment_enqueue_failed =
                (result.attachment_enqueue_failed || 0) + 1;
              console.warn(
                JSON.stringify({
                  tag: '[sync-pub]',
                  event: 'attachment_enqueue_failed',
                  reason: 'publicacion_lookup_failed',
                  work_item_id,
                  fingerprint,
                  error: pubLookupErr?.message || 'row_not_found',
                }),
              );
            } else {
              // ── Refresh pdf_url on the publicacion row itself (defensive) ──
              // Ensures updates to the pdf_url land even if the RPC upsert
              // path elected to skip the row. Best-effort, non-blocking.
              try {
                await supabase
                  .from('work_item_publicaciones')
                  .update({ pdf_url: pub.pdf_url })
                  .eq('id', pubRow.id)
                  .neq('pdf_url', pub.pdf_url);
              } catch (_e) { /* best-effort */ }

              // ── Re-point stale queue rows for THIS publicacion ──
              // A previous sync may have enqueued the same publication with an
              // older remote URL (e.g. samaicore.consejodeestado.gov.co). The
              // upstream now hands us Cloud Run URLs served by our own PDF
              // proxy — repoint any pending/failed rows to the fresh URL and
              // reset attempts so the worker retries against the good source.
              try {
                await supabase
                  .from('estado_attachment_queue')
                  .update({
                    remote_url: pub.pdf_url,
                    status: 'pending',
                    attempt_count: 0,
                    last_error: null,
                    next_retry_at: new Date().toISOString(),
                  })
                  .eq('publicacion_id', pubRow.id)
                  .neq('remote_url', pub.pdf_url)
                  .in('status', ['pending', 'failed']);
              } catch (_e) { /* best-effort */ }

              const { error: enqueueErr } = await supabase
                .from('estado_attachment_queue')
                .upsert(
                  {
                    work_item_id,
                    publicacion_id: pubRow.id,
                    organization_id: workItem.organization_id,
                    remote_url: pub.pdf_url,
                    filename: filename.slice(0, 255),
                    status: 'pending',
                    attempt_count: 0,
                    max_attempts: 5,
                    next_retry_at: new Date().toISOString(),
                  },
                  { onConflict: 'publicacion_id,remote_url' } as any,
                );

              if (enqueueErr) {
                result.attachment_enqueue_failed =
                  (result.attachment_enqueue_failed || 0) + 1;
                console.warn(
                  JSON.stringify({
                    tag: '[sync-pub]',
                    event: 'attachment_enqueue_failed',
                    reason: 'upsert_error',
                    work_item_id,
                    publicacion_id: pubRow.id,
                    remote_url: pub.pdf_url,
                    error: enqueueErr.message,
                  }),
                );
              } else {
                result.attachment_enqueued =
                  (result.attachment_enqueued || 0) + 1;
                console.log(
                  `[sync-pub] 📎 Queued attachment download: ${filename.slice(0, 60)} → pub ${pubRow.id}`,
                );
              }
            }
          } catch (attachErr: any) {
            result.attachment_enqueue_failed =
              (result.attachment_enqueue_failed || 0) + 1;
            console.warn(
              JSON.stringify({
                tag: '[sync-pub]',
                event: 'attachment_enqueue_failed',
                reason: 'exception',
                work_item_id,
                fingerprint,
                error: attachErr?.message || String(attachErr),
              }),
            );
          }
        }
      }
    }

    result.newest_publication_date = newestDate;
    
    // ============= UPDATE WORK_ITEM BASELINE =============
    if (result.inserted_count > 0) {
      try {
        // Use the fingerprint we actually inserted (asset_id-based).
        // Previously this recomputed with (undefined, undefined, title) which
        // produced a fingerprint that never matched the stored row, so the
        // baseline was effectively orphaned.
        const latestFingerprint = newestInsertedFingerprint;
        if (latestFingerprint) {
          await supabase
            .from('work_items')
            .update({
              latest_estado_fingerprint: latestFingerprint,
              latest_estado_at: new Date().toISOString(),
            })
            .eq('id', work_item_id);
            
          console.log(`[sync-pub] Updated work_item baseline`);
        }
      } catch (err) {
        console.warn('[sync-pub] Failed to update baseline:', err);
      }
    }
    
    // ── LAYER 2: POST-INSERT VERIFICATION ──
    if (result.inserted_count > 0 && attemptedPubFingerprints.length > 0) {
      try {
        const { data: persistedPubs, error: verifyErr } = await supabase
          .from('work_item_publicaciones')
          .select('hash_fingerprint')
          .eq('work_item_id', work_item_id)
          .in('hash_fingerprint', attemptedPubFingerprints);

        if (!verifyErr && persistedPubs) {
          const persistedSet = new Set(persistedPubs.map((r: any) => r.hash_fingerprint));
          const missingFps = attemptedPubFingerprints.filter(fp => !persistedSet.has(fp));

          if (missingFps.length > 0) {
            const msg = `[DATA_LOSS_DETECTED] ${missingFps.length}/${attemptedPubFingerprints.length} pub inserts did NOT persist for ${work_item_id} (likely trigger bug)`;
            console.error(msg);
            result.warnings.push(msg);
            result.inserted_count = persistedSet.size;

            try {
              await supabase.from('trigger_error_log').insert({
                trigger_name: 'POST_INSERT_VERIFY',
                table_name: 'work_item_publicaciones',
                error_message: `${missingFps.length} inserts silently failed for work_item ${work_item_id}`,
                work_item_id,
              });
            } catch (_logErr) { /* best-effort */ }
          } else {
            console.log(`[VERIFY_OK] All ${attemptedPubFingerprints.length} pub inserts verified persisted`);
          }
        }
      } catch (verifyError: any) {
        console.warn(`[VERIFY_INSERTS] Pub verification query failed: ${verifyError?.message}`);
      }
    }

    // BUG FIX 2.3: If errors[] is non-empty, classify as PARTIAL, not SUCCESS
    if (result.errors.length > 0) {
      if (result.inserted_count > 0) {
        result.ok = true;
        result.status = 'SUCCESS'; // Some inserted, some errored — still "ok" overall
        result.result_code = 'SUCCESS_WITH_DATA';
        result.warnings.push(`${result.errors.length} RPC error(s) occurred but ${result.inserted_count} publications were inserted`);
      } else {
        result.ok = false;
        result.status = 'ERROR'; // Nothing inserted AND errors present — this is a failure
        result.result_code = 'ERROR';
      }
    } else {
      result.ok = true;
      result.status = 'SUCCESS';
      // If we reach here with 0 inserted, 0 skipped and no errors it means the
      // sources genuinely had nothing new — treat as SUCCESS_EMPTY. If we did
      // insert or dedup at least one record, it's SUCCESS_WITH_DATA. This closes
      // the loophole that let SAMAI drift produce a silent SUCCESS 0/0.
      if (result.inserted_count === 0 && result.skipped_count === 0) {
        result.result_code = result.samai_estados_summary?.contract_mismatch
          ? 'CONTRACT_MISMATCH'
          : 'SUCCESS_EMPTY';
      } else {
        result.result_code = 'SUCCESS_WITH_DATA';
      }
    }

    // Set initial sync completion marker (idempotent: only on first successful sync)
    try {
      await supabase
        .from('work_items')
        .update({ pubs_initial_sync_completed_at: new Date().toISOString() } as any)
        .eq('id', work_item_id)
        .is('pubs_initial_sync_completed_at' as any, null);
    } catch (_markerErr) { /* best-effort */ }

    // Advance last_successful_sync_at ONLY on genuine success (result.ok===true).
    // Semantically distinct from last_synced_at ("último intento") — this tracks
    // "último éxito" and never advances on ERROR / CONTRACT_MISMATCH paths.
    if (result.ok) {
      try {
        await supabase
          .from('work_items')
          .update({ last_successful_sync_at: new Date().toISOString() } as any)
          .eq('id', work_item_id);
      } catch (_lssErr) { /* best-effort — do not fail the sync on this */ }
    }

    console.log(`[sync-pub] Completed: inserted=${result.inserted_count}, skipped=${result.skipped_count}, alerts=${result.alerts_created}, attachment_enqueued=${result.attachment_enqueued || 0}, attachment_enqueue_failed=${result.attachment_enqueue_failed || 0}`);

    // ============= EXTERNAL PROVIDER ENRICHMENT FOR PUBLICACIONES =============
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const adminDb = createClient(supabaseUrl, supabaseServiceKey);

      const { data: pubGlobalRoutes } = await adminDb
        .from('provider_category_routes_global')
        .select('id, workflow, scope, provider_connector_id, enabled, provider_connectors(id, name, key)')
        .eq('workflow', workItem.workflow_type)
        .in('scope', ['PUBS', 'BOTH'])
        .eq('enabled', true)
        .order('priority');

      const { data: pubOrgRoutes } = await adminDb
        .from('provider_category_routes_org_override')
        .select('id, workflow, scope, provider_connector_id, enabled, provider_connectors(id, name, key)')
        .eq('organization_id', workItem.organization_id)
        .eq('workflow', workItem.workflow_type)
        .in('scope', ['PUBS', 'BOTH'])
        .eq('enabled', true)
        .order('priority');

      const pubRoutes = (pubOrgRoutes && pubOrgRoutes.length > 0) ? pubOrgRoutes : (pubGlobalRoutes || []);

      if (pubRoutes.length > 0) {
        console.log(`[sync-pub] External provider enrichment: ${pubRoutes.length} route(s)`);

        for (const route of pubRoutes) {
          const connectorId = route.provider_connector_id;
          const connectorName = (route as any).provider_connectors?.name;
          const isOrgRoute = pubOrgRoutes && pubOrgRoutes.length > 0;

          let instanceQuery = adminDb
            .from('provider_instances')
            .select('id, name')
            .eq('connector_id', connectorId)
            .eq('is_enabled', true);
          if (isOrgRoute) instanceQuery = instanceQuery.eq('organization_id', workItem.organization_id);
          else instanceQuery = instanceQuery.is('organization_id', null);

          const { data: instances } = await instanceQuery.order('created_at', { ascending: false }).limit(1);
          const instance = instances?.[0];

          if (!instance) {
            console.warn(`[sync-pub] SKIP provider ${connectorName}: no instance`);
            continue;
          }

          const { data: existingSource } = await adminDb
            .from('work_item_sources')
            .select('id')
            .eq('work_item_id', work_item_id)
            .eq('provider_instance_id', instance.id)
            .maybeSingle();

          let sourceId = existingSource?.id;
          if (!sourceId) {
            const { data: newSource } = await adminDb
              .from('work_item_sources')
              .insert({
                work_item_id,
                provider_instance_id: instance.id,
                organization_id: workItem.organization_id,
                provider_case_id: workItem.radicado || work_item_id,
                source_input_type: 'RADICADO',
                source_input_value: workItem.radicado || work_item_id,
                scrape_status: 'SCRAPING_PENDING',
              })
              .select('id')
              .single();
            sourceId = newSource?.id;
          }

          if (sourceId) {
            try {
              console.log(`[sync-pub] Calling external provider: ${connectorName}`);
              await fetch(
                `${supabaseUrl}/functions/v1/provider-sync-external-provider`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${supabaseServiceKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ work_item_source_id: sourceId, work_item_id, provider_instance_id: instance.id }),
                }
              );
            } catch (e: any) {
              console.warn(`[sync-pub] Provider call failed (non-blocking):`, e?.message);
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[sync-pub] Provider enrichment failed:`, e?.message);
    }

    // ── Record external_sync_run for publicaciones (best-effort) ──
    try {
      const invokedBy = (_scheduled || isServiceRole) ? 'CRON' : 'MANUAL';
      await supabase.from('external_sync_runs').insert({
        work_item_id,
        organization_id: workItem.organization_id,
        invoked_by: invokedBy,
        trigger_source: 'sync-publicaciones-by-work-item',
        started_at: new Date(Date.now() - (result.provider_latency_ms || 0)).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: result.provider_latency_ms || 0,
        status: result.ok ? 'SUCCESS' : (result.errors.length > 0 ? 'FAILED' : 'PARTIAL'),
        provider_attempts: [
          {
            provider: 'publicaciones',
            data_kind: 'ESTADOS',
            status: result.ok ? 'success' : 'error',
            latency_ms: result.provider_latency_ms || 0,
            inserted_count: result.inserted_count,
            skipped_count: result.skipped_count,
            result_code: result.result_code,
          },
          ...(result.samai_estados_summary
            ? [{
                provider: 'samai_estados',
                data_kind: 'ESTADOS',
                status: result.samai_estados_summary.status || 'unknown',
                http_status: result.samai_estados_summary.http_status,
                latency_ms: result.samai_estados_summary.duration_ms || 0,
                raw_count: result.samai_estados_summary.raw_count,
                merged_new: result.samai_estados_summary.merged_new,
                contract_mismatch: result.samai_estados_summary.contract_mismatch || false,
                error: result.samai_estados_summary.error,
              }]
            : []),
        ],
        total_inserted_pubs: result.inserted_count,
        total_skipped_pubs: result.skipped_count,
        error_message: result.errors.length > 0
          ? result.errors.join('; ').slice(0, 500)
          : (result.samai_estados_summary?.contract_mismatch
              ? `CONTRACT_MISMATCH: SAMAI Estados EMPTY with recent Fijación actuaciones (${result.samai_estados_summary.raw_count ?? 0} raw)`
              : null),
      });
    } catch (_traceErr) { /* best-effort */ }

    return jsonResponse(result);

  } catch (err) {
    console.error('[sync-pub] Unhandled error:', err);
    // Never bubble a 500 to user-facing callers. Return a structured
    // degraded response so login/creation flows do not fail hard.
    return jsonResponse({
      ok: false,
      status: 'internal_error',
      reason: err instanceof Error ? err.message : 'An unexpected error occurred',
    }, 200);
  }
}, { function_name: "sync-publicaciones-by-work-item", default_operation: "publicaciones" }));
