/**
 * External API Scraping Adapter
 * 
 * Uses the external Render.com API (rama-judicial-api.onrender.com)
 * to search and retrieve process information and actuaciones.
 * 
 * This adapter uses job-based polling:
 * 1. POST/GET to /buscar?numero_radicacion={radicado} returns { jobId }
 * 2. Poll GET /resultado/{jobId} until status is "completed" or "failed"
 * 
 * API Response Structure:
 * {
 *   proceso: { "Fecha de Radicación", "Tipo de Proceso", "Despacho", "Demandante", "Demandado", ... },
 *   actuaciones: [{ "Fecha de Actuación", "Actuación", "Anotación", ... }],
 *   total_actuaciones: number,
 *   ultima_actuacion: { ... },
 *   contador_web: number
 * }
 */

import { API_BASE_URL } from '@/config/api';
import {
  ScrapingAdapter,
  LookupResult,
  ScrapeResult,
  RadicadoMatch,
  RawActuacion,
  NormalizedActuacion,
  computeActuacionHash,
  normalizeActuacionText,
} from './adapter-interface';

interface ExternalApiResponse {
  // Job-related fields
  jobId?: string;
  success?: boolean;
  status?: string;
  estado?: string;
  
  // Process data
  proceso?: {
    'Fecha de Radicación'?: string;
    'Tipo de Proceso'?: string;
    'Despacho'?: string;
    'Demandante'?: string;
    'Demandado'?: string;
    'Clase de Proceso'?: string;
    'Ubicación'?: string;
    'Ponente'?: string;
    [key: string]: string | undefined;
  };
  sujetos_procesales?: Array<{
    tipo: string;
    nombre: string;
  }>;
  actuaciones?: Array<{
    'Fecha de Actuación'?: string;
    'Actuación'?: string;
    'Anotación'?: string;
    'Fecha inicia Término'?: string;
    'Fecha finaliza Término'?: string;
    'Fecha de Registro'?: string;
  }>;
  total_actuaciones?: number;
  ultima_actuacion?: Record<string, unknown>;
  contador_web?: number;
  error?: string;
  message?: string;
}

export class ExternalApiAdapter implements ScrapingAdapter {
  readonly id = 'external-rama-judicial-api';
  readonly name = 'API Nueva Rama Judicial (Render con búsqueda avanzada)';
  readonly description = 'API mejorada con búsqueda avanzada/profunda en Render para consulta de procesos judiciales';
  readonly active = true;

  private readonly baseUrl = API_BASE_URL;
  private readonly pollingInterval = 2000; // 2 seconds between polls
  private readonly maxPollingAttempts = 45; // 45 * 2s = 90s max polling
  private readonly initialRequestTimeout = 45000; // 45s for initial request

