import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

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

interface SearchResult {
  radicado: string;
  despacho: string;
  demandante?: string;
  demandado?: string;
  tipo_proceso?: string;
  fecha_radicacion?: string;
  detail_url?: string;
  id_proceso?: number | string;
}

interface AttemptLog {
  phase: 'DISCOVER_API' | 'QUERY_LIST' | 'FETCH_DETAIL' | 'FETCH_ACTUACIONES' | 'FIRECRAWL_ACTIONS';
  url: string;
  method: string;
  status: number | null;
  latency_ms: number;
  error_type?: 'HTTP_ERROR' | 'TIMEOUT' | 'NON_JSON' | 'PARSE_ERROR' | 'NETWORK_ERROR' | 'FIRECRAWL_ERROR';
  response_snippet_1kb?: string;
  success: boolean;
}

type Classification = 
  | 'SUCCESS'
  | 'NO_RESULTS_CONFIRMED'
  | 'ENDPOINT_404'
  | 'ENDPOINT_CHANGED'
  | 'BLOCKED_403_429'
  | 'NON_JSON_RESPONSE'
  | 'PARSE_BROKE'
  | 'INTERACTION_REQUIRED'
  | 'INTERACTION_FAILED_SELECTOR_CHANGED'
  | 'UNKNOWN';

interface AdapterResponse {
  ok: boolean;
  source: string;
  run_id: string | null;
  classification: Classification;
  results?: SearchResult[];
  events?: ProcessEvent[];
  error?: string;
  attempts?: AttemptLog[];
  why_empty?: string;
}

// ============= CANDIDATE ENDPOINTS =============
// These are discovered/tested endpoints for CPNU API
// Priority order: most likely to work first

const CPNU_API_CANDIDATES = {
  // NumeroRadicacion search endpoints - different host/port/path variants
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
    // POST variants
    {
      url: `https://consultaprocesos.ramajudicial.gov.co/api/v2/Procesos/Consulta/NumeroRadicacion`,
      method: 'POST',
      body: JSON.stringify({ numero: radicado, SoloActivos: soloActivos, pagina: 1 }),
      description: 'POST v2 NumeroRadicacion without port',
    },
    // Legacy v1 endpoints as fallback
    {
      url: `https://consultaprocesos.ramajudicial.gov.co/api/v1/Procesos/Consulta/NumeroRadicacion?numero=${radicado}`,
      method: 'GET',
      description: 'Legacy v1 NumeroRadicacion',
    },
  ],
  
  // Detail endpoints for a specific process
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
  
  // Actuaciones endpoints
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
  // Simple SHA-like hash
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
  // ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    try { return new Date(dateStr).toISOString(); } catch { return null; }
  }
  // DD/MM/YYYY or DD-MM-YYYY
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
  return 'ACTUACION';
}

