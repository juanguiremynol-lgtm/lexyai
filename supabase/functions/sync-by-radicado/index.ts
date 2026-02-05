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
}

// ============= PROVIDER CONFIGURATION =============

function getProviderOrder(workflowType: string): ProviderConfig {
  switch (workflowType) {
    case 'CPACA':
      // Administrative litigation - SAMAI primary, no fallback to CPNU
      return { primary: 'SAMAI', fallbackEnabled: false };
    case 'TUTELA':
      // Tutela - CPNU primary, TUTELAS API fallback
      return { primary: 'CPNU', fallback: 'TUTELAS', fallbackEnabled: true };
    case 'CGP':
    case 'LABORAL':
    case 'PENAL_906':
    default:
      // Civil/Labor/Penal - CPNU only, no fallback (SAMAI doesn't have these)
      return { primary: 'CPNU', fallbackEnabled: false };
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
 * Normalize radicado input:
 * - Trims whitespace
 * - If starts with 'T' (tutela code), keeps the 'T' prefix and removes spaces
 * - Otherwise removes all non-digits (spaces, hyphens, etc.)
 */
function normalizeRadicado(radicado: string): string {
  if (!radicado) return '';
  const trimmed = radicado.trim();
  
  // Tutela codes start with T followed by digits (e.g., T1234567)
  if (/^[Tt]\d/.test(trimmed)) {
    return trimmed.toUpperCase().replace(/\s+/g, '');
  }
  
  // Standard radicado: remove all non-digits
  return trimmed.replace(/\D/g, '');
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
  
  const normalized = normalizeRadicado(radicado);
  
  if (normalized.length === 0) {
    return { 
      valid: false, 
      normalized: '', 
      error: 'El radicado no contiene dígitos válidos',
      errorCode: 'INVALID_CHARS',
    };
  }
  
  // Tutela codes have a different format (T followed by digits)
  if (workflowType === 'TUTELA' && /^T\d+$/.test(normalized)) {
    return { valid: true, normalized };
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
  const AUTO_ADMISORIO_PATTERNS = [
    /auto\s+admisorio/i,
    /admite\s+demanda/i,
    /admision\s+de\s+demanda/i,
    /auto\s+que\s+admite/i,
    /se\s+admite\s+la?\s+demanda/i,
    /admite\s+tutela/i,
    /auto\s+avoca\s+conocimiento/i,
    /avoca\s+conocimiento/i,
    /auto\s+admite\s+accion/i,
  ];

  for (const act of actuaciones) {
    const text = `${act.actuacion || ''} ${act.anotacion || ''}`.toLowerCase();
    for (const pattern of AUTO_ADMISORIO_PATTERNS) {
      if (pattern.test(text)) {
        return {
          hasAutoAdmisorio: true,
          reason: `Detectado: "${act.actuacion?.substring(0, 50)}..."`,
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

    if (result.ok && result.proceso) {
      const proceso = result.proceso;
      
      // Extract parties from sujetos_procesales
      let demandantes = '';
      let demandados = '';
      
      if (proceso.sujetos_procesales?.length > 0) {
        const demandantesList = proceso.sujetos_procesales
          .filter((s: { tipo: string }) => 
            s.tipo?.toLowerCase().includes('demandante') || 
            s.tipo?.toLowerCase().includes('actor') ||
            s.tipo?.toLowerCase().includes('accionante')
          )
          .map((s: { nombre: string }) => s.nombre);
        const demandadosList = proceso.sujetos_procesales
          .filter((s: { tipo: string }) => 
            s.tipo?.toLowerCase().includes('demandado') ||
            s.tipo?.toLowerCase().includes('accionado')
          )
          .map((s: { nombre: string }) => s.nombre);
        
        if (demandantesList.length) demandantes = demandantesList.join(', ');
        if (demandadosList.length) demandados = demandadosList.join(', ');
      }

      const actuaciones = (proceso.actuaciones || []).map((act: Record<string, unknown>) => ({
        fecha: (act.fecha_actuacion || act.fecha || '') as string,
        actuacion: (act.actuacion || '') as string,
        anotacion: (act.anotacion || '') as string,
      }));

      return {
        ok: true,
        found: true,
        source: 'CPNU',
        processData: {
          despacho: proceso.despacho,
          ciudad: proceso.ciudad,
          departamento: proceso.departamento,
          demandante: demandantes || proceso.demandante,
          demandado: demandados || proceso.demandado,
          tipo_proceso: proceso.tipo,
          clase_proceso: proceso.clase,
          fecha_radicacion: proceso.fecha_radicacion,
          sujetos_procesales: proceso.sujetos_procesales,
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
 * Helper to build SAMAI result from proceso data
 */
function buildSamaiResult(
  proceso: Record<string, unknown>,
  sujetos: Array<{ tipo: string; nombre: string }>,
  rawActuaciones: Array<Record<string, unknown>>,
  latencyMs: number
): ProviderResult {
  let demandantes = '';
  let demandados = '';
  
  if (Array.isArray(sujetos) && sujetos.length > 0) {
    const demandantesList = sujetos
      .filter((s) => {
        const tipo = (s.tipo || '').toLowerCase();
        return tipo.includes('demandante') || 
               tipo.includes('actor') ||
               tipo.includes('accionante') ||
               tipo.includes('ofendido') ||
               tipo.includes('tutelante');
      })
      .map((s) => s.nombre)
      .filter(Boolean);
    const demandadosList = sujetos
      .filter((s) => {
        const tipo = (s.tipo || '').toLowerCase();
        return tipo.includes('demandado') ||
               tipo.includes('accionado') ||
               tipo.includes('procesado');
      })
      .map((s) => s.nombre)
      .filter(Boolean);
    
    if (demandantesList.length) demandantes = demandantesList.join(' | ');
    if (demandadosList.length) demandados = demandadosList.join(' | ');
  }
  
  const actuaciones = rawActuaciones.map((act) => ({
    fecha: String(act.fechaActuacion || act.fecha_actuacion || act.fecha || act.fechaRegistro || ''),
    actuacion: String(act.actuacion || act.tipo_actuacion || ''),
    anotacion: String(act.anotacion || act.descripcion || ''),
  }));
  
  return {
    ok: true,
    found: true,
    source: 'SAMAI',
    processData: {
      despacho: (proceso.despacho || proceso.corporacion || proceso.corporacionNombre || proceso.despacho_actual) as string,
      ciudad: (proceso.ciudad || proceso.sede) as string,
      departamento: proceso.departamento as string,
      demandante: demandantes || (proceso.demandante as string),
      demandado: demandados || (proceso.demandado as string),
      tipo_proceso: (proceso.tipo_proceso || proceso.tipo) as string,
      clase_proceso: (proceso.clase_proceso || proceso.clase || proceso.subclase_proceso) as string,
      fecha_radicacion: (proceso.fecha_radicado || proceso.fecha_radicacion) as string,
      sujetos_procesales: sujetos,
      actuaciones,
      total_actuaciones: (proceso.total_actuaciones as number) || actuaciones.length,
    },
    latency_ms: latencyMs,
    eventsFound: actuaciones.length,
  };
}

/**
 * Fetch from SAMAI Cloud Run service
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
    console.log(`[sync-by-radicado] Calling SAMAI: ${samaiBaseUrl}/snapshot?numero_radicacion=${radicado}`);
    
    const response = await fetch(
      `${samaiBaseUrl}/snapshot?numero_radicacion=${radicado}`,
      {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
      }
    );

    const latency = Date.now() - startTime;

    if (!response.ok) {
      // For 404, try /buscar endpoint as fallback (SAMAI may require scraping trigger)
      if (response.status === 404) {
        console.log(`[sync-by-radicado] SAMAI /snapshot returned 404, trying /buscar fallback`);
        
        try {
          const buscarUrl = `${samaiBaseUrl}/buscar?numero_radicacion=${radicado}`;
          const buscarResponse = await fetch(buscarUrl, {
            method: 'GET',
            headers: {
              'x-api-key': apiKey,
              'Content-Type': 'application/json',
            },
          });
          
          if (buscarResponse.ok) {
            const buscarData = await buscarResponse.json();
            // /buscar may return cached data directly if available
            const proceso = buscarData.result || buscarData.data || buscarData;
            const actuaciones = proceso.actuaciones ?? [];
            
            if (actuaciones.length > 0) {
              console.log(`[sync-by-radicado] SAMAI /buscar returned ${actuaciones.length} cached actuaciones`);
              // Return this data - continue processing below
              const sujetos = proceso.sujetos_procesales ?? proceso.sujetos ?? [];
              return buildSamaiResult(proceso, sujetos, actuaciones, Date.now() - startTime);
            }
            
            // /buscar returned jobId for async scraping - we can't wait for it in lookup mode
            if (buscarData.jobId || buscarData.job_id) {
              console.log(`[sync-by-radicado] SAMAI /buscar initiated scraping job, data not immediately available`);
            }
          }
        } catch (buscarErr) {
          console.warn(`[sync-by-radicado] SAMAI /buscar fallback failed:`, buscarErr);
        }
        
        return {
          ok: true,
          found: false,
          source: 'SAMAI',
          processData: {},
          latency_ms: Date.now() - startTime,
          error: 'Record not found in SAMAI (tried /snapshot and /buscar)',
        };
      }
      return {
        ok: false,
        found: false,
        source: 'SAMAI',
        processData: {},
        latency_ms: Date.now() - startTime,
        error: `SAMAI returned ${response.status}`,
      };
    }

    const result = await response.json();
    
    // Check if SAMAI returned data - SAMAI may wrap in "result" key
    const proceso = result.result || result.data || result.proceso || result;
    
    if (!proceso || (Object.keys(proceso).length === 0)) {
      return {
        ok: true,
        found: false,
        source: 'SAMAI',
        processData: {},
        latency_ms: latency,
        error: 'No data in SAMAI response',
      };
    }

    // Extract parties from sujetos_procesales OR sujetos (SAMAI uses both field names)
    const sujetos = proceso.sujetos_procesales ?? proceso.sujetos ?? [];
    let demandantes = '';
    let demandados = '';
    
    if (Array.isArray(sujetos) && sujetos.length > 0) {
      const demandantesList = sujetos
        .filter((s: { tipo: string }) => {
          const tipo = (s.tipo || '').toLowerCase();
          return tipo.includes('demandante') || 
                 tipo.includes('actor') ||
                 tipo.includes('accionante') ||
                 tipo.includes('ofendido') ||
                 tipo.includes('tutelante');
        })
        .map((s: { nombre: string }) => s.nombre)
        .filter(Boolean);
      const demandadosList = sujetos
        .filter((s: { tipo: string }) => {
          const tipo = (s.tipo || '').toLowerCase();
          return tipo.includes('demandado') ||
                 tipo.includes('accionado') ||
                 tipo.includes('procesado');
        })
        .map((s: { nombre: string }) => s.nombre)
        .filter(Boolean);
      
      if (demandantesList.length) demandantes = demandantesList.join(' | ');
      if (demandadosList.length) demandados = demandadosList.join(' | ');
    }

    // Normalize actuaciones from SAMAI format
    // CRITICAL: SAMAI uses fechaActuacion (not fecha), and actuaciones may have different field names
    const rawActuaciones = proceso.actuaciones ?? [];
    const actuaciones = rawActuaciones.map((act: Record<string, unknown>) => ({
      // SAMAI uses fechaActuacion, fallback to other possible names
      fecha: String(act.fechaActuacion || act.fecha_actuacion || act.fecha || act.fechaRegistro || ''),
      actuacion: String(act.actuacion || act.tipo_actuacion || ''),
      anotacion: String(act.anotacion || act.descripcion || ''),
    }));

    return {
      ok: true,
      found: true,
      source: 'SAMAI',
      processData: {
        despacho: proceso.despacho || proceso.corporacion || proceso.despacho_actual,
        ciudad: proceso.ciudad || proceso.sede,
        departamento: proceso.departamento,
        demandante: demandantes || proceso.demandante,
        demandado: demandados || proceso.demandado,
        tipo_proceso: proceso.tipo_proceso || proceso.tipo,
        clase_proceso: proceso.clase_proceso || proceso.clase || proceso.subclase_proceso,
        fecha_radicacion: proceso.fecha_radicado || proceso.fecha_radicacion,
        sujetos_procesales: proceso.sujetos_procesales,
        actuaciones,
        total_actuaciones: proceso.total_actuaciones || actuaciones.length,
      },
      latency_ms: latency,
      eventsFound: actuaciones.length,
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
 * Helper to build TUTELAS result from proceso data
 */
function buildTutelasResult(proceso: Record<string, unknown>, latencyMs: number): ProviderResult {
  const actuaciones = (proceso.actuaciones || proceso.eventos || []) as Array<Record<string, unknown>>;
  const mappedActuaciones = actuaciones.map((act) => ({
    fecha: String(act.fecha_actuacion || act.fecha || ''),
    actuacion: String(act.actuacion || act.descripcion || act.tipo || ''),
    anotacion: String(act.anotacion || act.detalle || ''),
  }));
  
  return {
    ok: true,
    found: true,
    source: 'TUTELAS',
    processData: {
      despacho: (proceso.despacho || proceso.juzgado) as string,
      ciudad: proceso.ciudad as string,
      departamento: proceso.departamento as string,
      demandante: (proceso.accionante || proceso.demandante || proceso.tutelante) as string,
      demandado: (proceso.accionado || proceso.demandado) as string,
      tipo_proceso: 'TUTELA',
      fecha_radicacion: proceso.fecha_radicacion as string,
      actuaciones: mappedActuaciones,
      total_actuaciones: mappedActuaciones.length,
    },
    latency_ms: latencyMs,
    eventsFound: mappedActuaciones.length,
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
      // Handle 422 Unprocessable Entity (usually means malformed body)
      if (response.status === 422) {
        const errorBody = await response.text();
        console.error(`[sync-by-radicado] TUTELAS 422 error - check body format: ${errorBody}`);
        return {
          ok: false,
          found: false,
          source: 'TUTELAS',
          processData: {},
          latency_ms: latency,
          error: `TUTELAS validation error (422): ${errorBody.slice(0, 200)}`,
        };
      }
      
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
    
    // Check if this is an async job response (status: "pending", job_id present)
    if ((result.status === 'pending' || result.status === 'processing') && (result.job_id || result.jobId)) {
      const jobId = result.job_id || result.jobId;
      console.log(`[sync-by-radicado] TUTELAS initiated async job: ${jobId}. Polling for result...`);
      
      // Poll for result using GET /job/{job_id}
      const maxAttempts = 10;
      const pollInterval = 3000; // 3 seconds
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
        try {
          const pollUrl = `${tutelasBaseUrl}/job/${jobId}`;
          console.log(`[sync-by-radicado] TUTELAS poll ${attempt}/${maxAttempts}: ${pollUrl}`);
          
          const pollResponse = await fetch(pollUrl, {
            method: 'GET',
            headers: {
              'x-api-key': apiKey,
              'Accept': 'application/json',
            },
          });
          
          if (pollResponse.ok) {
            const pollResult = await pollResponse.json();
            const pollStatus = String(pollResult.status || '').toLowerCase();
            
            if (['done', 'completed', 'success', 'finished'].includes(pollStatus)) {
              console.log(`[sync-by-radicado] TUTELAS job completed!`);
              // Extract data and continue processing below
              const proceso = pollResult.result || pollResult.data || pollResult;
              if (proceso && (proceso.actuaciones || proceso.eventos)) {
                return buildTutelasResult(proceso, Date.now() - startTime);
              }
            }
            
            if (['failed', 'error'].includes(pollStatus)) {
              console.log(`[sync-by-radicado] TUTELAS job failed: ${pollResult.error || 'Unknown error'}`);
              break;
            }
          }
        } catch (pollErr) {
          console.warn(`[sync-by-radicado] TUTELAS poll error:`, pollErr);
        }
      }
      
      // Timeout or failure
      return {
        ok: false,
        found: false,
        source: 'TUTELAS',
        processData: {},
        latency_ms: Date.now() - startTime,
        error: 'TUTELAS scraping job did not complete in time',
      };
    }
    
    // Direct response with data
    if (!result.data && !result.proceso && !result.tutela && !result.actuaciones) {
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

    console.log(`[sync-by-radicado] Provider config for ${workflowType}:`, providerConfig);

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
      };
      
      console.log(`[sync-by-radicado] LOOKUP completed in ${Date.now() - startTime}ms, sources: ${sourcesChecked.join(', ')}, found: ${foundInSource}`);
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
