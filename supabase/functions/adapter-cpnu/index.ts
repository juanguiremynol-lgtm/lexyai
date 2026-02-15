import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= TYPES =============

interface ProcessEvent {
  source: string;
  event_type: string;
  event_date: string | null;
  title: string;
  description: string;
  detail?: string;
  attachments: Array<{ label: string; url: string }>;
  source_url: string;
  hash_fingerprint: string;
  raw_data?: Record<string, unknown>;
}

interface SujetoProcesal {
  tipo: string;
  nombre: string;
}

interface EstadoElectronico {
  nombre_archivo: string;
  despacho?: string;
  tipo_documento?: string;
  encontrado_el?: string;
}

interface SearchResult {
  radicado: string;
  despacho: string;
  demandante?: string;
  demandado?: string;
  tipo_proceso?: string;
  clase_proceso?: string;
  fecha_radicacion?: string;
  detail_url?: string;
  id_proceso?: number | string;
  sujetos_procesales?: SujetoProcesal[];
  contenido_radicacion?: string;
}

interface AttemptLog {
  phase: 'DISCOVER_API' | 'QUERY_LIST' | 'FETCH_DETAIL' | 'FETCH_ACTUACIONES' | 'FIRECRAWL_ACTIONS' | 'EXTERNAL_API' | 'RETRY';
  url: string;
  method: string;
  status: number | null;
  latency_ms: number;
  error_type?: 'HTTP_ERROR' | 'TIMEOUT' | 'NON_JSON' | 'PARSE_ERROR' | 'NETWORK_ERROR' | 'FIRECRAWL_ERROR' | 'INCOMPLETE_DATA';
  response_snippet_1kb?: string;
  success: boolean;
  retry_attempt?: number;
  source?: string;
}

type Classification = 
  | 'SUCCESS'
  | 'NO_RESULTS_CONFIRMED'
  | 'NO_RESULTS_PROVISIONAL'  // Not definitive, will retry
  | 'ENDPOINT_404'
  | 'ENDPOINT_CHANGED'
  | 'BLOCKED_403_429'
  | 'NON_JSON_RESPONSE'
  | 'PARSE_BROKE'
  | 'INTERACTION_REQUIRED'
  | 'INTERACTION_FAILED_SELECTOR_CHANGED'
  | 'INCOMPLETE_DATA'  // Silencio - got response but missing critical data
  | 'FALSE_NEGATIVE_RISK'  // High risk of false negative
  // NEW: Technical error classifications (NOT "no encontrado")
  | 'SCRAPER_TIMEOUT_INPUT'  // Timeout waiting for input field
  | 'SELECTOR_NOT_FOUND'  // Input field selector not found
  | 'BLOCKED_OR_CAPTCHA'  // Page blocked or captcha detected
  | 'PAGE_STRUCTURE_CHANGED'  // Page structure changed unexpectedly
  | 'NETWORK_FAILURE'  // Network/connection error
  | 'UNKNOWN';

interface CompletenessCheck {
  isComplete: boolean;
  hasSujetos: boolean;
  hasDespacho: boolean;
  hasActuaciones: boolean;
  missingFields: string[];
}

interface AdapterResponse {
  ok: boolean;
  source: string;
  run_id: string | null;
  classification: Classification;
  results?: SearchResult[];
  events?: ProcessEvent[];
  proceso?: {
    despacho: string;
    tipo?: string;
    clase?: string;
    contenido_radicacion?: string;
    demandante?: string;
    demandado?: string;
    fecha_radicacion?: string;
    sujetos_procesales: SujetoProcesal[];
    actuaciones: ProcessEvent[];
    estados_electronicos: EstadoElectronico[];
  };
  error?: string;
  attempts?: AttemptLog[];
  why_empty?: string;
  retry_exhausted?: boolean;
  sources_tried?: string[];
  // NEW: Debug info for technical errors
  debug?: {
    phase?: string;
    lastUrl?: string;
    errorType?: string;
    message?: string;
  };
}

// ============= CONFIGURATION =============

const CONFIG = {
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 3000,
  BACKOFF_MULTIPLIER: 1.5,
  POLLING_INTERVAL_MS: 3000,
  POLLING_TIMEOUT_MS: 90000,  // Increased to 90s for slow external API
  EXTERNAL_API_TIMEOUT_MS: 45000,  // 45s timeout for external API calls
  MIN_ACTUACIONES_FOR_COMPLETENESS: 1,
  MIN_SUJETOS_FOR_COMPLETENESS: 1,
};

// External API (Rama Judicial API on Render) - used as fallback
const EXTERNAL_API_BASE = 'https://rama-judicial-api.onrender.com';

// ============= CANDIDATE ENDPOINTS =============

const CPNU_API_CANDIDATES = {
  searchByRadicado: (radicado: string, soloActivos: boolean = false) => [
    {
      url: `https://consultaprocesos.ramajudicial.gov.co/api/v2/Procesos/Consulta/NumeroRadicacion?numero=${radicado}&SoloActivos=${soloActivos}&pagina=1`,
      method: 'GET',
      description: 'Standard v2 NumeroRadicacion without port',
    },
    {
      url: `https://consultaprocesos.ramajudicial.gov.co:443/api/v2/Procesos/Consulta/NumeroRadicacion?numero=${radicado}&SoloActivos=${soloActivos}&pagina=1`,
      method: 'GET',
      description: 'v2 NumeroRadicacion with explicit port 443',
    },
    {
      url: `https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Procesos/Consulta/NumeroRadicacion?numero=${radicado}&SoloActivos=${soloActivos}&pagina=1`,
      method: 'GET',
      description: 'v2 NumeroRadicacion with port 448',
    },
    {
      url: `https://consultaprocesos.ramajudicial.gov.co/api/v2/Procesos/Consulta/NumeroRadicacion`,
      method: 'POST',
      body: JSON.stringify({ numero: radicado, SoloActivos: soloActivos, pagina: 1 }),
      description: 'POST v2 NumeroRadicacion without port',
    },
    {
      url: `https://consultaprocesos.ramajudicial.gov.co/api/v1/Procesos/Consulta/NumeroRadicacion?numero=${radicado}`,
      method: 'GET',
      description: 'Legacy v1 NumeroRadicacion',
    },
  ],
  
  detail: (idProceso: string | number) => [
    {
      url: `https://consultaprocesos.ramajudicial.gov.co/api/v2/Proceso/Detalle/${idProceso}`,
      method: 'GET',
      description: 'v2 Proceso Detalle',
    },
    {
      url: `https://consultaprocesos.ramajudicial.gov.co:443/api/v2/Proceso/Detalle/${idProceso}`,
      method: 'GET',
      description: 'v2 Proceso Detalle with port 443',
    },
  ],
  
  actuaciones: (idProceso: string | number) => [
    {
      url: `https://consultaprocesos.ramajudicial.gov.co/api/v2/Proceso/Actuaciones/${idProceso}`,
      method: 'GET',
      description: 'v2 Proceso Actuaciones',
    },
    {
      url: `https://consultaprocesos.ramajudicial.gov.co:443/api/v2/Proceso/Actuaciones/${idProceso}`,
      method: 'GET',
      description: 'v2 Proceso Actuaciones with port 443',
    },
  ],
};

