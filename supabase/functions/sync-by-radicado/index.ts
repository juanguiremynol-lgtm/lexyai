/**
 * sync-by-radicado Edge Function
 * 
 * REFACTORED: Multi-provider lookup based on workflow_type:
 * - CGP/LABORAL: CPNU only (no fallback - civil/labor processes only exist in CPNU)
 * - CPACA: SAMAI primary (administrative litigation)
 * - TUTELA: CPNU primary, TUTELAS API fallback
 * - PENAL_906: CPNU primary
 * 
 * Modes:
 * - LOOKUP: Preview data without persisting (resolves via server-side adapters)
 * - SYNC_AND_APPLY: Create/update work_item and sync events
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= TYPES =============

interface SyncRequest {
  radicado: string;
  force_refresh?: boolean;
  mode?: 'LOOKUP' | 'SYNC_AND_APPLY';
  create_if_missing?: boolean;
  workflow_type?: string;
  stage?: string;
  client_id?: string;
}

interface SyncResponse {
  ok: boolean;
  work_item_id?: string;
  created: boolean;
  updated: boolean;
  found_in_source: boolean;
  source_used: string | null;
  sources_checked: string[];
  new_events_count: number;
  milestones_triggered: number;
  cgp_phase?: 'FILING' | 'PROCESS';
  classification_reason?: string;
  process_data?: ProcessData;
  error?: string;
  code?: string;
  attempts?: AttemptLog[];
  // Parallel sync stats
  sync_strategy?: 'fallback' | 'parallel';
  consolidation_stats?: {
    total_from_sources: number;
    after_dedup: number;
    duplicates_removed: number;
  };
}

interface ProcessData {
  despacho?: string;
  ciudad?: string;
  departamento?: string;
  demandante?: string;
  demandado?: string;
  tipo_proceso?: string;
  clase_proceso?: string;
  fecha_radicacion?: string;
  ultima_actuacion?: string;
  fecha_ultima_actuacion?: string;
  sujetos_procesales?: Array<{ tipo: string; nombre: string }>;
  actuaciones?: Array<{
    fecha: string;
    actuacion: string;
    anotacion?: string;
  }>;
  total_actuaciones?: number;
}

interface AttemptLog {
  source: string;
  success: boolean;
  latency_ms: number;
  error?: string;
  events_found?: number;
}

interface ProviderResult {
  ok: boolean;
  found: boolean;
  source: string;
  processData: ProcessData;
  latency_ms: number;
  error?: string;
  eventsFound?: number;
}

type WorkflowType = 'CGP' | 'LABORAL' | 'CPACA' | 'TUTELA' | 'PENAL_906' | 'PETICION' | 'GOV_PROCEDURE';

interface ProviderConfig {
  primary: 'CPNU' | 'SAMAI' | 'TUTELAS';
  fallback?: 'CPNU' | 'SAMAI' | 'TUTELAS';
  fallbackEnabled: boolean;
  useParallelSync: boolean;  // NEW: Enable parallel multi-source sync
  parallelProviders?: ('CPNU' | 'SAMAI' | 'TUTELAS')[];  // Providers to query in parallel
}

interface ParallelProviderResult {
  provider: string;
  status: 'success' | 'error' | 'empty' | 'timeout';
  processData: ProcessData;
  actuaciones: Array<{ fecha: string; actuacion: string; anotacion?: string; provider?: string }>;
  latencyMs: number;
  error?: string;
}

interface ConsolidatedLookupResult {
  processData: ProcessData;
  actuaciones: Array<{ fecha: string; actuacion: string; anotacion?: string; sources: string[]; primarySource: string }>;
  providerResults: ParallelProviderResult[];
  totalFromSources: number;
  afterDedup: number;
}

// ============= PROVIDER CONFIGURATION =============

function getProviderOrder(workflowType: string): ProviderConfig {
  switch (workflowType) {
    case 'CPACA':
      // Administrative litigation - SAMAI primary, no fallback to CPNU
      return { primary: 'SAMAI', fallbackEnabled: false, useParallelSync: false };
    case 'TUTELA':
      // Tutela - PARALLEL SYNC: Query all sources simultaneously
      return { 
        primary: 'CPNU', 
        fallback: 'TUTELAS', 
        fallbackEnabled: true,
        useParallelSync: true,  // Enable parallel sync for Tutelas
        parallelProviders: ['CPNU', 'SAMAI', 'TUTELAS']  // Query all sources
      };
    case 'CGP':
    case 'LABORAL':
    case 'PENAL_906':
    default:
      // Civil/Labor/Penal - CPNU only, no fallback (SAMAI doesn't have these)
      return { primary: 'CPNU', fallbackEnabled: false, useParallelSync: false };
  }
}

// ============= HELPERS =============

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, message: string, status: number = 400): Response {
  return jsonResponse({
    ok: false,
    code,
    message,
    timestamp: new Date().toISOString(),
  }, status);
}

/**
 * Extract city from despacho string (e.g., "JUZGADO 002 CIVIL MUNICIPAL DE MEDELLÍN" -> "MEDELLÍN")
 */
