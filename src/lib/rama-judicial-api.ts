/**
 * Rama Judicial API Client
 * 
 * Unified API client for interacting with the external Rama Judicial API.
 * Used for process lookups, updates, and scheduled crawling.
 * 
 * API: https://rama-judicial-api.onrender.com
 */

import { API_BASE_URL } from "@/config/api";

// ============== Types ==============

export interface Proceso {
  "Fecha de Radicación"?: string;
  "Tipo de Proceso"?: string;
  "Despacho"?: string;
  "Demandante"?: string;
  "Demandado"?: string;
  "Clase de Proceso"?: string;
  "Ubicación"?: string;
  "Ponente"?: string;
  [key: string]: string | undefined;
}

export interface Actuacion {
  "Fecha de Actuación"?: string;
  "Actuación"?: string;
  "Anotación"?: string;
  "Fecha inicia Término"?: string;
  "Fecha finaliza Término"?: string;
  "Fecha de Registro"?: string;
}

export interface SujetoProcesal {
  tipo: string;
  nombre: string;
}

export interface RamaJudicialApiResponse {
  success?: boolean;
  numero_radicacion?: string;
  proceso: Proceso;
  sujetos_procesales?: SujetoProcesal[];
  actuaciones: Actuacion[];
  total_actuaciones: number;
  ultima_actuacion: Actuacion;
  contador_web?: number;
  error?: string;
  message?: string;
}

export interface ParsedActuacion {
  rawText: string;
  normalizedText: string;
  actDate: string | null;
  actDateRaw: string;
  actTypeGuess: string | null;
  hashFingerprint: string;
}

// ============== Validation ==============

/**
 * Validates a radicado number (must be exactly 23 digits)
 */
export function validateRadicadoFormat(radicado: string): { valid: boolean; cleaned: string; error?: string } {
  const cleaned = radicado.replace(/\D/g, "");
  
  if (!cleaned) {
    return { valid: false, cleaned, error: "Ingrese un número de radicación" };
  }
  
  if (cleaned.length !== 23) {
    return { valid: false, cleaned, error: "El radicado debe tener exactamente 23 dígitos" };
  }
  
  return { valid: true, cleaned };
}

// ============== Date Parsing ==============

/**
 * Parse Colombian date formats into ISO date string (YYYY-MM-DD)
 * Supports: DD/MM/YYYY, YYYY-MM-DD, "15 de enero de 2024"
 */
export function parseColombianDate(dateStr: string): string | null {
  if (!dateStr) return null;
  
  // ISO format: 2024-01-15 or 2024-01-15T...
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.split('T')[0];
  }

  // DD/MM/YYYY format
  const ddmmyyyy = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (ddmmyyyy) {
    const day = ddmmyyyy[1].padStart(2, '0');
    const month = ddmmyyyy[2].padStart(2, '0');
    return `${ddmmyyyy[3]}-${month}-${day}`;
  }

  // YYYY/MM/DD format
  const yyyymmdd = dateStr.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (yyyymmdd) {
    const month = yyyymmdd[2].padStart(2, '0');
    const day = yyyymmdd[3].padStart(2, '0');
    return `${yyyymmdd[1]}-${month}-${day}`;
  }

  // Spelled out format: "15 de enero de 2024"
  const months: Record<string, string> = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
    'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
    'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
  };
  const spelled = dateStr.toLowerCase().match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/);
  if (spelled && months[spelled[2]]) {
    const day = spelled[1].padStart(2, '0');
    return `${spelled[3]}-${months[spelled[2]]}-${day}`;
  }

  return null;
}

// ============== Text Processing ==============

/**
 * Normalize text for comparison and storage
 */
export function normalizeActuacionText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute hash fingerprint for deduplication
 */
export function computeActuacionHash(actDate: string | null, normalizedText: string, radicado: string): string {
  const data = `${actDate || ''}_${normalizedText}_${radicado}`;
  return data.replace(/\s/g, '_').toLowerCase().substring(0, 100);
}

/**
 * Guess the actuacion type based on normalized text
 */