// ============= UTILITIES =============

function computeFingerprint(
  source: string, 
  radicado: string,
  eventDate: string | null, 
  eventType: string,
  description: string, 
  despacho: string,
  idProceso?: string | number
): string {
  const data = `${source}|${radicado}|${eventDate || ''}|${eventType}|${description}|${despacho}|${idProceso || ''}`;
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

function parseColombianDate(dateStr: string): string | null {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    try { return new Date(dateStr).toISOString(); } catch { return null; }
  }
  const match = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!match) return null;
  let [, day, month, year] = match;
  if (year.length === 2) {
    year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
  }
  try {
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return date.toISOString();
  } catch { return null; }
}

function determineEventType(description: string): string {
  const lower = description.toLowerCase();
  if (lower.includes('audiencia')) return 'AUDIENCIA';
  if (lower.includes('sentencia')) return 'SENTENCIA';
  if (lower.includes('auto ')) return 'AUTO';
  if (lower.includes('notifica')) return 'NOTIFICACION';
  if (lower.includes('traslado')) return 'TRASLADO';
  if (lower.includes('memorial')) return 'MEMORIAL';
  if (lower.includes('providencia')) return 'PROVIDENCIA';
  if (lower.includes('radicación')) return 'RADICACION';
  return 'ACTUACION';
}

function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Merge fallback results with Phase 1 results, preserving parties from Phase 1
 * when fallback results lack them. This prevents party loss when CPNU QUERY_LIST
 * returns parties but actuaciones fetch fails (406), triggering fallback.
 */
function mergeResultsPreserveParties(
  phase1Results: SearchResult[],
  fallbackResults: SearchResult[]
): SearchResult[] {
  if (phase1Results.length === 0) return fallbackResults;
  if (fallbackResults.length === 0) return phase1Results;
  
  // Use fallback as base, but fill in missing parties from Phase 1
  const phase1Main = phase1Results[0];
  return fallbackResults.map((fb, i) => {
    if (i > 0) return fb; // Only merge first result
    return {
      ...fb,
      demandante: fb.demandante?.trim() || phase1Main.demandante,
      demandado: fb.demandado?.trim() || phase1Main.demandado,
      fecha_radicacion: fb.fecha_radicacion || phase1Main.fecha_radicacion,
      despacho: fb.despacho?.trim() || phase1Main.despacho,
      tipo_proceso: fb.tipo_proceso || phase1Main.tipo_proceso,
      sujetos_procesales: (fb.sujetos_procesales?.length ? fb.sujetos_procesales : phase1Main.sujetos_procesales),
    };
  });
}

// ============= COMPLETENESS VALIDATION =============

function validateCompleteness(
  results: SearchResult[],
  events: ProcessEvent[]
): CompletenessCheck {
  const missingFields: string[] = [];
  
  const hasSujetos = results.some(r => 
    (r.sujetos_procesales && r.sujetos_procesales.length >= CONFIG.MIN_SUJETOS_FOR_COMPLETENESS) ||
    (r.demandante && r.demandante.trim().length > 0) ||
    (r.demandado && r.demandado.trim().length > 0)
  );
  
  const hasDespacho = results.some(r => r.despacho && r.despacho.trim().length > 5);
  const hasActuaciones = events.length >= CONFIG.MIN_ACTUACIONES_FOR_COMPLETENESS;
  
  if (!hasSujetos) missingFields.push('sujetos_procesales');
  if (!hasDespacho) missingFields.push('despacho');
  if (!hasActuaciones) missingFields.push('actuaciones');
  
  return {
    isComplete: hasSujetos && hasDespacho && hasActuaciones,
    hasSujetos,
    hasDespacho,
    hasActuaciones,
    missingFields,
  };
}

// ============= DIAGNOSTICS HELPERS =============

async function addStep(
  supabase: any, 
  runId: string, 
  stepName: string, 
  ok: boolean, 
  detail?: string, 
  meta?: Record<string, unknown>
) {
  try {
    await supabase.from('crawler_run_steps').insert({
      run_id: runId,
      step_name: stepName,
      ok,
      detail: truncate(detail || '', 500),
      meta: meta || {},
    });
  } catch (e) {
    console.error('Failed to add step:', e);
  }
}

async function finalizeRun(
  supabase: any, 
  runId: string, 
  status: string, 
  startTime: number,
  classification: Classification,
  attempts: AttemptLog[],
  httpStatus?: number, 
  errorCode?: string, 
  errorMessage?: string, 
  responseMeta?: Record<string, unknown>, 
  debugExcerpt?: string
) {
  const updateData: Record<string, unknown> = {
    finished_at: new Date().toISOString(),
    status,
    duration_ms: Date.now() - startTime,
    response_meta: {
      ...responseMeta,
      classification,
      attempts_count: attempts.length,
    },
  };
  
  if (httpStatus !== undefined) updateData.http_status = httpStatus;
  if (errorCode) updateData.error_code = errorCode;
  if (errorMessage) updateData.error_message = truncate(errorMessage, 1000);
  if (debugExcerpt) updateData.debug_excerpt = truncate(debugExcerpt, 10000);
  
  await supabase.from('crawler_runs').update(updateData).eq('id', runId);
}

// ============= CPNU FETCH WITH FALLBACKS =============

async function cpnuFetchJson(
  candidates: Array<{ url: string; method: string; body?: string; description: string }>,
  phase: AttemptLog['phase'],
  attempts: AttemptLog[],
  headers: Record<string, string> = {},
  retryAttempt: number = 0
): Promise<{ data: any; success: boolean; lastAttempt: AttemptLog }> {
  
  const defaultHeaders: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    ...headers,
  };
  
  let lastAttempt: AttemptLog | null = null;
  
  for (const candidate of candidates) {
    const startMs = Date.now();
    console.log(`[${phase}] Trying: ${candidate.method} ${candidate.url}`);
    
    const attempt: AttemptLog = {
      phase,
      url: candidate.url,
      method: candidate.method,
      status: null,
      latency_ms: 0,
      success: false,
      retry_attempt: retryAttempt,
    };
    
    try {
      const fetchOptions: RequestInit = {
        method: candidate.method,
        headers: defaultHeaders,
      };
      
      if (candidate.method === 'POST' && candidate.body) {
        fetchOptions.body = candidate.body;
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      fetchOptions.signal = controller.signal;
      
      const response = await fetch(candidate.url, fetchOptions);
      clearTimeout(timeoutId);
      
      attempt.status = response.status;
      attempt.latency_ms = Date.now() - startMs;
      
      const contentType = response.headers.get('content-type') || '';
      const responseText = await response.text();
      attempt.response_snippet_1kb = truncate(responseText, 1024);
      
      console.log(`[${phase}] Response: HTTP ${response.status}, Content-Type: ${contentType}, Length: ${responseText.length}`);
      
      if (response.status === 404) {
        attempt.error_type = 'HTTP_ERROR';
        attempts.push(attempt);
        lastAttempt = attempt;
        continue;
      }
      
      if (response.status === 403 || response.status === 429) {
        attempt.error_type = 'HTTP_ERROR';
        attempts.push(attempt);
        lastAttempt = attempt;
        return { data: null, success: false, lastAttempt: attempt };
      }
      
      if (!response.ok) {
        attempt.error_type = 'HTTP_ERROR';
        attempts.push(attempt);
        lastAttempt = attempt;
        continue;
      }
      
      if (!contentType.includes('application/json')) {
        if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
          attempt.error_type = 'NON_JSON';
          attempts.push(attempt);
          lastAttempt = attempt;
          continue;
        }
      }
      
      try {
        const data = JSON.parse(responseText);
        attempt.success = true;
        attempts.push(attempt);
        console.log(`[${phase}] SUCCESS: Got JSON response`);
        return { data, success: true, lastAttempt: attempt };
      } catch (parseErr) {
        attempt.error_type = 'PARSE_ERROR';
        attempts.push(attempt);
        lastAttempt = attempt;
        continue;
      }
      
    } catch (err) {
      attempt.latency_ms = Date.now() - startMs;
      
      if (err instanceof Error && err.name === 'AbortError') {
        attempt.error_type = 'TIMEOUT';
      } else {
        attempt.error_type = 'NETWORK_ERROR';
        attempt.response_snippet_1kb = err instanceof Error ? err.message : 'Unknown error';
      }
      
      attempts.push(attempt);
      lastAttempt = attempt;
      console.log(`[${phase}] Error:`, err);
    }
  }
  
  return { 
    data: null, 
    success: false, 
    lastAttempt: lastAttempt || { 
      phase, url: '', method: '', status: null, latency_ms: 0, success: false 
    } 
  };
}

