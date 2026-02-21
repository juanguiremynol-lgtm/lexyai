/**
 * tutelasAdapter.ts — Unified Tutelas provider adapter.
 *
 * SINGLE SOURCE OF TRUTH for all Tutelas HTTP calls and response normalization.
 * Supports two modes:
 *   - 'monitoring': Uses /expediente/{tutela_code} for direct lookup (T-code),
 *     or POST /search with fire-and-forget for radicado-based lookups.
 *   - 'discovery': Uses POST /search with inline polling (up to 6 attempts).
 *
 * Previously duplicated in:
 *   - sync-by-work-item/index.ts (monitoring path — ~200 lines)
 *   - sync-by-radicado/index.ts (discovery path — ~180 lines)
 *   - demo-radicado-lookup/index.ts (discovery + polling — ~100 lines)
 *
 * This adapter does NOT persist data — it returns normalized results only.
 */

import type {
  NormalizedActuacion,
  NormalizedPublicacion,
  PublicacionAttachment,
  CaseMetadata,
  ExtractedParties,
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

const PROVIDER_KEY = 'tutelas';
const LOG_TAG = '[tutelasAdapter]';

// ═══════════════════════════════════════════
// CORTE STATUS MAPPING
// ═══════════════════════════════════════════

/**
 * Map raw Corte Constitucional status to canonical status.
 */
export function mapCorteStatus(estado: string): string {
  const upper = (estado || '').toUpperCase();
  if (/NO.*SELECCION/.test(upper)) return 'NO_SELECCIONADA';
  if (/SELECCION.*REVISION|SELECCIONAD/.test(upper)) return 'SELECCIONADA';
  if (/SENTENCIA|FALLAD/.test(upper)) return 'SENTENCIA_EMITIDA';
  return 'PENDIENTE';
}

// ═══════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════

/**
 * Fetch actuaciones and estados from the Tutelas API.
 *
 * @param options - Standard adapter options. The `radicado` field may be a
 *   tutela code (T1234567) or a standard 23-digit radicado.
 * @returns Normalized ProviderAdapterResult with both actuaciones and publicaciones.
 */
export async function fetchFromTutelas(
  options: AdapterOptions,
): Promise<ProviderAdapterResult> {
  const startTime = Date.now();
  const { radicado, mode, timeoutMs, signal } = options;

  const baseUrl = Deno.env.get('TUTELAS_BASE_URL');
  const apiKeyInfo = await getApiKeyForProvider('tutelas');

  if (!baseUrl) {
    console.log(`${LOG_TAG} TUTELAS_BASE_URL not configured`);
    return emptyResult('ERROR', Date.now() - startTime, 'TUTELAS_BASE_URL not configured');
  }

  // Determine identifier type
  const isTutelaCode = /^T\d/i.test(radicado);

  try {
    if (mode === 'monitoring') {
      return await fetchMonitoring(radicado, isTutelaCode, baseUrl, apiKeyInfo, options, startTime);
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
  identifier: string,
  isTutelaCode: boolean,
  baseUrl: string,
  apiKeyInfo: ApiKeyInfo,
  options: AdapterOptions,
  startTime: number,
): Promise<ProviderAdapterResult> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const headers = buildHeaders(apiKeyInfo);
  const timeout = options.timeoutMs || 90_000;

  if (isTutelaCode) {
    // Direct expediente lookup by T-code
    return await fetchExpediente(identifier, cleanBase, headers, timeout, options, startTime);
  } else {
    // Radicado-based search — fire-and-forget pattern for monitoring
    return await triggerSearchFireAndForget(identifier, cleanBase, headers, apiKeyInfo, timeout, options, startTime);
  }
}

async function fetchExpediente(
  tutelaCode: string,
  baseUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
  options: AdapterOptions,
  startTime: number,
): Promise<ProviderAdapterResult> {
  const url = `${baseUrl}/expediente/${tutelaCode}`;
  console.log(`${LOG_TAG} GET ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      if (resp.status === 404) {
        // 404 on direct lookup — trigger scraping job
        console.log(`${LOG_TAG} 404 on /expediente, triggering /search as fallback`);
        return await triggerSearchFireAndForget(
          tutelaCode, baseUrl, headers, { value: headers['x-api-key'] || null, source: 'env', fingerprint: null },
          timeoutMs, options, startTime,
        );
      }
      return emptyResult('ERROR', Date.now() - startTime, `HTTP ${resp.status}`, resp.status);
    }

    const data = await resp.json();
    return buildResultFromData(data, options, startTime);
  } catch (err: any) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function triggerSearchFireAndForget(
  identifier: string,
  baseUrl: string,
  headers: Record<string, string>,
  apiKeyInfo: ApiKeyInfo,
  timeoutMs: number,
  options: AdapterOptions,
  startTime: number,
): Promise<ProviderAdapterResult> {
  const searchUrl = `${baseUrl}/search`;
  console.log(`${LOG_TAG} POST ${searchUrl} (fire-and-forget)`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.min(timeoutMs, 20_000));

  try {
    const resp = await fetch(searchUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ radicado: identifier }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      if (resp.status === 422) {
        const errorBody = await resp.text();
        return emptyResult('ERROR', Date.now() - startTime, `Validation error (422): ${errorBody.slice(0, 200)}`, 422);
      }
      if (resp.status === 404) {
        return emptyResult('EMPTY', Date.now() - startTime, 'Record not found in TUTELAS', 404);
      }
      return emptyResult('ERROR', Date.now() - startTime, `HTTP ${resp.status}`, resp.status);
    }

    const result = await resp.json();

    // Check if async job was created (monitoring: don't poll inline)
    if ((result.status === 'pending' || result.status === 'processing') && (result.job_id || result.jobId)) {
      const jobId = result.job_id || result.jobId;
      const pollUrl = `${baseUrl}/job/${jobId}`;
      console.log(`${LOG_TAG} Scraping job ${jobId} created (fire-and-forget)`);

      return {
        provider: PROVIDER_KEY,
        status: 'SCRAPING_INITIATED',
        actuaciones: [],
        publicaciones: [],
        metadata: null,
        parties: null,
        durationMs: Date.now() - startTime,
        httpStatus: 202,
        scrapingJobId: jobId,
        scrapingPollUrl: pollUrl,
      };
    }

    // Direct data returned
    return buildResultFromData(result, options, startTime);
  } catch (err: any) {
    clearTimeout(timeoutId);
    throw err;
  }
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
  const timeout = options.timeoutMs || 20_000;

  console.log(`${LOG_TAG} POST ${cleanBase}/search (discovery)`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const resp = await fetch(`${cleanBase}/search`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ radicado }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      if (resp.status === 404) {
        return emptyResult('EMPTY', Date.now() - startTime, 'Record not found', 404);
      }
      if (resp.status === 422) {
        const errorBody = await resp.text();
        return emptyResult('ERROR', Date.now() - startTime, `Validation error (422): ${errorBody.slice(0, 200)}`, 422);
      }
      return emptyResult('ERROR', Date.now() - startTime, `HTTP ${resp.status}`, resp.status);
    }

    let result = await resp.json();

    // Handle async job — in discovery mode, poll inline
    if ((result.status === 'pending' || result.status === 'processing') && (result.job_id || result.jobId)) {
      const jobId = result.job_id || result.jobId;
      console.log(`${LOG_TAG} Async job ${jobId}, polling inline (discovery)...`);

      const pollUrl = `${cleanBase}/job/${jobId}`;
      const polled = await pollForResult(
        pollUrl,
        headers,
        PROVIDER_KEY,
        { ...DEFAULT_POLL_CONFIG, maxAttempts: 6 },
      );

      if (polled?.ok && polled.data) {
        result = polled.data as any;
      } else {
        return emptyResult('TIMEOUT', Date.now() - startTime, 'Scraping job did not complete in time');
      }
    }

    return buildResultFromData(result, options, startTime);
  } catch (err: any) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ═══════════════════════════════════════════
// RESULT BUILDING
// ═══════════════════════════════════════════

function buildResultFromData(
  data: any,
  options: AdapterOptions,
  startTime: number,
): ProviderAdapterResult {
  // Response may be wrapped in "data", "expediente", "resultado", or flat
  const proceso = data?.data || data?.expediente || data?.resultado || data?.tutela || data;

  const actuaciones = normalizeTutelasActuaciones(proceso, options);
  const publicaciones = normalizeTutelasEstados(proceso, options);
  const metadata = extractTutelasMetadata(proceso);
  const parties = extractTutelasParties(proceso);

  const hasData = actuaciones.length > 0 || publicaciones.length > 0 || !!metadata?.despacho;

  return {
    provider: PROVIDER_KEY,
    status: hasData ? 'SUCCESS' : 'EMPTY',
    actuaciones,
    publicaciones,
    metadata,
    parties,
    durationMs: Date.now() - startTime,
    httpStatus: 200,
  };
}

// ═══════════════════════════════════════════
// NORMALIZATION: ACTUACIONES
// ═══════════════════════════════════════════

/**
 * Normalize Tutelas actuaciones into NormalizedActuacion[].
 */
export function normalizeTutelasActuaciones(
  proceso: any,
  options?: Pick<AdapterOptions, 'workItemId' | 'crossProviderDedup' | 'redactPII'>,
): NormalizedActuacion[] {
  const rawActs = Array.isArray(proceso?.actuaciones)
    ? proceso.actuaciones
    : (Array.isArray(proceso?.eventos) ? proceso.eventos : []);

  return rawActs
    .map((act: any) => {
      const fecha = normalizeDate(act.fecha_actuacion ?? act.fecha ?? '') || '';
      const actuacion = String(act.actuacion || act.descripcion || act.tipo || '');
      const anotacion = String(act.anotacion || act.detalle || '');

      if (!fecha && !actuacion) return null;

      const fingerprint = computeTutelasFingerprint(
        fecha, actuacion, anotacion,
        options?.workItemId, options?.crossProviderDedup,
      );

      return {
        fecha_actuacion: fecha,
        actuacion: options?.redactPII ? redactPII(truncate(actuacion, 120) || '') : truncate(actuacion, 120) || '',
        anotacion: options?.redactPII ? redactPII(truncate(anotacion, 300) || '') : (anotacion || null),
        hash_fingerprint: fingerprint,
        source_platform: PROVIDER_KEY,
        sources: [PROVIDER_KEY],
        raw_data: act,
      } as NormalizedActuacion;
    })
    .filter((a: NormalizedActuacion | null): a is NormalizedActuacion => a !== null);
}

// ═══════════════════════════════════════════
// NORMALIZATION: ESTADOS
// ═══════════════════════════════════════════

/**
 * Normalize Tutelas estados into NormalizedPublicacion[].
 */
export function normalizeTutelasEstados(
  proceso: any,
  options?: Pick<AdapterOptions, 'workItemId' | 'crossProviderDedup' | 'redactPII'>,
): NormalizedPublicacion[] {
  const rawEstados = Array.isArray(proceso?.estados) ? proceso.estados : [];

  return rawEstados
    .map((e: any) => {
      const fecha = normalizeDate(e.fecha || e.fechaEstado || e.fechaProvidencia || '') || '';
      const tipo = truncate(String(e.tipo || e.actuacion || 'Estado'), 120) || 'Estado';
      const descripcion = e.descripcion
        ? (options?.redactPII ? redactPII(truncate(String(e.descripcion), 200) || '') : truncate(String(e.descripcion), 200) || '')
        : null;

      if (!fecha && !descripcion) return null;

      const attachments = extractTutelasAttachments(e, PROVIDER_KEY);

      const fingerprint = computeTutelasFingerprint(
        fecha, tipo, descripcion || '',
        options?.workItemId, options?.crossProviderDedup,
      );

      return {
        title: tipo,
        tipo_publicacion: tipo,
        fecha_fijacion: fecha,
        hash_fingerprint: fingerprint,
        source_platform: PROVIDER_KEY,
        sources: [PROVIDER_KEY],
        attachments: attachments.length > 0 ? attachments : undefined,
        raw_data: e,
      } as NormalizedPublicacion;
    })
    .filter((p: NormalizedPublicacion | null): p is NormalizedPublicacion => p !== null);
}

// ═══════════════════════════════════════════
// FINGERPRINTING
// ═══════════════════════════════════════════

/**
 * Generate fingerprint for Tutelas deduplication.
 */
export function computeTutelasFingerprint(
  fecha: string,
  tipo: string,
  descripcion: string,
  workItemId?: string,
  crossProvider?: boolean,
): string {
  const scope = crossProvider ? 'x' : (workItemId?.slice(0, 8) || 'noscope');
  const data = `${scope}|${fecha}|${tipo.slice(0, 60).toLowerCase().trim()}|${(descripcion || '').slice(0, 40).toLowerCase().trim()}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `tut_${scope}_${Math.abs(hash).toString(16)}`;
}

// ═══════════════════════════════════════════
// METADATA & PARTIES
// ═══════════════════════════════════════════

/**
 * Extract metadata from Tutelas response, including Corte Constitucional fields.
 */
export function extractTutelasMetadata(proceso: any): CaseMetadata | null {
  if (!proceso) return null;

  const corteStatusRaw = String(proceso.estado || proceso.corte_status || proceso.estado_seleccion || '');

  return {
    despacho: (proceso.sala || proceso.despacho || proceso.juzgado || null) as string | null,
    ciudad: (proceso.ciudad || null) as string | null,
    departamento: (proceso.departamento || null) as string | null,
    tipo_proceso: 'TUTELA',
    fecha_radicacion: normalizeDate(proceso.fecha_radicacion) || null,
    ponente: (proceso.magistrado_ponente || proceso.ponente || null) as string | null,
    etapa: corteStatusRaw ? mapCorteStatus(corteStatusRaw) : null,
    tutela_code: (proceso.tutela_code || proceso.codigo_tutela || proceso.expediente_code || proceso.expediente || null) as string | null,
    corte_status: corteStatusRaw ? mapCorteStatus(corteStatusRaw) : null,
    sentencia_ref: (proceso.sentencia || proceso.sentencia_ref || proceso.numero_sentencia || null) as string | null,
  };
}

/**
 * Extract parties from Tutelas response.
 */
export function extractTutelasParties(proceso: any): ExtractedParties | null {
  if (!proceso) return null;

  const demandante = proceso.accionante || proceso.demandante || proceso.tutelante || null;
  const demandado = proceso.accionado || proceso.demandado || null;

  if (!demandante && !demandado) return null;

  return {
    demandante: demandante ? String(demandante) : null,
    demandado: demandado ? String(demandado) : null,
  };
}

// ═══════════════════════════════════════════
// ATTACHMENT EXTRACTION
// ═══════════════════════════════════════════

function extractTutelasAttachments(e: any, provider: string): PublicacionAttachment[] {
  const attachments: PublicacionAttachment[] = [];
  const seenUrls = new Set<string>();

  const candidateKeys = [
    'pdf_url', 'pdfUrl', 'url_pdf', 'documento_url', 'documentUrl',
    'link', 'enlace', 'archivo', 'adjunto', 'ruta_pdf', 'url',
  ];

  for (const key of candidateKeys) {
    const val = e[key];
    if (val && typeof val === 'string' && val.startsWith('https') && !seenUrls.has(val)) {
      seenUrls.add(val);
      attachments.push({
        type: val.toLowerCase().includes('.pdf') ? 'pdf' : 'link',
        url: val,
        label: 'Ver documento',
        provider,
      });
    }
  }

  return attachments;
}

// ═══════════════════════════════════════════
// HTTP HELPERS
// ═══════════════════════════════════════════

function buildHeaders(apiKeyInfo: ApiKeyInfo): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (apiKeyInfo.value) {
    headers['x-api-key'] = apiKeyInfo.value;
  }
  return headers;
}

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
