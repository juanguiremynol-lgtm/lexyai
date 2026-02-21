/**
 * samaiAdapter.ts — Unified SAMAI provider adapter.
 *
 * SINGLE SOURCE OF TRUTH for all SAMAI HTTP calls and response normalization.
 * Supports two modes:
 *   - 'monitoring': Uses /snapshot (preferred), falls back to /buscar + polling.
 *     For ongoing sync of monitored work items.
 *   - 'discovery': Uses /buscar directly (may return cached or trigger async scraping).
 *     For creation wizard and demo modal lookups.
 *
 * Previously duplicated in:
 *   - sync-by-work-item/index.ts (monitoring path — ~300 lines)
 *   - sync-by-radicado/index.ts (discovery path — ~250 lines)
 *
 * This adapter does NOT persist data — it returns normalized results only.
 */

import type {
  NormalizedActuacion,
  CaseMetadata,
  ExtractedParties,
  AdapterMode,
  AdapterOptions,
  ProviderStatus,
  ProviderAdapterResult,
} from './types.ts';

import {
  normalizeDate,
  ensureAbsoluteUrl,
  getApiKeyForProvider,
  pollForResult,
  DEFAULT_POLL_CONFIG,
  truncate,
  type ApiKeyInfo,
} from '../radicadoUtils.ts';

import { parseSujetosArray } from '../partyNormalization.ts';

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

const PROVIDER_KEY = 'samai';
const LOG_TAG = '[samaiAdapter]';

// ═══════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════

/**
 * Fetch actuaciones from SAMAI.
 *
 * - monitoring mode: /snapshot first, fallback to /buscar + polling
 * - discovery mode: /buscar directly (cached or async scraping + polling)
 */
export async function fetchFromSamai(
  options: AdapterOptions,
): Promise<ProviderAdapterResult> {
  const startTime = Date.now();
  const baseUrl = Deno.env.get('SAMAI_BASE_URL');
  const apiKeyInfo = await getApiKeyForProvider('samai');

  if (!baseUrl) {
    return makeErrorResult('SAMAI API not configured (missing SAMAI_BASE_URL)', startTime);
  }

  const cleanBase = baseUrl.replace(/\/+$/, '');
  const headers = buildHeaders(apiKeyInfo);

  try {
    if (options.mode === 'monitoring') {
      return await fetchMonitoringMode(options, cleanBase, headers, apiKeyInfo, startTime);
    } else {
      return await fetchDiscoveryMode(options, cleanBase, headers, startTime);
    }
  } catch (err) {
    console.error(`${LOG_TAG} Fetch error:`, err);
    return makeErrorResult(
      err instanceof Error ? err.message : 'SAMAI fetch failed',
      startTime,
    );
  }
}

// ═══════════════════════════════════════════
// MONITORING MODE: /snapshot → /buscar fallback → poll
// ═══════════════════════════════════════════

async function fetchMonitoringMode(
  options: AdapterOptions,
  baseUrl: string,
  headers: Record<string, string>,
  apiKeyInfo: ApiKeyInfo,
  startTime: number,
): Promise<ProviderAdapterResult> {
  const { radicado } = options;

  // Step 1: Try /snapshot (synchronous cached lookup)
  const snapshotUrl = `${baseUrl}/snapshot?numero_radicacion=${radicado}`;
  console.log(`${LOG_TAG} [monitoring] Calling /snapshot: ${snapshotUrl}`);

  const response = await fetch(snapshotUrl, { method: 'GET', headers });

  if (response.ok) {
    const data = await response.json();
    const result = data.result || data;
    const rawActuaciones = result.actuaciones || [];

    if (rawActuaciones.length === 0) {
      return makeEmptyResult('No actuaciones in SAMAI /snapshot response', startTime, 200);
    }

    console.log(`${LOG_TAG} [monitoring] /snapshot found ${rawActuaciones.length} actuaciones`);
    const sujetos = result.sujetos_procesales ?? result.sujetos ?? [];
    return buildSuccessResult(result, rawActuaciones, sujetos, options, startTime, 200);
  }

  // Step 2: If 404, try /buscar (may return cached or create async job)
  if (response.status === 404) {
    console.log(`${LOG_TAG} [monitoring] /snapshot 404, falling back to /buscar`);
    return await buscarWithPolling(radicado, baseUrl, headers, apiKeyInfo, options, startTime);
  }

  // Other HTTP error
  return makeErrorResult(`HTTP ${response.status}`, startTime, response.status);
}

