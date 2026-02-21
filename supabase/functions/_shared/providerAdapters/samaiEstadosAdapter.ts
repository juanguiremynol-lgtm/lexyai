/**
 * samaiEstadosAdapter.ts — Unified SAMAI Estados provider adapter.
 *
 * SINGLE SOURCE OF TRUTH for all SAMAI Estados HTTP calls and response normalization.
 * Supports two modes:
 *   - 'monitoring': Uses /snapshot or /buscar endpoints with adapter config from
 *     connector capabilities (header_mode, payload_mode, radicado_format, etc.).
 *   - 'discovery': Uses /buscar?radicado={formatted} for demo/wizard previews.
 *
 * Previously duplicated in:
 *   - demo-radicado-lookup/index.ts (discovery path — ~60 lines)
 *   - sync-by-work-item uses external enrichment section
 *
 * This adapter does NOT persist data — it returns normalized results only.
 * Uses the samai-estados-adapter.ts config layer for flexible upstream contract handling.
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
  truncate,
  redactPII,
  type ApiKeyInfo,
} from '../radicadoUtils.ts';

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

const PROVIDER_KEY = 'samai_estados';
const LOG_TAG = '[samaiEstadosAdapter]';

// ═══════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════

/**
 * Fetch estados from the SAMAI Estados API.
 *
 * @param options - Standard adapter options (radicado, mode, timeout, etc.)
 * @returns Normalized ProviderAdapterResult with publicaciones (estados), no actuaciones.
 */
