/**
 * sync-by-work-item Edge Function
 * 
 * PRODUCTION-GRADE sync for existing work items using external judicial APIs.
 * 
 * Features:
 * - Multi-tenant safe: validates user is member of work_item's organization
 * - CPNU primary + SAMAI fallback for radicado workflows
 * - TUTELAS API for TUTELA workflows (tutela_code-based)
 * - All external URLs from env vars: CPNU_BASE_URL, SAMAI_BASE_URL, TUTELAS_BASE_URL, EXTERNAL_X_API_KEY
 * - Idempotent: uses hash_fingerprint to prevent duplicates
 * - **NEW**: Detailed trace logging via sync_traces table for debugging
 * 
 * Input: { work_item_id: string }
 * Headers: X-Trace-Id (optional, for debugging)
 * Output: { ok, inserted_count, skipped_count, latest_event_date, provider_used, warnings, errors, trace_id }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-trace-id',
};

// ============= TYPES =============

interface SyncRequest {
  work_item_id: string;
  force_refresh?: boolean;
}

interface ProviderAttempt {
  provider: string;
  status: 'success' | 'not_found' | 'empty' | 'error' | 'timeout' | 'skipped';
  latencyMs: number;
  message?: string;
  actuacionesCount?: number;
}

interface SyncResult {
  ok: boolean;
  work_item_id: string;
  workflow_type: string;
  inserted_count: number;
  skipped_count: number;
  latest_event_date: string | null;
  provider_used: string | null;
  provider_attempts: ProviderAttempt[];
  provider_order_reason: string;
  warnings: string[];
  errors: string[];
  trace_id?: string;
  code?: string; // Error code for client
  // Auto-scraping fields
  scraping_initiated?: boolean;
  scraping_job_id?: string;
  scraping_poll_url?: string;
  scraping_provider?: string;
  scraping_message?: string;
}

interface WorkItem {
  id: string;
  owner_id: string;
  organization_id: string;
  workflow_type: string;
  radicado: string | null;
  tutela_code: string | null;
  scrape_status: string | null;
  last_crawled_at: string | null;
  expediente_url: string | null;
}

interface ActuacionRaw {
  fecha: string;
  actuacion: string;
  anotacion?: string;
  fecha_inicia_termino?: string;
  fecha_finaliza_termino?: string;
  // SAMAI-specific fields
  fecha_registro?: string;
  estado?: string;
  anexos?: number;
  indice?: string;
}

interface FetchResult {
  ok: boolean;
  actuaciones: ActuacionRaw[];
  expedienteUrl?: string;
  caseMetadata?: {
    despacho?: string;
    demandante?: string;
    demandado?: string;
    tipo_proceso?: string;
    // SAMAI-specific metadata fields
    origen?: string;
    ponente?: string;
    clase_proceso?: string;
    etapa?: string;
    ubicacion?: string;
    formato_expediente?: string;
    subclase?: string;
    recurso?: string;
    naturaleza?: string;
    fecha_radicado?: string;
    fecha_presenta_demanda?: string;
    fecha_para_sentencia?: string;
    fecha_sentencia?: string;
    asunto?: string;
    medida_cautelar?: string;
    ministerio_publico?: string;
    total_sujetos?: number;
  };
  // SAMAI sujetos for demandantes/demandados extraction
  sujetos?: Array<{
    registro?: string;
    tipo: string;
    nombre: string;
    accesoWebActivado?: boolean;
  }>;
  error?: string;
  provider: string;
  isEmpty?: boolean; // Indicates empty result (for fallback logic)
  latencyMs?: number;
  httpStatus?: number;
  // Auto-scraping fields
  scrapingInitiated?: boolean;
  scrapingJobId?: string;
  scrapingPollUrl?: string;
  scrapingMessage?: string;
}

// ============= TRACE LOGGING =============

interface TraceEvent {
  trace_id: string;
  work_item_id: string | null;
  organization_id: string | null;
  workflow_type: string | null;
  step: string;
  provider: string | null;
  http_status: number | null;
  latency_ms: number | null;
  success: boolean;
  error_code: string | null;
  message: string | null;
  meta: Record<string, unknown>;
}

// Log a trace event to the database (non-blocking, fail-safe)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logTrace(
  supabase: any,
  event: Partial<TraceEvent> & { trace_id: string; step: string }
): Promise<void> {
  try {
    // Use 'any' cast since sync_traces table may not be in generated types yet
    await (supabase.from('sync_traces') as any).insert({
      trace_id: event.trace_id,
      work_item_id: event.work_item_id || null,
      organization_id: event.organization_id || null,
      workflow_type: event.workflow_type || null,
      step: event.step,
      provider: event.provider || null,
      http_status: event.http_status || null,
      latency_ms: event.latency_ms || null,
      success: event.success ?? false,
      error_code: event.error_code || null,
      message: event.message?.slice(0, 500) || null, // Truncate messages
      meta: event.meta || {},
    });
  } catch (err) {
    // Fail silently - tracing should never break the main flow
    console.warn('[sync-by-work-item] Failed to log trace:', err);
  }
}

// ============= WORKFLOW-BASED PROVIDER ORDER =============
// 
// NOTIFICATION SOURCES:
// - CGP/LABORAL: ESTADOS are primary notification source (for legal terms)
//   - CPNU primary for enrichment actuaciones, SAMAI fallback
// - CPACA: SAMAI primary (administrative litigation), CPNU optional fallback (disabled)
// - TUTELA: TUTELAS API primary (tutela_code), CPNU fallback if TUTELAS empty/failed
// - PENAL_906: PUBLICACIONES are PRIMARY sync source (called FIRST); CPNU/SAMAI are optional enrichment
// 
// The Estados ingestion pipeline remains canonical for CGP/LABORAL.

type WorkflowType = 'CGP' | 'LABORAL' | 'CPACA' | 'TUTELA' | 'PENAL_906' | 'PETICION' | 'GOV_PROCEDURE';

interface ProviderOrderConfig {
  primary: 'cpnu' | 'samai' | 'tutelas-api' | 'publicaciones';
  fallback?: 'cpnu' | 'samai' | null;
  fallbackEnabled: boolean;
  usePublicacionesAsPrimary?: boolean; // For PENAL_906: Publicaciones is the PRIMARY sync source
}

function getProviderOrder(workflowType: string): ProviderOrderConfig {
  switch (workflowType) {
    case 'CPACA':
      // SAMAI is primary for CPACA (administrative litigation)
      return { primary: 'samai', fallback: 'cpnu', fallbackEnabled: false };
    case 'TUTELA':
      // TUTELAS API primary, CPNU fallback if TUTELAS empty/failed
      return { primary: 'tutelas-api', fallback: 'cpnu', fallbackEnabled: true };
    case 'PENAL_906':
      // PENAL_906: PUBLICACIONES is the PRIMARY sync source
      // Publicaciones must be called FIRST because penal updates frequently surface via published PDFs
      // CPNU/SAMAI are optional enrichment providers (disabled by default)
      return { primary: 'publicaciones', fallback: 'cpnu', fallbackEnabled: false, usePublicacionesAsPrimary: true };
    case 'CGP':
    case 'LABORAL':
      // CGP/LABORAL: CPNU PRIMARY, NO FALLBACK TO SAMAI
      // Civil/labor/family processes in CPNU are NOT in SAMAI, so fallback is technically useless
      // Note: Estados remain the canonical notification source (via estados ingestion pipeline)
      return { primary: 'cpnu', fallback: null, fallbackEnabled: false };
    default:
      // Unknown workflows: CPNU primary, no fallback
      return { primary: 'cpnu', fallback: null, fallbackEnabled: false };
  }
}

// ============= HELPERS =============

// ============= SIGNIFICANT EVENT DETECTION =============
// Detects important judicial events that warrant alerts
// IMPORTANT: Severity must be uppercase to match DB constraint: 'INFO', 'WARNING', 'CRITICAL'

interface SignificantEventInfo {
  type: string;
  title: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

const SIGNIFICANT_EVENT_PATTERNS: Array<{ patterns: string[]; info: SignificantEventInfo }> = [
  {
    patterns: ['auto admisorio', 'auto admite demanda', 'admite la demanda', 'se admite demanda'],
    info: { type: 'AUTO_ADMISORIO', title: 'Auto Admisorio detectado', severity: 'INFO' },
  },
  {
    patterns: ['sentencia', 'fallo de primera', 'fallo de segunda', 'se profiere sentencia'],
    info: { type: 'SENTENCIA', title: 'Sentencia detectada', severity: 'CRITICAL' },
  },
  {
    patterns: ['audiencia fijada', 'fija fecha para audiencia', 'señala fecha audiencia'],
    info: { type: 'AUDIENCIA_PROGRAMADA', title: 'Audiencia programada', severity: 'INFO' },
  },
  {
    patterns: ['recurso de apelación', 'concede apelación', 'admite recurso'],
    info: { type: 'APELACION', title: 'Recurso de apelación', severity: 'WARNING' },
  },
  {
    patterns: ['rechaza la demanda', 'rechaza demanda', 'auto de rechazo'],
    info: { type: 'RECHAZO', title: 'Demanda rechazada', severity: 'CRITICAL' },
  },
  {
    patterns: ['inadmite la demanda', 'auto inadmisorio', 'se inadmite'],
    info: { type: 'INADMISION', title: 'Demanda inadmitida', severity: 'WARNING' },
  },
  {
    patterns: ['medida cautelar', 'embargo', 'secuestro de bienes'],
    info: { type: 'MEDIDA_CAUTELAR', title: 'Medida cautelar ordenada', severity: 'WARNING' },
  },
  {
    patterns: ['ejecutoria', 'queda ejecutoriada', 'en firme'],
    info: { type: 'EJECUTORIA', title: 'Decisión en firme', severity: 'INFO' },
  },
];

function detectSignificantEvent(actuacion: string, anotacion: string): SignificantEventInfo | null {
  const textToSearch = `${actuacion} ${anotacion}`.toLowerCase();
  
  for (const { patterns, info } of SIGNIFICANT_EVENT_PATTERNS) {
    for (const pattern of patterns) {
      if (textToSearch.includes(pattern.toLowerCase())) {
        return info;
      }
    }
  }
  
  return null;
}

// ============= STAGE INFERENCE =============
// Lightweight stage inference from actuación text

interface StageSuggestion {
  suggestedStage: string;
  confidence: number;
  reason: string;
}

const STAGE_INFERENCE_PATTERNS: Array<{
  patterns: string[];
  stages: Record<string, string>; // workflow_type -> stage
  confidence: number;
  reason: string;
}> = [
  // ============= AUTO ADMISORIO (HIGH CONFIDENCE) =============
  {
    patterns: ['auto admisorio', 'auto admite demanda', 'admite la demanda', 'se admite demanda'],
    stages: { CGP: 'AUTO_ADMISORIO', LABORAL: 'AUTO_ADMISORIO', CPACA: 'AUTO_ADMISORIO', TUTELA: 'TUTELA_ADMITIDA' },
    confidence: 0.9,
    reason: 'Auto admisorio detectado en actuación',
  },
  // ============= RADICACIÓN =============
  {
    patterns: ['radicación de proceso', 'radicación demanda', 'se radica demanda'],
    stages: { CGP: 'RADICADO_CONFIRMED', LABORAL: 'RADICACION', CPACA: 'DEMANDA_RADICADA', TUTELA: 'TUTELA_RADICADA' },
    confidence: 0.85,
    reason: 'Radicación de proceso detectada',
  },
  // ============= NOTIFICACIÓN (CGP-specific) =============
  {
    patterns: ['notificación personal', 'se notifica personalmente', 'notificación por estado', 'notificación por aviso'],
    stages: { CGP: 'NOTIFICACION', LABORAL: 'NOTIFICACION', CPACA: 'NOTIFICACION_TRASLADOS' },
    confidence: 0.8,
    reason: 'Notificación detectada',
  },
  // ============= AUDIENCIA INICIAL (CGP) =============
  {
    patterns: ['audiencia inicial', 'fija fecha para audiencia inicial', 'citación audiencia inicial'],
    stages: { CGP: 'AUDIENCIA_INICIAL', LABORAL: 'AUDIENCIA_INICIAL', CPACA: 'AUDIENCIA_INICIAL' },
    confidence: 0.85,
    reason: 'Audiencia inicial detectada',
  },
  // ============= AUDIENCIA DE INSTRUCCIÓN Y JUZGAMIENTO (CGP-specific) =============
  {
    patterns: ['audiencia de instrucción', 'audiencia de juzgamiento', 'audiencia instrucción y juzgamiento', 'audiencia de trámite y juzgamiento'],
    stages: { CGP: 'AUDIENCIA_INSTRUCCION_JUZGAMIENTO', LABORAL: 'AUDIENCIA_TRAMITE_JUZGAMIENTO' },
    confidence: 0.9,
    reason: 'Audiencia de instrucción y juzgamiento detectada',
  },
  // ============= CONTESTACIÓN DEMANDA (CGP) =============
  {
    patterns: ['contestación demanda', 'contesta demanda', 'contestación de la demanda'],
    stages: { CGP: 'CONTESTACION', LABORAL: 'CONTESTACION', CPACA: 'CONTESTACION' },
    confidence: 0.85,
    reason: 'Contestación de demanda detectada',
  },
  // ============= TRASLADO (CGP) =============
  {
    patterns: ['traslado de la demanda', 'traslado demanda', 'corre traslado'],
    stages: { CGP: 'TRASLADO', LABORAL: 'TRASLADO', CPACA: 'TRASLADO_DEMANDA' },
    confidence: 0.8,
    reason: 'Traslado de demanda detectado',
  },
  // ============= SENTENCIA (HIGH CONFIDENCE) =============
  {
    patterns: ['sentencia', 'fallo de primera instancia', 'profiere sentencia', 'se profiere sentencia'],
    stages: { CGP: 'SENTENCIA', LABORAL: 'SENTENCIA_1A_INSTANCIA', CPACA: 'ALEGATOS_SENTENCIA', TUTELA: 'FALLO_PRIMERA_INSTANCIA' },
    confidence: 0.9,
    reason: 'Sentencia detectada en actuación',
  },
  // ============= RECURSOS =============
  {
    patterns: ['recurso de apelación', 'concede apelación', 'interpone recurso', 'recurso de reposición'],
    stages: { CGP: 'RECURSOS', LABORAL: 'APELACION', CPACA: 'RECURSOS', TUTELA: 'FALLO_SEGUNDA_INSTANCIA' },
    confidence: 0.85,
    reason: 'Recurso detectado',
  },
  // ============= MANDAMIENTO DE PAGO (EJECUTIVO CGP) =============
  {
    patterns: ['mandamiento de pago', 'libra mandamiento', 'mandamiento ejecutivo'],
    stages: { CGP: 'MANDAMIENTO_PAGO' },
    confidence: 0.9,
    reason: 'Mandamiento de pago detectado (proceso ejecutivo)',
  },
  // ============= EXCEPCIONES (CGP) =============
  {
    patterns: ['propone excepciones', 'excepciones previas', 'formula excepciones'],
    stages: { CGP: 'EXCEPCIONES', LABORAL: 'EXCEPCIONES' },
    confidence: 0.8,
    reason: 'Excepciones detectadas',
  },
  // ============= PRUEBAS (CGP) =============
  {
    patterns: ['decreto de pruebas', 'decreta pruebas', 'período probatorio'],
    stages: { CGP: 'PRUEBAS', LABORAL: 'PRUEBAS', CPACA: 'PERIODO_PROBATORIO' },
    confidence: 0.8,
    reason: 'Etapa probatoria detectada',
  },
  // ============= ALEGATOS =============
  {
    patterns: ['alegatos de conclusión', 'traslado para alegar', 'presenta alegatos'],
    stages: { CGP: 'ALEGATOS', LABORAL: 'ALEGATOS', CPACA: 'ALEGATOS_SENTENCIA' },
    confidence: 0.75,
    reason: 'Etapa de alegatos detectada',
  },
];

function inferStageFromActuacion(
  workflowType: string,
  actuacion: string,
  anotacion: string
): StageSuggestion | null {
  const textToSearch = `${actuacion} ${anotacion}`.toLowerCase();
  
  for (const { patterns, stages, confidence, reason } of STAGE_INFERENCE_PATTERNS) {
    for (const pattern of patterns) {
      if (textToSearch.includes(pattern.toLowerCase())) {
        const suggestedStage = stages[workflowType];
        if (suggestedStage) {
          return { suggestedStage, confidence, reason };
        }
      }
    }
  }
  
  return null;
}


function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, message: string, status: number = 400, traceId?: string): Response {
  return jsonResponse({
    ok: false,
    code,
    message,
    trace_id: traceId,
    timestamp: new Date().toISOString(),
  }, status);
}

function isValidTutelaCode(code: string): boolean {
  return /^T\d{6,10}$/i.test(code);
}

function isValidRadicado(radicado: string): boolean {
  const normalized = radicado.replace(/\D/g, '');
  return normalized.length === 23;
}

function normalizeRadicado(radicado: string): string {
  return radicado.replace(/\D/g, '');
}

function generateFingerprint(
  workItemId: string,
  date: string,
  text: string
): string {
  const normalized = `${workItemId}|${date}|${text.toLowerCase().trim().slice(0, 200)}`;
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `wi_${workItemId.slice(0, 8)}_${Math.abs(hash).toString(16)}`;
}

function parseColombianDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  
  // If already ISO format, return as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 10);
  }
  
  // Remove time portion if present (e.g., "07/06/2025 6:06:44" -> "07/06/2025")
  // Also handles "09/06/2025" without time
  const dateOnly = dateStr.split(' ')[0];
  
  const patterns = [
    /^(\d{2})\/(\d{2})\/(\d{4})$/,  // DD/MM/YYYY (Colombian format)
    /^(\d{2})-(\d{2})-(\d{4})$/,    // DD-MM-YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, // D/M/YYYY or DD/M/YYYY
  ];

  for (const pattern of patterns) {
    const match = dateOnly.match(pattern);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      return `${match[3]}-${month}-${day}`; // YYYY-MM-DD
    }
  }
  
  return null;
}

// ============= URL HELPERS =============

// Safe URL join that handles base, prefix, and path
// Rules:
// - base has no trailing slash
// - prefix is either "" or starts with "/" and has no trailing slash (normalized)
// - path always starts with "/" (query params preserved)
// - result has exactly one slash between segments (never "//health")
function joinUrl(baseUrl: string, prefix: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  let cleanPrefix = (prefix || '').trim();
  if (cleanPrefix === '/') cleanPrefix = '';
  if (cleanPrefix && !cleanPrefix.startsWith('/')) {
    cleanPrefix = '/' + cleanPrefix;
  }
  cleanPrefix = cleanPrefix.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPrefix}${cleanPath}`;
}

// Detect if response body looks like HTML "Cannot GET" (Express 404)
function isHtmlCannotGet(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes('cannot get') ||
    lower.includes('<!doctype html') ||
    lower.includes('<html') ||
    lower.includes('not found</pre>')
  );
}

// ============= API KEY SELECTION =============
// Provider-specific keys take precedence over the shared EXTERNAL_X_API_KEY

interface ApiKeyInfo {
  source: string;
  value: string | null;
  fingerprint: string | null;
}

async function hashFingerprint(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.slice(0, 8);
}

async function getApiKeyForProvider(provider: string): Promise<ApiKeyInfo> {
  const providerKeyMap: Record<string, string> = {
    cpnu: 'CPNU_X_API_KEY',
    samai: 'SAMAI_X_API_KEY',
    tutelas: 'TUTELAS_X_API_KEY',
    publicaciones: 'PUBLICACIONES_X_API_KEY',
  };

  // Try provider-specific key first
  const providerKeyName = providerKeyMap[provider];
  if (providerKeyName) {
    const providerKey = Deno.env.get(providerKeyName);
    if (providerKey && providerKey.length > 0) {
      return {
        source: providerKeyName,
        value: providerKey,
        fingerprint: await hashFingerprint(providerKey),
      };
    }
  }

  // Fall back to shared key
  const sharedKey = Deno.env.get('EXTERNAL_X_API_KEY');
  if (sharedKey && sharedKey.length > 0) {
    return {
      source: 'EXTERNAL_X_API_KEY',
      value: sharedKey,
      fingerprint: await hashFingerprint(sharedKey),
    };
  }

  return { source: 'MISSING', value: null, fingerprint: null };
}

// ============= SCRAPING JOB TYPES =============

interface ScrapingJobResult {
  ok: boolean;
  jobId?: string;
  pollUrl?: string;
  status?: string;
  error?: string;
  latencyMs?: number;
}

// ============= TRIGGER SCRAPING JOB =============
// Calls /buscar to initiate async scraping when /snapshot returns 404

async function triggerCpnuScrapingJob(
  radicado: string,
  baseUrl: string,
  pathPrefix: string,
  apiKeyInfo: ApiKeyInfo
): Promise<ScrapingJobResult> {
  const startTime = Date.now();
  const buscarPath = `/buscar?numero_radicacion=${radicado}`;
  const buscarUrl = joinUrl(baseUrl, pathPrefix, buscarPath);
  
  console.log(`[sync-by-work-item] SCRAPING_INITIATED: CPNU /buscar, url=${buscarUrl}`);
  
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKeyInfo.value) {
      headers['x-api-key'] = apiKeyInfo.value;
    }
    
    const response = await fetch(buscarUrl, {
      method: 'GET',
      headers,
    });
    
    const body = await response.text();
    const latencyMs = Date.now() - startTime;
    
    console.log(`[sync-by-work-item] SCRAPING_RESPONSE: CPNU /buscar, status=${response.status}, latencyMs=${latencyMs}`);
    
    if (!response.ok) {
      console.warn(`[sync-by-work-item] /buscar failed: HTTP ${response.status}`);
      return {
        ok: false,
        error: `Scraping job creation failed: HTTP ${response.status}`,
        latencyMs,
      };
    }
    
    // Parse response
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(body);
    } catch {
      console.warn(`[sync-by-work-item] /buscar returned non-JSON: ${body.slice(0, 200)}`);
      return {
        ok: false,
        error: 'Scraping service returned invalid response',
        latencyMs,
      };
    }
    
    // Extract job info - CPNU returns { jobId, status, poll_url } or similar
    const jobId = String(data.jobId || data.job_id || data.id || '');
    const pollUrl = String(data.poll_url || data.pollUrl || data.resultado_url || '');
    const status = String(data.status || 'PENDING');
    
    if (!jobId) {
      console.warn(`[sync-by-work-item] /buscar response missing jobId:`, data);
      return {
        ok: false,
        error: 'Scraping service did not return job ID',
        latencyMs,
      };
    }
    
    console.log(`[sync-by-work-item] Scraping job created: jobId=${jobId}, status=${status}`);
    
    return {
      ok: true,
      jobId,
      pollUrl: pollUrl || `${baseUrl}${pathPrefix}/resultado/${jobId}`,
      status,
      latencyMs,
    };
    
  } catch (err) {
    console.error('[sync-by-work-item] /buscar fetch error:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Scraping job creation failed',
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============= TRIGGER SCRAPING JOB: SAMAI =============
// Calls /buscar to initiate async scraping when SAMAI returns 404
// IMPORTANT: /buscar may return CACHED data directly (success=true, status="done")
// or create an async job (success=true, status="queued", jobId)

interface SamaiScrapingResult extends ScrapingJobResult {
  // If cached data is available, return it directly
  cachedData?: {
    actuaciones: ActuacionRaw[];
    sujetos?: Array<{
      registro?: string;
      tipo: string;
      nombre: string;
      accesoWebActivado?: boolean;
    }>;
    caseMetadata?: {
      despacho?: string;
      demandante?: string;
      demandado?: string;
      tipo_proceso?: string;
      // SAMAI-specific fields for cached data
      ponente?: string;
      etapa?: string;
      origen?: string;
      ministerio_publico?: string;
      total_sujetos?: number;
    };
  };
}

async function triggerSamaiScrapingJob(
  radicado: string,
  baseUrl: string,
  apiKeyInfo: ApiKeyInfo
): Promise<SamaiScrapingResult> {
  const startTime = Date.now();
  const buscarPath = `/buscar?numero_radicacion=${radicado}`;
  const buscarUrl = `${baseUrl.replace(/\/+$/, '')}${buscarPath}`;
  
  console.log(`[sync-by-work-item] SCRAPING_INITIATED: SAMAI /buscar, url=${buscarUrl}`);
  
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKeyInfo.value) {
      headers['x-api-key'] = apiKeyInfo.value;
    }
    
    const response = await fetch(buscarUrl, {
      method: 'GET',
      headers,
    });
    
    const body = await response.text();
    const latencyMs = Date.now() - startTime;
    
    console.log(`[sync-by-work-item] SCRAPING_RESPONSE: SAMAI /buscar, status=${response.status}, latencyMs=${latencyMs}`);
    
    if (!response.ok) {
      console.warn(`[sync-by-work-item] SAMAI /buscar failed: HTTP ${response.status}`);
      return {
        ok: false,
        error: `Scraping job creation failed: HTTP ${response.status}`,
        latencyMs,
      };
    }
    
    // Parse response
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(body);
    } catch {
      console.warn(`[sync-by-work-item] SAMAI /buscar returned non-JSON: ${body.slice(0, 200)}`);
      return {
        ok: false,
        error: 'Scraping service returned invalid response',
        latencyMs,
      };
    }
    
    // CRITICAL: Check if /buscar returned CACHED data directly
    // Response format when cached: { success: true, status: "done", cached: true, result: {...} }
    if (data.success === true && (data.status === 'done' || data.cached === true) && data.result) {
      console.log(`[sync-by-work-item] SAMAI /buscar returned CACHED data directly`);
      
      const resultData = data.result as Record<string, unknown>;
      const actuaciones = (resultData.actuaciones || []) as Array<Record<string, unknown>>;
      const sujetos = (resultData.sujetos || []) as Array<Record<string, unknown>>;
      
      if (actuaciones.length > 0) {
        console.log(`[sync-by-work-item] SAMAI /buscar: Found ${actuaciones.length} cached actuaciones, ${sujetos.length} sujetos`);
        
        // Extract demandantes/demandados from sujetos
        const demandantes = sujetos
          .filter(s => {
            const tipo = String(s.tipo || '').toLowerCase();
            return tipo.includes('demandante') || tipo.includes('accionante') || tipo.includes('ofendido');
          })
          .map(s => String(s.nombre || ''))
          .filter(Boolean)
          .join(' | ');
        
        const demandados = sujetos
          .filter(s => {
            const tipo = String(s.tipo || '').toLowerCase();
            return tipo.includes('demandado') || tipo.includes('accionado') || tipo.includes('procesado');
          })
          .map(s => String(s.nombre || ''))
          .filter(Boolean)
          .join(' | ');
        
        const ministerioPublico = sujetos
          .filter(s => String(s.tipo || '').toLowerCase().includes('ministerio'))
          .map(s => String(s.nombre || ''))
          .filter(Boolean)
          .join(' | ');
        
        return {
          ok: true,
          latencyMs,
          status: 'cached',
          cachedData: {
            // ✅ FIX: Use fechaActuacion (not fecha)
            actuaciones: actuaciones.map((act) => ({
              fecha: String(act.fechaActuacion || act.fecha || ''),
              actuacion: String(act.actuacion || ''),
              anotacion: String(act.anotacion || ''),
              fecha_registro: String(act.fechaRegistro || ''),
              estado: String(act.estado || ''),
              anexos: Number(act.anexos || 0),
              indice: String(act.indice || ''),
            })),
            // ✅ FIX: Include sujetos for demandantes/demandados extraction
            sujetos: sujetos.map(s => ({
              registro: String(s.registro || ''),
              tipo: String(s.tipo || ''),
              nombre: String(s.nombre || ''),
              accesoWebActivado: Boolean(s.accesoWebActivado),
            })),
            caseMetadata: {
              despacho: resultData.corporacionNombre as string || resultData.corporacion as string,
              demandante: demandantes || undefined,
              demandado: demandados || undefined,
              tipo_proceso: resultData.clasificacion 
                ? (resultData.clasificacion as Record<string, unknown>).tipoProceso as string 
                : resultData.clase as string,
              ponente: resultData.ponente as string,
              etapa: resultData.etapa as string,
              origen: resultData.origen as string,
              ministerio_publico: ministerioPublico || undefined,
              total_sujetos: (resultData.totalSujetos as number) || sujetos.length,
            },
          },
        };
      }
    }
    
    // Check for queued scraping job (async case)
    const jobId = String(data.jobId || data.job_id || data.id || '');
    const pollUrl = String(data.poll_url || data.pollUrl || data.resultado_url || '');
    const status = String(data.status || 'PENDING');
    
    if (jobId) {
      console.log(`[sync-by-work-item] SAMAI Scraping job created: jobId=${jobId}, status=${status}`);
      return {
        ok: true,
        jobId,
        pollUrl: pollUrl || `${baseUrl}/resultado/${jobId}`,
        status,
        latencyMs,
      };
    }
    
    // No jobId and no cached data - unexpected response
    console.warn(`[sync-by-work-item] SAMAI /buscar response missing jobId and no cached data:`, data);
    return {
      ok: false,
      error: 'Scraping service did not return job ID or cached data',
      latencyMs,
    };
    
  } catch (err) {
    console.error('[sync-by-work-item] SAMAI /buscar fetch error:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Scraping job creation failed',
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============= TRIGGER SCRAPING JOB: PUBLICACIONES =============
// Calls /buscar to initiate async scraping when Publicaciones returns 404
// IMPORTANT: Uses "radicado" parameter (not "numero_radicacion")

async function triggerPublicacionesScrapingJob(
  radicado: string,
  baseUrl: string,
  apiKeyInfo: ApiKeyInfo
): Promise<ScrapingJobResult> {
  const startTime = Date.now();
  // IMPORTANT: Publicaciones uses "radicado" parameter, not "numero_radicacion"
  const buscarPath = `/buscar?radicado=${radicado}`;
  const buscarUrl = `${baseUrl.replace(/\/+$/, '')}${buscarPath}`;
  
  console.log(`[sync-by-work-item] SCRAPING_INITIATED: PUBLICACIONES /buscar, url=${buscarUrl}`);
  
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKeyInfo.value) {
      headers['x-api-key'] = apiKeyInfo.value;
    }
    
    const response = await fetch(buscarUrl, {
      method: 'GET',
      headers,
    });
    
    const body = await response.text();
    const latencyMs = Date.now() - startTime;
    
    console.log(`[sync-by-work-item] SCRAPING_RESPONSE: PUBLICACIONES /buscar, status=${response.status}, latencyMs=${latencyMs}`);
    
    if (!response.ok) {
      console.warn(`[sync-by-work-item] PUBLICACIONES /buscar failed: HTTP ${response.status}`);
      return {
        ok: false,
        error: `Scraping job creation failed: HTTP ${response.status}`,
        latencyMs,
      };
    }
    
    // Parse response
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(body);
    } catch {
      console.warn(`[sync-by-work-item] PUBLICACIONES /buscar returned non-JSON: ${body.slice(0, 200)}`);
      return {
        ok: false,
        error: 'Scraping service returned invalid response',
        latencyMs,
      };
    }
    
    // Extract job info
    const jobId = String(data.jobId || data.job_id || data.id || '');
    const pollUrl = String(data.poll_url || data.pollUrl || data.resultado_url || '');
    const status = String(data.status || 'PENDING');
    
    if (!jobId) {
      console.warn(`[sync-by-work-item] PUBLICACIONES /buscar response missing jobId:`, data);
      return {
        ok: false,
        error: 'Scraping service did not return job ID',
        latencyMs,
      };
    }
    
    console.log(`[sync-by-work-item] PUBLICACIONES Scraping job created: jobId=${jobId}, status=${status}`);
    
    return {
      ok: true,
      jobId,
      pollUrl: pollUrl || `${baseUrl}/resultado/${jobId}`,
      status,
      latencyMs,
    };
    
  } catch (err) {
    console.error('[sync-by-work-item] PUBLICACIONES /buscar fetch error:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Scraping job creation failed',
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============= TRIGGER SCRAPING JOB: TUTELAS =============
// IMPORTANT: Tutelas uses POST with JSON body to /search endpoint

async function triggerTutelasScrapingJob(
  tutelaCode: string,
  baseUrl: string,
  apiKeyInfo: ApiKeyInfo
): Promise<ScrapingJobResult> {
  const startTime = Date.now();
  const searchUrl = `${baseUrl.replace(/\/+$/, '')}/search`;
  
  console.log(`[sync-by-work-item] SCRAPING_INITIATED: TUTELAS /search (POST), url=${searchUrl}`);
  
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKeyInfo.value) {
      headers['x-api-key'] = apiKeyInfo.value;
    }
    
    // TUTELAS uses POST with JSON body
    const response = await fetch(searchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ radicado: tutelaCode }),
    });
    
    const body = await response.text();
    const latencyMs = Date.now() - startTime;
    
    console.log(`[sync-by-work-item] SCRAPING_RESPONSE: TUTELAS /search, status=${response.status}, latencyMs=${latencyMs}`);
    
    if (!response.ok) {
      console.warn(`[sync-by-work-item] TUTELAS /search failed: HTTP ${response.status}`);
      return {
        ok: false,
        error: `Scraping job creation failed: HTTP ${response.status}`,
        latencyMs,
      };
    }
    
    // Parse response
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(body);
    } catch {
      console.warn(`[sync-by-work-item] TUTELAS /search returned non-JSON: ${body.slice(0, 200)}`);
      return {
        ok: false,
        error: 'Scraping service returned invalid response',
        latencyMs,
      };
    }
    
    // TUTELAS returns { job_id, status: "pending", message: "Use GET /job/{job_id}" }
    const jobId = String(data.job_id || data.jobId || data.id || '');
    const status = String(data.status || 'pending');
    const message = String(data.message || '');
    
    if (!jobId) {
      console.warn(`[sync-by-work-item] TUTELAS /search response missing job_id:`, data);
      return {
        ok: false,
        error: 'Scraping service did not return job ID',
        latencyMs,
      };
    }
    
    console.log(`[sync-by-work-item] TUTELAS Scraping job created: jobId=${jobId}, status=${status}`);
    
    return {
      ok: true,
      jobId,
      pollUrl: `${baseUrl}/job/${jobId}`,
      status,
      latencyMs,
    };
    
  } catch (err) {
    console.error('[sync-by-work-item] TUTELAS /search fetch error:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Scraping job creation failed',
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============= PROVIDER: CPNU =============
// CPNU Cloud Run service (cpnu-https-jobs) exposes routes at ROOT:
// - GET /health - health check
// - GET /snapshot?numero_radicacion={radicado} - synchronous lookup (preferred)
// - GET /buscar?numero_radicacion={radicado} - async job creation
// - GET /resultado/{jobId} - async job result

async function fetchFromCpnu(radicado: string): Promise<FetchResult> {
  const startTime = Date.now();
  const baseUrl = Deno.env.get('CPNU_BASE_URL');
  const pathPrefix = Deno.env.get('CPNU_PATH_PREFIX') || ''; // Default empty for root-exposed service
  
  // Get API key with provider-specific selection
  const apiKeyInfo = await getApiKeyForProvider('cpnu');

  if (!baseUrl) {
    console.log('[sync-by-work-item] CPNU_BASE_URL not configured');
    return { 
      ok: false, 
      actuaciones: [], 
      error: 'CPNU API not configured (missing CPNU_BASE_URL). Contact administrator.', 
      provider: 'cpnu',
      latencyMs: Date.now() - startTime,
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  
  // Only add auth header if key is present
  if (apiKeyInfo.value) {
    headers['x-api-key'] = apiKeyInfo.value;
  }

  // Log auth context safely (no secrets)
  console.log(`[sync-by-work-item] CPNU auth: source=${apiKeyInfo.source}, present=${!!apiKeyInfo.value}, fingerprint=${apiKeyInfo.fingerprint || 'none'}`);

  // STEP 1: Try /snapshot (synchronous lookup - preferred)
  const snapshotPath = `/snapshot?numero_radicacion=${radicado}`;
  const snapshotUrl = joinUrl(baseUrl, pathPrefix, snapshotPath);
  
  // Trace: PROVIDER_REQUEST_START
  console.log(`[sync-by-work-item] PROVIDER_REQUEST_START: CPNU, url=${snapshotUrl}, method=GET, auth_header=${apiKeyInfo.value ? 'x-api-key (present)' : 'none'}`);

  const requestStartTime = Date.now();
  
  try {
    const snapshotResponse = await fetch(snapshotUrl, {
      method: 'GET',
      headers,
    });

    const snapshotBody = await snapshotResponse.text();
    const requestLatencyMs = Date.now() - requestStartTime;
    
    // Trace: PROVIDER_RESPONSE_RECEIVED
    console.log(`[sync-by-work-item] PROVIDER_RESPONSE_RECEIVED: CPNU, status=${snapshotResponse.status}, latencyMs=${requestLatencyMs}, bodyLength=${snapshotBody.length}`);
    
    
    // Check for route mismatch (HTML "Cannot GET")
    if (snapshotResponse.status === 404 && isHtmlCannotGet(snapshotBody)) {
      console.warn(`[sync-by-work-item] CPNU route mismatch: HTML 404 for ${snapshotPath}. Check CPNU_BASE_URL/CPNU_PATH_PREFIX.`);
      return { 
        ok: false, 
        actuaciones: [], 
        error: `UPSTREAM_ROUTE_MISSING: CPNU returned HTML 404. Check CPNU_BASE_URL configuration.`, 
        provider: 'cpnu',
        latencyMs: Date.now() - startTime,
        httpStatus: 404,
      };
    }

    // Auth errors
    if (snapshotResponse.status === 401 || snapshotResponse.status === 403) {
      console.warn(`[sync-by-work-item] CPNU auth error: HTTP ${snapshotResponse.status}`);
      return { 
        ok: false, 
        actuaciones: [], 
        error: `UPSTREAM_AUTH: CPNU returned ${snapshotResponse.status}. Check EXTERNAL_X_API_KEY.`, 
        provider: 'cpnu',
        latencyMs: Date.now() - startTime,
        httpStatus: snapshotResponse.status,
      };
    }

    // Try to parse JSON
    let snapshotData: Record<string, unknown>;
    try {
      snapshotData = JSON.parse(snapshotBody);
    } catch {
      console.warn(`[sync-by-work-item] CPNU returned non-JSON: ${snapshotBody.slice(0, 200)}`);
      return { 
        ok: false, 
        actuaciones: [], 
        error: `INVALID_JSON_RESPONSE: CPNU returned non-JSON response.`, 
        provider: 'cpnu',
        latencyMs: Date.now() - startTime,
        httpStatus: snapshotResponse.status,
      };
    }

    // JSON 404 = record not found - AUTO-TRIGGER SCRAPING
    if (snapshotResponse.status === 404) {
      console.log(`[sync-by-work-item] CPNU: Record not found (JSON 404) for ${radicado}. Auto-triggering scraping...`);
      
      // Attempt to trigger scraping job via /buscar
      const scrapingResult = await triggerCpnuScrapingJob(radicado, baseUrl, pathPrefix, apiKeyInfo);
      
      if (scrapingResult.ok && scrapingResult.jobId) {
        console.log(`[sync-by-work-item] CPNU: Scraping job triggered successfully: jobId=${scrapingResult.jobId}`);
        return { 
          ok: false, 
          actuaciones: [], 
          error: 'RECORD_NOT_FOUND', 
          provider: 'cpnu',
          isEmpty: true,
          latencyMs: Date.now() - startTime,
          httpStatus: 404,
          scrapingInitiated: true,
          scrapingJobId: scrapingResult.jobId,
          scrapingPollUrl: scrapingResult.pollUrl,
          scrapingMessage: `Record not found in cache. Scraping initiated (job ${scrapingResult.jobId}). Retry sync in 30-60 seconds.`,
        };
      } else {
        // Scraping trigger failed - return normal 404
        console.log(`[sync-by-work-item] CPNU: Scraping trigger failed: ${scrapingResult.error}`);
        return { 
          ok: false, 
          actuaciones: [], 
          error: 'RECORD_NOT_FOUND', 
          provider: 'cpnu',
          isEmpty: true,
          latencyMs: Date.now() - startTime,
          httpStatus: 404,
        };
      }
    }

    // Check for "not found" indicators in JSON body - also trigger scraping
    if (snapshotData.expediente_encontrado === false || snapshotData.found === false) {
      console.log(`[sync-by-work-item] CPNU: found=false for ${radicado}. Auto-triggering scraping...`);
      
      const scrapingResult = await triggerCpnuScrapingJob(radicado, baseUrl, pathPrefix, apiKeyInfo);
      
      if (scrapingResult.ok && scrapingResult.jobId) {
        console.log(`[sync-by-work-item] CPNU: Scraping job triggered successfully: jobId=${scrapingResult.jobId}`);
        return { 
          ok: false, 
          actuaciones: [], 
          error: 'RECORD_NOT_FOUND', 
          provider: 'cpnu',
          isEmpty: true,
          latencyMs: Date.now() - startTime,
          httpStatus: snapshotResponse.status,
          scrapingInitiated: true,
          scrapingJobId: scrapingResult.jobId,
          scrapingPollUrl: scrapingResult.pollUrl,
          scrapingMessage: `Record not found in cache. Scraping initiated (job ${scrapingResult.jobId}). Retry sync in 30-60 seconds.`,
        };
      } else {
        return { 
          ok: false, 
          actuaciones: [], 
          error: 'RECORD_NOT_FOUND', 
          provider: 'cpnu',
          isEmpty: true,
          latencyMs: Date.now() - startTime,
          httpStatus: snapshotResponse.status,
        };
      }
    }

    // Success - extract actuaciones
    const proceso = snapshotData.proceso as Record<string, unknown> | undefined;
    const actuaciones = (snapshotData.actuaciones || proceso?.actuaciones || []) as Record<string, unknown>[];
    
    if (actuaciones.length === 0) {
      console.log(`[sync-by-work-item] CPNU: No actuaciones for ${radicado}`);
      return { 
        ok: false, 
        actuaciones: [], 
        error: 'No actuaciones found', 
        provider: 'cpnu',
        isEmpty: true,
        latencyMs: Date.now() - startTime,
        httpStatus: snapshotResponse.status,
      };
    }

    console.log(`[sync-by-work-item] CPNU: Found ${actuaciones.length} actuaciones for ${radicado}`);
    
    return {
      ok: true,
      actuaciones: actuaciones.map((act) => ({
        fecha: String(act.fecha_actuacion || act.fecha || ''),
        actuacion: String(act.actuacion || ''),
        anotacion: String(act.anotacion || ''),
        fecha_inicia_termino: act.fecha_inicia_termino ? String(act.fecha_inicia_termino) : undefined,
        fecha_finaliza_termino: act.fecha_finaliza_termino ? String(act.fecha_finaliza_termino) : undefined,
      })),
      caseMetadata: {
        despacho: (snapshotData.despacho || proceso?.despacho) as string | undefined,
        demandante: (snapshotData.demandante || proceso?.demandante) as string | undefined,
        demandado: (snapshotData.demandado || proceso?.demandado) as string | undefined,
        tipo_proceso: (snapshotData.tipo_proceso || proceso?.tipo) as string | undefined,
      },
      expedienteUrl: snapshotData.expediente_url as string | undefined,
      provider: 'cpnu',
      latencyMs: Date.now() - startTime,
      httpStatus: snapshotResponse.status,
    };

  } catch (err) {
    console.error('[sync-by-work-item] CPNU fetch error:', err);
    return { 
      ok: false, 
      actuaciones: [], 
      error: err instanceof Error ? err.message : 'CPNU fetch failed', 
      provider: 'cpnu',
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============= PROVIDER: SAMAI =============
// IMPORTANT: SAMAI wraps response in "result" key
// Actuaciones use "fechaActuacion" (NOT "fecha")
// Endpoint: /snapshot?numero_radicacion={radicado} (preferred) or /resultado/{jobId}

async function fetchFromSamai(radicado: string): Promise<FetchResult> {
  const startTime = Date.now();
  const baseUrl = Deno.env.get('SAMAI_BASE_URL');
  
  // Get API key with provider-specific selection
  const apiKeyInfo = await getApiKeyForProvider('samai');

  if (!baseUrl) {
    console.log('[sync-by-work-item] SAMAI_BASE_URL not configured');
    return { 
      ok: false, 
      actuaciones: [], 
      error: 'SAMAI API not configured (missing SAMAI_BASE_URL).', 
      provider: 'samai',
      latencyMs: Date.now() - startTime,
    };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKeyInfo.value) {
      headers['x-api-key'] = apiKeyInfo.value;
    }

    // Use /snapshot endpoint (synchronous lookup - preferred)
    const snapshotUrl = `${baseUrl.replace(/\/+$/, '')}/snapshot?numero_radicacion=${radicado}`;
    console.log(`[sync-by-work-item] Calling SAMAI: ${snapshotUrl}`);
    
    const response = await fetch(snapshotUrl, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[sync-by-work-item] SAMAI: Record not found (404) for ${radicado}. Auto-triggering scraping...`);
        
        // Attempt to trigger scraping job via /buscar
        // IMPORTANT: /buscar may return CACHED data directly or create an async job
        const scrapingResult = await triggerSamaiScrapingJob(radicado, baseUrl, apiKeyInfo);
        
        // Case 1: /buscar returned CACHED data directly - use it!
        if (scrapingResult.ok && scrapingResult.cachedData) {
          console.log(`[sync-by-work-item] SAMAI: /buscar returned ${scrapingResult.cachedData.actuaciones.length} cached actuaciones, ${scrapingResult.cachedData.sujetos?.length || 0} sujetos`);
          return { 
            ok: scrapingResult.cachedData.actuaciones.length > 0, 
            actuaciones: scrapingResult.cachedData.actuaciones, 
            // ✅ FIX: Include sujetos from cached data for total_sujetos_procesales update
            sujetos: scrapingResult.cachedData.sujetos,
            caseMetadata: scrapingResult.cachedData.caseMetadata,
            provider: 'samai',
            latencyMs: Date.now() - startTime,
            httpStatus: 200, // Treat cached data as success
          };
        }
        
        // Case 2: /buscar created an async scraping job
        if (scrapingResult.ok && scrapingResult.jobId) {
          console.log(`[sync-by-work-item] SAMAI: Scraping job triggered successfully: jobId=${scrapingResult.jobId}`);
          return { 
            ok: false, 
            actuaciones: [], 
            error: 'RECORD_NOT_FOUND', 
            provider: 'samai',
            isEmpty: true,
            latencyMs: Date.now() - startTime,
            httpStatus: 404,
            scrapingInitiated: true,
            scrapingJobId: scrapingResult.jobId,
            scrapingPollUrl: scrapingResult.pollUrl,
            scrapingMessage: `Record not found in SAMAI cache. Scraping initiated (job ${scrapingResult.jobId}). Retry sync in 30-60 seconds.`,
          };
        }
        
        // Case 3: /buscar failed - return original 404
        console.log(`[sync-by-work-item] SAMAI: Scraping trigger failed: ${scrapingResult.error}`);
        return { 
          ok: false, 
          actuaciones: [], 
          error: 'Not found in SAMAI', 
          provider: 'samai',
          isEmpty: true,
          latencyMs: Date.now() - startTime,
          httpStatus: 404,
        };
      }
      return { 
        ok: false, 
        actuaciones: [], 
        error: `HTTP ${response.status}`, 
        provider: 'samai',
        latencyMs: Date.now() - startTime,
        httpStatus: response.status,
      };
    }

    const data = await response.json();
    
    // SAMAI wraps response in "result" key
    const result = data.result || data;
    
    const actuaciones = result.actuaciones || [];
    
    if (actuaciones.length === 0) {
      return { 
        ok: false, 
        actuaciones: [], 
        error: 'No actuaciones in SAMAI', 
        provider: 'samai',
        isEmpty: true,
        latencyMs: Date.now() - startTime,
        httpStatus: 200,
      };
    }

    console.log(`[sync-by-work-item] SAMAI: Found ${actuaciones.length} actuaciones for ${radicado}`);
    
    // Extract sujetos procesales for demandantes/demandados
    const sujetos = (result.sujetos || []) as Array<Record<string, unknown>>;
    
    // Map actuaciones with correct field names
    // CRITICAL: Use fechaActuacion (NOT fecha which doesn't exist in SAMAI)
    const mappedActuaciones = actuaciones.map((act: Record<string, unknown>) => ({
      // ✅ FIX: Use fechaActuacion (SAMAI's actual field name)
      fecha: String(act.fechaActuacion || act.fecha || ''),
      actuacion: String(act.actuacion || ''),
      anotacion: String(act.anotacion || ''),
      // SAMAI-specific fields
      fecha_registro: String(act.fechaRegistro || ''),
      estado: String(act.estado || ''),
      anexos: Number(act.anexos || 0),
      indice: String(act.indice || ''),
    }));
    
    // Extract demandantes and demandados from sujetos
    const demandantes = sujetos
      .filter((s) => {
        const tipo = String(s.tipo || '').toLowerCase();
        return tipo.includes('demandante') || tipo.includes('accionante') || tipo.includes('ofendido');
      })
      .map((s) => String(s.nombre || ''))
      .filter(Boolean)
      .join(' | ');
    
    const demandados = sujetos
      .filter((s) => {
        const tipo = String(s.tipo || '').toLowerCase();
        return tipo.includes('demandado') || tipo.includes('accionado') || tipo.includes('procesado');
      })
      .map((s) => String(s.nombre || ''))
      .filter(Boolean)
      .join(' | ');
    
    const ministerioPublico = sujetos
      .filter((s) => String(s.tipo || '').toLowerCase().includes('ministerio'))
      .map((s) => String(s.nombre || ''))
      .filter(Boolean)
      .join(' | ');
    
    return {
      ok: true,
      actuaciones: mappedActuaciones,
      sujetos: sujetos.map((s) => ({
        registro: String(s.registro || ''),
        tipo: String(s.tipo || ''),
        nombre: String(s.nombre || ''),
        accesoWebActivado: Boolean(s.accesoWebActivado),
      })),
      caseMetadata: {
        despacho: result.corporacionNombre || result.corporacion || result.despacho,
        demandante: demandantes || undefined,
        demandado: demandados || undefined,
        tipo_proceso: result.clasificacion?.tipoProceso || result.tipo_proceso,
        // SAMAI-specific metadata
        origen: result.origen,
        ponente: result.ponente,
        clase_proceso: result.clase,
        etapa: result.etapa,
        ubicacion: result.ubicacion,
        formato_expediente: result.formatoExpediente,
        subclase: result.clasificacion?.subclase,
        recurso: result.clasificacion?.recurso,
        naturaleza: result.clasificacion?.naturaleza,
        fecha_radicado: result.fechas?.radicado,
        fecha_presenta_demanda: result.fechas?.presentaDemanda,
        fecha_para_sentencia: result.fechas?.paraSentencia,
        fecha_sentencia: result.fechas?.sentencia,
        asunto: result.asunto,
        medida_cautelar: result.medidaCautelar,
        ministerio_publico: ministerioPublico || undefined,
        total_sujetos: result.totalSujetos || sujetos.length,
      },
      provider: 'samai',
      latencyMs: Date.now() - startTime,
      httpStatus: 200,
    };
  } catch (err) {
    console.error('[sync-by-work-item] SAMAI fetch error:', err);
    return { 
      ok: false, 
      actuaciones: [], 
      error: err instanceof Error ? err.message : 'SAMAI fetch failed', 
      provider: 'samai',
      latencyMs: Date.now() - startTime,
      httpStatus: 0,
    };
  }
}

// ============= PROVIDER: TUTELAS API =============

async function fetchFromTutelasApi(tutelaCode: string): Promise<FetchResult> {
  const startTime = Date.now();
  const baseUrl = Deno.env.get('TUTELAS_BASE_URL');
  
  // Get API key with provider-specific selection
  const apiKeyInfo = await getApiKeyForProvider('tutelas');

  if (!baseUrl) {
    console.log('[sync-by-work-item] TUTELAS_BASE_URL not configured');
    return { 
      ok: false, 
      actuaciones: [], 
      error: 'TUTELAS API not configured (missing TUTELAS_BASE_URL). Contact administrator.', 
      provider: 'tutelas-api',
      latencyMs: Date.now() - startTime,
    };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKeyInfo.value) {
      headers['x-api-key'] = apiKeyInfo.value;
    }

    console.log(`[sync-by-work-item] Calling TUTELAS: ${baseUrl}/expediente/${tutelaCode}`);
    
    const response = await fetch(`${baseUrl}/expediente/${tutelaCode}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[sync-by-work-item] TUTELAS: Record not found (404) for ${tutelaCode}. Auto-triggering scraping...`);
        
        // Attempt to trigger scraping job via /search (POST)
        const scrapingResult = await triggerTutelasScrapingJob(tutelaCode, baseUrl, apiKeyInfo);
        
        if (scrapingResult.ok && scrapingResult.jobId) {
          console.log(`[sync-by-work-item] TUTELAS: Scraping job triggered successfully: jobId=${scrapingResult.jobId}`);
          return { 
            ok: false, 
            actuaciones: [], 
            error: 'RECORD_NOT_FOUND', 
            provider: 'tutelas-api',
            isEmpty: true,
            latencyMs: Date.now() - startTime,
            httpStatus: 404,
            scrapingInitiated: true,
            scrapingJobId: scrapingResult.jobId,
            scrapingPollUrl: scrapingResult.pollUrl,
            scrapingMessage: `Tutela not found in cache. Scraping initiated (job ${scrapingResult.jobId}). Retry sync in 30-60 seconds.`,
          };
        } else {
          console.log(`[sync-by-work-item] TUTELAS: Scraping trigger failed: ${scrapingResult.error}`);
          return { 
            ok: false, 
            actuaciones: [], 
            error: 'Tutela not found', 
            provider: 'tutelas-api',
            isEmpty: true,
            latencyMs: Date.now() - startTime,
            httpStatus: 404,
          };
        }
      }
      return { 
        ok: false, 
        actuaciones: [], 
        error: `HTTP ${response.status}`, 
        provider: 'tutelas-api',
        latencyMs: Date.now() - startTime,
        httpStatus: response.status,
      };
    }

    const data = await response.json();
    
    const actuaciones = data.actuaciones || [];
    
    console.log(`[sync-by-work-item] TUTELAS: Found ${actuaciones.length} actuaciones for ${tutelaCode}`);
    
    return {
      ok: actuaciones.length > 0 || !!data.expediente_url,
      actuaciones: actuaciones.map((act: Record<string, unknown>) => ({
        fecha: String(act.fecha || ''),
        actuacion: String(act.actuacion || act.descripcion || ''),
        anotacion: String(act.anotacion || ''),
      })),
      expedienteUrl: data.expediente_url,
      caseMetadata: {
        despacho: data.despacho,
        demandante: data.accionante,
        demandado: data.accionado,
        tipo_proceso: 'TUTELA',
      },
      provider: 'tutelas-api',
      latencyMs: Date.now() - startTime,
      httpStatus: 200,
    };
  } catch (err) {
    console.error('[sync-by-work-item] TUTELAS fetch error:', err);
    return { 
      ok: false, 
      actuaciones: [], 
      error: err instanceof Error ? err.message : 'TUTELAS API failed', 
      provider: 'tutelas-api',
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============= PROVIDER: PUBLICACIONES (for PENAL_906) =============

interface PublicacionesResult {
  ok: boolean;
  publicacionesCount: number;
  insertedCount: number;
  skippedCount: number;
  isEmpty?: boolean;
  error?: string;
  latencyMs?: number;
  // Auto-scraping fields
  scrapingInitiated?: boolean;
  scrapingJobId?: string;
  scrapingPollUrl?: string;
  scrapingMessage?: string;
}

function generatePublicacionFingerprint(
  workItemId: string,
  title: string,
  publishedAt: string | null
): string {
  const normalized = `pub|${workItemId}|${title.toLowerCase().trim().slice(0, 100)}|${publishedAt || 'no-date'}`;
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `pub_${workItemId.slice(0, 8)}_${Math.abs(hash).toString(16)}`;
}

async function fetchFromPublicaciones(
  radicado: string,
  workItemId: string,
  ownerId: string,
  organizationId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient: any
): Promise<PublicacionesResult> {
  const startTime = Date.now();
  const baseUrl = Deno.env.get('PUBLICACIONES_BASE_URL');
  
  // Get API key with provider-specific selection
  const apiKeyInfo = await getApiKeyForProvider('publicaciones');

  if (!baseUrl) {
    console.log('[sync-by-work-item] PUBLICACIONES_BASE_URL not configured');
    return { 
      ok: false, 
      publicacionesCount: 0,
      insertedCount: 0,
      skippedCount: 0,
      error: 'PUBLICACIONES API not configured (missing PUBLICACIONES_BASE_URL).', 
      latencyMs: Date.now() - startTime,
    };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKeyInfo.value) {
      headers['x-api-key'] = apiKeyInfo.value;
    }

    console.log(`[sync-by-work-item] PENAL_906: Calling PUBLICACIONES: ${baseUrl}/publicaciones/${radicado}`);
    
    const response = await fetch(`${baseUrl}/publicaciones/${radicado}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[sync-by-work-item] PUBLICACIONES: No publications found (404) for ${radicado}. Auto-triggering scraping...`);
        
        // Attempt to trigger scraping job via /buscar
        const scrapingResult = await triggerPublicacionesScrapingJob(radicado, baseUrl, apiKeyInfo);
        
        if (scrapingResult.ok && scrapingResult.jobId) {
          console.log(`[sync-by-work-item] PUBLICACIONES: Scraping job triggered successfully: jobId=${scrapingResult.jobId}`);
          return { 
            ok: false, // Still failed to get data, but scraping initiated
            publicacionesCount: 0,
            insertedCount: 0,
            skippedCount: 0,
            error: 'RECORD_NOT_FOUND', 
            isEmpty: true,
            latencyMs: Date.now() - startTime,
            scrapingInitiated: true,
            scrapingJobId: scrapingResult.jobId,
            scrapingPollUrl: scrapingResult.pollUrl,
            scrapingMessage: `No publications found. Scraping initiated (job ${scrapingResult.jobId}). Retry sync in 30-60 seconds.`,
          };
        } else {
          console.log(`[sync-by-work-item] PUBLICACIONES: Scraping trigger failed: ${scrapingResult.error}`);
          return { 
            ok: true, // 404 is ok - just no data
            publicacionesCount: 0,
            insertedCount: 0,
            skippedCount: 0,
            error: 'No publications found', 
            isEmpty: true,
            latencyMs: Date.now() - startTime,
          };
        }
      }
      const errorText = await response.text();
      console.log(`[sync-by-work-item] PUBLICACIONES HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      return { 
        ok: false, 
        publicacionesCount: 0,
        insertedCount: 0,
        skippedCount: 0,
        error: `HTTP ${response.status}`, 
        latencyMs: Date.now() - startTime,
      };
    }

    const data = await response.json();
    
    // Extract publications array
    const publications = data.publicaciones || data.publications || [];
    
    if (publications.length === 0) {
      console.log(`[sync-by-work-item] PUBLICACIONES: No publications for ${radicado}`);
      return { 
        ok: true,
        publicacionesCount: 0,
        insertedCount: 0,
        skippedCount: 0,
        error: 'No publications found', 
        isEmpty: true,
        latencyMs: Date.now() - startTime,
      };
    }

    console.log(`[sync-by-work-item] PUBLICACIONES: Found ${publications.length} publications for ${radicado}`);
    
    // Ingest publications with deduplication
    let insertedCount = 0;
    let skippedCount = 0;

    for (const pub of publications) {
      const title = String(pub.titulo || pub.title || '');
      const annotation = String(pub.anotacion || pub.annotation || '');
      const pdfUrl = pub.pdf_url || pub.url || null;
      const publishedAt = pub.fecha_publicacion || pub.published_at || pub.fecha || null;
      
      const fingerprint = generatePublicacionFingerprint(workItemId, title, publishedAt);

      // Check for existing record using fingerprint
      const { data: existing } = await supabaseClient
        .from('work_item_publicaciones')
        .select('id')
        .eq('work_item_id', workItemId)
        .eq('hash_fingerprint', fingerprint)
        .maybeSingle();

      if (existing) {
        skippedCount++;
        continue;
      }

      // Insert new publication
      const { error: insertError } = await supabaseClient
        .from('work_item_publicaciones')
        .insert({
          work_item_id: workItemId,
          owner_id: ownerId,
          organization_id: organizationId,
          title,
          annotation,
          pdf_url: pdfUrl,
          published_at: publishedAt ? parseColombianDate(publishedAt) : null,
          hash_fingerprint: fingerprint,
          source: 'publicaciones-api',
        });

      if (insertError) {
        // Check if it's a duplicate error (can happen in race conditions)
        if (insertError.message?.includes('duplicate') || insertError.code === '23505') {
          skippedCount++;
        } else {
          console.error(`[sync-by-work-item] PUBLICACIONES insert error:`, insertError);
        }
      } else {
        insertedCount++;
      }
    }

    return {
      ok: true,
      publicacionesCount: publications.length,
      insertedCount,
      skippedCount,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    console.error('[sync-by-work-item] PUBLICACIONES fetch error:', err);
    return { 
      ok: false, 
      publicacionesCount: 0,
      insertedCount: 0,
      skippedCount: 0,
      error: err instanceof Error ? err.message : 'PUBLICACIONES API failed', 
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Get trace ID from header or generate new one
  const traceId = req.headers.get('X-Trace-Id') || crypto.randomUUID();
  const syncStartTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('MISSING_ENV', 'Missing Supabase environment variables', 500, traceId);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      await logTrace(supabase, {
        trace_id: traceId,
        step: 'AUTHZ_FAILED',
        success: false,
        error_code: 'UNAUTHORIZED',
        message: 'Missing Authorization header',
      });
      return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401, traceId);
    }

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '');
    
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: authError } = await anonClient.auth.getClaims(token);
    
    if (authError || !claims?.claims?.sub) {
      await logTrace(supabase, {
        trace_id: traceId,
        step: 'AUTHZ_FAILED',
        success: false,
        error_code: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
      });
      return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401, traceId);
    }

    const userId = claims.claims.sub as string;

    // Parse request
    let payload: SyncRequest;
    try {
      payload = await req.json();
    } catch {
      return errorResponse('INVALID_JSON', 'Could not parse request body', 400, traceId);
    }

    const { work_item_id } = payload;
    
    if (!work_item_id) {
      return errorResponse('MISSING_WORK_ITEM_ID', 'work_item_id is required', 400, traceId);
    }

    console.log(`[sync-by-work-item] Starting sync for work_item_id=${work_item_id}, user=${userId}, trace_id=${traceId}`);

    // Log sync start
    await logTrace(supabase, {
      trace_id: traceId,
      work_item_id,
      step: 'SYNC_START',
      success: true,
      message: `Starting sync for work_item_id=${work_item_id}`,
      meta: { user_id: userId.slice(0, 8) + '...' },
    });

    // Fetch work item
    const { data: workItem, error: workItemError } = await supabase
      .from('work_items')
      .select('id, owner_id, organization_id, workflow_type, radicado, tutela_code, scrape_status, last_crawled_at, expediente_url')
      .eq('id', work_item_id)
      .maybeSingle();

    if (workItemError || !workItem) {
      console.log(`[sync-by-work-item] Work item not found: ${work_item_id}`);
      await logTrace(supabase, {
        trace_id: traceId,
        work_item_id,
        step: 'WORK_ITEM_NOT_FOUND',
        success: false,
        error_code: 'WORK_ITEM_NOT_FOUND',
        message: 'Work item not found or access denied',
      });
      return errorResponse('WORK_ITEM_NOT_FOUND', 'Work item not found or access denied', 404, traceId);
    }

    // Log work item loaded
    await logTrace(supabase, {
      trace_id: traceId,
      work_item_id,
      organization_id: workItem.organization_id,
      workflow_type: workItem.workflow_type,
      step: 'WORK_ITEM_LOADED',
      success: true,
      message: `Loaded work item: ${workItem.workflow_type}`,
      meta: {
        has_radicado: !!workItem.radicado,
        has_tutela_code: !!workItem.tutela_code,
        radicado_preview: workItem.radicado ? workItem.radicado.slice(0, 10) + '...' : null,
      },
    });

    // ============= MULTI-TENANT SECURITY: Verify user is member of org =============
    const { data: membership, error: membershipError } = await supabase
      .from('organization_memberships')
      .select('id, role')
      .eq('organization_id', workItem.organization_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (membershipError || !membership) {
      console.log(`[sync-by-work-item] ACCESS DENIED: User ${userId} is not member of org ${workItem.organization_id}`);
      return errorResponse(
        'ACCESS_DENIED', 
        'You do not have permission to sync this work item. You must be a member of the organization.', 
        403
      );
    }

    console.log(`[sync-by-work-item] Access verified: user ${userId} has role ${membership.role} in org ${workItem.organization_id}`);

    // Determine provider order based on workflow_type
    const providerOrder = getProviderOrder(workItem.workflow_type);
    console.log(`[sync-by-work-item] Workflow ${workItem.workflow_type}: primary=${providerOrder.primary}, fallback=${providerOrder.fallback || 'none'}, fallbackEnabled=${providerOrder.fallbackEnabled}`);

    const result: SyncResult = {
      ok: false,
      work_item_id,
      workflow_type: workItem.workflow_type,
      inserted_count: 0,
      skipped_count: 0,
      latest_event_date: null,
      provider_used: null,
      provider_attempts: [],
      provider_order_reason: `workflow_type=${workItem.workflow_type}`,
      warnings: [],
      errors: [],
    };

    // ============= RESOLVE IDENTIFIER BASED ON WORKFLOW =============
    let fetchResult: FetchResult | null = null;

    if (workItem.workflow_type === 'TUTELA') {
      // TUTELA workflow: TUTELAS API primary, CPNU fallback
      if (!workItem.tutela_code || !isValidTutelaCode(workItem.tutela_code)) {
        // If no tutela_code, try radicado via CPNU
        if (workItem.radicado && isValidRadicado(workItem.radicado)) {
          console.log(`[sync-by-work-item] TUTELA workflow without tutela_code, using radicado via CPNU`);
          const normalizedRadicado = normalizeRadicado(workItem.radicado);
          fetchResult = await fetchFromCpnu(normalizedRadicado);
          result.provider_attempts.push({
            provider: 'cpnu',
            status: fetchResult.ok ? 'success' : (fetchResult.isEmpty ? 'not_found' : 'error'),
            latencyMs: fetchResult.latencyMs || 0,
            message: 'Used CPNU (no tutela_code available)',
            actuacionesCount: fetchResult.actuaciones.length,
          });
          result.provider_order_reason = 'tutela_no_code_cpnu_fallback';
        } else {
          return errorResponse(
            'MISSING_IDENTIFIER',
            'TUTELA workflow requires a valid tutela_code (format: T + 6-10 digits, e.g., T11728622) or a 23-digit radicado. Please edit the work item to add one.',
            400
          );
        }
      } else {
        console.log(`[sync-by-work-item] TUTELA workflow: using tutela_code=${workItem.tutela_code}`);
        fetchResult = await fetchFromTutelasApi(workItem.tutela_code);
        
        result.provider_attempts.push({
          provider: 'tutelas-api',
          status: fetchResult.ok ? 'success' : (fetchResult.isEmpty ? 'not_found' : 'error'),
          latencyMs: fetchResult.latencyMs || 0,
          message: fetchResult.error,
          actuacionesCount: fetchResult.actuaciones.length,
        });
        
        // ============= CHECK IF SCRAPING WAS AUTO-INITIATED BY TUTELAS =============
        // If scraping was initiated, DO NOT attempt fallback - return 202 immediately
        if (fetchResult.scrapingInitiated && fetchResult.scrapingJobId) {
          console.log(`[sync-by-work-item] TUTELAS: Auto-scraping initiated, skipping CPNU fallback`);
          
          result.ok = false;
          result.provider_used = 'tutelas-api';
          result.scraping_initiated = true;
          result.scraping_job_id = fetchResult.scrapingJobId;
          result.scraping_poll_url = fetchResult.scrapingPollUrl;
          result.scraping_provider = 'tutelas-api';
          result.scraping_message = fetchResult.scrapingMessage || 
            `Tutela not found in cache. Scraping initiated (job ${fetchResult.scrapingJobId}). Retry sync in 30-60 seconds.`;
          
          // Log SCRAPING_INITIATED trace step
          await logTrace(supabase, {
            trace_id: traceId,
            work_item_id,
            organization_id: workItem.organization_id,
            workflow_type: workItem.workflow_type,
            step: 'SCRAPING_INITIATED',
            provider: 'tutelas-api',
            http_status: null,
            latency_ms: fetchResult.latencyMs || null,
            success: true,
            error_code: null,
            message: `Scraping job created: ${fetchResult.scrapingJobId}`,
            meta: {
              job_id: fetchResult.scrapingJobId,
              poll_url: fetchResult.scrapingPollUrl,
              tutela_code_preview: workItem.tutela_code?.slice(0, 6) + '...',
            },
          });
          
          // Update work_item with SCRAPING status and metadata
          await supabase
            .from('work_items')
            .update({
              scrape_status: 'IN_PROGRESS',
              scrape_provider: 'tutelas-api',
              scrape_job_id: fetchResult.scrapingJobId,
              scrape_poll_url: fetchResult.scrapingPollUrl,
              last_scrape_initiated_at: new Date().toISOString(),
              last_checked_at: new Date().toISOString(),
            })
            .eq('id', work_item_id);
          
          result.trace_id = traceId;
          return jsonResponse(result, 202);
        }
        
        // CPNU fallback for TUTELA if TUTELAS API returns empty/not-found (no scraping initiated)
        if (!fetchResult.ok && providerOrder.fallbackEnabled && fetchResult.isEmpty) {
          console.log(`[sync-by-work-item] TUTELAS API empty (no scraping), trying CPNU fallback`);
          result.warnings.push(`TUTELAS API (primary): ${fetchResult.error || 'Not found'}`);
          
          // Try CPNU using radicado if available
          if (workItem.radicado && isValidRadicado(workItem.radicado)) {
            const normalizedRadicado = normalizeRadicado(workItem.radicado);
            const cpnuResult = await fetchFromCpnu(normalizedRadicado);
            
            result.provider_attempts.push({
              provider: 'cpnu',
              status: cpnuResult.ok ? 'success' : (cpnuResult.isEmpty ? 'not_found' : 'error'),
              latencyMs: cpnuResult.latencyMs || 0,
              message: cpnuResult.error,
              actuacionesCount: cpnuResult.actuaciones.length,
            });
            
            if (cpnuResult.ok) {
              fetchResult = cpnuResult;
              result.provider_order_reason = 'tutela_tutelas_failed_cpnu_fallback';
            } else {
              result.warnings.push(`CPNU fallback: ${cpnuResult.error}`);
            }
          } else {
            result.provider_attempts.push({
              provider: 'cpnu',
              status: 'skipped',
              latencyMs: 0,
              message: 'No valid radicado for CPNU fallback',
            });
          }
        }
      }
      
    } else if (workItem.workflow_type === 'PENAL_906') {
      // ============= PENAL_906: PUBLICACIONES PRIMARY =============
      // For PENAL_906, Publicaciones Procesales is the PRIMARY sync source
      // because penal updates frequently surface via published PDFs/annotations
      
      if (!workItem.radicado || !isValidRadicado(workItem.radicado)) {
        return errorResponse(
          'MISSING_RADICADO',
          'PENAL_906 workflow requires a valid radicado (23 digits). Please edit the work item to add it.',
          400
        );
      }
      
      const normalizedRadicado = normalizeRadicado(workItem.radicado);
      console.log(`[sync-by-work-item] PENAL_906: Calling PUBLICACIONES as PRIMARY provider (radicado=${normalizedRadicado})`);
      
      // Call sync-publicaciones-by-work-item internally via the Publicaciones API
      // For now, we attempt to fetch Publicaciones directly here
      const publicacionesResult = await fetchFromPublicaciones(normalizedRadicado, workItem.id, workItem.owner_id, workItem.organization_id, supabase);
      
      result.provider_attempts.push({
        provider: 'publicaciones',
        status: publicacionesResult.ok ? 'success' : (publicacionesResult.isEmpty ? 'not_found' : 'error'),
        latencyMs: publicacionesResult.latencyMs || 0,
        message: publicacionesResult.error || (publicacionesResult.ok ? `Ingested ${publicacionesResult.insertedCount || 0} publications` : undefined),
        actuacionesCount: publicacionesResult.publicacionesCount || 0,
      });
      
      result.provider_order_reason = 'penal_906_publicaciones_primary';
      
      // For PENAL_906, check if scraping was auto-initiated
      if (publicacionesResult.scrapingInitiated && publicacionesResult.scrapingJobId) {
        console.log(`[sync-by-work-item] PUBLICACIONES: Auto-scraping initiated: jobId=${publicacionesResult.scrapingJobId}`);
        
        result.ok = false;
        result.provider_used = 'publicaciones';
        result.scraping_initiated = true;
        result.scraping_job_id = publicacionesResult.scrapingJobId;
        result.scraping_poll_url = publicacionesResult.scrapingPollUrl;
        result.scraping_provider = 'publicaciones';
        result.scraping_message = publicacionesResult.scrapingMessage || 
          `No publications found. Scraping initiated (job ${publicacionesResult.scrapingJobId}). Retry sync in 30-60 seconds.`;
        
        // Log SCRAPING_INITIATED trace step
        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'SCRAPING_INITIATED',
          provider: 'publicaciones',
          http_status: null,
          latency_ms: null,
          success: true,
          error_code: null,
          message: `Scraping job created: ${publicacionesResult.scrapingJobId}`,
          meta: {
            job_id: publicacionesResult.scrapingJobId,
            poll_url: publicacionesResult.scrapingPollUrl,
            radicado_preview: workItem.radicado?.slice(0, 10) + '...',
          },
        });
        
        // Update work_item with SCRAPING status (not FAILED)
        await supabase
          .from('work_items')
          .update({
            scrape_status: 'IN_PROGRESS',
            last_checked_at: new Date().toISOString(),
          })
          .eq('id', work_item_id);
        
        result.trace_id = traceId;
        return jsonResponse(result, 202);
      }
      
      // For PENAL_906, Publicaciones is the primary source
      // We report success based on Publicaciones, not CPNU/SAMAI
      if (publicacionesResult.ok) {
        result.ok = true;
        result.provider_used = 'publicaciones';
        result.inserted_count = publicacionesResult.insertedCount || 0;
        result.skipped_count = publicacionesResult.skippedCount || 0;
        
        // Update work_item metadata
        await supabase
          .from('work_items')
          .update({
            scrape_status: 'SUCCESS',
            last_crawled_at: new Date().toISOString(),
            last_checked_at: new Date().toISOString(),
          })
          .eq('id', work_item_id);
        
        return jsonResponse(result);
      }
      
      // Publicaciones returned empty/error - optionally try CPNU if fallback enabled
      if (providerOrder.fallbackEnabled && providerOrder.fallback === 'cpnu') {
        console.log(`[sync-by-work-item] PENAL_906: Publicaciones empty, trying CPNU fallback`);
        result.warnings.push(`Publicaciones (primary): ${publicacionesResult.error || 'No publications found'}`);
        
        fetchResult = await fetchFromCpnu(normalizedRadicado);
        
        result.provider_attempts.push({
          provider: 'cpnu',
          status: fetchResult.ok ? 'success' : (fetchResult.isEmpty ? 'not_found' : 'error'),
          latencyMs: fetchResult.latencyMs || 0,
          message: fetchResult.error,
          actuacionesCount: fetchResult.actuaciones.length,
        });
        
        if (!fetchResult.ok) {
          result.warnings.push(`CPNU fallback: ${fetchResult.error}`);
        } else {
          result.provider_order_reason = 'penal_906_publicaciones_empty_cpnu_fallback';
        }
      } else {
        // CPNU fallback disabled for PENAL_906 by default
        result.provider_attempts.push({
          provider: 'cpnu',
          status: 'skipped',
          latencyMs: 0,
          message: 'CPNU enrichment disabled for PENAL_906 (Publicaciones is primary)',
        });
        
        // Publicaciones was the only attempt and it failed/empty
        result.ok = true; // Still "ok" because we successfully queried
        result.provider_used = 'publicaciones';
        result.warnings.push(publicacionesResult.error || 'No publications found');
        
        await supabase
          .from('work_items')
          .update({
            scrape_status: publicacionesResult.isEmpty ? 'SUCCESS' : 'FAILED',
            last_checked_at: new Date().toISOString(),
          })
          .eq('id', work_item_id);
        
        return jsonResponse(result);
      }
      
    } else {
      // CGP/LABORAL/CPACA: require radicado (23 digits)
      if (!workItem.radicado || !isValidRadicado(workItem.radicado)) {
        return errorResponse(
          'MISSING_RADICADO',
          'This workflow requires a valid radicado (23 digits). Please edit the work item to add it.',
          400
        );
      }
      
      const normalizedRadicado = normalizeRadicado(workItem.radicado);
      console.log(`[sync-by-work-item] Radicado workflow (${workItem.workflow_type}): using radicado=${normalizedRadicado}, provider_order=${providerOrder.primary}→${providerOrder.fallback || 'none'}`);
      
      // ============= WORKFLOW-AWARE PROVIDER SELECTION =============
      if (providerOrder.primary === 'samai') {
        // CPACA: SAMAI primary
        console.log(`[sync-by-work-item] CPACA: Calling SAMAI as primary provider`);
        
        // Log PROVIDER_REQUEST trace step with request path (no host/secrets)
        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'PROVIDER_REQUEST_START',
          provider: 'samai',
          success: true,
          message: `SAMAI request: /proceso/${normalizedRadicado}`,
          meta: { 
            request_path: `/proceso/${normalizedRadicado}`,
            request_method: 'GET',
            is_primary: true,
          },
        });
        
        fetchResult = await fetchFromSamai(normalizedRadicado);
        
        // Log PROVIDER_RESPONSE trace step
        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'PROVIDER_RESPONSE_RECEIVED',
          provider: 'samai',
          http_status: fetchResult.httpStatus || (fetchResult.ok ? 200 : 404),
          latency_ms: fetchResult.latencyMs || 0,
          success: fetchResult.ok,
          error_code: fetchResult.ok ? null : (fetchResult.isEmpty ? 'PROVIDER_404' : 'PROVIDER_ERROR'),
          message: fetchResult.error || (fetchResult.ok ? `Found ${fetchResult.actuaciones.length} actuaciones` : 'Not found'),
          meta: { 
            actuaciones_count: fetchResult.actuaciones.length,
            is_empty: fetchResult.isEmpty || false,
            request_path: `/proceso/${normalizedRadicado}`,
          },
        });
        
        result.provider_attempts.push({
          provider: 'samai',
          status: fetchResult.ok ? 'success' : (fetchResult.isEmpty ? 'not_found' : 'error'),
          latencyMs: fetchResult.latencyMs || 0,
          message: fetchResult.error,
          actuacionesCount: fetchResult.actuaciones.length,
        });
        
        // ============= CHECK IF SCRAPING WAS AUTO-INITIATED BY SAMAI =============
        // If scraping was initiated, DO NOT attempt CPNU fallback - return 202 immediately
        if (fetchResult.scrapingInitiated && fetchResult.scrapingJobId) {
          console.log(`[sync-by-work-item] SAMAI: Auto-scraping initiated, skipping CPNU fallback`);
          
          result.ok = false;
          result.provider_used = 'samai';
          result.scraping_initiated = true;
          result.scraping_job_id = fetchResult.scrapingJobId;
          result.scraping_poll_url = fetchResult.scrapingPollUrl;
          result.scraping_provider = 'samai';
          result.scraping_message = fetchResult.scrapingMessage || 
            `Record not found in SAMAI cache. Scraping initiated (job ${fetchResult.scrapingJobId}). Retry sync in 30-60 seconds.`;
          
          // Log SCRAPING_INITIATED trace step
          await logTrace(supabase, {
            trace_id: traceId,
            work_item_id,
            organization_id: workItem.organization_id,
            workflow_type: workItem.workflow_type,
            step: 'SCRAPING_INITIATED',
            provider: 'samai',
            http_status: null,
            latency_ms: fetchResult.latencyMs || null,
            success: true,
            error_code: null,
            message: `Scraping job created: ${fetchResult.scrapingJobId}`,
            meta: {
              job_id: fetchResult.scrapingJobId,
              poll_url: fetchResult.scrapingPollUrl,
              radicado_preview: workItem.radicado?.slice(0, 10) + '...',
            },
          });
          
          // Update work_item with SCRAPING status and metadata
          await supabase
            .from('work_items')
            .update({
              scrape_status: 'IN_PROGRESS',
              scrape_provider: 'samai',
              scrape_job_id: fetchResult.scrapingJobId,
              scrape_poll_url: fetchResult.scrapingPollUrl,
              last_scrape_initiated_at: new Date().toISOString(),
              last_checked_at: new Date().toISOString(),
            })
            .eq('id', work_item_id);
          
          result.trace_id = traceId;
          return jsonResponse(result, 202);
        }
        
        // CPNU fallback for CPACA (only if explicitly enabled and NO scraping was initiated)
        if (!fetchResult.ok && providerOrder.fallbackEnabled && providerOrder.fallback === 'cpnu') {
          console.log(`[sync-by-work-item] SAMAI failed/empty (no scraping), trying CPNU fallback`);
          result.warnings.push(`SAMAI (primary): ${fetchResult.error}`);
          
          const cpnuResult = await fetchFromCpnu(normalizedRadicado);
          
          result.provider_attempts.push({
            provider: 'cpnu',
            status: cpnuResult.ok ? 'success' : (cpnuResult.isEmpty ? 'not_found' : 'error'),
            latencyMs: cpnuResult.latencyMs || 0,
            message: cpnuResult.error,
            actuacionesCount: cpnuResult.actuaciones.length,
          });
          
          if (cpnuResult.ok) {
            fetchResult = cpnuResult;
            result.provider_order_reason = 'cpaca_samai_failed_cpnu_fallback';
          } else {
            result.warnings.push(`CPNU fallback: ${cpnuResult.error}`);
          }
        } else if (!fetchResult.ok && !providerOrder.fallbackEnabled && !fetchResult.scrapingInitiated) {
          // Log that CPNU fallback is disabled for CPACA (only if no scraping was triggered)
          result.provider_attempts.push({
            provider: 'cpnu',
            status: 'skipped',
            latencyMs: 0,
            message: 'CPNU fallback disabled for CPACA workflow',
          });
        }
        
      } else {
        // ============= CGP/LABORAL: CPNU PRIMARY, NO FALLBACK TO SAMAI =============
        // Civil, labor, and family processes in CPNU are NOT in SAMAI
        // Attempting SAMAI fallback is technically useless and generates noise
        console.log(`[sync-by-work-item] ${workItem.workflow_type}: Calling CPNU as PRIMARY provider (NO SAMAI fallback)`);
        
        // Log PROVIDER_REQUEST trace step
        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'PROVIDER_REQUEST_START',
          provider: 'cpnu',
          success: true,
          message: `CPNU request: /snapshot?numero_radicacion=${normalizedRadicado}`,
          meta: { 
            request_path: `/snapshot?numero_radicacion=${normalizedRadicado}`,
            request_method: 'GET',
            is_primary: true,
            fallback_enabled: false, // Explicitly NO fallback for CGP/LABORAL
          },
        });
        
        fetchResult = await fetchFromCpnu(normalizedRadicado);
        
        // Log PROVIDER_RESPONSE trace step
        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'PROVIDER_RESPONSE_RECEIVED',
          provider: 'cpnu',
          http_status: fetchResult.httpStatus || (fetchResult.ok ? 200 : 404),
          latency_ms: fetchResult.latencyMs || 0,
          success: fetchResult.ok,
          error_code: fetchResult.ok ? null : (fetchResult.isEmpty ? 'PROVIDER_404' : 'PROVIDER_ERROR'),
          message: fetchResult.error || (fetchResult.ok ? `Found ${fetchResult.actuaciones.length} actuaciones` : 'Not found'),
          meta: { 
            actuaciones_count: fetchResult.actuaciones.length,
            is_empty: fetchResult.isEmpty || false,
            request_path: `/snapshot?numero_radicacion=${normalizedRadicado}`,
          },
        });
        
        result.provider_attempts.push({
          provider: 'cpnu',
          status: fetchResult.ok ? 'success' : (fetchResult.isEmpty ? 'not_found' : 'error'),
          latencyMs: fetchResult.latencyMs || 0,
          message: fetchResult.error,
          actuacionesCount: fetchResult.actuaciones.length,
        });
        
        // ============= CHECK IF SCRAPING WAS AUTO-INITIATED BY CPNU =============
        // If scraping was initiated, return 202 immediately (NO fallback)
        if (fetchResult.scrapingInitiated && fetchResult.scrapingJobId) {
          console.log(`[sync-by-work-item] CPNU: Auto-scraping initiated. Returning 202 (NO SAMAI fallback for ${workItem.workflow_type})`);
          
          result.ok = false;
          result.provider_used = 'cpnu';
          result.scraping_initiated = true;
          result.scraping_job_id = fetchResult.scrapingJobId;
          result.scraping_poll_url = fetchResult.scrapingPollUrl;
          result.scraping_provider = 'cpnu';
          result.scraping_message = fetchResult.scrapingMessage || 
            `Record not found in CPNU cache. Scraping initiated (job ${fetchResult.scrapingJobId}). Retry sync in 30-60 seconds.`;
          
          // Log SCRAPING_INITIATED trace step
          await logTrace(supabase, {
            trace_id: traceId,
            work_item_id,
            organization_id: workItem.organization_id,
            workflow_type: workItem.workflow_type,
            step: 'SCRAPING_INITIATED',
            provider: 'cpnu',
            http_status: null,
            latency_ms: fetchResult.latencyMs || null,
            success: true,
            error_code: null,
            message: `Scraping job created: ${fetchResult.scrapingJobId}`,
            meta: {
              job_id: fetchResult.scrapingJobId,
              poll_url: fetchResult.scrapingPollUrl,
              radicado_preview: workItem.radicado?.slice(0, 10) + '...',
              workflow_type: workItem.workflow_type,
              fallback_attempted: false, // Explicit: NO SAMAI fallback
            },
          });
          
          // Update work_item with SCRAPING status and metadata
          await supabase
            .from('work_items')
            .update({
              scrape_status: 'IN_PROGRESS',
              scrape_provider: 'cpnu',
              scrape_job_id: fetchResult.scrapingJobId,
              scrape_poll_url: fetchResult.scrapingPollUrl,
              last_scrape_initiated_at: new Date().toISOString(),
              last_checked_at: new Date().toISOString(),
            })
            .eq('id', work_item_id);
          
          result.trace_id = traceId;
          return jsonResponse(result, 202);
        }
        
        // ============= CGP/LABORAL: NO SAMAI FALLBACK =============
        // If CPNU fails with an error (not 404/scraping), return 502 immediately
        if (!fetchResult.ok && !fetchResult.scrapingInitiated) {
          // Check if it's an empty result (404) vs actual error
          if (fetchResult.isEmpty) {
            // 404 without scraping initiated - this shouldn't happen normally
            // (auto-scraping should have triggered), but handle gracefully
            console.log(`[sync-by-work-item] CPNU: Record not found (NO SAMAI fallback for ${workItem.workflow_type})`);
            result.warnings.push(`CPNU: ${fetchResult.error || 'Not found'}`);
            // Log that SAMAI fallback is NOT attempted
            result.provider_attempts.push({
              provider: 'samai',
              status: 'skipped',
              latencyMs: 0,
              message: `SAMAI fallback disabled for ${workItem.workflow_type} - civil/labor processes are NOT in SAMAI`,
            });
          } else {
            // Actual CPNU error (timeout, 5xx, network error)
            console.error(`[sync-by-work-item] ❌ CPNU failed for ${workItem.workflow_type} (NO SAMAI fallback)`, {
              work_item_id,
              workflow_type: workItem.workflow_type,
              radicado: workItem.radicado?.slice(0, 10) + '...',
              error_message: fetchResult.error,
              http_status: fetchResult.httpStatus,
            });
            
            // Log SYNC_FAILED with explicit no-fallback note
            await logTrace(supabase, {
              trace_id: traceId,
              work_item_id,
              organization_id: workItem.organization_id,
              workflow_type: workItem.workflow_type,
              step: 'SYNC_FAILED',
              provider: 'cpnu',
              http_status: fetchResult.httpStatus || null,
              latency_ms: fetchResult.latencyMs || null,
              success: false,
              error_code: 'CPNU_SYNC_FAILED',
              message: `CPNU failed: ${fetchResult.error}. NO fallback configured for ${workItem.workflow_type}.`,
              meta: {
                radicado_preview: workItem.radicado?.slice(0, 10) + '...',
                fallback_attempted: false,
                reason: 'CGP/LABORAL workflows use CPNU only - SAMAI does not have civil/labor cases',
              },
            });
            
            // Update work_item status to FAILED
            await supabase
              .from('work_items')
              .update({
                scrape_status: 'FAILED',
                last_checked_at: new Date().toISOString(),
              })
              .eq('id', work_item_id);
            
            // Return 502 with clear error message
            return jsonResponse({
              ok: false,
              code: 'CPNU_SYNC_FAILED',
              message: `CPNU provider failed and no fallback is configured for ${workItem.workflow_type}. Error: ${fetchResult.error}`,
              provider: 'cpnu',
              provider_attempts: result.provider_attempts,
              work_item_id,
              workflow_type: workItem.workflow_type,
              trace_id: traceId,
            }, 502);
          }
        }
      }
    }

    // Handle fetch failure - with enhanced diagnostics and auto-scraping
    if (!fetchResult || !fetchResult.ok) {
      const errorCode = fetchResult?.isEmpty ? 'PROVIDER_NOT_FOUND' : 'PROVIDER_ERROR';
      const providerUsed = fetchResult?.provider || providerOrder.primary;
      
      result.errors.push(fetchResult?.error || 'All providers failed to fetch data');
      result.code = errorCode;
      result.provider_used = providerUsed;
      
      // ============= CHECK IF SCRAPING WAS AUTO-INITIATED =============
      if (fetchResult?.scrapingInitiated && fetchResult.scrapingJobId) {
        console.log(`[sync-by-work-item] Auto-scraping initiated: jobId=${fetchResult.scrapingJobId}`);
        
        // Populate scraping fields in result
        result.scraping_initiated = true;
        result.scraping_job_id = fetchResult.scrapingJobId;
        result.scraping_poll_url = fetchResult.scrapingPollUrl;
        result.scraping_provider = providerUsed;
        result.scraping_message = fetchResult.scrapingMessage || 
          `Record not found in cache. Scraping initiated (job ${fetchResult.scrapingJobId}). Retry sync in 30-60 seconds.`;
        
        // Log SCRAPING_INITIATED trace step
        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'SCRAPING_INITIATED',
          provider: providerUsed,
          http_status: null,
          latency_ms: null,
          success: true,
          error_code: null,
          message: `Scraping job created: ${fetchResult.scrapingJobId}`,
          meta: {
            job_id: fetchResult.scrapingJobId,
            poll_url: fetchResult.scrapingPollUrl,
            radicado_preview: workItem.radicado?.slice(0, 10) + '...',
          },
        });
        
        // Update work_item with SCRAPING status and metadata
        await supabase
          .from('work_items')
          .update({
            scrape_status: 'IN_PROGRESS',
            scrape_provider: providerUsed,
            scrape_job_id: fetchResult.scrapingJobId,
            scrape_poll_url: fetchResult.scrapingPollUrl,
            last_scrape_initiated_at: new Date().toISOString(),
            last_checked_at: new Date().toISOString(),
          })
          .eq('id', work_item_id);
        
        // Return with scraping info - use 202 Accepted to indicate async processing
        result.ok = false; // Still "failed" to get data, but scraping is happening
        result.trace_id = traceId;
        return jsonResponse(result, 202);
      }
      
      // Log SYNC_FAILED trace step with diagnostics (no scraping)
      await logTrace(supabase, {
        trace_id: traceId,
        work_item_id,
        organization_id: workItem.organization_id,
        workflow_type: workItem.workflow_type,
        step: 'SYNC_FAILED',
        provider: providerUsed,
        http_status: fetchResult?.httpStatus || null,
        latency_ms: fetchResult?.latencyMs || null,
        success: false,
        error_code: errorCode,
        message: `${providerUsed.toUpperCase()}: ${fetchResult?.error || 'Provider failed'}`,
        meta: {
          radicado_preview: workItem.radicado?.slice(0, 10) + '...',
          provider_attempts: result.provider_attempts.length,
          request_path: `/snapshot?numero_radicacion=${normalizeRadicado(workItem.radicado || '')}`,
        },
      });
      
      // Update scrape status to FAILED
      await supabase
        .from('work_items')
        .update({
          scrape_status: 'FAILED',
          last_checked_at: new Date().toISOString(),
        })
        .eq('id', work_item_id);
      
      result.trace_id = traceId;
      return jsonResponse(result);
    }

    result.provider_used = fetchResult.provider;
    console.log(`[sync-by-work-item] Provider ${fetchResult.provider} returned ${fetchResult.actuaciones.length} actuaciones`);

    // Handle empty actuaciones (success but no data)
    if (fetchResult.actuaciones.length === 0) {
      result.ok = true;
      result.warnings.push('No actuaciones found in external source');
      
      await supabase
        .from('work_items')
        .update({
          scrape_status: 'SUCCESS',
          last_crawled_at: new Date().toISOString(),
          last_checked_at: new Date().toISOString(),
        })
        .eq('id', work_item_id);
      
      return jsonResponse(result);
    }

    // ============= INGEST ACTUACIONES WITH DEDUPLICATION =============
    let latestDate: string | null = null;

    for (const act of fetchResult.actuaciones) {
      const actDate = parseColombianDate(act.fecha);
      const fingerprint = generateFingerprint(work_item_id, act.fecha, act.actuacion);

      // Check for existing record using fingerprint
      const { data: existing } = await supabase
        .from('actuaciones')
        .select('id')
        .eq('work_item_id', work_item_id)
        .eq('hash_fingerprint', fingerprint)
        .maybeSingle();

      if (existing) {
        result.skipped_count++;
        continue;
      }

      // Insert new actuacion
      const { error: insertError } = await supabase
        .from('actuaciones')
        .insert({
          owner_id: workItem.owner_id,
          organization_id: workItem.organization_id,
          work_item_id,
          raw_text: act.actuacion,
          normalized_text: `${act.actuacion}${act.anotacion ? ' - ' + act.anotacion : ''}`,
          act_date: actDate,
          act_date_raw: act.fecha,
          source: fetchResult.provider,
          adapter_name: fetchResult.provider,
          hash_fingerprint: fingerprint,
        });

      if (insertError) {
        // Check if it's a duplicate error (can happen in race conditions)
        if (insertError.message?.includes('duplicate') || insertError.code === '23505') {
          result.skipped_count++;
        } else {
          console.error(`[sync-by-work-item] Insert error:`, insertError);
          result.errors.push(`Failed to insert actuacion: ${insertError.message}`);
        }
      } else {
        result.inserted_count++;
        if (actDate && (!latestDate || actDate > latestDate)) {
          latestDate = actDate;
        }
        
        // ============= DETECT SIGNIFICANT EVENTS & CREATE ALERTS =============
        const significantEvent = detectSignificantEvent(act.actuacion, act.anotacion || '');
        if (significantEvent) {
          // Use the event type in the fingerprint (not the whole object)
          const alertFingerprint = `alert_${work_item_id.slice(0, 8)}_${significantEvent.type}_${actDate || 'no-date'}`;
          
          // Check for existing alert with same fingerprint
          const { data: existingAlert } = await supabase
            .from('alert_instances')
            .select('id')
            .eq('entity_id', work_item_id)
            .eq('fingerprint', alertFingerprint)
            .maybeSingle();
          
          if (!existingAlert) {
            const { error: alertError } = await supabase
              .from('alert_instances')
              .insert({
                owner_id: workItem.owner_id,
                organization_id: workItem.organization_id,
                entity_id: work_item_id,
                entity_type: 'WORK_ITEM',
                severity: significantEvent.severity,
                title: significantEvent.title,
                message: `${act.actuacion}${act.anotacion ? ' - ' + act.anotacion : ''}`.slice(0, 500),
                status: 'PENDING', // Must be: PENDING, SENT, ACKNOWLEDGED, RESOLVED, CANCELLED, DISMISSED
                fingerprint: alertFingerprint,
                payload: {
                  event_type: significantEvent.type,
                  event_date: actDate,
                  provider: fetchResult.provider,
                },
              });
            
            if (alertError) {
              console.warn(`[sync-by-work-item] Failed to create alert for ${significantEvent.type}:`, alertError.message);
            } else {
              console.log(`[sync-by-work-item] Created alert for ${significantEvent.type}`);
            }
          }
        }
        
        // ============= STAGE INFERENCE =============
        const stageSuggestion = inferStageFromActuacion(
          workItem.workflow_type,
          act.actuacion,
          act.anotacion || ''
        );
        
        if (stageSuggestion && stageSuggestion.confidence >= 0.7) {
          const suggestionFingerprint = `stage_${work_item_id.slice(0, 8)}_${stageSuggestion.suggestedStage}`;
          
          // Check for existing pending suggestion
          const { data: existingSuggestion } = await supabase
            .from('work_item_stage_suggestions')
            .select('id')
            .eq('work_item_id', work_item_id)
            .eq('status', 'PENDING')
            .maybeSingle();
          
          if (!existingSuggestion) {
            const { error: suggestionError } = await supabase
              .from('work_item_stage_suggestions')
              .insert({
                work_item_id,
                owner_id: workItem.owner_id,
                organization_id: workItem.organization_id,
                suggested_stage: stageSuggestion.suggestedStage,
                confidence: stageSuggestion.confidence,
                reason: stageSuggestion.reason,
                source_type: 'ACTUACION', // Must be: ESTADO, ACTUACION, PUBLICACION, TUTELA_EXPEDIENTE
                event_fingerprint: suggestionFingerprint,
                status: stageSuggestion.confidence >= 0.8 ? 'APPLIED' : 'PENDING', // Must be: PENDING, APPLIED, DISMISSED
              });
            
            if (suggestionError) {
              console.warn(`[sync-by-work-item] Failed to create stage suggestion:`, suggestionError.message);
            } else {
              console.log(`[sync-by-work-item] Created stage suggestion: ${stageSuggestion.suggestedStage} (confidence: ${stageSuggestion.confidence})`);
              
              // Auto-apply high confidence suggestions
              if (stageSuggestion.confidence >= 0.8) {
                await supabase
                  .from('work_items')
                  .update({ stage: stageSuggestion.suggestedStage })
                  .eq('id', work_item_id);
                console.log(`[sync-by-work-item] Auto-applied stage: ${stageSuggestion.suggestedStage}`);
              }
            }
          }
        }
      }
    }

    result.latest_event_date = latestDate;

    // ============= UPDATE WORK ITEM METADATA =============
    // Strategy: ALWAYS UPDATE work_item with latest provider data (overwrite)
    // This ensures metadata stays fresh on each sync
    const updatePayload: Record<string, unknown> = {
      scrape_status: result.errors.length > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
      last_crawled_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
      total_actuaciones: fetchResult.actuaciones.length,
      scrape_provider: fetchResult.provider, // Track which provider was used
    };

    if (latestDate) {
      updatePayload.last_action_date = latestDate;
    }

    // Update expediente_url if returned and not already set
    if (fetchResult.expedienteUrl && !workItem.expediente_url) {
      updatePayload.expediente_url = fetchResult.expedienteUrl;
    }

    // ============= EXTRACT SUJETOS PROCESALES (demandantes/demandados) =============
    // This overrides caseMetadata.demandante/demandado with more complete data from sujetos
    if (fetchResult.sujetos && fetchResult.sujetos.length > 0) {
      const demandantes = fetchResult.sujetos
        .filter(s => {
          const tipo = s.tipo.toLowerCase();
          return tipo.includes('demandante') || tipo.includes('accionante') || tipo.includes('ofendido');
        })
        .map(s => s.nombre)
        .filter(Boolean)
        .join(' | ');
      
      const demandados = fetchResult.sujetos
        .filter(s => {
          const tipo = s.tipo.toLowerCase();
          return tipo.includes('demandado') || tipo.includes('accionado') || tipo.includes('procesado');
        })
        .map(s => s.nombre)
        .filter(Boolean)
        .join(' | ');
      
      const ministerioPublico = fetchResult.sujetos
        .filter(s => s.tipo.toLowerCase().includes('ministerio'))
        .map(s => s.nombre)
        .filter(Boolean)
        .join(' | ');

      if (demandantes) updatePayload.demandantes = demandantes;
      if (demandados) updatePayload.demandados = demandados;
      if (ministerioPublico) updatePayload.ministerio_publico = ministerioPublico;
      updatePayload.total_sujetos_procesales = fetchResult.sujetos.length;
      
      console.log(`[sync-by-work-item] Extracted ${fetchResult.sujetos.length} sujetos procesales from response`);
    } else if (fetchResult.caseMetadata?.total_sujetos && fetchResult.caseMetadata.total_sujetos > 0) {
      // Fallback: use total_sujetos from caseMetadata if sujetos array not available
      updatePayload.total_sujetos_procesales = fetchResult.caseMetadata.total_sujetos;
      console.log(`[sync-by-work-item] Using total_sujetos from caseMetadata: ${fetchResult.caseMetadata.total_sujetos}`);
    }

    // ============= UPDATE ALL CASE METADATA FROM PROVIDER =============
    if (fetchResult.caseMetadata) {
      const meta = fetchResult.caseMetadata;
      
      // Basic metadata (always update)
      if (meta.despacho) updatePayload.authority_name = meta.despacho;
      // Only set demandantes/demandados from caseMetadata if not already set from sujetos
      if (meta.demandante && !updatePayload.demandantes) updatePayload.demandantes = meta.demandante;
      if (meta.demandado && !updatePayload.demandados) updatePayload.demandados = meta.demandado;
      
      // SAMAI-specific metadata (update if present)
      if (meta.origen) updatePayload.origen = meta.origen;
      if (meta.ponente) updatePayload.ponente = meta.ponente;
      if (meta.clase_proceso) updatePayload.clase_proceso = meta.clase_proceso;
      if (meta.etapa) updatePayload.etapa = meta.etapa;
      if (meta.ubicacion) updatePayload.ubicacion_expediente = meta.ubicacion;
      if (meta.formato_expediente) updatePayload.formato_expediente = meta.formato_expediente;
      if (meta.tipo_proceso) updatePayload.tipo_proceso = meta.tipo_proceso;
      if (meta.subclase) updatePayload.subclase_proceso = meta.subclase;
      if (meta.recurso) updatePayload.tipo_recurso = meta.recurso;
      if (meta.naturaleza) updatePayload.naturaleza_proceso = meta.naturaleza;
      if (meta.asunto) updatePayload.asunto = meta.asunto;
      if (meta.medida_cautelar) updatePayload.medida_cautelar = meta.medida_cautelar;
      if (meta.ministerio_publico && !updatePayload.ministerio_publico) {
        updatePayload.ministerio_publico = meta.ministerio_publico;
      }
      
      // Parse and update important dates
      if (meta.fecha_radicado) {
        const parsedDate = parseColombianDate(meta.fecha_radicado);
        if (parsedDate) updatePayload.fecha_radicado = parsedDate;
      }
      if (meta.fecha_presenta_demanda) {
        const parsedDate = parseColombianDate(meta.fecha_presenta_demanda);
        if (parsedDate) updatePayload.fecha_presenta_demanda = parsedDate;
      }
      if (meta.fecha_para_sentencia) {
        const parsedDate = parseColombianDate(meta.fecha_para_sentencia);
        if (parsedDate) updatePayload.fecha_para_sentencia = parsedDate;
      }
      // fecha_sentencia can be text like "SIN SENTENCIA" or a date
      if (meta.fecha_sentencia) {
        updatePayload.fecha_sentencia = meta.fecha_sentencia;
      }
    }

    await supabase
      .from('work_items')
      .update(updatePayload)
      .eq('id', work_item_id);

    result.ok = true;
    console.log(`[sync-by-work-item] Completed: inserted=${result.inserted_count}, skipped=${result.skipped_count}, provider=${result.provider_used}`);

    return jsonResponse(result);

  } catch (err) {
    console.error('[sync-by-work-item] Unhandled error:', err);
    return errorResponse(
      'INTERNAL_ERROR',
      err instanceof Error ? err.message : 'An unexpected error occurred',
      500
    );
  }
});