// ═══════════════════════════════════════════
// DISCOVERY MODE: /buscar directly
// ═══════════════════════════════════════════

async function fetchDiscoveryMode(
  options: AdapterOptions,
  baseUrl: string,
  headers: Record<string, string>,
  startTime: number,
): Promise<ProviderAdapterResult> {
  const { radicado } = options;
  const buscarUrl = `${baseUrl}/buscar?numero_radicacion=${radicado}`;
  console.log(`${LOG_TAG} [discovery] Calling /buscar: ${buscarUrl}`);

  const response = await fetch(buscarUrl, { method: 'GET', headers });
  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    if (response.status === 404) {
      return makeEmptyResult('Record not found in SAMAI', startTime, 404);
    }
    return makeErrorResult(`SAMAI returned ${response.status}`, startTime, response.status);
  }

  const buscarResult = await response.json();

  // Check if /buscar returned an async scraping job
  if ((buscarResult.jobId || buscarResult.job_id) && !buscarResult.result) {
    const jobId = buscarResult.jobId || buscarResult.job_id;
    console.log(`${LOG_TAG} [discovery] /buscar initiated scraping job: ${jobId}. Polling...`);

    const rawPollUrl = buscarResult.poll_url || buscarResult.pollUrl || buscarResult.resultado_url || '';
    const pollUrl = resolveAbsolutePollUrl(rawPollUrl, baseUrl, jobId);

    const pollResult = await pollForResult(pollUrl, headers, 'SAMAI', DEFAULT_POLL_CONFIG);

    if (pollResult.ok && pollResult.data) {
      const resultData = (pollResult.data.result || pollResult.data.data || pollResult.data) as Record<string, unknown>;
      const rawActs = (resultData.actuaciones ?? []) as Array<Record<string, unknown>>;
      const sujetos = (resultData.sujetos_procesales ?? resultData.sujetos ?? []) as Array<Record<string, unknown>>;

      if (rawActs.length > 0) {
        console.log(`${LOG_TAG} [discovery] Polling completed: ${rawActs.length} actuaciones`);
        return buildSuccessResult(resultData, rawActs, sujetos, options, startTime, 200);
      }
    }

    // Polling failed/timed out
    return {
      provider: PROVIDER_KEY,
      status: 'TIMEOUT' as ProviderStatus,
      actuaciones: [],
      publicaciones: [],
      metadata: null,
      parties: null,
      durationMs: Date.now() - startTime,
      errorMessage: `Scraping job ${jobId} did not complete in time`,
      httpStatus: 408,
      scrapingJobId: jobId,
      scrapingPollUrl: pollUrl,
    };
  }

  // /buscar returned data directly (cached or synchronous)
  const proceso = buscarResult.result || buscarResult.data || buscarResult.proceso || buscarResult;
  if (!proceso || Object.keys(proceso).length === 0) {
    return makeEmptyResult('No data in SAMAI response', startTime, 200);
  }

  const sujetos = proceso.sujetos_procesales ?? proceso.sujetos ?? [];
  const rawActuaciones = proceso.actuaciones ?? [];
  return buildSuccessResult(proceso, rawActuaciones, sujetos, options, startTime, 200);
}

// ═══════════════════════════════════════════
// /buscar + POLLING (monitoring fallback)
// ═══════════════════════════════════════════