// ============= EXTERNAL API FALLBACK (Rama Judicial API on Render) =============

interface ExternalApiResult {
  success: boolean;
  results: SearchResult[];
  events: ProcessEvent[];
  despacho?: string;
  sujetos?: SujetoProcesal[];
  error?: string;
  classification?: Classification;
  debug?: {
    phase: string;
    lastUrl?: string;
    errorType?: string;
    responseSnippet?: string;
  };
}

function classifyExternalApiError(
  errorMessage: string, 
  responseData?: any
): Classification {
  const msg = (errorMessage || '').toLowerCase();
  const respStr = responseData ? JSON.stringify(responseData).toLowerCase() : '';
  
  // Detect selector/input timeout errors
  if (msg.includes('waitforselector') || msg.includes('timeout') && msg.includes('input')) {
    return 'SCRAPER_TIMEOUT_INPUT';
  }
  if (msg.includes('timeout') && (msg.includes('23 dígitos') || msg.includes('23 digitos'))) {
    return 'SCRAPER_TIMEOUT_INPUT';
  }
  if (msg.includes('selector') && (msg.includes('not found') || msg.includes('no encontr'))) {
    return 'SELECTOR_NOT_FOUND';
  }
  
  // Detect block/captcha
  if (msg.includes('captcha') || respStr.includes('captcha')) {
    return 'BLOCKED_OR_CAPTCHA';
  }
  if (msg.includes('access denied') || msg.includes('blocked') || msg.includes('cloudflare')) {
    return 'BLOCKED_OR_CAPTCHA';
  }
  if (msg.includes('verifying you are human') || respStr.includes('verifying you are human')) {
    return 'BLOCKED_OR_CAPTCHA';
  }
  
  // Network errors
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound')) {
    return 'NETWORK_FAILURE';
  }
  
  // Generic timeout (not input-specific)
  if (msg.includes('timeout')) {
    return 'SCRAPER_TIMEOUT_INPUT';  // Still treat as scraper issue
  }
  
  // Page structure changed
  if (msg.includes('page') && msg.includes('change')) {
    return 'PAGE_STRUCTURE_CHANGED';
  }
  
  return 'UNKNOWN';
}

