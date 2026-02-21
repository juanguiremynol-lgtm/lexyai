/**
 * publicacionesAdapter.ts — Unified Publicaciones provider adapter.
 *
 * SINGLE SOURCE OF TRUTH for all Publicaciones HTTP calls and response normalization.
 * Supports two modes:
 *   - 'monitoring': Uses /snapshot/{radicado} (preferred), falls back to /search/{radicado},
 *     then /buscar with async polling. For ongoing sync of monitored work items.
 *   - 'discovery': Uses /snapshot/{radicado} for demo/creation wizard previews.
 *
 * Previously duplicated in:
 *   - sync-publicaciones-by-work-item/index.ts (monitoring path — ~300 lines)
 *   - demo-radicado-lookup/index.ts (discovery path — ~100 lines)
 *
 * This adapter does NOT persist data — it returns normalized results only.
 */

import type {
  NormalizedPublicacion,
  PublicacionAttachment,
  CaseMetadata,
  AdapterMode,
  AdapterOptions,
  ProviderStatus,
  ProviderAdapterResult,
} from './types.ts';

import {
  normalizeDate,
  getApiKeyForProvider,
  pollForResult,
  DEFAULT_POLL_CONFIG,
  truncate,
  redactPII,
  type ApiKeyInfo,
} from '../radicadoUtils.ts';

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

const PROVIDER_KEY = 'publicaciones';
const LOG_TAG = '[publicacionesAdapter]';

// Spanish month names for date extraction from titles
const SPANISH_MONTHS: Record<string, string> = {
  'ENERO': '01', 'FEBRERO': '02', 'MARZO': '03', 'ABRIL': '04',
  'MAYO': '05', 'JUNIO': '06', 'JULIO': '07', 'AGOSTO': '08',
  'SEPTIEMBRE': '09', 'OCTUBRE': '10', 'NOVIEMBRE': '11', 'DICIEMBRE': '12',
};

// ═══════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════

/**
 * Fetch publications from the Publicaciones API.
 *
 * @param options - Standard adapter options (radicado, mode, timeout, etc.)
 * @returns Normalized ProviderAdapterResult with publicaciones (no actuaciones).
 */
export async function fetchFromPublicaciones(
  options: AdapterOptions,
): Promise<ProviderAdapterResult> {
  const startTime = Date.now();
  const { radicado, mode, timeoutMs, signal } = options;

  const baseUrl = Deno.env.get('PUBLICACIONES_BASE_URL');
  const apiKeyInfo = await getApiKeyForProvider('publicaciones');

  if (!baseUrl) {
    console.log(`${LOG_TAG} PUBLICACIONES_BASE_URL not configured`);
    return emptyResult('ERROR', Date.now() - startTime, 'PUBLICACIONES_BASE_URL not configured');
  }

  try {
    if (mode === 'monitoring') {
      return await fetchMonitoring(radicado, baseUrl, apiKeyInfo, options, startTime);
    } else {
      return await fetchDiscovery(radicado, baseUrl, apiKeyInfo, options, startTime);
    }
  } catch (err: any) {
    const isTimeout = err instanceof DOMException && err.name === 'AbortError';
    return emptyResult(
      isTimeout ? 'TIMEOUT' : 'ERROR',
      Date.now() - startTime,
      isTimeout ? 'Timeout' : (err.message || String(err)),
    );
  }
}

// ═══════════════════════════════════════════
// MONITORING MODE
// ═══════════════════════════════════════════