async function buscarWithPolling(
  radicado: string,
  baseUrl: string,
  headers: Record<string, string>,
  apiKeyInfo: ApiKeyInfo,
  options: AdapterOptions,
  startTime: number,
): Promise<ProviderAdapterResult> {
  const buscarUrl = `${baseUrl}/buscar?numero_radicacion=${radicado}`;
  console.log(`${LOG_TAG} [monitoring] Triggering /buscar: ${buscarUrl}`);

  let buscarResponse: Response;
  try {
    buscarResponse = await fetch(buscarUrl, { method: 'GET', headers });
  } catch (err) {
    return makeErrorResult(`/buscar fetch failed: ${err instanceof Error ? err.message : String(err)}`, startTime);
  }

  if (!buscarResponse.ok) {
    return makeErrorResult(`/buscar failed: HTTP ${buscarResponse.status}`, startTime, buscarResponse.status);
  }

  let data: Record<string, unknown>;
  try {
    const body = await buscarResponse.text();
    data = JSON.parse(body);
  } catch {
    return makeErrorResult('Scraping service returned invalid response', startTime);
  }

  // Case 1: /buscar returned CACHED data directly
  if (data.success === true && (data.status === 'done' || data.cached === true) && data.result) {
    console.log(`${LOG_TAG} [monitoring] /buscar returned CACHED data`);
    const resultData = data.result as Record<string, unknown>;
    const rawActs = (resultData.actuaciones || []) as Array<Record<string, unknown>>;
    const sujetos = (resultData.sujetos || []) as Array<Record<string, unknown>>;

    if (rawActs.length > 0) {
      return buildSuccessResult(resultData, rawActs, sujetos, options, startTime, 200);
    }
  }

  // Case 2: /buscar created an async job — poll for result
  const jobId = String(data.jobId || data.job_id || data.id || '');
  if (jobId) {
    const rawPollUrl = String(data.poll_url || data.pollUrl || data.resultado_url || '');
    const pollUrl = resolveAbsolutePollUrl(rawPollUrl, baseUrl, jobId);

    console.log(`${LOG_TAG} [monitoring] Scraping job created: jobId=${jobId}, polling at ${pollUrl}`);

    const pollResult = await pollForResult(pollUrl, headers, 'SAMAI', DEFAULT_POLL_CONFIG);

    if (pollResult.ok && pollResult.data) {
      const resultData = (pollResult.data.result || pollResult.data) as Record<string, unknown>;
      const rawActs = (resultData.actuaciones || []) as Array<Record<string, unknown>>;
      const sujetos = (resultData.sujetos || []) as Array<Record<string, unknown>>;

      if (rawActs.length > 0) {
        console.log(`${LOG_TAG} [monitoring] Scraping completed: ${rawActs.length} actuaciones`);
        return buildSuccessResult(resultData, rawActs, sujetos, options, startTime, 200);
      }
    }

    // Polling failed/timed out
    return {
      provider: PROVIDER_KEY,
      status: 'TIMEOUT' as ProviderStatus,
      actuaciones: [],
      publicaciones: [],
      metadata: null,
      parties: null,
      durationMs: Date.now() - startTime,
      errorMessage: `Scraping job ${jobId} did not complete within timeout`,
      httpStatus: 408,
      scrapingJobId: jobId,
      scrapingPollUrl: pollUrl,
    };
  }

  // Case 3: No cached data, no job ID — unexpected
  return makeEmptyResult('SAMAI /buscar returned no data and no job ID', startTime, 200);
}

// ═══════════════════════════════════════════
// NORMALIZATION
// ═══════════════════════════════════════════

/**
 * Normalize raw SAMAI actuaciones into NormalizedActuacion[].
 * SAMAI field names: fechaActuacion, actuacion, anotacion, fechaRegistro, estado, anexos, indice
 */