export function guessActuacionType(normalizedText: string): string | null {
  if (/auto\s+admisorio|admite\s+(la\s+)?demanda|auto\s+que\s+admite/.test(normalizedText)) return 'AUTO_ADMISORIO';
  if (/mandamiento\s+de\s+pago|libra\s+mandamiento/.test(normalizedText)) return 'MANDAMIENTO_DE_PAGO';
  if (/notificacion|notificado|se\s+notifica/.test(normalizedText)) return 'NOTIFICACION';
  if (/al\s+despacho|expediente\s+al\s+despacho|pasa\s+al\s+despacho/.test(normalizedText)) return 'EXPEDIENTE_AL_DESPACHO';
  if (/sentencia|fallo|decision\s+de\s+fondo/.test(normalizedText)) return 'SENTENCIA';
  if (/audiencia|programa\s+audiencia|fija\s+audiencia/.test(normalizedText)) return 'AUDIENCIA';
  if (/recurso|apelacion|reposicion/.test(normalizedText)) return 'RECURSO';
  if (/traslado|corre\s+traslado/.test(normalizedText)) return 'TRASLADO';
  if (/embargo|medida\s+cautelar/.test(normalizedText)) return 'EMBARGO';
  if (/contestacion|contesta\s+demanda/.test(normalizedText)) return 'CONTESTACION_DEMANDA';
  if (/excepciones|propone\s+excepciones/.test(normalizedText)) return 'EXCEPCIONES';
  if (/desistimiento|desiste/.test(normalizedText)) return 'DESISTIMIENTO';
  if (/terminacion|archivese|archivo/.test(normalizedText)) return 'TERMINACION';
  return null;
}

// ============== API Client ==============

export interface FetchResult {
  success: boolean;
  data?: RamaJudicialApiResponse;
  error?: string;
  isTimeout?: boolean;
}

/**
 * Fetch process data from the Rama Judicial API
 */
export async function fetchFromRamaJudicial(radicado: string, timeout = 30000): Promise<FetchResult> {
  const validation = validateRadicadoFormat(radicado);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(
      `${API_BASE_URL}/buscar?numero_radicacion=${encodeURIComponent(validation.cleaned)}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        return { success: false, error: "Proceso no encontrado" };
      }
      if (response.status === 429) {
        return { success: false, error: "Servicio temporalmente no disponible (rate limit)" };
      }
      return { success: false, error: `Error HTTP: ${response.status}` };
    }

    const data: RamaJudicialApiResponse = await response.json();

    if (data.error || data.message?.toLowerCase().includes('error')) {
      return { success: false, error: data.error || data.message || "Error en la respuesta" };
    }

    if (!data.proceso) {
      return { success: false, error: "No se encontró información del proceso" };
    }

    return { success: true, data };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { 
        success: false, 
        error: "El servidor está tardando más de lo esperado. Intenta nuevamente.",
        isTimeout: true 
      };
    }
    return { success: false, error: err instanceof Error ? err.message : "Error de conexión" };
  }
}

// ============== Actuaciones Processing ==============

/**
 * Process raw actuaciones from API response into normalized format
 */
export function processActuaciones(actuaciones: Actuacion[], radicado: string): ParsedActuacion[] {
  return actuaciones.map(act => {
    const rawText = `${act["Actuación"] || ""}${act["Anotación"] ? " - " + act["Anotación"] : ""}`;
    const normalizedText = normalizeActuacionText(rawText);
    const actDate = parseColombianDate(act["Fecha de Actuación"] || "");
    const actTypeGuess = guessActuacionType(normalizedText);
    const hashFingerprint = computeActuacionHash(actDate, normalizedText, radicado);

    return {
      rawText,
      normalizedText,
      actDate,
      actDateRaw: act["Fecha de Actuación"] || "",
      actTypeGuess,
      hashFingerprint,
    };
  });
}

/**
 * Create actuaciones insert data for Supabase
 */
export function createActuacionesInsertData(
  actuaciones: Actuacion[],
  radicado: string,
  ownerId: string,
  entityId: string,
  isMonitoredProcess: boolean
) {
  const processed = processActuaciones(actuaciones, radicado);
  
  return processed.map(act => ({
    owner_id: ownerId,
    filing_id: isMonitoredProcess ? null : entityId,
    monitored_process_id: isMonitoredProcess ? entityId : null,
    raw_text: act.rawText,
    normalized_text: act.normalizedText,
    act_date: act.actDate,
    act_date_raw: act.actDateRaw,
    act_type_guess: act.actTypeGuess,
    source: "RAMA_JUDICIAL",
    adapter_name: "external_api",
    hash_fingerprint: act.hashFingerprint,
    confidence: 0.7,
    attachments: [],
  }));
}