async function fetchFromExternalApi(
  radicado: string,
  attempts: AttemptLog[]
): Promise<ExternalApiResult> {
  const startMs = Date.now();
  const attempt: AttemptLog = {
    phase: 'EXTERNAL_API',
    url: `${EXTERNAL_API_BASE}/buscar`,
    method: 'GET',
    status: null,
    latency_ms: 0,
    success: false,
    source: 'RAMA_JUDICIAL_API',
  };

  try {
    console.log('[EXTERNAL_API] Starting job-based polling with extended timeout...');
    
    // Step 1: Initiate search with timeout
    const initUrl = `${EXTERNAL_API_BASE}/buscar?numero_radicacion=${radicado}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.EXTERNAL_API_TIMEOUT_MS);
    
    let initResponse: Response;
    try {
      initResponse = await fetch(initUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
        attempt.error_type = 'TIMEOUT';
        attempt.latency_ms = Date.now() - startMs;
        attempts.push(attempt);
        return {
          success: false,
          results: [],
          events: [],
          error: 'Timeout iniciando búsqueda (45s)',
          classification: 'SCRAPER_TIMEOUT_INPUT',
          debug: { phase: 'init', errorType: 'TIMEOUT' },
        };
      }
      throw fetchErr;
    }
    
    attempt.status = initResponse.status;
    
    if (!initResponse.ok) {
      attempt.error_type = 'HTTP_ERROR';
      attempt.latency_ms = Date.now() - startMs;
      attempts.push(attempt);
      return {
        success: false,
        results: [],
        events: [],
        error: `HTTP ${initResponse.status}`,
        classification: initResponse.status === 403 || initResponse.status === 429 
          ? 'BLOCKED_403_429' 
          : 'NETWORK_FAILURE',
        debug: { phase: 'init', errorType: 'HTTP_ERROR' },
      };
    }
    
    const initData = await initResponse.json();
    
    if (!initData.jobId) {
      // Maybe direct response
      if (initData.success && initData.proceso) {
        attempt.success = true;
        attempt.latency_ms = Date.now() - startMs;
        attempts.push(attempt);
        return processExternalApiResponse(initData, radicado);
      }
      
      attempt.error_type = 'PARSE_ERROR';
      attempt.response_snippet_1kb = JSON.stringify(initData).substring(0, 1024);
      attempt.latency_ms = Date.now() - startMs;
      attempts.push(attempt);
      return {
        success: false,
        results: [],
        events: [],
        error: 'No jobId in response',
        classification: 'UNKNOWN',
        debug: { phase: 'init', errorType: 'NO_JOB_ID', responseSnippet: JSON.stringify(initData).substring(0, 500) },
      };
    }
    
    const jobId = initData.jobId;
    console.log(`[EXTERNAL_API] Got jobId: ${jobId}, starting polling (timeout: ${CONFIG.POLLING_TIMEOUT_MS}ms)...`);
    
    // Step 2: Poll for results with extended timeout
    const pollStartTime = Date.now();
    let pollAttempts = 0;
    
    while (Date.now() - pollStartTime < CONFIG.POLLING_TIMEOUT_MS) {
      pollAttempts++;
      await sleep(CONFIG.POLLING_INTERVAL_MS);
      
      const pollUrl = `${EXTERNAL_API_BASE}/resultado/${jobId}`;
      
      let pollResponse: Response;
      try {
        const pollController = new AbortController();
        const pollTimeoutId = setTimeout(() => pollController.abort(), 30000);
        pollResponse = await fetch(pollUrl, { signal: pollController.signal });
        clearTimeout(pollTimeoutId);
      } catch (pollErr) {
        console.log(`[EXTERNAL_API] Poll attempt ${pollAttempts}: Error - ${pollErr instanceof Error ? pollErr.message : 'Unknown'}`);
        continue;
      }
      
      if (!pollResponse.ok) {
        console.log(`[EXTERNAL_API] Poll attempt ${pollAttempts}: HTTP ${pollResponse.status}`);
        continue;
      }
      
      const pollData = await pollResponse.json();
      console.log(`[EXTERNAL_API] Poll attempt ${pollAttempts}: status=${pollData.status}, estado=${pollData.estado || 'N/A'}`);
      
      if (pollData.status === 'completed') {
        attempt.latency_ms = Date.now() - startMs;
        
        // CRITICAL: Analyze the error message to determine if this is a technical error
        if (pollData.success === false) {
          const errorMsg = pollData.mensaje || pollData.error || '';
          
          // Check if the error message indicates a technical failure (NOT a real "not found")
          const techClassification = classifyExternalApiError(errorMsg, pollData);
          
          if (techClassification !== 'UNKNOWN') {
            console.log(`[EXTERNAL_API] TECHNICAL ERROR detected: ${techClassification}`);
            attempt.error_type = 'HTTP_ERROR';
            attempt.response_snippet_1kb = JSON.stringify(pollData).substring(0, 1024);
            attempts.push(attempt);
            
            return {
              success: false,
              results: [],
              events: [],
              error: errorMsg,
              classification: techClassification,
              debug: {
                phase: 'poll_completed',
                errorType: techClassification,
                responseSnippet: JSON.stringify(pollData).substring(0, 500),
              },
            };
          }
          
          // If estado is NO_ENCONTRADO, check if the search actually executed
          if (pollData.estado === 'NO_ENCONTRADO') {
            // Look for evidence that the search actually ran successfully
            // If there's a selector/timeout error in the message, it's NOT a real "not found"
            const hasTimeoutHint = errorMsg.toLowerCase().includes('timeout') || 
                                   errorMsg.toLowerCase().includes('selector');
            
            if (hasTimeoutHint) {
              console.log('[EXTERNAL_API] NO_ENCONTRADO with timeout/selector hint - treating as SCRAPER_TIMEOUT_INPUT');
              attempt.error_type = 'TIMEOUT';
              attempt.response_snippet_1kb = JSON.stringify(pollData).substring(0, 1024);
              attempts.push(attempt);
              
              return {
                success: false,
                results: [],
                events: [],
                error: errorMsg || 'Error técnico en el scraper (no es "no encontrado" real)',
                classification: 'SCRAPER_TIMEOUT_INPUT',
                debug: {
                  phase: 'poll_completed',
                  errorType: 'SCRAPER_TIMEOUT_INPUT',
                  responseSnippet: JSON.stringify(pollData).substring(0, 500),
                },
              };
            }
            
            // Otherwise treat as provisional (will retry with fallback)
            console.log('[EXTERNAL_API] NO_ENCONTRADO - treating as PROVISIONAL (will retry)');
            attempt.error_type = 'INCOMPLETE_DATA';
            attempt.response_snippet_1kb = JSON.stringify(pollData).substring(0, 1024);
            attempts.push(attempt);
            
            return {
              success: false,
              results: [],
              events: [],
              error: pollData.mensaje || 'No se encontró información del proceso',
              classification: 'NO_RESULTS_PROVISIONAL', // NOT definitive!
              debug: {
                phase: 'poll_completed',
                errorType: 'NO_ENCONTRADO_PROVISIONAL',
                responseSnippet: JSON.stringify(pollData).substring(0, 500),
              },
            };
          }
        }
        
        if (pollData.success) {
          attempt.success = true;
          attempts.push(attempt);
          return processExternalApiResponse(pollData, radicado);
        }
      }
      
      if (pollData.status === 'failed') {
        // Analyze the failure reason
        const errorMsg = pollData.error || pollData.mensaje || '';
        const techClassification = classifyExternalApiError(errorMsg, pollData);
        
        attempt.error_type = 'HTTP_ERROR';
        attempt.response_snippet_1kb = JSON.stringify(pollData).substring(0, 1024);
        attempt.latency_ms = Date.now() - startMs;
        attempts.push(attempt);
        
        return {
          success: false,
          results: [],
          events: [],
          error: errorMsg || 'Job failed',
          classification: techClassification !== 'UNKNOWN' ? techClassification : 'NO_RESULTS_PROVISIONAL',
          debug: {
            phase: 'poll_failed',
            errorType: techClassification,
            responseSnippet: JSON.stringify(pollData).substring(0, 500),
          },
        };
      }
    }
    
    // Timeout during polling
    attempt.error_type = 'TIMEOUT';
    attempt.latency_ms = Date.now() - startMs;
    attempts.push(attempt);
    return {
      success: false,
      results: [],
      events: [],
      error: `Polling timeout después de ${Math.round(CONFIG.POLLING_TIMEOUT_MS / 1000)}s`,
      classification: 'SCRAPER_TIMEOUT_INPUT',  // Treat polling timeout as scraper issue
      debug: {
        phase: 'poll_timeout',
        errorType: 'POLLING_TIMEOUT',
      },
    };
    
  } catch (err) {
    attempt.latency_ms = Date.now() - startMs;
    attempt.error_type = 'NETWORK_ERROR';
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    attempt.response_snippet_1kb = errorMsg;
    attempts.push(attempt);
    
    const techClassification = classifyExternalApiError(errorMsg);
    
    return {
      success: false,
      results: [],
      events: [],
      error: errorMsg,
      classification: techClassification !== 'UNKNOWN' ? techClassification : 'NETWORK_FAILURE',
      debug: {
        phase: 'exception',
        errorType: techClassification,
      },
    };
  }
}

function processExternalApiResponse(data: any, radicado: string): {
  success: boolean;
  results: SearchResult[];
  events: ProcessEvent[];
  despacho?: string;
  sujetos?: SujetoProcesal[];
  classification?: Classification;
} {
  const results: SearchResult[] = [];
  const events: ProcessEvent[] = [];
  let despacho = '';
  const sujetos: SujetoProcesal[] = [];
  
  const proceso = data.proceso || data;
  
  if (proceso.despacho) {
    despacho = proceso.despacho;
  }
  
  // Extract sujetos
  if (Array.isArray(proceso.sujetos_procesales)) {
    for (const s of proceso.sujetos_procesales) {
      sujetos.push({
        tipo: s.tipo || s.tipoParte || 'Parte',
        nombre: s.nombre || '',
      });
    }
  }
  
  // Build search result
  results.push({
    radicado,
    despacho,
    tipo_proceso: proceso.tipo,
    clase_proceso: proceso.clase,
    contenido_radicacion: proceso.contenido_radicacion,
    sujetos_procesales: sujetos,
    demandante: sujetos.find(s => s.tipo.toLowerCase().includes('demandante'))?.nombre,
    demandado: sujetos.find(s => s.tipo.toLowerCase().includes('demandado'))?.nombre,
  });
  
  // Extract actuaciones
  if (Array.isArray(proceso.actuaciones)) {
    for (const act of proceso.actuaciones) {
      const eventDate = parseColombianDate(act.fecha_actuacion || act.fechaActuacion || '');
      const description = act.actuacion || act.descripcion || '';
      
      if (!description) continue;
      
      events.push({
        source: 'EXTERNAL_API',
        event_type: determineEventType(description),
        event_date: eventDate,
        title: truncate(description, 100),
        description,
        detail: act.anotacion,
        attachments: [],
        source_url: `${EXTERNAL_API_BASE}`,
        hash_fingerprint: computeFingerprint('EXTERNAL', radicado, eventDate, determineEventType(description), description, despacho),
        raw_data: act,
      });
    }
  }
  
  // Validate completeness
  const completeness = validateCompleteness(results, events);
  
  if (!completeness.isComplete) {
    console.log(`[EXTERNAL_API] Incomplete data: missing ${completeness.missingFields.join(', ')}`);
    return {
      success: false,
      results,
      events,
      despacho,
      sujetos,
      classification: 'INCOMPLETE_DATA',
    };
  }
  
  return {
    success: true,
    results,
    events,
    despacho,
    sujetos,
    classification: 'SUCCESS',
  };
}

// ============= FIRECRAWL ACTIONS FALLBACK =============

async function scrapeWithFirecrawlActions(
  radicado: string,
  attempts: AttemptLog[],
  useTodosProcesos: boolean = true
): Promise<{ 
  success: boolean; 
  markdown?: string; 
  html?: string; 
  screenshot?: string;
  error?: string;
  classification?: Classification;
}> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) {
    return { success: false, error: 'FIRECRAWL_API_KEY not configured' };
  }

  const startMs = Date.now();
  const attempt: AttemptLog = {
    phase: 'FIRECRAWL_ACTIONS',
    url: 'https://consultaprocesos.ramajudicial.gov.co/Procesos/NumeroRadicacion',
    method: 'SCRAPE_WITH_ACTIONS',
    status: null,
    latency_ms: 0,
    success: false,
  };

  try {
    console.log('Firecrawl Actions: Starting form submission flow');
    
    const actions: any[] = [
      { type: 'wait', milliseconds: 2000 },
    ];
    
    if (useTodosProcesos) {
      actions.push({
        type: 'click',
        selector: 'input[id="input-68"]',
      });
      actions.push({ type: 'wait', milliseconds: 500 });
    }
    
    actions.push({
      type: 'write',
      selector: 'input[maxlength="23"]',
      text: radicado,
    });
    
    actions.push({ type: 'wait', milliseconds: 500 });
    
    actions.push({
      type: 'click',
      selector: 'button[aria-label="Consultar Número de radicación"]',
    });
    
    actions.push({ type: 'wait', milliseconds: 5000 });
    actions.push({ type: 'scroll', direction: 'down' });
    actions.push({ type: 'wait', milliseconds: 2000 });

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://consultaprocesos.ramajudicial.gov.co/Procesos/NumeroRadicacion',
        formats: ['markdown', 'html', 'screenshot'],
        actions,
        waitFor: 3000,
        onlyMainContent: false,
      }),
    });

    attempt.status = response.status;
    attempt.latency_ms = Date.now() - startMs;

    if (!response.ok) {
      const errorText = await response.text();
      attempt.error_type = 'FIRECRAWL_ERROR';
      attempt.response_snippet_1kb = truncate(errorText, 1024);
      attempts.push(attempt);
      return { 
        success: false, 
        error: `Firecrawl HTTP ${response.status}: ${errorText.substring(0, 200)}`,
        classification: 'INTERACTION_REQUIRED',
      };
    }

    const data = await response.json();
    const markdown = data.data?.markdown || data.markdown || '';
    const html = data.data?.html || data.html || '';
    const screenshot = data.data?.screenshot || data.screenshot;
    
    attempt.response_snippet_1kb = truncate(markdown, 1024);
    
    console.log('Firecrawl Actions: Got response, markdown length:', markdown.length);

    const isStillForm = markdown.includes('0 / 23') || 
                        (markdown.includes('Número de Radicación') && !markdown.includes('Despacho'));
    
    if (isStillForm) {
      attempt.error_type = 'FIRECRAWL_ERROR';
      attempts.push(attempt);
      return {
        success: false,
        markdown,
        html,
        screenshot,
        error: 'Form submission did not trigger - still showing empty form',
        classification: 'INTERACTION_FAILED_SELECTOR_CHANGED',
      };
    }
    
    if (markdown.includes('No se encontraron') || markdown.includes('sin resultados')) {
      attempt.success = true;
      attempts.push(attempt);
      return {
        success: true,
        markdown,
        html,
        screenshot,
        classification: 'NO_RESULTS_PROVISIONAL', // Changed from CONFIRMED
      };
    }
    
    if (markdown.includes(radicado) || html.includes(radicado)) {
      attempt.success = true;
      attempts.push(attempt);
      return {
        success: true,
        markdown,
        html,
        screenshot,
        classification: 'SUCCESS',
      };
    }
    
    attempt.success = true;
    attempts.push(attempt);
    return {
      success: true,
      markdown,
      html,
      screenshot,
      classification: 'UNKNOWN',
    };

  } catch (error) {
    attempt.latency_ms = Date.now() - startMs;
    attempt.error_type = 'NETWORK_ERROR';
    attempt.response_snippet_1kb = error instanceof Error ? error.message : 'Unknown error';
    attempts.push(attempt);
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      classification: 'UNKNOWN',
    };
  }
}

// ============= PARSE RESULTS FROM FIRECRAWL OUTPUT =============

function parseSearchResultsFromContent(
  markdown: string, 
  html: string, 
  radicado: string
): { results: SearchResult[]; parseMethod: string } {
  const results: SearchResult[] = [];
  const contentToCheck = markdown + html;
  
  if (!contentToCheck.includes(radicado)) {
    if (markdown.includes('0 / 23') && markdown.includes('Número de Radicación')) {
      return { results: [], parseMethod: 'SPA_FORM_EMPTY' };
    }
    
    if (markdown.includes('No se encontraron') || markdown.includes('sin resultados')) {
      return { results: [], parseMethod: 'NO_RESULTS_MESSAGE' };
    }
    
    return { results: [], parseMethod: 'NO_MATCH' };
  }
  
  let idProceso: string | number | undefined;
  const urlMatch = contentToCheck.match(/idProceso[=\/](\d+)/i);
  if (urlMatch) idProceso = urlMatch[1];
  
  const dataIdMatch = contentToCheck.match(/data-(?:id|proceso)[="](\d+)/i);
  if (!idProceso && dataIdMatch) idProceso = dataIdMatch[1];
  
  let despacho = '';
  const despachoPatterns = [
    /Juzgado[^\n|<]{5,80}/i,
    /Tribunal[^\n|<]{5,80}/i,
    /Corte[^\n|<]{5,80}/i,
  ];
  
  for (const pattern of despachoPatterns) {
    const match = contentToCheck.match(pattern);
    if (match) {
      despacho = match[0].trim();
      break;
    }
  }
  
  let demandante: string | undefined;
  let demandado: string | undefined;
  
  const demandanteMatch = contentToCheck.match(/[Dd]emandante[:\s]+([^\n|<]{2,50})/);
  if (demandanteMatch) demandante = demandanteMatch[1].trim();
  
  const demandadoMatch = contentToCheck.match(/[Dd]emandado[:\s]+([^\n|<]{2,50})/);
  if (demandadoMatch) demandado = demandadoMatch[1].trim();
  
  results.push({
    radicado,
    despacho,
    demandante,
    demandado,
    id_proceso: idProceso,
    detail_url: idProceso 
      ? `https://consultaprocesos.ramajudicial.gov.co/Procesos/Detalle?idProceso=${idProceso}` 
      : undefined,
  });
  
  return { results, parseMethod: 'CONTENT_MATCH' };
}

