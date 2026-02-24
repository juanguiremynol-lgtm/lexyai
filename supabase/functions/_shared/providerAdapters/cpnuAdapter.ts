/**
 * cpnuAdapter.ts — Unified CPNU provider adapter.
 *
 * SINGLE SOURCE OF TRUTH for all CPNU HTTP calls and response normalization.
 * Supports two modes:
 *   - 'monitoring': Uses CPNU Cloud Run (/snapshot, /buscar, /resultado polling)
 *     for ongoing sync of monitored work items.
 *   - 'discovery': Uses CPNU Rama Judicial public API (consultaprocesos.ramajudicial.gov.co)
 *     for creation wizard and demo modal lookups.
 *
 * Previously duplicated in:
 *   - sync-by-work-item/index.ts (monitoring path — ~500 lines)
 *   - demo-radicado-lookup/index.ts (discovery path — ~100 lines)
 *   - adapter-cpnu/index.ts (discovery via CPNU API + Render fallback)
 *   - sync-by-radicado/index.ts (thin proxy to adapter-cpnu)
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
  joinUrl,
  ensureAbsoluteUrl,
  isHtmlCannotGet,
  getApiKeyForProvider,
  pollForResult,
  DEFAULT_POLL_CONFIG,
  redactPII,
  truncate,
  type ApiKeyInfo,
} from '../radicadoUtils.ts';

import { parseCpnuSujetos } from '../partyNormalization.ts';

import {
  checkSnapshotFreshness,
  extractMaxActDate,
  buildIngestionMetadata,
  type FreshnessCheckResult,
  type IngestionMetadata,
} from '../cpnuFreshnessGate.ts';

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

const PROVIDER_KEY = 'cpnu';

/** CPNU Rama Judicial public API endpoints (for discovery mode) */
const CPNU_PUBLIC_API = 'https://consultaprocesos.ramajudicial.gov.co';

const CPNU_HEADERS: Record<string, string> = {
  'Accept': 'application/json, text/json, text/plain, */*',
  'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Referer': `${CPNU_PUBLIC_API}/`,
  'Origin': CPNU_PUBLIC_API,
};

// ═══════════════════════════════════════════
// HASH FINGERPRINT
// ═══════════════════════════════════════════

/**
 * Compute a dedup fingerprint for a CPNU actuación.
 * Uses a robust composite key: date + actuacion title + fecha_registro + anotacion + despacho.
 * This prevents dropping distinct records that share the same date+title but differ
 * in registration date, annotation, or instance.
 */