async function fetchMonitoring(
  radicado: string,
  baseUrl: string,
  apiKeyInfo: ApiKeyInfo,
  options: AdapterOptions,
  startTime: number,
): Promise<ProviderAdapterResult> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const headers = buildHeaders(apiKeyInfo);
  const timeoutMs = options.timeoutMs || 30_000;

  // Strategy: /snapshot → /search → /buscar (async trigger)
  const endpoints = [
    `${cleanBase}/snapshot/${radicado}`,
    `${cleanBase}/search/${radicado}`,
  ];

  for (const url of endpoints) {
    const result = await fetchEndpoint(url, headers, timeoutMs, options.signal);
    if (result.ok && result.data) {
      const publicaciones = normalizePublicacionesResponse(result.data, options);
      if (publicaciones.length > 0 || result.data.found) {
        return {
          provider: PROVIDER_KEY,
          status: publicaciones.length > 0 ? 'SUCCESS' : 'EMPTY',
          actuaciones: [],
          publicaciones,
          metadata: extractPublicacionesMetadata(result.data),
          parties: null,
          durationMs: Date.now() - startTime,
          httpStatus: 200,
        };
      }
    }
  }

  // Last resort: /buscar async trigger with polling
  const buscarResult = await tryBuscarWithPolling(cleanBase, radicado, headers, timeoutMs, options.signal);
  if (buscarResult) {
    const publicaciones = normalizePublicacionesResponse(buscarResult, options);
    return {
      provider: PROVIDER_KEY,
      status: publicaciones.length > 0 ? 'SUCCESS' : 'EMPTY',
      actuaciones: [],
      publicaciones,
      metadata: extractPublicacionesMetadata(buscarResult),
      parties: null,
      durationMs: Date.now() - startTime,
      httpStatus: 200,
    };
  }

  return emptyResult('EMPTY', Date.now() - startTime, 'All endpoints exhausted');
}

// ═══════════════════════════════════════════
// DISCOVERY MODE
// ═══════════════════════════════════════════

async function fetchDiscovery(
  radicado: string,
  baseUrl: string,
  apiKeyInfo: ApiKeyInfo,
  options: AdapterOptions,
  startTime: number,
): Promise<ProviderAdapterResult> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const headers = buildHeaders(apiKeyInfo);
  const timeoutMs = options.timeoutMs || 20_000;

  const url = `${cleanBase}/snapshot/${radicado}`;
  const result = await fetchEndpoint(url, headers, timeoutMs, options.signal);

  if (!result.ok || !result.data) {
    return emptyResult(
      result.httpStatus === 404 ? 'EMPTY' : 'ERROR',
      Date.now() - startTime,
      result.error || `HTTP ${result.httpStatus}`,
      result.httpStatus,
    );
  }

  const publicaciones = normalizePublicacionesResponse(result.data, options);

  return {
    provider: PROVIDER_KEY,
    status: publicaciones.length > 0 ? 'SUCCESS' : 'EMPTY',
    actuaciones: [],
    publicaciones,
    metadata: extractPublicacionesMetadata(result.data),
    parties: null,
    durationMs: Date.now() - startTime,
    httpStatus: 200,
  };
}

// ═══════════════════════════════════════════
// HTTP HELPERS
// ═══════════════════════════════════════════

function buildHeaders(apiKeyInfo: ApiKeyInfo): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (apiKeyInfo.value) {
    headers['x-api-key'] = apiKeyInfo.value;
  }
  return headers;
}

interface EndpointResult {
  ok: boolean;
  data?: any;
  error?: string;
  httpStatus?: number;
}

async function fetchEndpoint(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<EndpointResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Chain external signal
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    console.log(`${LOG_TAG} GET ${url}`);
    const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return { ok: false, error: `HTTP ${resp.status}`, httpStatus: resp.status };
    }

    const data = await resp.json();
    return { ok: true, data, httpStatus: resp.status };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { ok: false, error: 'Timeout' };
    }
    return { ok: false, error: err.message || String(err) };
  }
}