function parseActuacionesFromJson(data: any, radicado: string, sourceUrl: string): ProcessEvent[] {
  const events: ProcessEvent[] = [];
  
  if (!data || !Array.isArray(data.actuaciones || data)) {
    return events;
  }
  
  const actuaciones = data.actuaciones || data;
  
  for (const act of actuaciones) {
    const eventDate = parseColombianDate(act.fechaActuacion || act.fecha || '');
    const description = act.actuacion || act.descripcion || act.anotacion || '';
    const despacho = act.nombreDespacho || act.despacho || '';
    
    if (!description) continue;
    
    events.push({
      source: 'CPNU',
      event_type: determineEventType(description),
      event_date: eventDate,
      title: truncate(description, 100),
      description,
      detail: act.detalle || act.anotacion || undefined,
      attachments: (act.documentos || []).map((doc: any) => ({
        label: doc.nombre || doc.descripcion || 'Documento',
        url: doc.url || doc.enlace || '',
      })),
      source_url: sourceUrl,
      hash_fingerprint: computeFingerprint('CPNU', radicado, eventDate, determineEventType(description), description, despacho),
      raw_data: act,
    });
  }
  
  return events;
}

function parseActuacionesFromMarkdown(markdown: string, radicado: string, sourceUrl: string): ProcessEvent[] {
  const events: ProcessEvent[] = [];
  const lines = markdown.split('\n');
  
  for (const line of lines) {
    const dateMatch = line.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
    if (dateMatch && line.length > 20) {
      const eventDate = parseColombianDate(dateMatch[1]);
      const description = line.replace(dateMatch[0], '').trim();
      
      if (description.length > 10) {
        events.push({
          source: 'CPNU',
          event_type: determineEventType(description),
          event_date: eventDate,
          title: truncate(description, 100),
          description,
          attachments: [],
          source_url: sourceUrl,
          hash_fingerprint: computeFingerprint('CPNU', radicado, eventDate, determineEventType(description), description, ''),
        });
      }
    }
  }
  
  return events;
}