function computeCpnuFingerprint(
  radicado: string,
  fecha: string,
  actuacion: string,
  despacho: string,
  workItemId?: string,
  crossProviderDedup?: boolean,
  fechaRegistro?: string,
  anotacion?: string,
  instancia?: string,
): string {
  // When cross-provider dedup is enabled, use a provider-agnostic prefix
  const prefix = crossProviderDedup ? 'ACT' : 'cpnu';
  const itemKey = workItemId || radicado;
  // Normalize anotacion: trim, collapse whitespace, lowercase, cap at 200 chars
  const normAnnotation = (anotacion || '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 200);
  const normActuacion = (actuacion || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const data = `${prefix}|${itemKey}|${fecha}|${normActuacion}|${fechaRegistro || ''}|${normAnnotation}|${instancia || ''}|${despacho}`;
  let hash1 = 0, hash2 = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash1 = ((hash1 << 5) - hash1) + char;
    hash1 = hash1 & hash1;
    hash2 = ((hash2 << 7) + hash2) ^ char;
    hash2 = hash2 & hash2;
  }
  return `${Math.abs(hash1).toString(16).padStart(8, '0')}${Math.abs(hash2).toString(16).padStart(8, '0')}`;
}

// ═══════════════════════════════════════════
// RESPONSE NORMALIZATION (shared across modes)
// ═══════════════════════════════════════════

/**
 * Normalize raw CPNU actuación records into NormalizedActuacion[].
 * Handles both Cloud Run and public API response formats.
 */
function normalizeActuaciones(
  rawActs: Record<string, unknown>[],
  radicado: string,
  despacho: string,
  opts?: { workItemId?: string; crossProviderDedup?: boolean; redactPII?: boolean },
): NormalizedActuacion[] {
  return rawActs.map((act, idx) => {
    const fecha = normalizeDate(
      String(act.fechaActuacion || act.fecha_actuacion || act.fecha || act.event_date || ''),
    );
    const actuacionTitle = String(act.actuacion || act.title || act.description || '');
    let anotacion = String(act.anotacion || act.detail || '');
    if (opts?.redactPII && anotacion) {
      anotacion = redactPII(anotacion);
    }

    const fechaRegistro = normalizeDate(String(act.fechaRegistro || act.fecha_registro || ''));
    const instanciaVal = String(act.instancia || act.consInstancia || '');
    const hash = computeCpnuFingerprint(
      radicado, fecha, actuacionTitle, despacho,
      opts?.workItemId, opts?.crossProviderDedup,
      fechaRegistro, anotacion, instanciaVal,
    );

    const normalized: NormalizedActuacion = {
      fecha_actuacion: fecha,
      actuacion: actuacionTitle,
      anotacion: anotacion || null,
      hash_fingerprint: hash,
      source_platform: PROVIDER_KEY,
      sources: [PROVIDER_KEY],
      nombre_despacho: despacho || undefined,
      instancia: instanciaVal || undefined,
    };

    // Optional fields
    const fechaInicial = act.fechaInicial || act.fecha_inicia_termino;
    if (fechaInicial) normalized.fecha_inicia_termino = normalizeDate(String(fechaInicial));

    const fechaFinal = act.fechaFinal || act.fecha_finaliza_termino;
    if (fechaFinal) normalized.fecha_finaliza_termino = normalizeDate(String(fechaFinal));

    const fechaRegistroRaw = act.fechaRegistro || act.fecha_registro;
    if (fechaRegistroRaw) normalized.fecha_registro = normalizeDate(String(fechaRegistroRaw));

    const consActuacion = act.consActuacion || act.idRegActuacion;
    normalized.indice = consActuacion ? String(consActuacion) : String(idx + 1);

    if (act.conDocumentos) normalized.anexos_count = 1;

    if (Array.isArray(act.documentos) && act.documentos.length > 0) {
      normalized.documentos = (act.documentos as Array<{ nombre?: string; url?: string }>).map(d => ({
        nombre: String(d.nombre || 'Documento'),
        url: String(d.url || ''),
      }));
    }

    normalized.raw_data = act;
    return normalized;
  });
}

/**
 * Extract parties from CPNU sujetos array.
 */
function extractParties(
  sujetos: Record<string, unknown>[],
  resumenString?: string,
  redact?: boolean,
): ExtractedParties {
  if (sujetos.length > 0) {
    const demandantes = sujetos
      .filter(s => {
        const tipo = String(s.tipoSujeto || s.tipo || s.tipoParte || '').toLowerCase();
        return tipo.includes('demandante') || tipo.includes('accionante') || tipo.includes('tutelante');
      })
      .map(s => String(s.nombreRazonSocial || s.nombre || ''))
      .filter(Boolean);

    const demandados = sujetos
      .filter(s => {
        const tipo = String(s.tipoSujeto || s.tipo || s.tipoParte || '').toLowerCase();
        return tipo.includes('demandado') || tipo.includes('accionado');
      })
      .map(s => String(s.nombreRazonSocial || s.nombre || ''))
      .filter(Boolean);

    let demandante = demandantes.join(' | ') || null;
    let demandado = demandados.join(' | ') || null;

    if (redact) {
      if (demandante) demandante = redactPII(demandante);
      if (demandado) demandado = redactPII(demandado);
    }

    return {
      demandante,
      demandado,
      sujetos_procesales: sujetos.map(s => ({
        tipo: String(s.tipoSujeto || s.tipo || s.tipoParte || 'Parte'),
        nombre: String(s.nombreRazonSocial || s.nombre || ''),
      })),
    };
  }

  // Fallback: parse from sujetosProcesales string
  if (resumenString) {
    const parsed = parseCpnuSujetos(resumenString);
    return {
      demandante: parsed.demandante || null,
      demandado: parsed.demandado || null,
      sujetos_procesales: parsed.partes.map(s => ({ tipo: s.rawRole || s.canonicalRole, nombre: s.name })),
    };
  }

  return { demandante: null, demandado: null };
}

// ═══════════════════════════════════════════
// MONITORING MODE (Cloud Run: /snapshot, /buscar, /resultado)
// ═══════════════════════════════════════════

async function fetchMonitoring(options: AdapterOptions): Promise<ProviderAdapterResult> {
  const startTime = Date.now();
  const { radicado } = options;

  const baseUrl = Deno.env.get('CPNU_BASE_URL');
  const pathPrefix = Deno.env.get('CPNU_PATH_PREFIX') || '';
  const apiKeyInfo = await getApiKeyForProvider('cpnu');

  if (!baseUrl) {
    return makeErrorResult('CPNU_BASE_URL not configured', startTime);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (apiKeyInfo.value) {
    headers['x-api-key'] = apiKeyInfo.value;
  }

  console.log(`[cpnuAdapter] monitoring mode: auth=${apiKeyInfo.source}, radicado=${radicado.slice(0,4)}***, forceRefresh=${!!options.forceRefresh}`);

  // If forceRefresh, skip stale /snapshot cache and go directly to /buscar scraping
  if (options.forceRefresh) {
    console.log(`[cpnuAdapter] forceRefresh=true, bypassing /snapshot, triggering /buscar scraping...`);
    const result = await handleScrapingFallback(radicado, baseUrl, pathPrefix, apiKeyInfo, headers, options, startTime);
    result.cpnuIngestionMeta = {
      source_mode: 'BUSCAR',
      snapshot_max_act_date: null,
      stale_reason: 'FORCE_REFRESH',
      force_refresh: true,
    };
    return result;
  }

  // STEP 1: Try /snapshot
  const snapshotUrl = joinUrl(baseUrl, pathPrefix, `/snapshot?numero_radicacion=${radicado}`);
  
  try {
    const snapshotResponse = await fetch(snapshotUrl, { method: 'GET', headers });
    const snapshotBody = await snapshotResponse.text();

    // HTML 404 (route mismatch)
    if (snapshotResponse.status === 404 && isHtmlCannotGet(snapshotBody)) {
      return makeErrorResult('UPSTREAM_ROUTE_MISSING: CPNU returned HTML 404', startTime, 404);
    }

    // Auth errors
    if (snapshotResponse.status === 401 || snapshotResponse.status === 403) {
      return makeErrorResult(`UPSTREAM_AUTH: HTTP ${snapshotResponse.status}`, startTime, snapshotResponse.status);
    }

    // Parse JSON
    let snapshotData: Record<string, unknown>;
    try {
      snapshotData = JSON.parse(snapshotBody);
    } catch {
      return makeErrorResult('INVALID_JSON_RESPONSE', startTime, snapshotResponse.status);
    }

    // JSON 404 or not-found indicator → trigger scraping
    if (snapshotResponse.status === 404 || snapshotData.expediente_encontrado === false || snapshotData.found === false) {
      console.log(`[cpnuAdapter] Record not found, triggering scraping...`);
      return await handleScrapingFallback(radicado, baseUrl, pathPrefix, apiKeyInfo, headers, options, startTime);
    }

    // ═══ SUCCESS: Extract actuaciones ═══
    const nestedData = snapshotData.data as Record<string, unknown> | undefined;
    const proceso = snapshotData.proceso as Record<string, unknown> | undefined;

    const actuaciones = (
      nestedData?.actuaciones || snapshotData.actuaciones || proceso?.actuaciones || []
    ) as Record<string, unknown>[];

    const sujetos = (
      nestedData?.sujetos || snapshotData.sujetos || []
    ) as Record<string, unknown>[];

    const resumenBusqueda = nestedData?.resumenBusqueda as Record<string, unknown> | undefined;
    const detalle = nestedData?.detalle as Record<string, unknown> | undefined;
    const despacho = String(
      resumenBusqueda?.despacho || detalle?.despacho || nestedData?.despacho || snapshotData.despacho || proceso?.despacho || ''
    );

    if (actuaciones.length === 0) {
      return makeEmptyResult('No actuaciones found', startTime, snapshotResponse.status);
    }

    // Handle pagination
    let allActuaciones = [...actuaciones];
    const pagination = (nestedData?.paginacionActuaciones || snapshotData.paginacionActuaciones) as Record<string, unknown> | undefined;
    const totalPages = pagination ? parseInt(String(pagination.totalPaginas || '1')) : 1;

    if (totalPages > 1) {
      console.log(`[cpnuAdapter] Fetching ${totalPages - 1} additional pages...`);
      for (let page = 2; page <= totalPages; page++) {
        try {
          const pageUrl = joinUrl(baseUrl, pathPrefix, `/snapshot?numero_radicacion=${radicado}&pagina=${page}`);
          const pageResponse = await fetch(pageUrl, { method: 'GET', headers });
          if (pageResponse.ok) {
            const pageData = await pageResponse.json();
            const pageNested = pageData.data as Record<string, unknown> | undefined;
            const pageActs = (pageNested?.actuaciones || pageData.actuaciones || []) as Record<string, unknown>[];
            allActuaciones = [...allActuaciones, ...pageActs];
          }
        } catch (e) {
          console.warn(`[cpnuAdapter] Page ${page} error:`, e);
        }
      }
    }

    console.log(`[cpnuAdapter] Found ${allActuaciones.length} actuaciones, ${sujetos.length} sujetos`);

    const normalized = normalizeActuaciones(allActuaciones, radicado, despacho, {
      workItemId: options.workItemId,
      crossProviderDedup: options.crossProviderDedup,
      redactPII: options.redactPII,
    });

    // ═══ FRESHNESS GATE: Check if snapshot data is stale ═══
    const snapshotMaxActDate = extractMaxActDate(normalized);
    const freshnessCheck = checkSnapshotFreshness({
      snapshotMaxActDate,
      dbMaxActDate: options.dbMaxActDate || null,
      snapshotRecordCount: normalized.length,
      historicalRecordCount: options.historicalRecordCount,
      forceRefresh: false, // Already handled above
    });

    if (freshnessCheck.isStale) {
      console.warn(
        `[cpnuAdapter] ⚠️ SNAPSHOT STALE DETECTED: ${freshnessCheck.explanation}`,
        `reason=${freshnessCheck.reason}, snapshotMax=${snapshotMaxActDate}, dbMax=${options.dbMaxActDate}`,
      );
      // Log metric event for monitoring
      console.log(`[cpnu.snapshot_stale_detected] reason=${freshnessCheck.reason} radicado=${radicado.slice(0,4)}*** snapshotMax=${snapshotMaxActDate}`);

      // Fallback to /buscar
      const buscarResult = await handleScrapingFallback(radicado, baseUrl, pathPrefix, apiKeyInfo, headers, options, startTime);
      buscarResult.cpnuIngestionMeta = {
        source_mode: 'BUSCAR',
        snapshot_max_act_date: snapshotMaxActDate,
        stale_reason: freshnessCheck.reason,
        force_refresh: false,
      };

      // If buscar also returned data, use it. If buscar failed/empty, fall back to snapshot data.
      if (buscarResult.status === 'SUCCESS' && buscarResult.actuaciones.length > 0) {
        return buscarResult;
      }

      // Buscar failed — return snapshot data anyway (stale > nothing)
      console.warn(`[cpnuAdapter] /buscar fallback failed or empty, returning stale snapshot data as fallback`);
    }

    const parties = options.includeParties
      ? extractParties(sujetos, resumenBusqueda?.sujetosProcesalesResumen as string | undefined, options.redactPII)
      : null;

    const departamento = (resumenBusqueda?.departamento || detalle?.departamento || nestedData?.departamento) as string | undefined;

    const metadata: CaseMetadata = {
      despacho: despacho || null,
      departamento: departamento || null,
      tipo_proceso: (nestedData?.tipoProceso || snapshotData.tipo_proceso || proceso?.tipo) as string | null || null,
    };

    return {
      provider: PROVIDER_KEY,
      status: 'SUCCESS',
      actuaciones: normalized,
      publicaciones: [],
      metadata,
      parties,
      durationMs: Date.now() - startTime,
      httpStatus: snapshotResponse.status,
      cpnuIngestionMeta: {
        source_mode: freshnessCheck.isStale ? 'BUSCAR' : 'SNAPSHOT',
        snapshot_max_act_date: snapshotMaxActDate,
        stale_reason: freshnessCheck.reason,
        force_refresh: false,
      },
    };

  } catch (err) {
    console.error('[cpnuAdapter] monitoring error:', err);
    return makeErrorResult(err instanceof Error ? err.message : 'CPNU fetch failed', startTime);
  }
}

/**
 * Handle 404/not-found by triggering /buscar scraping and polling /resultado.
 */
async function handleScrapingFallback(
  radicado: string,
  baseUrl: string,
  pathPrefix: string,
  apiKeyInfo: ApiKeyInfo,
  headers: Record<string, string>,
  options: AdapterOptions,
  startTime: number,
): Promise<ProviderAdapterResult> {
  // Trigger /buscar
  const buscarUrl = joinUrl(baseUrl, pathPrefix, `/buscar?numero_radicacion=${radicado}`);
  try {
    const buscarHeaders: Record<string, string> = { ...headers };
    const buscarResp = await fetch(buscarUrl, { method: 'GET', headers: buscarHeaders });

    if (!buscarResp.ok) {
      return makeEmptyResult('Scraping trigger failed', startTime, buscarResp.status);
    }

    const buscarData = await buscarResp.json();
    const jobId = String(buscarData.jobId || buscarData.job_id || buscarData.id || '');

    if (!jobId) {
      return makeEmptyResult('RECORD_NOT_FOUND', startTime, 404);
    }

    // Build absolute poll URL
    const rawPollUrl = String(buscarData.poll_url || buscarData.pollUrl || buscarData.resultado_url || '');
    const pollUrl = rawPollUrl
      ? ensureAbsoluteUrl(rawPollUrl, baseUrl)
      : joinUrl(baseUrl, pathPrefix, `/resultado/${jobId}`);

    console.log(`[cpnuAdapter] Polling scraping job ${jobId}...`);
    const pollResult = await pollForResult(pollUrl, headers, 'cpnu', DEFAULT_POLL_CONFIG);

    if (pollResult.ok && pollResult.data) {
      const resultData = (pollResult.data.result || pollResult.data) as Record<string, unknown>;
      const nestedResultData = (resultData.data || {}) as Record<string, unknown>;
      const polledActs = (resultData.actuaciones || nestedResultData.actuaciones || []) as Record<string, unknown>[];
      const polledSujetos = (resultData.sujetos || nestedResultData.sujetos || []) as Record<string, unknown>[];

      if (polledActs.length === 0) {
        return makeEmptyResult('Scraping completed but no actuaciones', startTime, 200);
      }

      const despacho = String(resultData.despacho || '');
      const normalized = normalizeActuaciones(polledActs, radicado, despacho, {
        workItemId: options.workItemId,
        crossProviderDedup: options.crossProviderDedup,
        redactPII: options.redactPII,
      });

      const parties = options.includeParties
        ? extractParties(polledSujetos, undefined, options.redactPII)
        : null;

      return {
        provider: PROVIDER_KEY,
        status: 'SUCCESS',
        actuaciones: normalized,
        publicaciones: [],
        metadata: {
          despacho: despacho || null,
          tipo_proceso: (resultData.tipoProceso as string) || null,
        },
        parties,
        durationMs: Date.now() - startTime,
        httpStatus: 200,
        scrapingJobId: jobId,
        scrapingPollUrl: pollUrl,
      };
    }

    // Polling timed out — try snapshot one more time
    const snapshotUrl = joinUrl(baseUrl, pathPrefix, `/snapshot?numero_radicacion=${radicado}`);
    try {
      const retryResp = await fetch(snapshotUrl, { method: 'GET', headers });
      if (retryResp.ok) {
        const retryData = await retryResp.json();
        const retryNested = retryData.data as Record<string, unknown> | undefined;
        const retryActs = (retryNested?.actuaciones || retryData.actuaciones || []) as Record<string, unknown>[];
        if (retryActs.length > 0) {
          const despacho = String(retryNested?.despacho || retryData.despacho || '');
          return {
            provider: PROVIDER_KEY,
            status: 'SUCCESS',
            actuaciones: normalizeActuaciones(retryActs, radicado, despacho, {
              workItemId: options.workItemId,
              crossProviderDedup: options.crossProviderDedup,
            }),
            publicaciones: [],
            metadata: { despacho: despacho || null },
            parties: null,
            durationMs: Date.now() - startTime,
            httpStatus: 200,
          };
        }
      }
    } catch { /* fall through */ }

    return {
      provider: PROVIDER_KEY,
      status: 'SCRAPING_INITIATED',
      actuaciones: [],
      publicaciones: [],
      metadata: null,
      parties: null,
      durationMs: Date.now() - startTime,
      errorMessage: `Scraping job ${jobId} did not complete within polling timeout`,
      scrapingJobId: jobId,
      scrapingPollUrl: pollUrl,
    };

  } catch (err) {
    return makeEmptyResult('RECORD_NOT_FOUND', startTime, 404);
  }
}

// ═══════════════════════════════════════════
// DISCOVERY MODE (CPNU Rama Judicial public API)
// ═══════════════════════════════════════════

/** Candidate endpoints for the CPNU public API search */
function getSearchCandidates(radicado: string) {
  return [
    { url: `${CPNU_PUBLIC_API}/api/v2/Procesos/Consulta/NumeroRadicacion?numero=${radicado}&SoloActivos=false&pagina=1`, method: 'GET', desc: 'v2 standard' },
    { url: `${CPNU_PUBLIC_API}:443/api/v2/Procesos/Consulta/NumeroRadicacion?numero=${radicado}&SoloActivos=false&pagina=1`, method: 'GET', desc: 'v2 port 443' },
    { url: `${CPNU_PUBLIC_API}:448/api/v2/Procesos/Consulta/NumeroRadicacion?numero=${radicado}&SoloActivos=false&pagina=1`, method: 'GET', desc: 'v2 port 448' },
    { url: `${CPNU_PUBLIC_API}/api/v2/Procesos/Consulta/NumeroRadicacion`, method: 'POST', body: JSON.stringify({ numero: radicado, SoloActivos: false, pagina: 1 }), desc: 'v2 POST' },
    { url: `${CPNU_PUBLIC_API}/api/v1/Procesos/Consulta/NumeroRadicacion?numero=${radicado}`, method: 'GET', desc: 'v1 legacy' },
  ];
}

/** Candidate endpoints for actuaciones */
function getActuacionesCandidates(idProceso: string | number) {
  return [
    `${CPNU_PUBLIC_API}:448/api/v2/Proceso/Actuaciones/${idProceso}`,
    `${CPNU_PUBLIC_API}/api/v2/Proceso/Actuaciones/${idProceso}`,
    `${CPNU_PUBLIC_API}:443/api/v2/Proceso/Actuaciones/${idProceso}`,
  ];
}

async function fetchDiscovery(options: AdapterOptions): Promise<ProviderAdapterResult> {
  const startTime = Date.now();
  const { radicado, timeoutMs = 12000 } = options;

  const searchCandidates = getSearchCandidates(radicado);

  for (const candidate of searchCandidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const fetchOpts: RequestInit = { method: candidate.method, headers: CPNU_HEADERS, signal: controller.signal };
      if ((candidate as any).body) fetchOpts.body = (candidate as any).body;

      const resp = await fetch(candidate.url, fetchOpts);
      clearTimeout(timeoutId);

      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('json') && !ct.includes('text/plain')) continue;
      if (!resp.ok) continue;

      const data = await resp.json();
      const procesos = data?.procesos || [];

      if (procesos.length === 0) {
        return makeEmptyResult('No processes found', startTime, resp.status);
      }

      const p = procesos[0];
      const idProceso = p.idProceso;

      // Fetch actuaciones
      let rawActs: any[] = [];
      if (idProceso) {
        const actCandidates = getActuacionesCandidates(idProceso);
        for (const actUrl of actCandidates) {
          try {
            const ac = new AbortController();
            const at = setTimeout(() => ac.abort(), timeoutMs);
            const actResp = await fetch(actUrl, { headers: CPNU_HEADERS, signal: ac.signal });
            clearTimeout(at);
            if (actResp.ok && (actResp.headers.get('content-type') || '').includes('json')) {
              const actData = await actResp.json();
              rawActs = actData?.actuaciones || [];
              break;
            }
          } catch { /* try next */ }
        }
      }

      // Extract metadata
      const despacho = String(p.despacho || p.nombreDespacho || '');

      // Normalize actuaciones
      const normalized = normalizeActuaciones(rawActs, radicado, despacho, {
        workItemId: options.workItemId,
        crossProviderDedup: options.crossProviderDedup,
        redactPII: options.redactPII,
      });

      // Extract parties
      const sujetosRaw = p.sujetosProcesales;
      const parties = options.includeParties !== false
        ? extractParties(
            Array.isArray(sujetosRaw) ? sujetosRaw : [],
            typeof sujetosRaw === 'string' ? sujetosRaw : undefined,
            options.redactPII,
          )
        : null;

      // If parties not resolved from search string, also try direct fields
      if (parties && !parties.demandante && p.demandante) {
        parties.demandante = typeof p.demandante === 'string' ? p.demandante.trim().replace(/\.+$/, '') : null;
      }
      if (parties && !parties.demandado && p.demandado) {
        parties.demandado = typeof p.demandado === 'string' ? p.demandado.trim().replace(/\.+$/, '') : null;
      }

      const metadata: CaseMetadata = {
        despacho: despacho || null,
        tipo_proceso: p.tipoProceso || null,
        fecha_radicacion: p.fechaRadicacion || p.fechaProceso || null,
      };

      return {
        provider: PROVIDER_KEY,
        status: normalized.length > 0 ? 'SUCCESS' : 'EMPTY',
        actuaciones: normalized,
        publicaciones: [],
        metadata,
        parties,
        durationMs: Date.now() - startTime,
        httpStatus: resp.status,
      };

    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return {
          provider: PROVIDER_KEY,
          status: 'TIMEOUT',
          actuaciones: [],
          publicaciones: [],
          metadata: null,
          parties: null,
          durationMs: Date.now() - startTime,
          errorMessage: 'Timeout',
        };
      }
      continue;
    }
  }

  return makeErrorResult('All CPNU API candidates exhausted', startTime);
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function makeErrorResult(errorMessage: string, startTime: number, httpStatus?: number): ProviderAdapterResult {
  return {
    provider: PROVIDER_KEY,
    status: 'ERROR',
    actuaciones: [],
    publicaciones: [],
    metadata: null,
    parties: null,
    durationMs: Date.now() - startTime,
    errorMessage,
    httpStatus,
  };
}