export async function fetchFromSamaiEstados(
  options: AdapterOptions,
): Promise<ProviderAdapterResult> {
  const startTime = Date.now();
  const { radicado, mode, timeoutMs, signal } = options;

  const baseUrl = Deno.env.get('SAMAI_ESTADOS_BASE_URL');
  const apiKeyInfo = await getApiKeyForProvider('samai_estados');

  if (!baseUrl) {
    console.log(`${LOG_TAG} SAMAI_ESTADOS_BASE_URL not configured`);
    return emptyResult('ERROR', Date.now() - startTime, 'SAMAI_ESTADOS_BASE_URL not configured');
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
  const formatted = formatRadicadoForSamai(radicado);
  const headers = buildHeaders(apiKeyInfo);
  const timeout = options.timeoutMs || 90_000;

  // Try /snapshot first, then /buscar
  const endpoints = [
    `${cleanBase}/snapshot?radicado=${encodeURIComponent(formatted)}`,
    `${cleanBase}/buscar?radicado=${encodeURIComponent(formatted)}`,
  ];

  for (const url of endpoints) {
    const result = await fetchEndpoint(url, headers, timeout, options.signal);
    if (result.ok && result.data) {
      const publicaciones = normalizeSamaiEstadosResponse(result.data, options);
      if (publicaciones.length > 0) {
        return {
          provider: PROVIDER_KEY,
          status: 'SUCCESS',
          actuaciones: [],
          publicaciones,
          metadata: null,
          parties: null,
          durationMs: Date.now() - startTime,
          httpStatus: result.httpStatus,
        };
      }
    }
  }

  return emptyResult('EMPTY', Date.now() - startTime, 'No estados found');
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
  const formatted = formatRadicadoForSamai(radicado);
  const headers = buildHeaders(apiKeyInfo);
  const timeout = options.timeoutMs || 12_000;

  const url = `${cleanBase}/buscar?radicado=${encodeURIComponent(formatted)}`;
  const result = await fetchEndpoint(url, headers, timeout, options.signal);

  if (!result.ok || !result.data) {
    return emptyResult(
      result.httpStatus === 404 ? 'EMPTY' : 'ERROR',
      Date.now() - startTime,
      result.error || `HTTP ${result.httpStatus}`,
      result.httpStatus,
    );
  }

  const publicaciones = normalizeSamaiEstadosResponse(result.data, options);

  return {
    provider: PROVIDER_KEY,
    status: publicaciones.length > 0 ? 'SUCCESS' : 'EMPTY',
    actuaciones: [],
    publicaciones,
    metadata: null,
    parties: null,
    durationMs: Date.now() - startTime,
    httpStatus: 200,
  };
}

// ═══════════════════════════════════════════
// RADICADO FORMATTING
// ═══════════════════════════════════════════

/**
 * Format a 23-digit radicado for SAMAI Estados API.
 * SAMAI Estados expects: XX-XXX-XX-XX-XXX-XXXX-XXXXX-XX
 */
export function formatRadicadoForSamai(radicado: string): string {
  const digits = radicado.replace(/\D/g, '');
  if (digits.length === 23) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 21)}-${digits.slice(21, 23)}`;
  }
  return radicado; // Return as-is if not 23 digits
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
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    console.log(`${LOG_TAG} GET ${url}`);
    const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (!resp.ok) {
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

// ═══════════════════════════════════════════
// NORMALIZATION
// ═══════════════════════════════════════════

/**
 * Normalize SAMAI Estados response into NormalizedPublicacion[].
 */
export function normalizeSamaiEstadosResponse(
  data: any,
  options?: Pick<AdapterOptions, 'workItemId' | 'crossProviderDedup' | 'redactPII'>,
): NormalizedPublicacion[] {
  const resultado = data?.result || data;
  const rawEstados = Array.isArray(resultado?.estados) ? resultado.estados : [];

  return rawEstados
    .map((e: any) => normalizeOneEstado(e, options))
    .filter((p: NormalizedPublicacion | null): p is NormalizedPublicacion => p !== null);
}

function normalizeOneEstado(
  e: any,
  options?: Pick<AdapterOptions, 'workItemId' | 'crossProviderDedup' | 'redactPII'>,
): NormalizedPublicacion | null {
  const fecha = normalizeDate(
    e['Fecha Providencia'] ?? e['Fecha Estado'] ?? e.fechaProvidencia ??
    e.fechaEstado ?? e.fecha ?? '',
  );
  const actuacion = String(e['Actuación'] ?? e.actuacion ?? e.tipo ?? '');
  const anotacion = String(e['Anotación'] ?? e.anotacion ?? e.descripcion ?? '');

  const title = options?.redactPII
    ? redactPII(truncate(actuacion || 'Estado SAMAI', 120) || 'Estado SAMAI')
    : truncate(actuacion || 'Estado SAMAI', 120) || 'Estado SAMAI';

  const description = options?.redactPII
    ? redactPII(truncate(anotacion || actuacion, 200) || '')
    : truncate(anotacion || actuacion, 200) || '';

  // Extract attachments
  const attachments = extractSamaiEstadosAttachments(e, PROVIDER_KEY);

  // Fingerprint
  const fingerprint = computeSamaiEstadosFingerprint(
    fecha || '',
    actuacion,
    anotacion,
    options?.workItemId,
    options?.crossProviderDedup,
  );

  if (!fecha && !actuacion) return null;

  return {
    title,
    tipo_publicacion: actuacion || 'Estado SAMAI',
    fecha_fijacion: fecha || '',
    hash_fingerprint: fingerprint,
    source_platform: PROVIDER_KEY,
    sources: [PROVIDER_KEY],
    attachments: attachments.length > 0 ? attachments : undefined,
    raw_data: e,
  };
}

// ═══════════════════════════════════════════
// FINGERPRINTING
// ═══════════════════════════════════════════

/**
 * Generate fingerprint for SAMAI Estados deduplication.
 */
export function computeSamaiEstadosFingerprint(
  fecha: string,
  actuacion: string,
  anotacion: string,
  workItemId?: string,
  crossProvider?: boolean,
): string {
  const scope = crossProvider ? 'x' : (workItemId?.slice(0, 8) || 'noscope');
  const data = `${scope}|${fecha}|${actuacion.slice(0, 60).toLowerCase().trim()}|${(anotacion || '').slice(0, 40).toLowerCase().trim()}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `se_${scope}_${Math.abs(hash).toString(16)}`;
}

// ═══════════════════════════════════════════
// ATTACHMENT EXTRACTION
// ═══════════════════════════════════════════

function extractSamaiEstadosAttachments(e: any, provider: string): PublicacionAttachment[] {
  const attachments: PublicacionAttachment[] = [];
  const seenUrls = new Set<string>();

  const candidateKeys = [
    'pdf_url', 'pdfUrl', 'url_pdf', 'documento_url', 'documentUrl',
    'link', 'enlace', 'archivo', 'adjunto', 'ruta_pdf', 'url', 'Documento',
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
