/**
 * Penal 906 Normalizer
 * 
 * Transforms raw actuaciones from Rama Judicial into normalized process events
 */

import { classifyActuacion, normalizeText, hasMedidaAseguramiento, hasNulidad } from './penal906-classifier';

// Raw actuación from scraper/adapter
export interface RawActuacion {
  radicado: string;
  fechaActuacion: string | null; // 'YYYY-MM-DD' or null
  despacho: string | null;
  descripcion: string;
  urlDocumento: string | null;
  fechaConsulta: string; // 'YYYY-MM-DD'
}

// Normalized process event
export interface NormalizedPenalEvent {
  event_id: string; // SHA256 fingerprint
  work_item_id: string;
  raw_text: string;
  event_summary: string; // ≤200 chars, extractive
  event_date: string | null; // ISO date
  scrape_date: string;
  despacho: string | null;
  source_url: string | null;
  source_platform: string;
  
  // Classification
  phase_inferred: number;
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  keywords_matched: string[];
  event_type_normalized: string;
  event_category: string;
  
  // Flags
  is_retroactive: boolean;
  parsing_errors: string[];
  
  // Alert triggers
  triggers_audiencia_alert: boolean;
  triggers_sentencia_alert: boolean;
  triggers_recurso_alert: boolean;
  triggers_medida_aseguramiento_alert: boolean;
  triggers_nulidad_alert: boolean;
}

/**
 * Compute SHA-256 fingerprint for deduplication
 */
async function computeFingerprint(
  workItemId: string,
  fechaActuacion: string | null,
  despacho: string | null,
  descripcion: string
): Promise<string> {
  const data = `${workItemId}|${fechaActuacion || ''}|${despacho || ''}|${descripcion.slice(0, 100)}`;
  
  // Use Web Crypto API
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex;
}

/**
 * Compute fingerprint synchronously (fallback)
 */