function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
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
  headers: Record<string, string> = {}
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
      
      // Handle specific HTTP errors
      if (response.status === 404) {
        attempt.error_type = 'HTTP_ERROR';
        attempts.push(attempt);
        lastAttempt = attempt;
        continue; // Try next candidate
      }
      
      if (response.status === 403 || response.status === 429) {
        attempt.error_type = 'HTTP_ERROR';
        attempts.push(attempt);
        lastAttempt = attempt;
        // Don't try more candidates if blocked
        return { data: null, success: false, lastAttempt: attempt };
      }
      
      if (!response.ok) {
        attempt.error_type = 'HTTP_ERROR';
        attempts.push(attempt);
        lastAttempt = attempt;
        continue;
      }
      
      // Check if response is JSON
      if (!contentType.includes('application/json')) {
        // Could be HTML response
        if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
          attempt.error_type = 'NON_JSON';
          attempts.push(attempt);
          lastAttempt = attempt;
          continue;
        }
      }
      
      // Try to parse JSON
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
  jsResult?: any;
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
    
    // Build actions to:
    // 1. Wait for page load
    // 2. Select "Todos los Procesos" if needed
    // 3. Type radicado in the input
    // 4. Click Consultar
    // 5. Wait for results
    // 6. Execute JS to extract results
    
    const actions: any[] = [
      { type: 'wait', milliseconds: 2000 },
    ];
    
    // If we want all processes (not just last 30 days), click the second radio
    if (useTodosProcesos) {
      actions.push({
        type: 'click',
        selector: 'input[id="input-68"]', // "Todos los Procesos" radio
      });
      actions.push({ type: 'wait', milliseconds: 500 });
    }
    
    // Type the radicado into the input field
    actions.push({
      type: 'write',
      selector: 'input[maxlength="23"]',
      text: radicado,
    });
    
    actions.push({ type: 'wait', milliseconds: 500 });
    
    // Click the Consultar button
    actions.push({
      type: 'click',
      selector: 'button[aria-label="Consultar Número de radicación"]',
    });
    
    // Wait for results to load
    actions.push({ type: 'wait', milliseconds: 5000 });
    
    // Scroll down to ensure results are visible
    actions.push({ type: 'scroll', direction: 'down' });
    actions.push({ type: 'wait', milliseconds: 2000 });

    console.log('Firecrawl Actions: Sending request with actions:', JSON.stringify(actions));

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
    console.log('Firecrawl Actions: Markdown preview:', markdown.substring(0, 500));

    // Check if we still see the empty form
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
    
    // Check for "no results" message
    if (markdown.includes('No se encontraron') || markdown.includes('sin resultados')) {
      attempt.success = true;
      attempts.push(attempt);
      return {
        success: true,
        markdown,
        html,
        screenshot,
        classification: 'NO_RESULTS_CONFIRMED',
      };
    }
    
    // Check if radicado appears in results
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
    
    // Got some response but no clear success indicators
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
  
  console.log('Parsing content for radicado:', radicado);
  
  // Look for radicado in content
  if (!contentToCheck.includes(radicado)) {
    console.log('Radicado not found in content');
    
    // Check if it's the empty form
    if (markdown.includes('0 / 23') && markdown.includes('Número de Radicación')) {
      return { results: [], parseMethod: 'SPA_FORM_EMPTY' };
    }
    
    if (markdown.includes('No se encontraron') || markdown.includes('sin resultados')) {
      return { results: [], parseMethod: 'NO_RESULTS_MESSAGE' };
    }
    
    return { results: [], parseMethod: 'NO_MATCH' };
  }
  
  console.log('Found radicado in content!');
  
  // Try to extract idProceso from various patterns
  let idProceso: string | number | undefined;
  
  // Pattern 1: idProceso=XXXXXX in URLs
  const urlMatch = contentToCheck.match(/idProceso[=\/](\d+)/i);
  if (urlMatch) {
    idProceso = urlMatch[1];
    console.log('Found idProceso from URL:', idProceso);
  }
  
  // Pattern 2: data-id or similar attributes
  const dataIdMatch = contentToCheck.match(/data-(?:id|proceso)[="](\d+)/i);
  if (!idProceso && dataIdMatch) {
    idProceso = dataIdMatch[1];
    console.log('Found idProceso from data attribute:', idProceso);
  }
  
  // Try to extract despacho (court name)
  let despacho = 'Despacho encontrado';
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
  
  // Try to extract demandante/demandado
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

// Parse actuaciones from JSON API response
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
      detail: act.detalle || undefined,
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

// Parse actuaciones from markdown (fallback)
function parseActuacionesFromMarkdown(markdown: string, radicado: string, sourceUrl: string): ProcessEvent[] {
  const events: ProcessEvent[] = [];
  const lines = markdown.split('\n');
  
  for (const line of lines) {
    // Look for date patterns followed by text
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

// ============= CLASSIFY RESULT =============

function classifyResult(
  attempts: AttemptLog[],
  results: SearchResult[],
  events: ProcessEvent[],
  firecrawlClassification?: Classification
): Classification {
  
  // If Firecrawl gave us a classification, use it
  if (firecrawlClassification && firecrawlClassification !== 'UNKNOWN') {
    return firecrawlClassification;
  }
  
  // Check for success
  if (results.length > 0 || events.length > 0) {
    return 'SUCCESS';
  }
  
  // Analyze attempts to classify failure
  const lastAttempt = attempts[attempts.length - 1];
  
  if (!lastAttempt) {
    return 'UNKNOWN';
  }
  
  // All attempts were 404
  const all404 = attempts.every(a => a.status === 404);
  if (all404) {
    return 'ENDPOINT_404';
  }
  
  // Any 403/429 = blocked
  const blocked = attempts.some(a => a.status === 403 || a.status === 429);
  if (blocked) {
    return 'BLOCKED_403_429';
  }
  
  // All attempts returned non-JSON
  const allNonJson = attempts.every(a => a.error_type === 'NON_JSON');
  if (allNonJson) {
    return 'NON_JSON_RESPONSE';
  }
  
  // Had successful fetch but no results extracted
  const hadSuccess = attempts.some(a => a.success);
  if (hadSuccess && results.length === 0 && events.length === 0) {
    return 'PARSE_BROKE';
  }
  
  return 'UNKNOWN';
}

// ============= AUTH HELPER =============

// Helper to extract and validate user from JWT
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
    
    // Authenticate user from JWT token
    const authUser = await getAuthenticatedUser(req, supabaseUrl, supabaseAnonKey);
    if (!authUser) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized - valid authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Use authenticated user's ID instead of trusting request body
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

      // Ensure radicado is a clean string of 23 digits
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

      // PHASE 1: Try direct API endpoints
      console.log('PHASE 1: Trying direct API endpoints...');
      if (runId) await addStep(supabase, runId, 'PHASE_1_API', true, 'Starting direct API attempts');
      
      // First try with SoloActivos=false (all processes)
      const searchCandidates = CPNU_API_CANDIDATES.searchByRadicado(radicadoStr, false);
      const apiResult = await cpnuFetchJson(searchCandidates, 'QUERY_LIST', attempts);
      
      let results: SearchResult[] = [];
      let events: ProcessEvent[] = [];
      let classification: Classification = 'UNKNOWN';
      let debugExcerpt = '';
      
      if (apiResult.success && apiResult.data) {
        console.log('API success! Parsing results...');
        if (runId) await addStep(supabase, runId, 'API_SUCCESS', true, 'Got JSON response from API');
        
        // Parse the API response
        const procesos = apiResult.data.procesos || apiResult.data.data || apiResult.data;
        
        if (Array.isArray(procesos) && procesos.length > 0) {
          for (const p of procesos) {
            results.push({
              radicado: p.numero || p.radicado || radicadoStr,
              despacho: p.despacho || p.nombreDespacho || '',
              demandante: p.demandante,
              demandado: p.demandado,
              tipo_proceso: p.tipoProceso || p.clase,
              fecha_radicacion: p.fechaRadicacion || p.fecha,
              id_proceso: p.idProceso || p.id,
              detail_url: p.idProceso ? `https://consultaprocesos.ramajudicial.gov.co/Procesos/Detalle?idProceso=${p.idProceso}` : undefined,
            });
          }
          
          // Try to fetch actuaciones for the first process
          if (results.length > 0 && results[0].id_proceso) {
            const actCandidates = CPNU_API_CANDIDATES.actuaciones(results[0].id_proceso);
            const actResult = await cpnuFetchJson(actCandidates, 'FETCH_ACTUACIONES', attempts);
            
            if (actResult.success && actResult.data) {
              events = parseActuacionesFromJson(actResult.data, radicadoStr, actCandidates[0].url);
              if (runId) await addStep(supabase, runId, 'ACTUACIONES', true, `Found ${events.length} actuaciones from API`);
            }
          }
          
          classification = 'SUCCESS';
        } else {
          classification = 'NO_RESULTS_CONFIRMED';
        }
        
        debugExcerpt = JSON.stringify(apiResult.data).substring(0, 10000);
        
      } else {
        // PHASE 2: Fallback to Firecrawl with actions
        console.log('PHASE 2: API failed, trying Firecrawl actions fallback...');
        if (runId) await addStep(supabase, runId, 'PHASE_2_FIRECRAWL', true, 'API attempts failed, trying Firecrawl actions', { 
          api_attempts: attempts.length,
          last_status: apiResult.lastAttempt.status,
        });
        
        const fcResult = await scrapeWithFirecrawlActions(radicadoStr, attempts, true);
        
        if (fcResult.success && fcResult.markdown) {
          debugExcerpt = fcResult.markdown.substring(0, 10000);
          
          const parseResult = parseSearchResultsFromContent(fcResult.markdown, fcResult.html || '', radicadoStr);
          results = parseResult.results;
          
          if (results.length > 0) {
            if (runId) await addStep(supabase, runId, 'PARSE', true, `Parsed ${results.length} results via ${parseResult.parseMethod}`);
            
            // Try to get actuaciones from the page content
            events = parseActuacionesFromMarkdown(fcResult.markdown, radicadoStr, 'https://consultaprocesos.ramajudicial.gov.co/Procesos/NumeroRadicacion');
            if (events.length > 0) {
              if (runId) await addStep(supabase, runId, 'ACTUACIONES', true, `Parsed ${events.length} actuaciones from Firecrawl content`);
            }
          } else {
            if (runId) await addStep(supabase, runId, 'PARSE', false, `No results parsed, method: ${parseResult.parseMethod}`);
          }
          
          classification = fcResult.classification || classifyResult(attempts, results, events);
        } else {
          classification = fcResult.classification || classifyResult(attempts, results, events);
          debugExcerpt = fcResult.error || 'Firecrawl failed';
          if (runId) await addStep(supabase, runId, 'FIRECRAWL_FAIL', false, fcResult.error);
        }
      }

      // Determine final status
      const status = results.length > 0 || events.length > 0 ? 'SUCCESS' : (classification === 'NO_RESULTS_CONFIRMED' ? 'EMPTY' : 'ERROR');
      
      // Build why_empty if no results
      let whyEmpty: string | undefined;
      if (results.length === 0 && events.length === 0) {
        if (classification === 'NO_RESULTS_CONFIRMED') {
          whyEmpty = 'EMPTY_NO_MATCH';
        } else if (classification === 'ENDPOINT_404') {
          whyEmpty = 'ALL_ENDPOINTS_404';
        } else if (classification === 'BLOCKED_403_429') {
          whyEmpty = 'BLOCKED_BY_SERVER';
        } else if (classification === 'INTERACTION_FAILED_SELECTOR_CHANGED') {
          whyEmpty = 'SPA_SELECTORS_CHANGED';
        } else if (classification === 'PARSE_BROKE') {
          whyEmpty = 'PARSE_EXTRACTED_ZERO';
        } else {
          whyEmpty = 'UNKNOWN_FAILURE';
        }
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
          status === 'ERROR' ? classification : undefined,
          status === 'ERROR' ? whyEmpty : undefined,
          { 
            results_count: results.length, 
            events_count: events.length,
            attempts_count: attempts.length,
            classification,
            why_empty: whyEmpty,
          },
          debugExcerpt
        );
      }

      const response: AdapterResponse = {
        ok: status === 'SUCCESS' || status === 'EMPTY',
        source: 'CPNU',
        run_id: runId,
        classification,
        results,
        events,
        attempts: debug ? attempts : undefined,
        why_empty: whyEmpty,
      };

      return new Response(JSON.stringify(response), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Unknown action
    const response: AdapterResponse = {
      ok: false,
      source: 'CPNU',
      run_id: runId,
      classification: 'UNKNOWN',
      error: `Unknown action: ${action}`,
      attempts,
    };
    return new Response(JSON.stringify(response), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('CPNU adapter error:', error);
    const response: AdapterResponse = {
      ok: false,
      source: 'CPNU',
      run_id: runId,
      classification: 'UNKNOWN',
      error: error instanceof Error ? error.message : 'Unknown error',
      attempts,
    };
    return new Response(JSON.stringify(response), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