export function normalizeSamaiActuaciones(
  rawActuaciones: Array<Record<string, unknown>>,
  options: {
    workItemId?: string;
    crossProviderDedup?: boolean;
  } = {},
): NormalizedActuacion[] {
  return rawActuaciones.map((act) => {
    const fecha = normalizeDate(
      String(act.fechaActuacion || act.fecha_actuacion || act.fecha || act.fechaRegistro || ''),
    );
    const actuacion = String(act.actuacion || act.tipo_actuacion || '');
    const anotacion = String(act.anotacion || act.descripcion || '') || null;
    const fechaRegistro = normalizeDate(String(act.fechaRegistro || ''));
    const estado = String(act.estado || '') || undefined;
    const anexosCount = Number(act.anexos || 0) || undefined;
    const indice = String(act.indice || '') || undefined;

    return {
      fecha_actuacion: fecha,
      actuacion,
      anotacion,
      hash_fingerprint: computeSamaiFingerprint(fecha, actuacion, anotacion, options),
      source_platform: PROVIDER_KEY,
      sources: [PROVIDER_KEY],
      fecha_registro: fechaRegistro || undefined,
      estado,
      anexos_count: anexosCount,
      indice,
      raw_data: act as Record<string, unknown>,
    };
  });
}

/**
 * Compute a deterministic fingerprint for dedup.
 * Uses date + actuacion + first 100 chars of anotacion.
 */
export function computeSamaiFingerprint(
  fecha: string,
  actuacion: string,
  anotacion: string | null,
  options: { workItemId?: string; crossProviderDedup?: boolean } = {},
): string {
  const base = [
    fecha,
    actuacion.trim().toLowerCase(),
    truncate(anotacion || '', 100).trim().toLowerCase(),
  ].join('|');

  // If cross-provider dedup is enabled (FANOUT mode), don't include provider in fingerprint
  const prefix = options.crossProviderDedup
    ? ''
    : `${PROVIDER_KEY}:`;

  const scope = options.workItemId
    ? `wi:${options.workItemId}:`
    : '';

  return `${prefix}${scope}${simpleHash(base)}`;
}

/**
 * Extract SAMAI-specific case metadata from the response.
 */
export function extractSamaiMetadata(
  data: Record<string, unknown>,
  sujetos: Array<Record<string, unknown>>,
): CaseMetadata {
  const clasificacion = data.clasificacion as Record<string, unknown> | undefined;
  const fechas = data.fechas as Record<string, unknown> | undefined;
  const salas = data.salas as Record<string, unknown> | undefined;

  // Extract ministerio publico from sujetos
  const ministerioPublico = sujetos
    .filter(s => String(s.tipo || '').toLowerCase().includes('ministerio'))
    .map(s => String(s.nombre || ''))
    .filter(Boolean)
    .join(' | ') || undefined;

  return {
    despacho: (data.corporacionNombre || data.corporacion || data.despacho || data.despacho_actual) as string ?? null,
    ciudad: (data.ciudad || data.sede) as string ?? null,
    departamento: data.departamento as string ?? null,
    tipo_proceso: (clasificacion?.tipoProceso || data.tipo_proceso || data.tipo || data.clase) as string ?? null,
    clase_proceso: (clasificacion?.clase || data.clase_proceso || data.clase || data.subclase_proceso) as string ?? null,
    fecha_radicacion: (data.fecha_radicado || data.fecha_radicacion || fechas?.radicado) as string ?? null,
    // SAMAI-specific fields
    ponente: data.ponente as string ?? null,
    etapa: data.etapa as string ?? null,
    origen: data.origen as string ?? null,
    ubicacion: data.ubicacion as string ?? null,
    formato_expediente: data.formatoExpediente as string ?? null,
    subclase: clasificacion?.subclase as string ?? null,
    recurso: clasificacion?.recurso as string ?? null,
    naturaleza: clasificacion?.naturaleza as string ?? null,
    asunto: data.asunto as string ?? null,
    medida_cautelar: data.medidaCautelar as string ?? null,
    ministerio_publico: ministerioPublico ?? null,
    total_sujetos: (data.totalSujetos as number) || sujetos.length || null,
    fecha_presenta_demanda: fechas?.presentaDemanda as string ?? null,
    fecha_para_sentencia: fechas?.paraSentencia as string ?? null,
    fecha_sentencia: fechas?.sentencia as string ?? null,
    sala_conoce: salas?.conoce as string ?? null,
    sala_decide: salas?.decide as string ?? null,
    veces_en_corporacion: data.vecesEnCorporacion as number ?? null,
    guid: data.guid as string ?? null,
    consultado_en: data.consultadoEn as string ?? null,
    fuente: (data.fuente as string) || 'SAMAI',
  };
}