function computeFingerprintSync(
  workItemId: string,
  fechaActuacion: string | null,
  despacho: string | null,
  descripcion: string
): string {
  const data = `${workItemId}|${fechaActuacion || ''}|${despacho || ''}|${descripcion.slice(0, 100)}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Extract event summary (extractive, ≤200 chars)
 * Never invents content - takes from raw text only
 */
function extractSummary(rawText: string, maxLength: number = 200): string {
  // Clean the text
  const cleaned = rawText
    .replace(/\s+/g, ' ')
    .trim();
  
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  
  // Try to find first sentence
  const sentenceEnd = cleaned.search(/[.!?]\s/);
  if (sentenceEnd > 0 && sentenceEnd < maxLength - 3) {
    return cleaned.slice(0, sentenceEnd + 1);
  }
  
  // Otherwise truncate at word boundary
  const truncated = cleaned.slice(0, maxLength - 3);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.7) {
    return truncated.slice(0, lastSpace) + '...';
  }
  
  return truncated + '...';
}

/**
 * Validate URL format
 */
function isValidUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse date string to ISO format
 */
function parseDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  
  // Handle YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // Handle DD/MM/YYYY format
  const dmy = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  }
  
  // Handle other formats by trying to parse
  try {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  } catch {
    // Fall through
  }
  
  return null;
}

/**
 * Extract future audiencia date from text if present
 */
export function extractAudienciaDate(text: string): string | null {
  const textNorm = normalizeText(text);
  
  // Common patterns for audiencia dates
  const patterns = [
    /audiencia\s+(?:para|el)\s+(?:dia|fecha)?\s*(\d{1,2})\s*(?:de|\/)\s*(\w+|\d{1,2})\s*(?:de|\/)\s*(\d{4})/,
    /fija\s+(?:audiencia|fecha)\s+(?:para)?\s*(?:el)?\s*(\d{1,2})\s*(?:de|\/)\s*(\w+|\d{1,2})\s*(?:de|\/)\s*(\d{4})/,
    /(\d{1,2})\s*(?:de|\/)\s*(\w+|\d{1,2})\s*(?:de|\/)\s*(\d{4})\s*(?:a las)?\s*(\d{1,2})[:\.]?(\d{2})?/,
  ];
  
  const months: Record<string, string> = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
    'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
    'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12',
  };
  
  for (const pattern of patterns) {
    const match = textNorm.match(pattern);
    if (match) {
      const day = match[1].padStart(2, '0');
      let month = match[2];
      const year = match[3];
      
      // Convert month name to number
      if (months[month]) {
        month = months[month];
      } else if (/^\d{1,2}$/.test(month)) {
        month = month.padStart(2, '0');
      } else {
        continue;
      }
      
      const dateStr = `${year}-${month}-${day}`;
      const parsed = new Date(dateStr);
      
      // Only return if it's a future date
      if (!isNaN(parsed.getTime()) && parsed > new Date()) {
        return dateStr;
      }
    }
  }
  
  return null;
}

/**
 * Normalize a single raw actuación into a process event
 */
export async function normalizeActuacion(
  raw: RawActuacion,
  workItemId: string,
  currentPhase: number = 0,
  latestEventDate: string | null = null
): Promise<NormalizedPenalEvent> {
  const parsingErrors: string[] = [];
  
  // Parse event date
  let eventDate = parseDate(raw.fechaActuacion);
  if (!eventDate && raw.fechaActuacion) {
    parsingErrors.push(`Fecha de actuación no parseable: ${raw.fechaActuacion}`);
  }
  
  // If no event date, use scrape date
  if (!eventDate) {
    eventDate = raw.fechaConsulta;
    parsingErrors.push('Fecha de actuación faltante, usando fecha de consulta');
  }
  
  // Validate URL
  let sourceUrl: string | null = null;
  if (raw.urlDocumento) {
    if (isValidUrl(raw.urlDocumento)) {
      sourceUrl = raw.urlDocumento;
    } else {
      parsingErrors.push(`URL malformada: ${raw.urlDocumento.slice(0, 50)}`);
    }
  }
  
  // Classify the actuación
  const classification = classifyActuacion(raw.descripcion, currentPhase);
  
  // Check for retroactivity
  const isRetroactive = latestEventDate !== null && 
    eventDate !== null && 
    eventDate < latestEventDate;
  
  if (isRetroactive) {
    parsingErrors.push('Evento retroactivo detectado');
  }
  
  // Compute fingerprint
  let eventId: string;
  try {
    eventId = await computeFingerprint(workItemId, raw.fechaActuacion, raw.despacho, raw.descripcion);
  } catch {
    eventId = computeFingerprintSync(workItemId, raw.fechaActuacion, raw.despacho, raw.descripcion);
  }
  
  // Extract summary
  const eventSummary = extractSummary(raw.descripcion);
  
  // Check alert triggers
  const textNorm = normalizeText(raw.descripcion);
  const triggersAudiencia = classification.event_type === 'AUDIENCIA' && 
    extractAudienciaDate(raw.descripcion) !== null;
  const triggersSentencia = classification.event_type === 'SENTENCIA' ||
    /sentencia|fallo|condena|absolucion/.test(textNorm);
  const triggersRecurso = classification.event_type === 'RECURSO' ||
    /recurso|apelacion|casacion|impugnacion/.test(textNorm);
  const triggersMedida = hasMedidaAseguramiento(textNorm);
  const triggersNulidad = hasNulidad(textNorm);
  
  return {
    event_id: eventId,
    work_item_id: workItemId,
    raw_text: raw.descripcion,
    event_summary: eventSummary,
    event_date: eventDate,
    scrape_date: raw.fechaConsulta,
    despacho: raw.despacho,
    source_url: sourceUrl,
    source_platform: 'Rama Judicial',
    
    phase_inferred: classification.phase_inferred,
    confidence_level: classification.confidence_level,
    keywords_matched: classification.keywords_matched,
    event_type_normalized: classification.event_type,
    event_category: classification.event_category,
    
    is_retroactive: isRetroactive,
    parsing_errors: parsingErrors,
    
    triggers_audiencia_alert: triggersAudiencia,
    triggers_sentencia_alert: triggersSentencia,
    triggers_recurso_alert: triggersRecurso,
    triggers_medida_aseguramiento_alert: triggersMedida,
    triggers_nulidad_alert: triggersNulidad,
  };
}

/**
 * Normalize a batch of raw actuaciones
 */
export async function normalizeActuaciones(
  rawActuaciones: RawActuacion[],
  workItemId: string,
  currentPhase: number = 0
): Promise<NormalizedPenalEvent[]> {
  // Sort by date descending to find latest event
  const sorted = [...rawActuaciones].sort((a, b) => {
    const dateA = a.fechaActuacion || a.fechaConsulta;
    const dateB = b.fechaActuacion || b.fechaConsulta;
    return dateB.localeCompare(dateA);
  });
  
  const latestDate = sorted[0]?.fechaActuacion || sorted[0]?.fechaConsulta || null;
  
  // Track progressive phase changes
  let runningPhase = currentPhase;
  const events: NormalizedPenalEvent[] = [];
  
  // Process in chronological order for phase progression
  const chronological = [...rawActuaciones].sort((a, b) => {
    const dateA = a.fechaActuacion || a.fechaConsulta;
    const dateB = b.fechaActuacion || b.fechaConsulta;
    return dateA.localeCompare(dateB);
  });
  
  for (const raw of chronological) {
    const event = await normalizeActuacion(raw, workItemId, runningPhase, latestDate);
    events.push(event);
    
    // Update running phase if it advanced
    if (event.phase_inferred > runningPhase && 
        event.confidence_level !== 'UNKNOWN' &&
        event.confidence_level !== 'LOW') {
      runningPhase = event.phase_inferred;
    }
  }
  
  return events;
}