// ============= AUTH HELPER =============

async function getAuthenticatedUser(req: Request, supabaseUrl: string, supabaseAnonKey: string): Promise<{ user_id: string } | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return null;
  }
  
  return { user_id: user.id };
}

// ============= MAIN ORCHESTRATOR WITH RETRY + FALLBACK =============

async function orchestrateSearch(
  radicadoStr: string,
  supabase: any,
  runId: string | null,
  attempts: AttemptLog[],
  startTime: number
): Promise<{
  results: SearchResult[];
  events: ProcessEvent[];
  classification: Classification;
  debugExcerpt: string;
  sourcesTried: string[];
  retryExhausted: boolean;
  phase1Results: SearchResult[];
}> {
  let results: SearchResult[] = [];
  let events: ProcessEvent[] = [];
  // Preserve Phase 1 results (with parties) when fallbacks only add events
  let phase1Results: SearchResult[] = [];
  let classification: Classification = 'UNKNOWN';
  let debugExcerpt = '';
  const sourcesTried: string[] = [];
  let retryExhausted = false;
  let foundSuccess = false;
  
  // === PHASE 1: Try CPNU Direct API ===
  console.log('=== PHASE 1: CPNU Direct API ===');
  sourcesTried.push('CPNU_API');
  if (runId) await addStep(supabase, runId, 'PHASE_1_CPNU_API', true, 'Starting CPNU direct API attempts');
  
  const searchCandidates = CPNU_API_CANDIDATES.searchByRadicado(radicadoStr, false);
  const apiResult = await cpnuFetchJson(searchCandidates, 'QUERY_LIST', attempts);
  
  if (apiResult.success && apiResult.data) {
    const procesos = apiResult.data.procesos || apiResult.data.data || apiResult.data;
    
    if (Array.isArray(procesos) && procesos.length > 0) {
      for (const p of procesos) {
        const sujetos: SujetoProcesal[] = [];
        if (Array.isArray(p.sujetosProcesales)) {
          for (const s of p.sujetosProcesales) {
            sujetos.push({ tipo: s.tipoParte || 'Parte', nombre: s.nombre || '' });
          }
        }
        
        results.push({
          radicado: p.numero || p.radicado || radicadoStr,
          despacho: p.despacho || p.nombreDespacho || '',
          demandante: p.demandante,
          demandado: p.demandado,
          tipo_proceso: p.tipoProceso || p.clase,
          fecha_radicacion: p.fechaRadicacion || p.fecha,
          id_proceso: p.idProceso || p.id,
          sujetos_procesales: sujetos,
          detail_url: p.idProceso ? `https://consultaprocesos.ramajudicial.gov.co/Procesos/Detalle?idProceso=${p.idProceso}` : undefined,
        });
      }
      
      // Try to fetch actuaciones
      if (results.length > 0 && results[0].id_proceso) {
        const actCandidates = CPNU_API_CANDIDATES.actuaciones(results[0].id_proceso);
        const actResult = await cpnuFetchJson(actCandidates, 'FETCH_ACTUACIONES', attempts);
        
        if (actResult.success && actResult.data) {
          events = parseActuacionesFromJson(actResult.data, radicadoStr, actCandidates[0].url);
          if (runId) await addStep(supabase, runId, 'ACTUACIONES_API', true, `Found ${events.length} actuaciones`);
        }
      }
      
      // Validate completeness
      const completeness = validateCompleteness(results, events);
      if (completeness.isComplete) {
        classification = 'SUCCESS';
        debugExcerpt = JSON.stringify(apiResult.data).substring(0, 10000);
        return { results, events, classification, debugExcerpt, sourcesTried, retryExhausted: false };
      } else {
        // CRITICAL: Preserve Phase 1 results (which contain parties from QUERY_LIST)
        // so fallback phases only supplement events/actuaciones, not overwrite parties
        phase1Results = [...results];
        console.log(`CPNU API returned incomplete data: missing ${completeness.missingFields.join(', ')}. Preserving ${phase1Results.length} results with parties for merge.`);
        if (runId) await addStep(supabase, runId, 'INCOMPLETE_DATA', false, `Missing: ${completeness.missingFields.join(', ')}. Parties preserved: demandante=${results[0]?.demandante}, demandado=${results[0]?.demandado}`);
        classification = 'INCOMPLETE_DATA';
      }
    }
    
    debugExcerpt = JSON.stringify(apiResult.data).substring(0, 10000);
  }
  
  // === PHASE 2: External API Fallback (Rama Judicial API) ===
  if (!foundSuccess) {
    console.log('=== PHASE 2: External API Fallback ===');
    sourcesTried.push('EXTERNAL_API');
    if (runId) await addStep(supabase, runId, 'PHASE_2_EXTERNAL_API', true, 'Trying external API fallback');
    
    let lastExternalClassification: Classification = 'UNKNOWN';
    
    for (let retry = 0; retry < CONFIG.MAX_RETRIES; retry++) {
      if (retry > 0) {
        const delay = CONFIG.RETRY_DELAY_MS * Math.pow(CONFIG.BACKOFF_MULTIPLIER, retry - 1);
        console.log(`[RETRY] Attempt ${retry + 1}/${CONFIG.MAX_RETRIES}, waiting ${delay}ms...`);
        await sleep(delay);
      }
      
      const externalResult = await fetchFromExternalApi(radicadoStr, attempts);
      lastExternalClassification = externalResult.classification || 'UNKNOWN';
      
      if (externalResult.success && externalResult.results.length > 0) {
        // Merge: use fallback results but preserve Phase 1 parties if fallback lacks them
        results = mergeResultsPreserveParties(phase1Results, externalResult.results);
        events = externalResult.events;
        classification = 'SUCCESS';
        debugExcerpt = `External API success: ${results.length} results, ${events.length} events`;
        if (runId) await addStep(supabase, runId, 'EXTERNAL_API_SUCCESS', true, debugExcerpt);
        return { results, events, classification, debugExcerpt, sourcesTried, retryExhausted: false };
      }
      
      // CRITICAL: If it's a TECHNICAL error (not "no encontrado"), propagate it immediately
      // These are NOT retryable with the same source
      const technicalErrors: Classification[] = [
        'SCRAPER_TIMEOUT_INPUT',
        'SELECTOR_NOT_FOUND', 
        'BLOCKED_OR_CAPTCHA',
        'PAGE_STRUCTURE_CHANGED',
        'NETWORK_FAILURE',
      ];
      
      if (technicalErrors.includes(externalResult.classification as Classification)) {
        console.log(`[EXTERNAL_API] TECHNICAL ERROR: ${externalResult.classification} - will try Firecrawl fallback`);
        if (runId) await addStep(supabase, runId, 'TECHNICAL_ERROR', false, 
          `${externalResult.classification}: ${externalResult.error}`);
        classification = externalResult.classification!;
        debugExcerpt = externalResult.error || `Technical error: ${externalResult.classification}`;
        // Don't retry with same source on technical errors, move to fallback
        break;
      }
      
      // If provisional NO_ENCONTRADO, continue retrying
      if (externalResult.classification === 'NO_RESULTS_PROVISIONAL') {
        console.log(`[RETRY] Got provisional NO_ENCONTRADO, will retry (attempt ${retry + 1}/${CONFIG.MAX_RETRIES})`);
        if (runId) await addStep(supabase, runId, 'RETRY_PROVISIONAL', false, `Provisional no results, retry ${retry + 1}`);
        continue;
      }
      
      // If incomplete data, continue retrying
      if (externalResult.classification === 'INCOMPLETE_DATA') {
        console.log(`[RETRY] Got incomplete data, will retry (attempt ${retry + 1}/${CONFIG.MAX_RETRIES})`);
        continue;
      }
      
      // Other errors - break and try fallback
      break;
    }
    
    // Keep track of the last external classification for final status
    if (classification === 'UNKNOWN') {
      classification = lastExternalClassification;
    }
    
    retryExhausted = true;
  }
  
  // === PHASE 3: Firecrawl Fallback ===
  if (!foundSuccess) {
    console.log('=== PHASE 3: Firecrawl Fallback ===');
    sourcesTried.push('FIRECRAWL');
    if (runId) await addStep(supabase, runId, 'PHASE_3_FIRECRAWL', true, 'Trying Firecrawl fallback');
    
    const fcResult = await scrapeWithFirecrawlActions(radicadoStr, attempts, true);
    
    if (fcResult.success && fcResult.markdown) {
      debugExcerpt = fcResult.markdown.substring(0, 10000);
      
      const parseResult = parseSearchResultsFromContent(fcResult.markdown, fcResult.html || '', radicadoStr);
      
      if (parseResult.results.length > 0) {
        // Merge: preserve Phase 1 parties if Firecrawl lacks them
        results = mergeResultsPreserveParties(phase1Results, parseResult.results);
        events = parseActuacionesFromMarkdown(fcResult.markdown, radicadoStr, 'https://consultaprocesos.ramajudicial.gov.co');
        
        const completeness = validateCompleteness(results, events);
        if (completeness.isComplete) {
          classification = 'SUCCESS';
        } else {
          classification = 'INCOMPLETE_DATA';
        }
        
        if (runId) await addStep(supabase, runId, 'FIRECRAWL_PARSED', true, `Results: ${results.length}, Events: ${events.length}`);
      } else {
        classification = fcResult.classification || 'NO_RESULTS_PROVISIONAL';
      }
    } else {
      debugExcerpt = fcResult.error || 'Firecrawl failed';
      classification = fcResult.classification || 'UNKNOWN';
    }
  }
  
  // === Restore Phase 1 results if all fallbacks failed but Phase 1 had data ===
  if (results.length === 0 && phase1Results.length > 0) {
    console.log(`[FINAL] Restoring Phase 1 results (${phase1Results.length}) with parties: demandante=${phase1Results[0]?.demandante}, demandado=${phase1Results[0]?.demandado}`);
    results = phase1Results;
    // Mark as partial success since we have search results but no actuaciones
    if (classification !== 'SUCCESS') {
      classification = 'INCOMPLETE_DATA';
    }
  }
  
  // === Final classification ===
  if (results.length === 0 && events.length === 0) {
    // CRITICAL: Preserve technical error classifications - do NOT override to "NO_ENCONTRADO"
    const technicalErrors: Classification[] = [
      'SCRAPER_TIMEOUT_INPUT',
      'SELECTOR_NOT_FOUND', 
      'BLOCKED_OR_CAPTCHA',
      'PAGE_STRUCTURE_CHANGED',
      'NETWORK_FAILURE',
    ];
    
    if (technicalErrors.includes(classification)) {
      // Keep the technical error classification - this is NOT "no encontrado"
      console.log(`[FINAL] Preserving technical error classification: ${classification}`);
    } else if (retryExhausted && sourcesTried.length >= 2) {
      // Only mark as definitively NOT_FOUND if all sources tried AND no technical errors
      classification = 'NO_RESULTS_CONFIRMED';
    } else {
      classification = 'FALSE_NEGATIVE_RISK';
    }
  }
  
  return { results, events, classification, debugExcerpt, sourcesTried, retryExhausted, phase1Results };
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let runId: string | null = null;
  const attempts: AttemptLog[] = [];

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const authUser = await getAuthenticatedUser(req, supabaseUrl, supabaseAnonKey);
    if (!authUser) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized - valid authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const owner_id = authUser.user_id;
    const { action, radicado, debug } = await req.json();
    
    if (!action) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing required field: action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Create crawler run record
    const { data: runData } = await supabase.from('crawler_runs').insert({
      owner_id,
      radicado: radicado || 'N/A',
      adapter: 'CPNU',
      status: 'RUNNING',
      request_meta: { action, radicado, debug: !!debug },
    }).select('id').single();
    
    runId = runData?.id;
    console.log('CPNU Adapter: Run ID:', runId);

    if (action === 'search') {
      if (!radicado) {
        const response: AdapterResponse = {
          ok: false,
          source: 'CPNU',
          run_id: runId,
          classification: 'UNKNOWN',
          error: 'Radicado is required',
          attempts,
        };
        if (runId) await finalizeRun(supabase, runId, 'ERROR', startTime, 'UNKNOWN', attempts, undefined, 'MISSING_PARAM', 'Radicado is required');
        return new Response(JSON.stringify(response), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Normalize radicado
      const radicadoStr = String(radicado).trim().replace(/\D/g, '');
      if (radicadoStr.length !== 23) {
        const response: AdapterResponse = {
          ok: false,
          source: 'CPNU',
          run_id: runId,
          classification: 'UNKNOWN',
          error: `Invalid radicado length: ${radicadoStr.length}, expected 23 digits`,
          attempts,
        };
        if (runId) await finalizeRun(supabase, runId, 'ERROR', startTime, 'UNKNOWN', attempts, undefined, 'INVALID_RADICADO', response.error);
        return new Response(JSON.stringify(response), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (runId) await addStep(supabase, runId, 'VALIDATE', true, `Radicado: ${radicadoStr} (23 digits)`, { radicado: radicadoStr });

      // Run orchestrated search with retries and fallbacks
      const orchestration = await orchestrateSearch(radicadoStr, supabase, runId, attempts, startTime);
      
      let { results, events, classification, debugExcerpt, sourcesTried, retryExhausted, phase1Results } = orchestration;

      // CRITICAL: Determine status based on classification
      // Technical errors should result in 'FAILED', not 'EMPTY' (which implies "no encontrado")
      const technicalErrors: Classification[] = [
        'SCRAPER_TIMEOUT_INPUT', 'SELECTOR_NOT_FOUND', 'BLOCKED_OR_CAPTCHA',
        'PAGE_STRUCTURE_CHANGED', 'NETWORK_FAILURE',
      ];
      
      const isTechnicalError = technicalErrors.includes(classification);
      const status = results.length > 0 || events.length > 0 ? 'SUCCESS' : 
                     isTechnicalError ? 'FAILED' :
                     (classification === 'NO_RESULTS_CONFIRMED' ? 'EMPTY' : 'ERROR');
      
      // Build why_empty if no results - DIFFERENTIATE technical errors
      let whyEmpty: string | undefined;
      if (results.length === 0 && events.length === 0) {
        if (isTechnicalError) {
          whyEmpty = `TECHNICAL_ERROR_${classification}`;
        } else if (classification === 'NO_RESULTS_CONFIRMED') {
          whyEmpty = 'ALL_SOURCES_EMPTY';
        } else if (classification === 'FALSE_NEGATIVE_RISK') {
          whyEmpty = 'POSSIBLE_FALSE_NEGATIVE';
        } else if (classification === 'INCOMPLETE_DATA') {
          whyEmpty = 'SILENCIO_DATOS';
        } else {
          whyEmpty = 'UNKNOWN_FAILURE';
        }
      }

      // Build proceso object for normalized response
      // CRITICAL: Also merge Phase 1 results parties if current results lack them
      if (phase1Results.length > 0 && results.length === 0) {
        results = phase1Results;
      }
      let proceso: AdapterResponse['proceso'] | undefined;
      if (results.length > 0 || events.length > 0) {
        const mainResult = results[0] || {};
        proceso = {
          despacho: mainResult.despacho || '',
          tipo: mainResult.tipo_proceso,
          clase: mainResult.clase_proceso,
          contenido_radicacion: mainResult.contenido_radicacion,
          // Include demandante/demandado in proceso so sync-by-radicado can read them
          demandante: mainResult.demandante,
          demandado: mainResult.demandado,
          fecha_radicacion: mainResult.fecha_radicacion,
          sujetos_procesales: mainResult.sujetos_procesales || [],
          actuaciones: events,
          estados_electronicos: [], // Would be populated if available
        };
      }

      // Finalize run
      if (runId) {
        await finalizeRun(
          supabase, 
          runId, 
          status, 
          startTime, 
          classification,
          attempts,
          attempts.find(a => a.success)?.status || attempts[attempts.length - 1]?.status || undefined,
          undefined,
          undefined,
          { 
            results_count: results.length,
            events_count: events.length,
            sources_tried: sourcesTried,
            retry_exhausted: retryExhausted,
          },
          debugExcerpt
        );
      }

      const response: AdapterResponse = {
        ok: results.length > 0 || events.length > 0,
        source: sourcesTried.join(' -> '),
        run_id: runId,
        classification,
        results,
        events,
        proceso,
        attempts: debug ? attempts : undefined,
        why_empty: whyEmpty,
        retry_exhausted: retryExhausted,
        sources_tried: sourcesTried,
      };

      return new Response(JSON.stringify(response), { 
        status: results.length > 0 ? 200 : (classification === 'NO_RESULTS_CONFIRMED' ? 404 : 500),
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (action === 'actuaciones') {
      // For actuaciones action, use orchestration as well
      if (!radicado) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Radicado is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const radicadoStr = String(radicado).trim().replace(/\D/g, '');
      const orchestration = await orchestrateSearch(radicadoStr, supabase, runId, attempts, startTime);
      
      if (runId) {
        await finalizeRun(supabase, runId, orchestration.events.length > 0 ? 'SUCCESS' : 'EMPTY', 
          startTime, orchestration.classification, attempts);
      }

      return new Response(JSON.stringify({
        ok: orchestration.events.length > 0,
        source: orchestration.sourcesTried.join(' -> '),
        run_id: runId,
        classification: orchestration.classification,
        events: orchestration.events,
        sources_tried: orchestration.sourcesTried,
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    return new Response(
      JSON.stringify({ ok: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('CPNU Adapter Error:', error);
    
    if (runId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      await finalizeRun(supabase, runId, 'ERROR', startTime, 'UNKNOWN', attempts, 
        undefined, 'EXCEPTION', error instanceof Error ? error.message : 'Unknown error');
    }

    return new Response(
      JSON.stringify({ 
        ok: false, 
        source: 'CPNU',
        run_id: runId,
        classification: 'UNKNOWN',
        error: error instanceof Error ? error.message : 'Unknown error',
        attempts,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