async function tryBuscarWithPolling(
  baseUrl: string,
  radicado: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<any | null> {
  try {
    const buscarUrl = `${baseUrl}/buscar?radicado=${radicado}`;
    console.log(`${LOG_TAG} Trying /buscar: ${buscarUrl}`);

    const resp = await fetch(buscarUrl, { method: 'GET', headers });
    if (!resp.ok) return null;

    const data = await resp.json();

    // If /buscar returned data directly (cached)
    if (data.found && data.publicaciones?.length > 0) {
      return data;
    }

    // If it returned a job ID, poll
    const jobId = data.jobId || data.job_id || data.id;
    const rawPollUrl = data.poll_url || data.pollUrl;
    const pollUrl = rawPollUrl || (jobId ? `${baseUrl}/resultado/${jobId}` : null);

    if (jobId && pollUrl) {
      console.log(`${LOG_TAG} /buscar initiated job ${jobId}, polling...`);
      const pollResult = await pollForResult(
        pollUrl,
        headers,
        PROVIDER_KEY,
        { ...DEFAULT_POLL_CONFIG, maxAttempts: 10 },
      );
      if (pollResult?.ok && pollResult.data) {
        const resultData = pollResult.data as any;
        if (resultData.publicaciones?.length > 0 || resultData.found) {
          return resultData;
        }
      }
    }

    return null;
  } catch (err) {
    console.warn(`${LOG_TAG} /buscar fallback error:`, err);
    return null;
  }
}

// ═══════════════════════════════════════════
// NORMALIZATION
// ═══════════════════════════════════════════

/**
 * Normalize raw publicaciones from the API response into NormalizedPublicacion[].
 */
export function normalizePublicacionesResponse(
  data: any,
  options?: Pick<AdapterOptions, 'workItemId' | 'crossProviderDedup' | 'redactPII'>,
): NormalizedPublicacion[] {
  const rawPubs = Array.isArray(data?.publicaciones)
    ? data.publicaciones
    : (Array.isArray(data) ? data : []);

  return rawPubs
    .map((p: any) => normalizeOnePublicacion(p, options))
    .filter((p: NormalizedPublicacion | null): p is NormalizedPublicacion => p !== null);
}

function normalizeOnePublicacion(
  p: any,
  options?: Pick<AdapterOptions, 'workItemId' | 'crossProviderDedup' | 'redactPII'>,
): NormalizedPublicacion | null {
  // Extract date
  let fecha: string | null | undefined = normalizeDate(
    p.fecha_publicacion ?? p.fecha_hora_inicio ?? p.fechaFijacion ??
    p.fechaPublicacion ?? p.fecha ?? p.fechaInicio ?? p.fechaRegistro,
  );
  const tituloStr = String(p.titulo || '');
  if (!fecha && tituloStr) fecha = extractDateFromTitle(tituloStr) || null;
  const pdfUrl = String(p.pdf_url || p.url || '');
  if (!fecha && pdfUrl) {
    const m = pdfUrl.match(/(\d{4})(\d{2})(\d{2})\.pdf/i);
    if (m) fecha = `${m[1]}-${m[2]}-${m[3]}`;
  }

  // Extract tipo
  let tipo = String(p.tipo_evento || '');
  if (!tipo || tipo === 'null') {
    if (/^ESTADOS?\b/i.test(tituloStr)) tipo = 'Estado Electrónico';
    else if (/^EDICTO/i.test(tituloStr)) tipo = 'Edicto';
    else if (/^NOTIFICACI/i.test(tituloStr)) tipo = 'Notificación';
    else if (/^TRASLADO/i.test(tituloStr)) tipo = 'Traslado';
    else tipo = truncate(String(p.tipo || 'Estado'), 80) || 'Estado';
  }

  const cleanTitle = tituloStr.replace(/\.pdf$/i, '').trim();
  const title = options?.redactPII && cleanTitle
    ? redactPII(truncate(cleanTitle, 200) || '')
    : (cleanTitle || tipo);

  // Attachments
  const attachments = extractAttachments(p, PROVIDER_KEY);

  // Fingerprint
  const assetId = p.asset_id || p.key || '';
  const fingerprint = computePublicacionFingerprint(
    options?.workItemId || '',
    assetId,
    p.key,
    tituloStr,
    options?.crossProviderDedup,
  );

  if (!fecha && !title) return null;

  return {
    title: title || tipo,
    tipo_publicacion: tipo,
    fecha_fijacion: fecha || '',
    fecha_desfijacion: normalizeDate(p.fecha_desfijacion ?? p.fechaDesfijacion) || undefined,
    hash_fingerprint: fingerprint,
    source_platform: PROVIDER_KEY,
    sources: [PROVIDER_KEY],
    juzgado: p.juzgado || p.despacho || undefined,
    pdf_url: pdfUrl || undefined,
    entry_url: p.entry_url || p.url || undefined,
    asset_id: p.asset_id || undefined,
    key: p.key || undefined,
    terminos_inician: undefined, // Calculated by caller
    attachments: attachments.length > 0 ? attachments : undefined,
    clasificacion: p.clasificacion || undefined,
    raw_data: p,
  };
}

// ═══════════════════════════════════════════
// FINGERPRINTING
// ═══════════════════════════════════════════

/**
 * Generate unique fingerprint for publication deduplication.
 * Uses asset_id (guaranteed unique per publication) or falls back to key/title.
 */
export function computePublicacionFingerprint(
  workItemId: string,
  assetId: string | undefined,
  key: string | undefined,
  title: string,
  crossProvider?: boolean,
): string {
  const uniqueId = assetId || key || title;
  const scope = crossProvider ? 'x' : (workItemId || 'noscope');
  const data = `${scope}|${uniqueId}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `pub_${scope.slice(0, 8)}_${Math.abs(hash).toString(16)}`;
}

// ═══════════════════════════════════════════
// DATE EXTRACTION FROM TITLES
// ═══════════════════════════════════════════

/**
 * Extract date from publication title — handles multiple formats.
 */
export function extractDateFromTitle(title: string): string | undefined {
  if (!title) return undefined;

  // Pattern 1: "XXXEstadosYYYYMMDD.pdf"
  const yyyymmddMatch = title.match(/(\d{4})(\d{2})(\d{2})\.pdf/i);
  if (yyyymmddMatch) {
    const [, y, m, d] = yyyymmddMatch;
    if (+y >= 2020 && +y <= 2030 && +m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) {
      return `${y}-${m}-${d}`;
    }
  }

  // Pattern 2: YYYYMMDD anywhere
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

  // Pattern 4: DD/MM/YYYY or DD-MM-YYYY
  const slashMatch = title.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
  }

  return undefined;
}

// ═══════════════════════════════════════════
// ATTACHMENT EXTRACTION
// ═══════════════════════════════════════════

function extractAttachments(p: any, provider: string): PublicacionAttachment[] {
  const attachments: PublicacionAttachment[] = [];
  const seenUrls = new Set<string>();

  const candidateKeys = [
    'pdf_url', 'pdfUrl', 'url_pdf', 'documento_url', 'documentUrl',
    'link', 'enlace', 'archivo', 'adjunto', 'ruta_pdf', 'url',
  ];

  for (const key of candidateKeys) {
    const val = p[key];
    if (val && typeof val === 'string' && val.startsWith('https') && !seenUrls.has(val)) {
      seenUrls.add(val);
      attachments.push({
        type: val.toLowerCase().includes('.pdf') ? 'pdf' : 'link',
        url: val,
        label: val.toLowerCase().includes('.pdf') ? 'Ver PDF' : 'Ver documento',
        provider,
      });
    }
  }

  // Check for URLs in arrays (e.g., documentos: [{url: ...}])
  if (Array.isArray(p.documentos)) {
    for (const doc of p.documentos) {
      const docUrl = doc?.url || doc?.pdf_url || doc?.enlace;
      if (docUrl && typeof docUrl === 'string' && docUrl.startsWith('https') && !seenUrls.has(docUrl)) {
        seenUrls.add(docUrl);
        attachments.push({
          type: docUrl.toLowerCase().includes('.pdf') ? 'pdf' : 'link',
          url: docUrl,
          label: doc?.titulo || doc?.label || 'Ver documento',
          provider,
        });
      }
    }
  }

  return attachments;
}

// ═══════════════════════════════════════════
// METADATA EXTRACTION
// ═══════════════════════════════════════════

function extractPublicacionesMetadata(data: any): CaseMetadata | null {
  if (!data?.found && !data?.principal) return null;

  const pr = data.principal || {};
  return {
    despacho: pr.despacho || null,
    tipo_proceso: pr.tipoProceso || pr.tipo_proceso || null,
    fecha_radicacion: normalizeDate(pr.fechaRadicacion ?? pr.fecha_radicacion ?? pr.fecha) || null,
  };
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function emptyResult(
  status: ProviderStatus,
  durationMs: number,
  errorMessage?: string,
  httpStatus?: number,
): ProviderAdapterResult {
  return {
    provider: PROVIDER_KEY,
    status,
    actuaciones: [],
    publicaciones: [],
    metadata: null,
    parties: null,
    durationMs,
    errorMessage,
    httpStatus,
  };
}