function makeEmptyResult(errorMessage: string, startTime: number, httpStatus?: number): ProviderAdapterResult {
  return {
    provider: PROVIDER_KEY,
    status: 'EMPTY',
    actuaciones: [],
    publicaciones: [],
    metadata: null,
    parties: null,
    durationMs: Date.now() - startTime,
    errorMessage,
    httpStatus,
  };
}

// ═══════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════

/**
 * Fetch from CPNU provider.
 *
 * @param options - Adapter options including radicado, mode, etc.
 * @returns Normalized provider result ready for persistence or preview.
 *
 * Usage:
 *   // Monitoring (orchestrator)
 *   const result = await fetchFromCpnu({ radicado, mode: 'monitoring' });
 *
 *   // Discovery (creation wizard / demo)
 *   const result = await fetchFromCpnu({ radicado, mode: 'discovery', includeParties: true });
 */
export async function fetchFromCpnu(options: AdapterOptions): Promise<ProviderAdapterResult> {
  if (options.mode === 'monitoring') {
    return fetchMonitoring(options);
  }
  return fetchDiscovery(options);
}

/**
 * Re-export normalization functions for use by callers that need custom processing.
 */
export { normalizeActuaciones as normalizeCpnuActuaciones };
export { extractParties as extractCpnuParties };
export { computeCpnuFingerprint };