  /**
   * Perform job-based polling to get results
   */
  private async pollForResults(jobId: string): Promise<ExternalApiResponse> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      
      const polling = setInterval(async () => {
        attempts++;
        
        try {
          const response = await fetch(
            `${this.baseUrl}/resultado/${jobId}`,
            {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
            }
          );

          const result: ExternalApiResponse = await response.json();
          console.log(`⏳ Polling intento ${attempts}: ${result.status || 'unknown'}`);

          if (result.status === 'completed') {
            clearInterval(polling);
            resolve(result);
          } else if (result.status === 'failed') {
            clearInterval(polling);
            reject(new Error(result.error || 'La consulta falló'));
          }

          // Timeout after max attempts
          if (attempts >= this.maxPollingAttempts) {
            clearInterval(polling);
            reject(new Error('TIMEOUT: La consulta tomó demasiado tiempo'));
          }
        } catch (err) {
          console.error('Error en polling:', err);
          if (attempts >= this.maxPollingAttempts) {
            clearInterval(polling);
            reject(err);
          }
        }
      }, this.pollingInterval);
    });
  }

  async lookup(radicadoNumber: string): Promise<LookupResult> {
    try {
      const cleanRadicado = radicadoNumber.replace(/\D/g, '');
      
      // Validate radicado format (23 digits)
      if (cleanRadicado.length !== 23) {
        return {
          status: 'NOT_FOUND',
          matches: [],
          errorMessage: 'El radicado debe tener exactamente 23 dígitos',
          errorCode: 'INVALID_FORMAT',
        };
      }

      console.log('🔍 ExternalApiAdapter: Consultando radicado:', cleanRadicado);

      // Step 1: Start the search job (with timeout)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.initialRequestTimeout);

      let startResponse: Response;
      try {
        startResponse = await fetch(
          `${this.baseUrl}/buscar?numero_radicacion=${cleanRadicado}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            signal: controller.signal,
          }
        );
        clearTimeout(timeout);
      } catch (fetchError) {
        clearTimeout(timeout);
        const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
        if (errorMsg.includes('abort') || errorMsg.includes('AbortError')) {
          return {
            status: 'UNAVAILABLE',
            matches: [],
            errorMessage: 'Tiempo de espera agotado (la API de Rama Judicial está tardando demasiado)',
            errorCode: 'TIMEOUT',
          };
        }
        throw fetchError;
      }

      if (!startResponse.ok) {
        if (startResponse.status === 404) {
          return {
            status: 'NOT_FOUND',
            matches: [],
            errorMessage: 'Proceso no encontrado',
          };
        }
        if (startResponse.status === 429) {
          return {
            status: 'UNAVAILABLE',
            matches: [],
            errorMessage: 'Servicio temporalmente no disponible (rate limit)',
            errorCode: 'RATE_LIMITED',
          };
        }
        return {
          status: 'ERROR',
          matches: [],
          errorMessage: `Error HTTP: ${startResponse.status}`,
          errorCode: `HTTP_${startResponse.status}`,
        };
      }

      const startData: ExternalApiResponse = await startResponse.json();
      console.log('📋 Respuesta inicial API:', JSON.stringify(startData).substring(0, 500));
      
      let data: ExternalApiResponse;

      // IMPORTANT: Check for jobId FIRST before any other checks
      // API returns { success: true, jobId: "xxx" } when starting a job
      if (startData.jobId) {
        console.log('📋 Job ID recibido:', startData.jobId);
        // Step 2: Poll for results
        try {
          data = await this.pollForResults(startData.jobId);
          console.log('📊 Polling completado, estado:', data.estado || data.status);
        } catch (pollError) {
          const errorMsg = pollError instanceof Error ? pollError.message : 'Error en polling';
          console.error('❌ Error en polling:', errorMsg);
          return {
            status: 'UNAVAILABLE',
            matches: [],
            errorMessage: errorMsg,
            errorCode: errorMsg.includes('TIMEOUT') ? 'TIMEOUT' : 'POLLING_ERROR',
          };
        }
      } else if (startData.proceso) {
        // Direct response with data (no polling needed)
        console.log('✅ Respuesta directa recibida con proceso');
        data = startData;
      } else if (startData.estado === 'NO_ENCONTRADO') {
        return {
          status: 'NOT_FOUND',
          matches: [],
          errorMessage: 'No se encontró información del proceso',
        };
      } else if (startData.error) {
        return {
          status: 'ERROR',
          matches: [],
          errorMessage: startData.error,
          errorCode: 'API_ERROR',
        };
      } else {
        // Unknown response format - log and return error
        console.error('❓ Respuesta inesperada:', JSON.stringify(startData));
        return {
          status: 'ERROR',
          matches: [],
          errorMessage: 'Respuesta inesperada del servidor: ' + JSON.stringify(startData).substring(0, 200),
          errorCode: 'UNEXPECTED_RESPONSE',
        };
      }

      // Check for NOT_FOUND in polling result
      if (data.estado === 'NO_ENCONTRADO') {
        return {
          status: 'NOT_FOUND',
          matches: [],
          errorMessage: 'No se encontró información del proceso',
        };
      }

      if (data.error) {
        return {
          status: 'ERROR',
          matches: [],
          errorMessage: data.error,
          errorCode: 'API_ERROR',
        };
      }

      if (!data.proceso) {
        console.error('❌ No hay datos de proceso en respuesta:', JSON.stringify(data).substring(0, 500));
        return {
          status: 'NOT_FOUND',
          matches: [],
          errorMessage: 'No se encontró información del proceso en la respuesta',
          errorCode: 'NO_PROCESS_DATA',
        };
      }

      console.log('✅ Proceso encontrado:', data.proceso['Despacho']);
      console.log('📊 Total actuaciones:', data.total_actuaciones);

      // Build the match from the response
      const match: RadicadoMatch = {
        radicado: cleanRadicado,
        despacho: data.proceso['Despacho'] || '',
        demandante: data.proceso['Demandante'],
        demandado: data.proceso['Demandado'],
        lastActionDate: data.ultima_actuacion?.['Fecha de Actuación'] as string | undefined,
        sourceUrl: `${this.baseUrl}/buscar?numero_radicacion=${cleanRadicado}`,
        confidence: 1.0,
      };

      return {
        status: 'FOUND',
        matches: [match],
        rawResponse: data,
      };

    } catch (err) {
      console.error('ExternalApiAdapter lookup error:', err);
      
      const errorMessage = err instanceof Error ? err.message : 'Error de conexión';
      
      if (errorMessage.includes('TIMEOUT')) {
        return {
          status: 'UNAVAILABLE',
          matches: [],
          errorMessage: 'Tiempo de espera agotado (el servicio puede estar ocupado)',
          errorCode: 'TIMEOUT',
        };
      }

      return {
        status: 'ERROR',
        matches: [],
        errorMessage,
        errorCode: 'NETWORK_ERROR',
      };
    }
  }

  async scrapeCase(match: RadicadoMatch): Promise<ScrapeResult> {
    try {
      console.log('🔍 ExternalApiAdapter: Scraping caso:', match.radicado);

      // Step 1: Start the search job
      const startResponse = await fetch(
        `${this.baseUrl}/buscar?numero_radicacion=${match.radicado}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        }
      );

      if (!startResponse.ok) {
        return {
          status: 'FAILED',
          actuaciones: [],
          errorMessage: `Error HTTP: ${startResponse.status}`,
          errorCode: `HTTP_${startResponse.status}`,
          scrapedAt: new Date().toISOString(),
        };
      }

      const startData: ExternalApiResponse = await startResponse.json();
      console.log('📋 Scrape respuesta inicial:', JSON.stringify(startData).substring(0, 300));
      
      let data: ExternalApiResponse;

      // IMPORTANT: Check for jobId FIRST before any other checks
      if (startData.jobId) {
        console.log('📋 Scrape Job ID:', startData.jobId);
        try {
          data = await this.pollForResults(startData.jobId);
          console.log('📊 Scrape polling completado, estado:', data.estado || data.status);
        } catch (pollError) {
          const errorMsg = pollError instanceof Error ? pollError.message : 'Error en polling';
          return {
            status: 'FAILED',
            actuaciones: [],
            errorMessage: errorMsg,
            errorCode: errorMsg.includes('TIMEOUT') ? 'TIMEOUT' : 'POLLING_ERROR',
            scrapedAt: new Date().toISOString(),
          };
        }
      } else if (startData.proceso) {
        console.log('✅ Scrape respuesta directa con proceso');
        data = startData;
      } else if (startData.estado === 'NO_ENCONTRADO') {
        return {
          status: 'FAILED',
          actuaciones: [],
          errorMessage: 'No se encontró información del proceso',
          errorCode: 'NO_DATA',
          scrapedAt: new Date().toISOString(),
        };
      } else {
        console.error('❓ Scrape respuesta inesperada:', JSON.stringify(startData));
        return {
          status: 'FAILED',
          actuaciones: [],
          errorMessage: startData.error || 'Respuesta inesperada: ' + JSON.stringify(startData).substring(0, 100),
          errorCode: 'UNEXPECTED_RESPONSE',
          scrapedAt: new Date().toISOString(),
        };
      }

      if (data.estado === 'NO_ENCONTRADO') {
        return {
          status: 'FAILED',
          actuaciones: [],
          errorMessage: 'No se encontró información del proceso',
          errorCode: 'NO_DATA',
          scrapedAt: new Date().toISOString(),
        };
      }

      if (data.error) {
        return {
          status: 'FAILED',
          actuaciones: [],
          errorMessage: data.error,
          errorCode: 'API_ERROR',
          scrapedAt: new Date().toISOString(),
        };
      }

      if (!data.proceso) {
        console.error('❌ Scrape sin datos de proceso:', JSON.stringify(data).substring(0, 300));
        return {
          status: 'FAILED',
          actuaciones: [],
          errorMessage: 'No se encontró información del proceso en la respuesta',
          errorCode: 'NO_PROCESS_DATA',
          scrapedAt: new Date().toISOString(),
        };
      }

      console.log('✅ Scrape exitoso. Actuaciones:', data.total_actuaciones);

      // Transform actuaciones to the expected format
      const actuaciones: RawActuacion[] = (data.actuaciones || []).map(act => ({
        fechaActuacion: act['Fecha de Actuación'] || '',
        actuacion: act['Actuación'] || '',
        anotacion: act['Anotación'],
        fechaInicial: act['Fecha inicia Término'],
        fechaFinal: act['Fecha finaliza Término'],
        fechaRegistro: act['Fecha de Registro'],
        conDocumentos: false,
        documentos: [],
        rawData: act,
      }));

      return {
        status: 'SUCCESS',
        caseMetadata: {
          radicado: match.radicado,
          despacho: data.proceso['Despacho'],
          ponente: data.proceso['Ponente'],
          demandantes: data.proceso['Demandante'],
          demandados: data.proceso['Demandado'],
          tipoProceso: data.proceso['Tipo de Proceso'],
          clase: data.proceso['Clase de Proceso'],
          ubicacion: data.proceso['Ubicación'],
          fechaRadicacion: data.proceso['Fecha de Radicación'],
          ultimaActuacion: data.ultima_actuacion?.['Fecha de Actuación'] as string | undefined,
          sourceUrl: match.sourceUrl,
          sujetosProcesales: data.sujetos_procesales,
          totalActuaciones: data.total_actuaciones,
        },
        actuaciones,
        scrapedAt: new Date().toISOString(),
      };

    } catch (err) {
      console.error('ExternalApiAdapter scrape error:', err);
      
      const errorMessage = err instanceof Error ? err.message : 'Error de conexión';

      return {
        status: 'FAILED',
        actuaciones: [],
        errorMessage,
        errorCode: errorMessage.includes('TIMEOUT') ? 'TIMEOUT' : 'NETWORK_ERROR',
        scrapedAt: new Date().toISOString(),
      };
    }
  }

  normalizeActuaciones(actuacionesRaw: RawActuacion[], sourceUrl: string): NormalizedActuacion[] {
    return actuacionesRaw.map(act => {
      const rawText = `${act.actuacion}${act.anotacion ? ' - ' + act.anotacion : ''}`;
      const normalizedText = normalizeActuacionText(rawText);
      
      // Parse date
      let actDate: string | null = null;
      if (act.fechaActuacion) {
        const parsed = this.parseColombianDate(act.fechaActuacion);
        if (parsed) actDate = parsed;
      }

      // Parse time if available in the text
      let actTime: string | null = null;
      const timeMatch = rawText.match(/(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1]);
        const minutes = timeMatch[2];
        const period = timeMatch[3]?.toLowerCase();
        if (period && (period.includes('p')) && hours < 12) hours += 12;
        if (period && (period.includes('a')) && hours === 12) hours = 0;
        actTime = `${hours.toString().padStart(2, '0')}:${minutes}:00`;
      }

      // Build attachments list
      const attachments = (act.documentos || []).map(d => ({
        label: d.nombre || 'Documento',
        url: d.url || '',
      }));

      const hashFingerprint = computeActuacionHash(actDate, normalizedText, sourceUrl);

      return {
        rawText,
        normalizedText,
        actDate,
        actTime,
        actDateRaw: act.fechaActuacion,
        actTypeGuess: this.guessActType(normalizedText),
        confidence: 0.9, // Higher confidence for external API with polling
        attachments,
        sourceUrl,
        hashFingerprint,
      };
    });
  }

  private parseColombianDate(dateStr: string): string | null {
    if (!dateStr) return null;
    
    // Try ISO format first (2024-01-15)
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
      return dateStr.split('T')[0];
    }

    // Try DD/MM/YYYY format
    const ddmmyyyy = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (ddmmyyyy) {
      const day = ddmmyyyy[1].padStart(2, '0');
      const month = ddmmyyyy[2].padStart(2, '0');
      return `${ddmmyyyy[3]}-${month}-${day}`;
    }

    // Try spelled out format "15 de enero de 2024"
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

    // Try YYYY/MM/DD format
    const yyyymmdd = dateStr.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (yyyymmdd) {
      const month = yyyymmdd[2].padStart(2, '0');
      const day = yyyymmdd[3].padStart(2, '0');
      return `${yyyymmdd[1]}-${month}-${day}`;
    }

    return null;
  }

  private guessActType(normalizedText: string): string | null {
    // Enhanced type detection
    if (/auto\s+admisorio|admite\s+(la\s+)?demanda|auto\s+que\s+admite/.test(normalizedText)) return 'AUTO_ADMISORIO';
    if (/mandamiento\s+de\s+pago|libra\s+mandamiento/.test(normalizedText)) return 'MANDAMIENTO_DE_PAGO';
    if (/notificacion|notificado|se\s+notifica/.test(normalizedText)) return 'NOTIFICACION';
    if (/al\s+despacho|expediente\s+al\s+despacho|pasa\s+al\s+despacho/.test(normalizedText)) return 'EXPEDIENTE_AL_DESPACHO';
    if (/sentencia|fallo|decision\s+de\s+fondo/.test(normalizedText)) return 'SENTENCIA';
    if (/audiencia|programa\s+audiencia|fija\s+audiencia/.test(normalizedText)) return 'AUDIENCIA';
    if (/recurso|apelacion|reposicion/.test(normalizedText)) return 'RECURSO';
    if (/traslado|corre\s+traslado/.test(normalizedText)) return 'TRASLADO';
    if (/embargo|medida\s+cautelar|embargo\s+y\s+secuestro/.test(normalizedText)) return 'EMBARGO';
    if (/contestacion|contesta\s+demanda/.test(normalizedText)) return 'CONTESTACION_DEMANDA';
    if (/excepciones|propone\s+excepciones/.test(normalizedText)) return 'EXCEPCIONES';
    if (/desistimiento|desiste/.test(normalizedText)) return 'DESISTIMIENTO';
    if (/terminacion|archivese|archivo/.test(normalizedText)) return 'TERMINACION';
    return null;
  }
}

// Export a singleton instance
export const externalApiAdapter = new ExternalApiAdapter();