function extractCityFromDespacho(despacho: string): string {
  if (!despacho) return '';
  
  // Common patterns: "... DE [CITY]" or "... - [CITY]"
  const deMatch = despacho.match(/(?:\sDE\s+|\s-\s+)([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+)$/i);
  if (deMatch) {
    return deMatch[1].trim();
  }
  
  // List of major Colombian cities to detect
  const majorCities = [
    'BOGOTÁ', 'BOGOTA', 'MEDELLÍN', 'MEDELLIN', 'CALI', 'BARRANQUILLA', 
    'CARTAGENA', 'BUCARAMANGA', 'CÚCUTA', 'CUCUTA', 'PEREIRA', 'MANIZALES',
    'IBAGUÉ', 'IBAGUE', 'SANTA MARTA', 'VILLAVICENCIO', 'PASTO', 'MONTERÍA',
    'NEIVA', 'VALLEDUPAR', 'ARMENIA', 'SINCELEJO', 'POPAYÁN', 'TUNJA',
    'FLORENCIA', 'QUIBDÓ', 'RIOHACHA', 'MOCOA', 'YOPAL', 'LETICIA', 'ARAUCA',
    'MITÚ', 'SAN JOSÉ DEL GUAVIARE', 'PUERTO CARREÑO', 'INÍRIDA',
  ];
  
  const upper = despacho.toUpperCase();
  for (const city of majorCities) {
    if (upper.includes(city)) {
      return city;
    }
  }
  
  return '';
}

/**
 * Extract department from despacho or infer from city
 */
function extractDepartmentFromDespacho(despacho: string): string {
  const city = extractCityFromDespacho(despacho);
  
  // City to department mapping
  const cityToDept: Record<string, string> = {
    'BOGOTÁ': 'CUNDINAMARCA', 'BOGOTA': 'CUNDINAMARCA',
    'MEDELLÍN': 'ANTIOQUIA', 'MEDELLIN': 'ANTIOQUIA',
    'CALI': 'VALLE DEL CAUCA',
    'BARRANQUILLA': 'ATLÁNTICO',
    'CARTAGENA': 'BOLÍVAR',
    'BUCARAMANGA': 'SANTANDER',
    'CÚCUTA': 'NORTE DE SANTANDER', 'CUCUTA': 'NORTE DE SANTANDER',
    'PEREIRA': 'RISARALDA',
    'MANIZALES': 'CALDAS',
    'IBAGUÉ': 'TOLIMA', 'IBAGUE': 'TOLIMA',
    'SANTA MARTA': 'MAGDALENA',
    'VILLAVICENCIO': 'META',
    'PASTO': 'NARIÑO',
    'MONTERÍA': 'CÓRDOBA',
    'NEIVA': 'HUILA',
    'VALLEDUPAR': 'CESAR',
    'ARMENIA': 'QUINDÍO',
    'SINCELEJO': 'SUCRE',
    'POPAYÁN': 'CAUCA',
    'TUNJA': 'BOYACÁ',
    'FLORENCIA': 'CAQUETÁ',
    'QUIBDÓ': 'CHOCÓ',
    'RIOHACHA': 'LA GUAJIRA',
  };
  
  if (city && cityToDept[city.toUpperCase()]) {
    return cityToDept[city.toUpperCase()];
  }
  
  return '';
}

/**
 * Validate and normalize radicado input
 */
function validateRadicado(radicado: string, workflowType?: string): { 
  valid: boolean; 
  normalized: string; 
  error?: string;
  errorCode?: string;
} {
  if (!radicado || typeof radicado !== 'string') {
    return { 
      valid: false, 
      normalized: '', 
      error: 'Radicado es requerido',
      errorCode: 'EMPTY_RADICADO',
    };
  }
  
  const normalized = radicado.replace(/\D/g, '');
  
  if (normalized.length === 0) {
    return { 
      valid: false, 
      normalized: '', 
      error: 'El radicado no contiene dígitos válidos',
      errorCode: 'INVALID_CHARS',
    };
  }
  
  if (normalized.length !== 23) {
    return { 
      valid: false, 
      normalized, 
      error: `El radicado debe tener exactamente 23 dígitos (tiene ${normalized.length})`,
      errorCode: 'INVALID_LENGTH',
    };
  }
  
  if (workflowType === 'CGP') {
    const ending = normalized.slice(-2);
    if (ending !== '00' && ending !== '01') {
      return {
        valid: false,
        normalized,
        error: `El radicado CGP debe terminar en 00 o 01 (termina en ${ending})`,
        errorCode: 'INVALID_ENDING',
      };
    }
  }
  
  return { valid: true, normalized };
}

/**
 * Detect if Auto Admisorio exists in actuaciones
 */
function detectAutoAdmisorio(actuaciones: Array<{ actuacion: string; anotacion?: string }>): {
  hasAutoAdmisorio: boolean;
  reason: string;
} {
  // Extended patterns to match various court formats including SAMAI's "Auto que admite tutela"
  const AUTO_ADMISORIO_PATTERNS = [
    /auto\s+admisorio/i,
    /admite\s+demanda/i,
    /admision\s+de\s+demanda/i,
    /auto\s+que\s+admite/i,
    /se\s+admite\s+la?\s+demanda/i,
    /admite\s+tutela/i,
    /admite\s+la\s+tutela/i,
    /admision\s+tutela/i,
    /auto\s+admite\s+tutela/i,
    /auto\s+admite\s+la\s+tutela/i,
    /auto\s+avoca\s+conocimiento/i,
    /avoca\s+conocimiento/i,
    /auto\s+admite\s+accion/i,
    /auto\s+admite\s+la\s+accion/i,
  ];

  for (const act of actuaciones) {
    const text = `${act.actuacion || ''} ${act.anotacion || ''}`.toLowerCase();
    for (const pattern of AUTO_ADMISORIO_PATTERNS) {
      if (pattern.test(text)) {
        return {
          hasAutoAdmisorio: true,
          reason: `Auto Admisorio detectado: "${(act.actuacion || '').substring(0, 50)}..."`,
        };
      }
    }
  }

  return {
    hasAutoAdmisorio: false,
    reason: 'No se encontró Auto Admisorio en las actuaciones',
  };
}

/**
 * Parse Colombian date strings to ISO format
 */
function parseColombianDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  
  const patterns = [
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    /^(\d{2})-(\d{2})-(\d{4})$/,
    /^(\d{4})-(\d{2})-(\d{2})$/,
  ];

  for (const pattern of patterns) {
    const match = dateStr.match(pattern);
    if (match) {
      if (pattern.source.startsWith('(\\d{4})')) {
        return dateStr;
      }
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
  }
  
  return null;
}

// ============= PROVIDER FETCH FUNCTIONS =============

/**
 * Fetch from CPNU via adapter-cpnu Edge Function
 */
async function fetchFromCpnu(
  radicado: string, 
  supabaseUrl: string, 
  authHeader: string
): Promise<ProviderResult> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/adapter-cpnu`,
      {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          radicado,
          action: 'search',
        }),
      }
    );

    const result = await response.json();
    const latency = Date.now() - startTime;

    console.log(`[CPNU] Response: ok=${result.ok}, has_proceso=${!!result.proceso}, has_results=${!!result.results?.length}`);

    if (result.ok && (result.proceso || result.results?.length > 0)) {
      const proceso = result.proceso || {};
      const firstResult = result.results?.[0] || {};
      
      // Extract parties from sujetos_procesales (prefer proceso, fallback to firstResult)
      let demandantes = '';
      let demandados = '';
      
      const sujetosSource = proceso.sujetos_procesales?.length > 0 
        ? proceso.sujetos_procesales 
        : (firstResult.sujetos_procesales || []);
      
      if (sujetosSource.length > 0) {
        const demandantesList = sujetosSource
          .filter((s: { tipo: string }) => 
            s.tipo?.toLowerCase().includes('demandante') || 
            s.tipo?.toLowerCase().includes('actor') ||
            s.tipo?.toLowerCase().includes('accionante')
          )
          .map((s: { nombre: string }) => s.nombre);
        const demandadosList = sujetosSource
          .filter((s: { tipo: string }) => 
            s.tipo?.toLowerCase().includes('demandado') ||
            s.tipo?.toLowerCase().includes('accionado')
          )
          .map((s: { nombre: string }) => s.nombre);
        
        if (demandantesList.length) demandantes = demandantesList.join(', ');
        if (demandadosList.length) demandados = demandadosList.join(', ');
      }
      
      // Fallback: Check firstResult for demandante/demandado direct fields
      if (!demandantes && firstResult.demandante) {
        demandantes = firstResult.demandante;
      }
      if (!demandados && firstResult.demandado) {
        demandados = firstResult.demandado;
      }
      
      // Also check proceso for direct fields
      if (!demandantes && proceso.demandante) {
        demandantes = proceso.demandante;
      }
      if (!demandados && proceso.demandado) {
        demandados = proceso.demandado;
      }

      const actuaciones = (proceso.actuaciones || []).map((act: Record<string, unknown>) => ({
        fecha: (act.fecha_actuacion || act.fecha || '') as string,
        actuacion: (act.actuacion || '') as string,
        anotacion: (act.anotacion || '') as string,
      }));
      
      // Extract location info from multiple sources
      const despacho = proceso.despacho || firstResult.despacho || '';
      const ciudad = proceso.ciudad || firstResult.ciudad || extractCityFromDespacho(despacho);
      const departamento = proceso.departamento || firstResult.departamento || extractDepartmentFromDespacho(despacho);
      
      console.log(`[CPNU] Extracted: despacho="${despacho}", ciudad="${ciudad}", demandantes="${demandantes}", demandados="${demandados}"`);

      return {
        ok: true,
        found: true,
        source: 'CPNU',
        processData: {
          despacho,
          ciudad,
          departamento,
          demandante: demandantes,
          demandado: demandados,
          tipo_proceso: proceso.tipo || firstResult.tipo_proceso,
          clase_proceso: proceso.clase || firstResult.clase_proceso,
          fecha_radicacion: proceso.fecha_radicacion || firstResult.fecha_radicacion,
          sujetos_procesales: sujetosSource,
          actuaciones,
          total_actuaciones: actuaciones.length,
        },
        latency_ms: latency,
        eventsFound: actuaciones.length,
      };
    }

    return {
      ok: true,
      found: false,
      source: 'CPNU',
      processData: {},
      latency_ms: latency,
      error: result.error || result.why_empty || 'No results',
    };
  } catch (err) {
    return {
      ok: false,
      found: false,
      source: 'CPNU',
      processData: {},
      latency_ms: Date.now() - startTime,
      error: err instanceof Error ? err.message : 'CPNU fetch failed',
    };
  }
}

/**
 * Extract parties from SAMAI actuaciones anotaciones
 * SAMAI often has party info in actuacion annotations like:
 * "El Señor(a): WILSON DAVID GALINDO GONZALEZ"
 */
function extractPartiesFromSamaiActuaciones(actuaciones: Array<{ anotacion?: string }>): {
  accionantes: string[];
  accionados: string[];
} {
  const accionantes: string[] = [];
  const accionados: string[] = [];
  
  for (const act of actuaciones) {
    const anotacion = act.anotacion || '';
    
    // Pattern: "El Señor(a): NOMBRE COMPLETO" or "El Señor(a):NOMBRE"
    const personMatch = anotacion.match(/El Señor\(a\):?\s*([A-ZÁÉÍÓÚÑ\s]+?)(?:\s+con|\s+presenta|\s+solicita|,|$)/i);
    if (personMatch && !accionantes.includes(personMatch[1].trim())) {
      accionantes.push(personMatch[1].trim());
    }
    
    // Pattern: "contra ENTIDAD"
    const entidadMatch = anotacion.match(/contra\s+([A-ZÁÉÍÓÚÑ\s]+?)(?:\s+por|\s+en|\.|,|$)/i);
    if (entidadMatch && !accionados.includes(entidadMatch[1].trim())) {
      accionados.push(entidadMatch[1].trim());
    }
    
    // Pattern: "accionante: NOMBRE" or "tutelante: NOMBRE"
    const accionanteMatch = anotacion.match(/(?:accionante|tutelante|demandante):\s*([A-ZÁÉÍÓÚÑ\s]+?)(?:\s+\||,|$)/i);
    if (accionanteMatch && !accionantes.includes(accionanteMatch[1].trim())) {
      accionantes.push(accionanteMatch[1].trim());
    }
    
    // Pattern: "accionado: NOMBRE" or "tutelado: NOMBRE"
    const accionadoMatch = anotacion.match(/(?:accionado|tutelado|demandado):\s*([A-ZÁÉÍÓÚÑ\s]+?)(?:\s+\||,|$)/i);
    if (accionadoMatch && !accionados.includes(accionadoMatch[1].trim())) {
      accionados.push(accionadoMatch[1].trim());
    }
  }
  
  return { accionantes, accionados };
}

/**
 * Fetch from SAMAI Cloud Run service
 * 
 * SAMAI has unique field names compared to CPNU:
 * - origen / corporacion → despacho
 * - ponente → judge name
 * - clase → process type
 * - fechaActuacion / fechaRegistro → date fields in actuaciones
 * 
 * SAMAI uses async flow: /buscar → jobId → /resultado/{jobId}
 * We poll the resultado endpoint for up to 30 seconds
 */
async function fetchFromSamai(radicado: string): Promise<ProviderResult> {
  const startTime = Date.now();
  const samaiBaseUrl = Deno.env.get('SAMAI_BASE_URL');
  const apiKey = Deno.env.get('SAMAI_X_API_KEY') || Deno.env.get('EXTERNAL_X_API_KEY');

  if (!samaiBaseUrl || !apiKey) {
    return {
      ok: false,
      found: false,
      source: 'SAMAI',
      processData: {},
      latency_ms: Date.now() - startTime,
      error: 'SAMAI not configured (missing BASE_URL or API_KEY)',
    };
  }

  try {
    // SAMAI uses /buscar to trigger scraping and returns a jobId
    console.log(`[sync-by-radicado] Calling SAMAI /buscar: ${samaiBaseUrl}/buscar?numero_radicacion=${radicado}`);
    
    const buscarResponse = await fetch(
      `${samaiBaseUrl}/buscar?numero_radicacion=${radicado}`,
      {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!buscarResponse.ok) {
      return {
        ok: false,
        found: false,
        source: 'SAMAI',
        processData: {},
        latency_ms: Date.now() - startTime,
        error: `SAMAI /buscar returned ${buscarResponse.status}`,
      };
    }

    const buscarResult = await buscarResponse.json();
    
    console.log(`[sync-by-radicado][SAMAI] /buscar response:`, buscarResult);
    
    // Get jobId from response
    const jobId = buscarResult.jobId || buscarResult.job_id || buscarResult.id;
    
    if (!jobId) {
      // No jobId - check if data is returned directly (cached response or status: "done")
      // CRITICAL: SAMAI wraps cached data in "result" object: { success: true, status: "done", result: {...} }
      const cachedData = buscarResult.result || buscarResult.data || buscarResult;
      const hasCachedActuaciones = (cachedData.actuaciones?.length || 0) > 0;
      const isCachedDone = buscarResult.status === 'done' || buscarResult.cached === true;
      
      if (hasCachedActuaciones || isCachedDone) {
        // Data returned directly, parse it
        console.log(`[sync-by-radicado][SAMAI] Data returned directly from /buscar (cached=${buscarResult.cached}, status=${buscarResult.status}, actuaciones=${cachedData.actuaciones?.length || 0})`);
        return parseSamaiResult(buscarResult, Date.now() - startTime);
      }
      
      return {
        ok: true,
        found: false,
        source: 'SAMAI',
        processData: {},
        latency_ms: Date.now() - startTime,
        error: `SAMAI /buscar did not return a jobId or cached data (keys: ${Object.keys(buscarResult).join(',')})`,
      };
    }
    
    // Poll for result (up to 30 seconds)
    const MAX_POLL_TIME_MS = 30000;
    const POLL_INTERVAL_MS = 1500;
    const pollStartTime = Date.now();
    
    while (Date.now() - pollStartTime < MAX_POLL_TIME_MS) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      
      const resultUrl = `${samaiBaseUrl}/resultado/${jobId}`;
      console.log(`[sync-by-radicado][SAMAI] Polling resultado: ${resultUrl}`);
      
      const resultResponse = await fetch(resultUrl, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
      });
      
      if (!resultResponse.ok) {
        if (resultResponse.status === 404) {
          // Job not ready yet, continue polling
          continue;
        }
        return {
          ok: false,
          found: false,
          source: 'SAMAI',
          processData: {},
          latency_ms: Date.now() - startTime,
          error: `SAMAI /resultado returned ${resultResponse.status}`,
        };
      }
      
      const result = await resultResponse.json();
      
      // Check job status
      const status = result.status || result.state;
      if (status === 'pending' || status === 'queued' || status === 'processing') {
        console.log(`[sync-by-radicado][SAMAI] Job ${jobId} still ${status}, continuing to poll...`);
        continue;
      }
      
      // Job completed - parse result
      console.log(`[sync-by-radicado][SAMAI] Job ${jobId} completed, parsing result`);
      return parseSamaiResult(result, Date.now() - startTime);
    }
    
    // Timeout reached
    return {
      ok: true,
      found: false,
      source: 'SAMAI',
      processData: {},
      latency_ms: Date.now() - startTime,
      error: `SAMAI polling timeout after ${MAX_POLL_TIME_MS}ms`,
    };
    
  } catch (err) {
    return {
      ok: false,
      found: false,
      source: 'SAMAI',
      processData: {},
      latency_ms: Date.now() - startTime,
      error: err instanceof Error ? err.message : 'SAMAI fetch failed',
    };
  }
}

/**
 * Parse SAMAI result into ProviderResult format
 */
function parseSamaiResult(result: Record<string, unknown>, latency: number): ProviderResult {
    console.log(`[sync-by-radicado][SAMAI] Raw response keys:`, Object.keys(result));
    
    // CRITICAL: SAMAI wraps actual process data in a "result" object!
    // Structure: { success: true, status: "done", result: { sujetos: [...], actuaciones: [...], ... } }
    // The "result" key contains the actual process data, NOT the top level!
    
    // First, find where the actual process data lives
    // Priority: result.result (SAMAI's nested structure) > result.data > result.proceso > result itself
    const nestedResult = result.result as Record<string, unknown> | undefined;
    const resultData = result.data as Record<string, unknown> | undefined;
    const resultProceso = result.proceso as Record<string, unknown> | undefined;
    
    // The proceso object is where the actual data lives
    const proceso = nestedResult || resultData || resultProceso || result;
    
    console.log(`[sync-by-radicado][SAMAI] Using proceso from: ${nestedResult ? 'result.result' : resultData ? 'result.data' : resultProceso ? 'result.proceso' : 'result (root)'}`);
    console.log(`[sync-by-radicado][SAMAI] Proceso keys:`, Object.keys(proceso));
    
    // Check for data presence indicators
    const hasActuaciones = ((proceso.actuaciones as unknown[] | undefined)?.length || 0) > 0;
    const hasSujetos = ((proceso.sujetos as unknown[] | undefined)?.length || 0) > 0;
    const hasOrigen = !!(proceso.origen || proceso.ponente || proceso.despacho);
    const hasRadicado = !!(proceso.radicado);
    
    console.log(`[sync-by-radicado][SAMAI] Data indicators: hasActuaciones=${hasActuaciones}, hasSujetos=${hasSujetos}, hasOrigen=${hasOrigen}, hasRadicado=${hasRadicado}`);
    
    // Check if we have any meaningful data
    if (!hasActuaciones && !hasSujetos && !hasOrigen && !hasRadicado && result.status !== 'done' && result.status !== 'completed') {
      return {
        ok: true,
        found: false,
        source: 'SAMAI',
        processData: {},
        latency_ms: latency,
        error: `No data in SAMAI response (status: ${result.status || 'unknown'})`,
      };
    }
    
    // ============= CRITICAL FIX: SAMAI uses DIFFERENT field names than CPNU =============
    // SAMAI: sujetos[].tipo = "ACTOR", "DEMANDADO", "TERCERO INTERVINIENTE/INTERESADO"
    // SAMAI: sujetos[].nombre = party name (NOT nombreRazonSocial)
    // CPNU:  sujetos[].tipoSujeto = "Demandante", "Demandado"
    // CPNU:  sujetos[].nombreRazonSocial = party name
    
    // Extract parties from sujetos array (SAMAI-specific field names!)
    let demandantes = '';
    let demandados = '';
    
    // SAMAI uses "sujetos" (not sujetos_procesales)
    const sujetosSource = (proceso.sujetos || proceso.sujetos_procesales || proceso.partes || []) as Array<{ 
      tipo?: string; 
      tipoSujeto?: string;  // CPNU fallback
      nombre?: string; 
      nombreRazonSocial?: string;  // CPNU fallback
      registro?: string;
    }>;
    
    console.log(`[sync-by-radicado][SAMAI] Found ${sujetosSource.length} sujetos to process`);
    
    if (sujetosSource.length > 0) {
      // Log first sujeto for debugging
      console.log(`[sync-by-radicado][SAMAI] First sujeto sample:`, JSON.stringify(sujetosSource[0]));
      
      const demandantesList = sujetosSource
        .filter((s) => 
          {
            // SAMAI uses "tipo" field with values: "ACTOR", "DEMANDADO", etc.
            // CPNU uses "tipoSujeto" field with values: "Demandante", "Demandado", etc.
            const tipo = ((s.tipo || s.tipoSujeto || '')).toUpperCase();
            const isActor = tipo === 'ACTOR' || 
                           tipo.includes('DEMANDANTE') || 
                           tipo.includes('ACCIONANTE') ||
                           tipo.includes('TUTELANTE') ||
                           tipo.includes('REQUIRENTE');
            if (isActor) {
              console.log(`[sync-by-radicado][SAMAI] Found demandante/actor: tipo="${s.tipo}", nombre="${s.nombre}"`);
            }
            return isActor;
          }
        )
        .map((s) => s.nombre || s.nombreRazonSocial || '')
        .filter(Boolean);
        
      const demandadosList = sujetosSource
        .filter((s) => 
          {
            const tipo = ((s.tipo || s.tipoSujeto || '')).toUpperCase();
            const isAccionado = tipo === 'DEMANDADO' ||
                               tipo.includes('ACCIONADO') ||
                               tipo.includes('TUTELADO') ||
                               tipo.includes('REQUERIDO');
            if (isAccionado) {
              console.log(`[sync-by-radicado][SAMAI] Found demandado/accionado: tipo="${s.tipo}", nombre="${s.nombre}"`);
            }
            return isAccionado;
          }
        )
        .map((s) => s.nombre || s.nombreRazonSocial || '')
        .filter(Boolean);
      
      if (demandantesList.length) demandantes = demandantesList.join(', ');
      if (demandadosList.length) demandados = demandadosList.join(', ');
      
      console.log(`[sync-by-radicado][SAMAI] Extracted from sujetos: demandantes="${demandantes}", demandados="${demandados}"`);
    }

    // Normalize actuaciones from SAMAI format
    // SAMAI fields: fechaActuacion, fechaRegistro, actuacion, anotacion
    const rawActuaciones = (proceso.actuaciones || proceso.historial || []) as Array<Record<string, unknown>>;
    
    const actuaciones = rawActuaciones.map((act) => ({
      // SAMAI date fields: fechaActuacion (primary), fechaRegistro (fallback), fecha
      fecha: (act.fechaActuacion || act.fecha_actuacion || act.fechaRegistro || act.fecha_registro || act.fecha || '') as string,
      actuacion: (act.actuacion || act.tipo_actuacion || act.tipo || act.descripcion || '') as string,
      anotacion: (act.anotacion || act.detalle || act.descripcion || act.observacion || '') as string,
    }));
    
    console.log(`[sync-by-radicado][SAMAI] Normalized ${actuaciones.length} actuaciones`);
    
    // If no parties found in sujetos, try extracting from actuacion annotations
    if (!demandantes && !demandados && actuaciones.length > 0) {
      const extractedParties = extractPartiesFromSamaiActuaciones(actuaciones);
      if (extractedParties.accionantes.length > 0) {
        demandantes = extractedParties.accionantes.join(', ');
      }
      if (extractedParties.accionados.length > 0) {
        demandados = extractedParties.accionados.join(', ');
      }
      console.log(`[sync-by-radicado][SAMAI] Extracted parties from actuaciones: demandantes="${demandantes}", demandados="${demandados}"`);
    }

    // SAMAI uses 'origen' or 'corporacion' for the court/judge info
    const despacho = (proceso.origen || proceso.corporacion || proceso.despacho || proceso.despacho_actual || proceso.ponente || '') as string;
    
    // Extract department from origen if possible (e.g., "CONSEJO DE ESTADO... DE BOGOTA D.C.")
    let departamento = (proceso.departamento || '') as string;
    if (!departamento && despacho) {
      const deptMatch = despacho.match(/DE\s+([\w\s\.]+)$/i);
      if (deptMatch) {
        departamento = deptMatch[1].trim();
      }
    }
    
    // SAMAI date format for radicacion: may be DD/MM/YYYY or YYYY-MM-DD
    const fechaRadicacion = (proceso.fechaRadicacion || proceso.fecha_radicado || proceso.fecha_radicacion || proceso.radicadoEl || '') as string;

    // Map sujetos to required type
    const mappedSujetos = sujetosSource.map(s => ({
      tipo: s.tipo || s.tipoSujeto || '',
      nombre: s.nombre || s.nombreRazonSocial || ''
    }));
    
    console.log(`[sync-by-radicado][SAMAI] Final extracted data: despacho="${despacho}", demandantes="${demandantes || '(from actuaciones: ' + (demandantes || '(none)') + ')'}", demandados="${demandados}", actuaciones=${actuaciones.length}`);

    return {
      ok: true,
      found: true,
      source: 'SAMAI',
      processData: {
        despacho,
        ciudad: (proceso.ciudad || proceso.sede || extractCityFromDespacho(despacho)) as string,
        departamento,
        demandante: demandantes || (proceso.demandante as string) || (proceso.accionante as string) || '',
        demandado: demandados || (proceso.demandado as string) || (proceso.accionado as string) || '',
        tipo_proceso: (proceso.tipo_proceso || proceso.tipo || proceso.clase || 'PROCESO') as string,
        clase_proceso: (proceso.clase_proceso || proceso.clase || proceso.subclase_proceso || proceso.subclase || '') as string,
        fecha_radicacion: fechaRadicacion,
        sujetos_procesales: mappedSujetos,
        actuaciones,
        total_actuaciones: (proceso.total_actuaciones as number) || actuaciones.length,
      },
      latency_ms: latency,
      eventsFound: actuaciones.length,
    };
}

/**
 * Fetch from TUTELAS Cloud Run service
 */
async function fetchFromTutelas(radicado: string): Promise<ProviderResult> {
  const startTime = Date.now();
  const tutelasBaseUrl = Deno.env.get('TUTELAS_BASE_URL');
  const apiKey = Deno.env.get('TUTELAS_X_API_KEY') || Deno.env.get('EXTERNAL_X_API_KEY');

  if (!tutelasBaseUrl || !apiKey) {
    return {
      ok: false,
      found: false,
      source: 'TUTELAS',
      processData: {},
      latency_ms: Date.now() - startTime,
      error: 'TUTELAS not configured (missing BASE_URL or API_KEY)',
    };
  }

  try {
    console.log(`[sync-by-radicado] Calling TUTELAS: POST ${tutelasBaseUrl}/search`);
    
    const response = await fetch(
      `${tutelasBaseUrl}/search`,
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ radicado }),
      }
    );

    const latency = Date.now() - startTime;

    if (!response.ok) {
      if (response.status === 404) {
        return {
          ok: true,
          found: false,
          source: 'TUTELAS',
          processData: {},
          latency_ms: latency,
          error: 'Record not found in TUTELAS',
        };
      }
      return {
        ok: false,
        found: false,
        source: 'TUTELAS',
        processData: {},
        latency_ms: latency,
        error: `TUTELAS returned ${response.status}`,
      };
    }

    const result = await response.json();
    
    if (!result.data && !result.proceso && !result.tutela) {
      return {
        ok: true,
        found: false,
        source: 'TUTELAS',
        processData: {},
        latency_ms: latency,
        error: 'No data in TUTELAS response',
      };
    }

    const proceso = result.data || result.proceso || result.tutela || result;

    // Normalize actuaciones from TUTELAS format
    const actuaciones = (proceso.actuaciones || proceso.eventos || []).map((act: Record<string, unknown>) => ({
      fecha: (act.fecha_actuacion || act.fecha || '') as string,
      actuacion: (act.actuacion || act.descripcion || act.tipo || '') as string,
      anotacion: (act.anotacion || act.detalle || '') as string,
    }));

    return {
      ok: true,
      found: true,
      source: 'TUTELAS',
      processData: {
        despacho: proceso.despacho || proceso.juzgado,
        ciudad: proceso.ciudad,
        departamento: proceso.departamento,
        demandante: proceso.accionante || proceso.demandante,
        demandado: proceso.accionado || proceso.demandado,
        tipo_proceso: 'TUTELA',
        fecha_radicacion: proceso.fecha_radicacion,
        actuaciones,
        total_actuaciones: actuaciones.length,
      },
      latency_ms: latency,
      eventsFound: actuaciones.length,
    };
  } catch (err) {
    return {
      ok: false,
      found: false,
      source: 'TUTELAS',
      processData: {},
      latency_ms: Date.now() - startTime,
      error: err instanceof Error ? err.message : 'TUTELAS fetch failed',
    };
  }
}

// ============= PARALLEL SYNC FUNCTIONS =============

/**
 * Normalize actuacion for deduplication
 */
function normalizeActuacionForDedup(act: { fecha?: string; actuacion?: string; anotacion?: string }): string {
  const date = act.fecha || 'nodate';
  const desc = (act.actuacion || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
  return `${date}|${desc}`;
}

/**
 * Execute parallel sync for TUTELA workflow - query all sources simultaneously
 */
async function executeParallelLookup(
  radicado: string,
  providers: string[],
  supabaseUrl: string,
  authHeader: string
): Promise<ConsolidatedLookupResult> {
  console.log(`[sync-by-radicado] Starting PARALLEL lookup for ${radicado} with ${providers.length} sources: ${providers.join(', ')}`);
  
  // Execute all providers simultaneously using Promise.allSettled
  const promises = providers.map(async (provider): Promise<ParallelProviderResult> => {
    const startTime = Date.now();
    try {
      let result: ProviderResult;
      
      switch (provider) {
        case 'CPNU':
          result = await fetchFromCpnu(radicado, supabaseUrl, authHeader);
          break;
        case 'SAMAI':
          result = await fetchFromSamai(radicado);
          break;
        case 'TUTELAS':
          result = await fetchFromTutelas(radicado);
          break;
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
      
      const actuaciones = result.processData.actuaciones || [];
      return {
        provider,
        status: result.found ? 'success' : (result.ok ? 'empty' : 'error'),
        processData: result.processData,
        actuaciones: actuaciones.map(a => ({ ...a, provider })),
        latencyMs: result.latency_ms,
        error: result.error,
      };
    } catch (err) {
      return {
        provider,
        status: 'error',
        processData: {},
        actuaciones: [],
        latencyMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  });
  
  const results = await Promise.all(promises);
  
  console.log(`[sync-by-radicado] Parallel results:`, results.map(r => 
    `${r.provider}: ${r.status}, ${r.actuaciones.length} actuaciones, ${r.latencyMs}ms`
  ));
  
  // Consolidate results
  return consolidateParallelResults(results);
}

/**
 * Consolidate results from multiple providers - deduplicate and merge actuaciones
 */
function consolidateParallelResults(results: ParallelProviderResult[]): ConsolidatedLookupResult {
  // Find the best process data (prefer successful result with most complete data)
  const successfulResults = results
    .filter(r => r.status === 'success')
    .sort((a, b) => {
      // Prioritize by completeness of data
      const scoreA = (a.processData.despacho ? 1 : 0) + 
                     (a.processData.demandante ? 1 : 0) + 
                     (a.processData.demandado ? 1 : 0) +
                     (a.actuaciones.length > 0 ? 2 : 0);
      const scoreB = (b.processData.despacho ? 1 : 0) + 
                     (b.processData.demandante ? 1 : 0) + 
                     (b.processData.demandado ? 1 : 0) +
                     (b.actuaciones.length > 0 ? 2 : 0);
      return scoreB - scoreA;
    });
  
  // Pick best process data (merge from multiple sources if beneficial)
  let consolidatedProcessData: ProcessData = {};
  let primarySource = '';
  
  if (successfulResults.length > 0) {
    const primary = successfulResults[0];
    primarySource = primary.provider;
    consolidatedProcessData = { ...primary.processData };
    
    // Merge missing fields from other sources
    for (const result of successfulResults.slice(1)) {
      if (!consolidatedProcessData.despacho && result.processData.despacho) {
        consolidatedProcessData.despacho = result.processData.despacho;
      }
      if (!consolidatedProcessData.demandante && result.processData.demandante) {
        consolidatedProcessData.demandante = result.processData.demandante;
      }
      if (!consolidatedProcessData.demandado && result.processData.demandado) {
        consolidatedProcessData.demandado = result.processData.demandado;
      }
      if (!consolidatedProcessData.ciudad && result.processData.ciudad) {
        consolidatedProcessData.ciudad = result.processData.ciudad;
      }
      if (!consolidatedProcessData.departamento && result.processData.departamento) {
        consolidatedProcessData.departamento = result.processData.departamento;
      }
    }
  }
  
  // Collect all actuaciones from all sources
  const allActuaciones: Array<{ fecha: string; actuacion: string; anotacion?: string; provider: string }> = [];
  for (const result of results) {
    if (result.status === 'success' || result.status === 'empty') {
      for (const act of result.actuaciones) {
        allActuaciones.push({
          fecha: act.fecha || '',
          actuacion: act.actuacion || '',
          anotacion: act.anotacion,
          provider: result.provider,
        });
      }
    }
  }
  
  const totalFromSources = allActuaciones.length;
  
  // Deduplicate actuaciones by similarity key
  const dedupMap = new Map<string, { 
    act: { fecha: string; actuacion: string; anotacion?: string }; 
    sources: string[]; 
    primarySource: string;
    bestScore: number;
  }>();
  
  for (const act of allActuaciones) {
    const key = normalizeActuacionForDedup(act);
    const existing = dedupMap.get(key);
    
    // Calculate completeness score
    const score = (act.fecha ? 2 : 0) + 
                  (act.actuacion ? 1 : 0) + 
                  (act.anotacion && act.anotacion.length > 10 ? 2 : 0);
    
    if (!existing) {
      dedupMap.set(key, {
        act: { fecha: act.fecha, actuacion: act.actuacion, anotacion: act.anotacion },
        sources: [act.provider],
        primarySource: act.provider,
        bestScore: score,
      });
    } else {
      // Add source if not already present
      if (!existing.sources.includes(act.provider)) {
        existing.sources.push(act.provider);
      }
      // Use the more complete version
      if (score > existing.bestScore) {
        existing.act = { fecha: act.fecha, actuacion: act.actuacion, anotacion: act.anotacion };
        existing.bestScore = score;
      }
      // Merge annotations (take longer one)
      if (act.anotacion && (!existing.act.anotacion || act.anotacion.length > existing.act.anotacion.length)) {
        existing.act.anotacion = act.anotacion;
      }
    }
  }
  
  // Convert to consolidated array
  const consolidatedActuaciones: Array<{ 
    fecha: string; 
    actuacion: string; 
    anotacion?: string; 
    sources: string[]; 
    primarySource: string 
  }> = [];
  
  for (const [, value] of dedupMap) {
    consolidatedActuaciones.push({
      ...value.act,
      sources: value.sources,
      primarySource: value.primarySource,
    });
  }
  
  // Sort by date descending
  consolidatedActuaciones.sort((a, b) => {
    if (!a.fecha && !b.fecha) return 0;
    if (!a.fecha) return 1;
    if (!b.fecha) return -1;
    return b.fecha.localeCompare(a.fecha);
  });
  
  const afterDedup = consolidatedActuaciones.length;
  
  console.log(`[sync-by-radicado] Consolidation: ${totalFromSources} total → ${afterDedup} unique (${totalFromSources - afterDedup} duplicates removed)`);
  
  // Update process data with consolidated actuaciones
  consolidatedProcessData.actuaciones = consolidatedActuaciones.map(a => ({
    fecha: a.fecha,
    actuacion: a.actuacion,
    anotacion: a.anotacion,
  }));
  consolidatedProcessData.total_actuaciones = afterDedup;
  
  return {
    processData: consolidatedProcessData,
    actuaciones: consolidatedActuaciones,
    providerResults: results,
    totalFromSources,
    afterDedup,
  };
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('MISSING_ENV', 'Missing Supabase environment variables', 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '');
    
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: authError } = await anonClient.auth.getClaims(token);
    
    if (authError || !claims?.claims?.sub) {
      return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401);
    }

    const userId = claims.claims.sub as string;

    let payload: SyncRequest;
    try {
      payload = await req.json();
    } catch {
      return errorResponse('INVALID_JSON', 'Could not parse request body', 400);
    }

    // Validate radicado with workflow-specific rules
    const validation = validateRadicado(payload.radicado, payload.workflow_type);
    if (!validation.valid) {
      console.log(`[sync-by-radicado] Validation failed: ${validation.error}`);
      return errorResponse(
        validation.errorCode || 'INVALID_RADICADO', 
        validation.error || 'Invalid radicado', 
        400
      );
    }

    const radicado = validation.normalized;
    const mode = payload.mode || 'SYNC_AND_APPLY';
    const createIfMissing = payload.create_if_missing !== false;
    const workflowType = (payload.workflow_type || 'CGP') as WorkflowType;
    
    console.log(`[sync-by-radicado] Mode: ${mode}, Radicado: ${radicado}, Workflow: ${workflowType}, User: ${userId}`);

    // Get user's organization
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', userId)
      .maybeSingle();

    const organizationId = profile?.organization_id;
    if (!organizationId) {
      return errorResponse('NO_ORGANIZATION', 'User is not part of an organization', 400);
    }

    // Check if work_item already exists for this radicado + user
    const { data: existingWorkItem } = await supabase
      .from('work_items')
      .select('id, cgp_phase, stage, demandantes, demandados, authority_name, last_action_date, total_actuaciones')
      .eq('owner_id', userId)
      .eq('radicado', radicado)
      .maybeSingle();

    // ============= SYNC_AND_APPLY MODE WITH EXISTING WORK_ITEM =============
    
    if (existingWorkItem && mode === 'SYNC_AND_APPLY') {
      // Delegate to sync-by-work-item
      console.log(`[sync-by-radicado] Delegating to sync-by-work-item for existing item: ${existingWorkItem.id}`);
      
      const syncResponse = await fetch(
        `${supabaseUrl}/functions/v1/sync-by-work-item`,
        {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            work_item_id: existingWorkItem.id,
            force_refresh: payload.force_refresh,
          }),
        }
      );

      const syncResult = await syncResponse.json();
      
      if (syncResult.ok) {
        // Re-fetch to get updated data for response
        const { data: updatedWorkItem } = await supabase
          .from('work_items')
          .select('cgp_phase, demandantes, demandados, authority_name, last_action_date, total_actuaciones')
          .eq('id', existingWorkItem.id)
          .single();

        const { data: actuaciones } = await supabase
          .from('actuaciones')
          .select('act_date, raw_text, normalized_text')
          .eq('work_item_id', existingWorkItem.id)
          .order('act_date', { ascending: false })
          .limit(50);

        const processData: ProcessData = {
          despacho: updatedWorkItem?.authority_name,
          demandante: updatedWorkItem?.demandantes,
          demandado: updatedWorkItem?.demandados,
          fecha_ultima_actuacion: updatedWorkItem?.last_action_date,
          actuaciones: actuaciones?.map(a => ({
            fecha: a.act_date || '',
            actuacion: a.raw_text,
            anotacion: '',
          })) || [],
          total_actuaciones: updatedWorkItem?.total_actuaciones || actuaciones?.length || 0,
        };

        return jsonResponse({
          ok: true,
          work_item_id: existingWorkItem.id,
          created: false,
          updated: true,
          found_in_source: true,
          source_used: syncResult.source_used,
          sources_checked: syncResult.sources_checked || [syncResult.source_used],
          new_events_count: syncResult.inserted_count || 0,
          milestones_triggered: 0,
          cgp_phase: updatedWorkItem?.cgp_phase,
          process_data: processData,
        });
      } else {
        // Return error from sync-by-work-item
        return jsonResponse({
          ok: false,
          work_item_id: existingWorkItem.id,
          created: false,
          updated: false,
          found_in_source: false,
          source_used: null,
          sources_checked: [],
          new_events_count: 0,
          milestones_triggered: 0,
          error: syncResult.errors?.[0] || syncResult.message || 'Sync failed',
          code: syncResult.code,
        });
      }
    }

    // ============= LOOKUP OR CREATE NEW WORK_ITEM =============
    
    // Get provider order based on workflow type
    const providerConfig = getProviderOrder(workflowType);
    const attempts: AttemptLog[] = [];
    const sourcesChecked: string[] = [];
    let processData: ProcessData = {};
    let foundInSource = false;
    let sourceUsed: string | null = null;
    let consolidationStats: { totalFromSources: number; afterDedup: number } | null = null;

    console.log(`[sync-by-radicado] Provider config for ${workflowType}:`, providerConfig);

    // ============= PARALLEL SYNC FOR TUTELA =============
    if (providerConfig.useParallelSync && providerConfig.parallelProviders) {
      console.log(`[sync-by-radicado] Using PARALLEL sync for ${workflowType}`);
      
      const parallelResult = await executeParallelLookup(
        radicado,
        providerConfig.parallelProviders,
        supabaseUrl,
        authHeader
      );
      
      // Populate attempts and sourcesChecked from parallel results
      for (const pr of parallelResult.providerResults) {
        sourcesChecked.push(pr.provider);
        attempts.push({
          source: pr.provider,
          success: pr.status === 'success',
          latency_ms: pr.latencyMs,
          error: pr.error,
          events_found: pr.actuaciones.length,
        });
        
        if (pr.status === 'success' && !foundInSource) {
          foundInSource = true;
          sourceUsed = pr.provider;
        }
      }
      
      // Use consolidated data
      processData = parallelResult.processData;
      foundInSource = parallelResult.providerResults.some(r => r.status === 'success');
      
      // Store consolidation stats for response
      consolidationStats = {
        totalFromSources: parallelResult.totalFromSources,
        afterDedup: parallelResult.afterDedup,
      };
      
      // Pick the first successful provider as the "primary" source
      const successfulProvider = parallelResult.providerResults.find(r => r.status === 'success');
      if (successfulProvider) {
        sourceUsed = successfulProvider.provider;
      }
      
    } else {
      // ============= FALLBACK PATTERN FOR OTHER WORKFLOWS =============
      
      // Try primary provider
      let primaryResult: ProviderResult;
      
      if (providerConfig.primary === 'SAMAI') {
        primaryResult = await fetchFromSamai(radicado);
      } else if (providerConfig.primary === 'TUTELAS') {
        primaryResult = await fetchFromTutelas(radicado);
      } else {
        primaryResult = await fetchFromCpnu(radicado, supabaseUrl, authHeader);
      }

      sourcesChecked.push(primaryResult.source);
      attempts.push({
        source: primaryResult.source,
        success: primaryResult.found,
        latency_ms: primaryResult.latency_ms,
        error: primaryResult.error,
        events_found: primaryResult.eventsFound,
      });

      if (primaryResult.found) {
        processData = primaryResult.processData;
        foundInSource = true;
        sourceUsed = primaryResult.source;
        console.log(`[sync-by-radicado] Found in ${primaryResult.source} with ${primaryResult.eventsFound} events`);
      } 
      // Try fallback if primary didn't find data and fallback is enabled
      else if (providerConfig.fallbackEnabled && providerConfig.fallback) {
        console.log(`[sync-by-radicado] Primary ${primaryResult.source} not found, trying fallback ${providerConfig.fallback}`);
        
        let fallbackResult: ProviderResult;
        
        if (providerConfig.fallback === 'SAMAI') {
          fallbackResult = await fetchFromSamai(radicado);
        } else if (providerConfig.fallback === 'TUTELAS') {
          fallbackResult = await fetchFromTutelas(radicado);
        } else {
          fallbackResult = await fetchFromCpnu(radicado, supabaseUrl, authHeader);
        }

        sourcesChecked.push(fallbackResult.source);
        attempts.push({
          source: fallbackResult.source,
          success: fallbackResult.found,
          latency_ms: fallbackResult.latency_ms,
          error: fallbackResult.error,
          events_found: fallbackResult.eventsFound,
        });

        if (fallbackResult.found) {
          processData = fallbackResult.processData;
          foundInSource = true;
          sourceUsed = fallbackResult.source;
          console.log(`[sync-by-radicado] Found in fallback ${fallbackResult.source} with ${fallbackResult.eventsFound} events`);
        }
      }
    }

    // Classify FILING vs PROCESS
    const { hasAutoAdmisorio, reason: classificationReason } = detectAutoAdmisorio(
      processData.actuaciones || []
    );
    const cgpPhase = hasAutoAdmisorio ? 'PROCESS' : 'FILING';

    // ============= LOOKUP MODE: Return preview only =============
    
    if (mode === 'LOOKUP') {
      const response: SyncResponse = {
        ok: true,
        work_item_id: existingWorkItem?.id,
        created: false,
        updated: false,
        found_in_source: foundInSource,
        source_used: sourceUsed,
        sources_checked: sourcesChecked,
        new_events_count: processData.total_actuaciones || 0,
        milestones_triggered: 0,
        cgp_phase: cgpPhase,
        classification_reason: classificationReason,
        process_data: processData,
        attempts,
        // Add parallel sync metadata
        sync_strategy: providerConfig.useParallelSync ? 'parallel' : 'fallback',
        consolidation_stats: consolidationStats ? {
          total_from_sources: consolidationStats.totalFromSources,
          after_dedup: consolidationStats.afterDedup,
          duplicates_removed: consolidationStats.totalFromSources - consolidationStats.afterDedup,
        } : undefined,
      };
      
      console.log(`[sync-by-radicado] LOOKUP completed in ${Date.now() - startTime}ms, sources: ${sourcesChecked.join(', ')}, found: ${foundInSource}${consolidationStats ? `, consolidated: ${consolidationStats.totalFromSources} → ${consolidationStats.afterDedup}` : ''}`);
      return jsonResponse(response);
    }

    // ============= CREATE NEW WORK_ITEM =============
    
    if (!createIfMissing && !foundInSource) {
      return jsonResponse({
        ok: false,
        created: false,
        updated: false,
        found_in_source: false,
        source_used: null,
        sources_checked: sourcesChecked,
        new_events_count: 0,
        milestones_triggered: 0,
        error: 'No se encontró el proceso y create_if_missing está desactivado',
        code: 'NOT_FOUND',
        attempts,
      });
    }

    // Determine stage based on classification
    let stage = payload.stage;
    if (!stage) {
      if (workflowType === 'CGP') {
        stage = hasAutoAdmisorio ? 'AUTO_ADMISORIO' : 'RADICADO_CONFIRMED';
      } else if (workflowType === 'CPACA') {
        stage = hasAutoAdmisorio ? 'AUTO_ADMISORIO' : 'DEMANDA_RADICADA';
      } else if (workflowType === 'TUTELA') {
        stage = hasAutoAdmisorio ? 'TUTELA_ADMITIDA' : 'TUTELA_RADICADA';
      } else {
        stage = 'MONITORING';
      }
    }

    // Create the work item
    const { data: newWorkItem, error: insertError } = await supabase
      .from('work_items')
      .insert({
        owner_id: userId,
        organization_id: organizationId,
        radicado,
        radicado_verified: foundInSource,
        workflow_type: workflowType,
        stage,
        cgp_phase: workflowType === 'CGP' ? cgpPhase : null,
        cgp_phase_source: 'AUTO',
        status: 'ACTIVE',
        source: foundInSource ? 'SCRAPE_API' : 'MANUAL',
        source_reference: `sync-by-radicado-${Date.now()}`,
        authority_name: processData.despacho || null,
        authority_city: processData.ciudad || null,
        authority_department: processData.departamento || null,
        demandantes: processData.demandante || null,
        demandados: processData.demandado || null,
        filing_date: parseColombianDate(processData.fecha_radicacion),
        client_id: payload.client_id || null,
        is_flagged: false,
        monitoring_enabled: true,
        email_linking_enabled: true,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[sync-by-radicado] Insert error:', insertError);
      return errorResponse('INSERT_ERROR', insertError.message, 500);
    }

    const workItemId = newWorkItem?.id;
    console.log(`[sync-by-radicado] Created work_item: ${workItemId}`);

    // If we have actuaciones from preview, delegate to sync-by-work-item for full sync
    if (workItemId && foundInSource) {
      const syncResponse = await fetch(
        `${supabaseUrl}/functions/v1/sync-by-work-item`,
        {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            work_item_id: workItemId,
          }),
        }
      );

      const syncResult = await syncResponse.json();
      console.log(`[sync-by-radicado] sync-by-work-item result:`, { 
        ok: syncResult.ok, 
        inserted: syncResult.inserted_count,
        source: syncResult.source_used,
      });
    }

    const response: SyncResponse = {
      ok: true,
      work_item_id: workItemId,
      created: true,
      updated: false,
      found_in_source: foundInSource,
      source_used: sourceUsed,
      sources_checked: sourcesChecked,
      new_events_count: processData.total_actuaciones || 0,
      milestones_triggered: 0,
      cgp_phase: cgpPhase,
      classification_reason: classificationReason,
      process_data: processData,
      attempts,
    };

    console.log(`[sync-by-radicado] Completed in ${Date.now() - startTime}ms`);
    return jsonResponse(response);

  } catch (error) {
    console.error('[sync-by-radicado] Unexpected error:', error);
    return errorResponse(
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Unexpected error',
      500
    );
  }
});
