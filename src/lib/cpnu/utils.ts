// ============= CPNU PURE UTILITY FUNCTIONS =============
// Extracted for testability - no side effects, no network calls

import type {
  CandidateRequest,
  Classification,
  AttemptLog,
  SearchResult,
  ProcessEvent,
  ParseMeta,
} from './types';

// ============= URL CANDIDATE GENERATION =============

export function buildSearchCandidates(radicado: string, soloActivos: boolean = false): CandidateRequest[] {
  // Validate radicado is string and 23 chars
  if (typeof radicado !== 'string' || radicado.length !== 23) {
    console.warn(`Invalid radicado format: expected 23-char string, got ${typeof radicado} with length ${radicado?.length}`);
  }
  
  return [
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
  ];
}

export function buildDetailCandidates(idProceso: string | number): CandidateRequest[] {
  return [
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
  ];
}

export function buildActuacionesCandidates(idProceso: string | number): CandidateRequest[] {
  return [
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
  ];
}

// ============= FINGERPRINT COMPUTATION =============

export function computeFingerprint(
  source: string, 
  radicado: string,
  eventDate: string | null, 
  eventType: string,
  description: string, 
  despacho: string,
  idProceso?: string | number
): string {
  const data = `${source}|${radicado}|${eventDate || ''}|${eventType}|${description}|${despacho}|${idProceso || ''}`;
  // Simple hash function - deterministic
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

// ============= DATE PARSING =============

export function parseColombianDate(dateStr: string): string | null {
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

// ============= EVENT TYPE DETECTION =============

export function determineEventType(description: string): string {
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

// ============= STRING UTILITIES =============

export function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

// ============= CLASSIFICATION LOGIC =============

export function classifyRun(
  attempts: AttemptLog[],
  parseMeta: ParseMeta | null,
  resultCount: number,
  eventCount: number = 0,
  firecrawlClassification?: Classification
): { classification: Classification; why_empty?: string } {
  
  // If Firecrawl gave us a classification, use it
  if (firecrawlClassification && firecrawlClassification !== 'UNKNOWN') {
    const why_empty = resultCount === 0 && eventCount === 0 
      ? `firecrawl_${firecrawlClassification.toLowerCase()}` 
      : undefined;
    return { classification: firecrawlClassification, why_empty };
  }
  
  // Check for success
  if (resultCount > 0 || eventCount > 0) {
    return { classification: 'SUCCESS' };
  }
  
  // Analyze attempts to classify failure
  if (attempts.length === 0) {
    return { classification: 'UNKNOWN', why_empty: 'NO_ATTEMPTS_MADE' };
  }
  
  // All attempts were 404
  const all404 = attempts.every(a => a.status === 404);
  if (all404) {
    return { classification: 'ENDPOINT_404', why_empty: 'ALL_ENDPOINTS_404' };
  }
  
  // Any 403/429 = blocked
  const blocked = attempts.some(a => a.status === 403 || a.status === 429);
  if (blocked) {
    const blockingAttempt = attempts.find(a => a.status === 403 || a.status === 429);
    return { 
      classification: 'BLOCKED_403_429', 
      why_empty: `BLOCKED_HTTP_${blockingAttempt?.status}` 
    };
  }
  
  // All attempts returned non-JSON
  const allNonJson = attempts.every(a => a.error_type === 'NON_JSON');
  if (allNonJson) {
    return { classification: 'NON_JSON_RESPONSE', why_empty: 'ALL_RESPONSES_NON_JSON' };
  }
  
  // Had successful fetch but no results extracted
  const hadSuccess = attempts.some(a => a.success);
  if (hadSuccess && resultCount === 0 && eventCount === 0) {
    const method = parseMeta?.parseMethod || 'UNKNOWN';
    return { classification: 'PARSE_BROKE', why_empty: `PARSE_${method}` };
  }
  
  // Parse meta gives us a hint
  if (parseMeta?.parseMethod === 'NO_RESULTS_MESSAGE') {
    return { classification: 'NO_RESULTS_CONFIRMED', why_empty: 'CPNU_NO_MATCH_MESSAGE' };
  }
  
  if (parseMeta?.parseMethod === 'SPA_FORM_EMPTY') {
    return { classification: 'INTERACTION_FAILED_SELECTOR_CHANGED', why_empty: 'SPA_FORM_NOT_SUBMITTED' };
  }
  
  return { classification: 'UNKNOWN', why_empty: 'UNCLASSIFIED_FAILURE' };
}

// ============= CPNU API RESPONSE PARSERS =============

interface CpnuSearchApiResponse {
  procesos?: Array<{
    idProceso: number | string;
    numeroRadicacion?: string;
    radicado?: string;
    despacho?: string;
    nombreDespacho?: string;
    demandante?: string;
    demandado?: string;
    tipoProceso?: string;
    fechaRadicacion?: string;
  }>;
  // Some responses have data at root level
  idProceso?: number | string;
  numeroRadicacion?: string;
}

export function parseCpnuSearchResponse(json: unknown): { 
  results: SearchResult[]; 
  parseMeta: ParseMeta;
} {
  const results: SearchResult[] = [];
  const fieldsMissing: string[] = [];
  
  if (!json || typeof json !== 'object') {
    return { 
      results: [], 
      parseMeta: { parseMethod: 'INVALID_JSON', fieldsMissing: ['root'] } 
    };
  }
  
  const data = json as CpnuSearchApiResponse;
  
  // Check for procesos array
  if (Array.isArray(data.procesos)) {
    for (const proc of data.procesos) {
      if (!proc.idProceso) fieldsMissing.push('idProceso');
      
      results.push({
        radicado: proc.numeroRadicacion || proc.radicado || '',
        despacho: proc.despacho || proc.nombreDespacho || '',
        demandante: proc.demandante,
        demandado: proc.demandado,
        tipo_proceso: proc.tipoProceso,
        fecha_radicacion: proc.fechaRadicacion,
        id_proceso: proc.idProceso,
        detail_url: proc.idProceso 
          ? `https://consultaprocesos.ramajudicial.gov.co/Procesos/Detalle?idProceso=${proc.idProceso}`
          : undefined,
      });
    }
    
    return {
      results,
      parseMeta: { 
        parseMethod: 'CPNU_API_PROCESOS', 
        itemCount: results.length,
        fieldsMissing: fieldsMissing.length > 0 ? fieldsMissing : undefined,
      },
    };
  }
  
  // Single process at root level
  if (data.idProceso) {
    results.push({
      radicado: data.numeroRadicacion || '',
      despacho: '',
      id_proceso: data.idProceso,
    });
    
    return {
      results,
      parseMeta: { parseMethod: 'CPNU_API_SINGLE', itemCount: 1 },
    };
  }
  
  // Empty response
  return {
    results: [],
    parseMeta: { parseMethod: 'CPNU_API_EMPTY', fieldsMissing: ['procesos'] },
  };
}

interface CpnuActuacionesApiResponse {
  actuaciones?: Array<{
    fechaActuacion?: string;
    fecha?: string;
    actuacion?: string;
    descripcion?: string;
    anotacion?: string;
    nombreDespacho?: string;
    despacho?: string;
    detalle?: string;
    documentos?: Array<{ nombre?: string; descripcion?: string; url?: string; enlace?: string }>;
  }>;
}

export function parseCpnuActuacionesResponse(
  json: unknown, 
  radicado: string, 
  sourceUrl: string
): { events: ProcessEvent[]; parseMeta: ParseMeta } {
  const events: ProcessEvent[] = [];
  
  if (!json || typeof json !== 'object') {
    return { 
      events: [], 
      parseMeta: { parseMethod: 'INVALID_JSON', fieldsMissing: ['root'] } 
    };
  }
  
  const data = json as CpnuActuacionesApiResponse;
  const actuaciones = data.actuaciones || (Array.isArray(json) ? json : []);
  
  if (!Array.isArray(actuaciones) || actuaciones.length === 0) {
    return {
      events: [],
      parseMeta: { parseMethod: 'CPNU_ACTUACIONES_EMPTY', fieldsMissing: ['actuaciones'] },
    };
  }
  
  for (const act of actuaciones) {
    const eventDate = parseColombianDate(act.fechaActuacion || act.fecha || '');
    const description = act.actuacion || act.descripcion || act.anotacion || '';
    const despacho = act.nombreDespacho || act.despacho || '';
    
    if (!description) continue;
    
    const eventType = determineEventType(description);
    
    events.push({
      source: 'CPNU',
      event_type: eventType,
      event_date: eventDate,
      title: truncate(description, 100),
      description,
      detail: act.detalle,
      attachments: (act.documentos || []).map(doc => ({
        label: doc.nombre || doc.descripcion || 'Documento',
        url: doc.url || doc.enlace || '',
      })),
      source_url: sourceUrl,
      hash_fingerprint: computeFingerprint('CPNU', radicado, eventDate, eventType, description, despacho),
      raw_data: act as Record<string, unknown>,
    });
  }
  
  return {
    events,
    parseMeta: { parseMethod: 'CPNU_ACTUACIONES_PARSED', itemCount: events.length },
  };
}

// ============= FIRECRAWL RESULT PARSERS =============

export function parseFirecrawlSearchResult(
  markdown: string,
  html: string,
  radicado: string
): { results: SearchResult[]; parseMeta: ParseMeta } {
  const results: SearchResult[] = [];
  const contentToCheck = markdown + html;
  
  // Check if it's the empty form
  if (markdown.includes('0 / 23') && markdown.includes('Número de Radicación')) {
    return { results: [], parseMeta: { parseMethod: 'SPA_FORM_EMPTY' } };
  }
  
  // Check for no results message
  if (markdown.includes('No se encontraron') || markdown.includes('sin resultados')) {
    return { results: [], parseMeta: { parseMethod: 'NO_RESULTS_MESSAGE' } };
  }
  
  // Look for radicado in content
  if (!contentToCheck.includes(radicado)) {
    return { results: [], parseMeta: { parseMethod: 'NO_MATCH' } };
  }
  
  // Extract idProceso
  let idProceso: string | number | undefined;
  const urlMatch = contentToCheck.match(/idProceso[=\/](\d+)/i);
  if (urlMatch) idProceso = urlMatch[1];
  
  const dataIdMatch = contentToCheck.match(/data-(?:id|proceso)[="](\d+)/i);
  if (!idProceso && dataIdMatch) idProceso = dataIdMatch[1];
  
  // Extract despacho
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
  
  // Extract party names
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
  
  return { results, parseMeta: { parseMethod: 'FIRECRAWL_CONTENT_MATCH', itemCount: 1 } };
}

// ============= SCHEMA VALIDATION =============

export function validateSearchResponseSchema(json: unknown): { 
  valid: boolean; 
  missingFields: string[]; 
  message?: string;
} {
  if (!json || typeof json !== 'object') {
    return { valid: false, missingFields: ['root'], message: 'Response is not an object' };
  }
  
  const data = json as Record<string, unknown>;
  const missingFields: string[] = [];
  
  // Check for procesos array or idProceso at root
  if (!data.procesos && !data.idProceso) {
    // Could be an array response
    if (!Array.isArray(json)) {
      missingFields.push('procesos OR idProceso');
    }
  }
  
  // If procesos exists, validate first item structure
  if (Array.isArray(data.procesos) && data.procesos.length > 0) {
    const first = data.procesos[0];
    if (!first.idProceso && !first.id) missingFields.push('procesos[0].idProceso');
    if (!first.numeroRadicacion && !first.radicado) missingFields.push('procesos[0].radicado');
  }
  
  if (missingFields.length > 0) {
    return { 
      valid: false, 
      missingFields, 
      message: `CPNU schema changed: missing ${missingFields.join(', ')}. Update parser + fixtures.` 
    };
  }
  
  return { valid: true, missingFields: [] };
}

export function validateActuacionesResponseSchema(json: unknown): {
  valid: boolean;
  missingFields: string[];
  message?: string;
} {
  if (!json || typeof json !== 'object') {
    return { valid: false, missingFields: ['root'], message: 'Response is not an object' };
  }
  
  const missingFields: string[] = [];
  const data = json as Record<string, unknown>;
  
  // Check for actuaciones array
  const actuaciones = data.actuaciones || (Array.isArray(json) ? json : null);
  
  if (!actuaciones || !Array.isArray(actuaciones)) {
    missingFields.push('actuaciones');
  } else if (actuaciones.length > 0) {
    const first = actuaciones[0];
    if (!first.fechaActuacion && !first.fecha) missingFields.push('actuaciones[0].fecha');
    if (!first.actuacion && !first.descripcion && !first.anotacion) {
      missingFields.push('actuaciones[0].descripcion');
    }
  }
  
  if (missingFields.length > 0) {
    return {
      valid: false,
      missingFields,
      message: `CPNU actuaciones schema changed: missing ${missingFields.join(', ')}. Update parser + fixtures.`,
    };
  }
  
  return { valid: true, missingFields: [] };
}

// ============= ATTEMPT LOG VALIDATION =============

export function validateAttemptLog(attempt: unknown): { 
  valid: boolean; 
  missingFields: string[];
} {
  if (!attempt || typeof attempt !== 'object') {
    return { valid: false, missingFields: ['attempt'] };
  }
  
  const a = attempt as Record<string, unknown>;
  const requiredFields = ['phase', 'url', 'method', 'status', 'latency_ms', 'success'];
  const missingFields: string[] = [];
  
  for (const field of requiredFields) {
    if (!(field in a)) {
      missingFields.push(field);
    }
  }
  
  // Validate response_snippet is truncated properly
  if (a.response_snippet_1kb && typeof a.response_snippet_1kb === 'string') {
    if (a.response_snippet_1kb.length > 1024 + 3) { // +3 for "..."
      missingFields.push('response_snippet_1kb (exceeds 1024)');
    }
  }
  
  return { valid: missingFields.length === 0, missingFields };
}

// ============= REDACTION UTILITY =============

export function redactSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  
  if (typeof data === 'string') {
    // Redact patterns
    let redacted = data;
    
    // Names (title case words, 2+ consecutive)
    redacted = redacted.replace(/([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+){2,}[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/g, 'NOMBRE_TEST');
    
    // Colombian cedula numbers (6-10 digits, possibly with dots)
    redacted = redacted.replace(/\b\d{1,3}\.?\d{3}\.?\d{3}\b/g, '0');
    
    // Email addresses
    redacted = redacted.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'email@test.com');
    
    // Phone numbers
    redacted = redacted.replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '000-000-0000');
    
    // Addresses (patterns like "Calle X # Y - Z")
    redacted = redacted.replace(/(?:Calle|Carrera|Avenida|Transversal|Diagonal)\s+\d+[^\n]{5,50}/gi, 'DIRECCION_TEST');
    
    return redacted;
  }
  
  if (Array.isArray(data)) {
    return data.map(item => redactSensitiveData(item));
  }
  
  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      // Redact specific field names
      const sensitiveFields = ['nombre', 'demandante', 'demandado', 'cedula', 'nit', 'email', 'telefono', 'direccion'];
      if (sensitiveFields.some(f => key.toLowerCase().includes(f))) {
        if (typeof value === 'string') {
          result[key] = 'REDACTED_TEST';
        } else {
          result[key] = redactSensitiveData(value);
        }
      } else {
        result[key] = redactSensitiveData(value);
      }
    }
    return result;
  }
  
  return data;
}
