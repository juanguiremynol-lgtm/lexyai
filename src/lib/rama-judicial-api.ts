/**
 * Rama Judicial API Client
 * 
 * REFACTORED: This module now delegates to Edge Functions.
 * NO external API URLs are hardcoded here.
 * All actual API calls happen server-side via sync-by-radicado.
 */

import { supabase } from "@/integrations/supabase/client";

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

export interface Estadisticas {
  total_actuaciones?: number;
  primera_actuacion?: string;
  ultima_actuacion?: string;
  dias_desde_radicacion?: number;
  dias_desde_ultima_actuacion?: number;
  sujetos_procesales?: {
    demandantes?: string[];
    demandados?: string[];
  };
  [key: string]: string | number | { demandantes?: string[]; demandados?: string[] } | undefined;
}

export interface RamaJudicialApiResponse {
  success?: boolean;
  numero_radicacion?: string;
  proceso: Proceso;
  sujetos_procesales?: SujetoProcesal[];
  actuaciones: Actuacion[];
  total_actuaciones: number;
  ultima_actuacion: Actuacion | null;
  estadisticas?: Estadisticas;
  contador_web?: number;
  error?: string;
  message?: string;
  // Raw data from API for debugging
  rawData?: Record<string, unknown>;
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
  notFound?: boolean;
  isProvisional?: boolean;
  rawResponse?: unknown;
}

export interface PollingCallbacks {
  onProgress?: (attempt: number, status: string, elapsedMs?: number) => void;
}

/**
 * Fetch process data from the Rama Judicial API using job-based polling
 * 
 * @param radicado - 23-digit case number
 * @param timeoutMs - Total timeout in milliseconds (default: 30000)
 * @param pollingInterval - Interval between polls in milliseconds (default: 2000)
 * @param callbacks - Optional callbacks for progress updates
 */
export async function fetchFromRamaJudicial(
  radicado: string, 
  timeoutMs = 30000,
  pollingInterval = 2000,
  callbacks?: PollingCallbacks
): Promise<FetchResult> {
  const validation = validateRadicadoFormat(radicado);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const startTime = Date.now();
  let abortController: AbortController | null = null;
  let pollingIntervalId: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (pollingIntervalId) {
      clearInterval(pollingIntervalId);
      pollingIntervalId = null;
    }
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  };

  try {
    // Step 1: Start the search job with timeout
    console.log("🔍 Consultando:", validation.cleaned);
    
    abortController = new AbortController();
    const initTimeoutId = setTimeout(() => abortController?.abort(), timeoutMs);
    
    let startResponse: Response;
    try {
      startResponse = await fetch(
        `${API_BASE_URL}/buscar?numero_radicacion=${encodeURIComponent(validation.cleaned)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          signal: abortController.signal,
        }
      );
    } catch (err) {
      clearTimeout(initTimeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        return { 
          success: false, 
          error: "El servidor está tardando más de lo esperado. Intenta nuevamente.",
          isTimeout: true 
        };
      }
      throw err;
    }
    clearTimeout(initTimeoutId);

    if (!startResponse.ok) {
      if (startResponse.status === 404) {
        return { success: false, error: "Proceso no encontrado", notFound: true };
      }
      if (startResponse.status === 429) {
        return { success: false, error: "Servicio temporalmente no disponible (rate limit)" };
      }
      return { success: false, error: `Error HTTP: ${startResponse.status}` };
    }

    const startData = await startResponse.json();
    
    // If API returns direct data (no jobId), handle it directly
    if (!startData.jobId) {
      if (startData.error || startData.success === false) {
        if (startData.estado === "NO_ENCONTRADO") {
          return { 
            success: false, 
            error: "No se encontró información del proceso", 
            notFound: true,
            rawResponse: startData,
          };
        }
        return { success: false, error: startData.error || "Error al iniciar la búsqueda", rawResponse: startData };
      }
      
      // Direct response with data
      if (startData.proceso) {
        return { success: true, data: startData };
      }
    }

    const jobId = startData.jobId;
    console.log("📋 Job ID:", jobId);

    // Step 2: Poll for results with timeout
    return new Promise((resolve) => {
      let attempts = 0;
      const maxPollingTime = timeoutMs - (Date.now() - startTime);
      
      if (maxPollingTime <= 0) {
        resolve({ 
          success: false, 
          error: "El servidor está tardando más de lo esperado. Intenta nuevamente.",
          isTimeout: true 
        });
        return;
      }

      const timeoutHandler = setTimeout(() => {
        cleanup();
        resolve({ 
          success: false, 
          error: "El servidor está tardando más de lo esperado. Intenta nuevamente.",
          isTimeout: true 
        });
      }, maxPollingTime);
      
      pollingIntervalId = setInterval(async () => {
        attempts++;
        const elapsedMs = Date.now() - startTime;
        
        try {
          const pollController = new AbortController();
          const pollTimeoutId = setTimeout(() => pollController.abort(), 5000);
          
          const resultResponse = await fetch(
            `${API_BASE_URL}/resultado/${jobId}`,
            {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              signal: pollController.signal,
            }
          );
          clearTimeout(pollTimeoutId);

          const result = await resultResponse.json();
          console.log(`⏳ Intento ${attempts}: ${result.status} (${elapsedMs}ms)`);
          
          callbacks?.onProgress?.(attempts, result.status, elapsedMs);

          if (result.status === "completed") {
            clearTimeout(timeoutHandler);
            cleanup();
            
            // Check for NO_ENCONTRADO - this may be a false negative
            if (result.success === false || result.estado === "NO_ENCONTRADO") {
              resolve({ 
                success: false, 
                error: result.mensaje || "No se encontró información del proceso. Puede registrarlo manualmente.",
                notFound: true,
                isProvisional: true, // Mark as provisional - may be false negative
                rawResponse: result,
              });
            } else if (result.success === true && result.proceso) {
              // Validate completeness - check for "silencio"
              const hasDespacho = result.proceso.Despacho || result.proceso.despacho;
              const hasSujetos = (result.sujetos_procesales && result.sujetos_procesales.length > 0) ||
                                 result.proceso.Demandante || result.proceso.Demandado;
              const hasActuaciones = result.actuaciones && result.actuaciones.length > 0;
              
              if (!hasDespacho || !hasSujetos || !hasActuaciones) {
                console.warn("⚠️ Respuesta incompleta (silencio):", {
                  hasDespacho: !!hasDespacho,
                  hasSujetos: !!hasSujetos,
                  hasActuaciones: !!hasActuaciones,
                });
              }
              
              console.log("✅ Proceso encontrado:", result);
              resolve({ success: true, data: result, rawResponse: result });
            } else {
              // Unexpected completed state
              resolve({ success: true, data: result, rawResponse: result });
            }
          } else if (result.status === "failed") {
            clearTimeout(timeoutHandler);
            cleanup();
            resolve({ 
              success: false, 
              error: result.error || "Error al procesar la consulta",
              rawResponse: result,
            });
          }
          // For "processing" status, continue polling
        } catch (err) {
          console.error("Error en polling:", err);
          // Continue polling unless it's an abort
          if (err instanceof Error && err.name === 'AbortError') {
            // This poll was aborted, continue with next iteration
          }
        }
      }, pollingInterval);
    });
  } catch (err) {
    cleanup();
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