/**
 * Extract parties from SAMAI sujetos array.
 * Uses the shared partyNormalization module.
 */
export function extractSamaiParties(
  sujetos: Array<Record<string, unknown>>,
): ExtractedParties {
  if (!sujetos || sujetos.length === 0) {
    return { demandante: null, demandado: null };
  }

  const normalized = sujetos.map(s => ({
    tipo: String(s.tipo || ''),
    nombre: String(s.nombre || ''),
  }));

  const parsed = parseSujetosArray(normalized);

  return {
    demandante: parsed.demandante || null,
    demandado: parsed.demandado || null,
    sujetos_procesales: parsed.partes.map(p => ({
      tipo: p.rawRole,
      nombre: p.name,
    })),
  };
}

// ═══════════════════════════════════════════
// INTERNAL HELPERS
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

function resolveAbsolutePollUrl(rawUrl: string, baseUrl: string, jobId: string): string {
  if (rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))) {
    return rawUrl;
  }
  if (rawUrl && rawUrl.startsWith('/')) {
    return `${baseUrl}${rawUrl}`;
  }
  return `${baseUrl}/resultado/${jobId}`;
}

function buildSuccessResult(
  data: Record<string, unknown>,
  rawActuaciones: Array<Record<string, unknown>>,
  sujetos: Array<Record<string, unknown>>,
  options: AdapterOptions,
  startTime: number,
  httpStatus: number,
): ProviderAdapterResult {
  const actuaciones = normalizeSamaiActuaciones(rawActuaciones, {
    workItemId: options.workItemId,
    crossProviderDedup: options.crossProviderDedup,
  });

  const metadata = extractSamaiMetadata(data, sujetos);
  const parties = options.includeParties !== false
    ? extractSamaiParties(sujetos)
    : null;

  return {
    provider: PROVIDER_KEY,
    status: 'SUCCESS' as ProviderStatus,
    actuaciones,
    publicaciones: [], // SAMAI estados are handled by samaiEstadosAdapter
    metadata,
    parties,
    durationMs: Date.now() - startTime,
    httpStatus,
  };
}

function makeErrorResult(
  message: string,
  startTime: number,
  httpStatus?: number,
): ProviderAdapterResult {
  return {
    provider: PROVIDER_KEY,
    status: 'ERROR' as ProviderStatus,
    actuaciones: [],
    publicaciones: [],
    metadata: null,
    parties: null,
    durationMs: Date.now() - startTime,
    errorMessage: message,
    httpStatus,
  };
}

function makeEmptyResult(
  message: string,
  startTime: number,
  httpStatus: number,
): ProviderAdapterResult {
  return {
    provider: PROVIDER_KEY,
    status: 'EMPTY' as ProviderStatus,
    actuaciones: [],
    publicaciones: [],
    metadata: null,
    parties: null,
    durationMs: Date.now() - startTime,
    errorMessage: message,
    httpStatus,
  };
}

/**
 * Simple non-crypto hash for fingerprinting (same as cpnuAdapter).
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
