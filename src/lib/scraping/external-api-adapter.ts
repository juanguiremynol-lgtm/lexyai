/**
 * External API Scraping Adapter
 * 
 * Uses the external Render.com API (rama-judicial-api.onrender.com)
 * to search and retrieve process information and actuaciones.
 * 
 * This adapter provides direct access to scraped judicial data
 * without relying on Supabase edge functions.
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
  proceso?: {
    'Fecha de Radicación'?: string;
    'Tipo de Proceso'?: string;
    'Despacho'?: string;
    'Demandante'?: string;
    'Demandado'?: string;
    'Clase de Proceso'?: string;
    'Ubicación'?: string;
    'Ponente'?: string;
  };
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
  readonly name = 'API Externa Rama Judicial (Render)';
  readonly description = 'API externa alojada en Render para consulta de procesos judiciales';
  readonly active = true;

  private readonly baseUrl = API_BASE_URL;
  private readonly timeout = 30000; // 30 seconds for scraping operations

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

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(
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

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          return {
            status: 'NOT_FOUND',
            matches: [],
            errorMessage: 'Proceso no encontrado',
          };
        }
        if (response.status === 429) {
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
          errorMessage: `Error HTTP: ${response.status}`,
          errorCode: `HTTP_${response.status}`,
        };
      }

      const data: ExternalApiResponse = await response.json();

      if (data.error || data.message?.toLowerCase().includes('error')) {
        return {
          status: 'NOT_FOUND',
          matches: [],
          errorMessage: data.error || data.message || 'Proceso no encontrado',
        };
      }

      if (!data.proceso) {
        return {
          status: 'NOT_FOUND',
          matches: [],
          errorMessage: 'No se encontró información del proceso',
        };
      }

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
      console.error('External API lookup error:', err);
      
      if (err instanceof Error && err.name === 'AbortError') {
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
        errorMessage: err instanceof Error ? err.message : 'Error de conexión',
        errorCode: 'NETWORK_ERROR',
      };
    }
  }

  async scrapeCase(match: RadicadoMatch): Promise<ScrapeResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(
        `${this.baseUrl}/buscar?numero_radicacion=${match.radicado}`,
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
        return {
          status: 'FAILED',
          actuaciones: [],
          errorMessage: `Error HTTP: ${response.status}`,
          errorCode: `HTTP_${response.status}`,
          scrapedAt: new Date().toISOString(),
        };
      }

      const data: ExternalApiResponse = await response.json();

      if (data.error || !data.proceso) {
        return {
          status: 'FAILED',
          actuaciones: [],
          errorMessage: data.error || 'No se encontró información del proceso',
          errorCode: 'NO_DATA',
          scrapedAt: new Date().toISOString(),
        };
      }

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
        },
        actuaciones,
        scrapedAt: new Date().toISOString(),
      };

    } catch (err) {
      console.error('External API scrape error:', err);

      return {
        status: 'FAILED',
        actuaciones: [],
        errorMessage: err instanceof Error ? err.message : 'Error de conexión',
        errorCode: err instanceof Error && err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
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
        confidence: 0.7, // Higher base confidence for external API
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
