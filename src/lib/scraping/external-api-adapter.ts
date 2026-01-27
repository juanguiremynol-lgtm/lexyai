/**
 * External API Scraping Adapter
 * 
 * IMPORTANT: This adapter is for CLIENT-SIDE preview/lookup only.
 * It delegates ALL external API calls to server-side Edge Functions.
 * 
 * NO external API URLs are hardcoded here.
 * All actual fetching happens via sync-by-work-item edge function.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  ScrapingAdapter,
  LookupResult,
  ScrapeResult,
  RadicadoMatch,
  RawActuacion,
  NormalizedActuacion,
  AdapterCapability,
  SupportedWorkflowType,
  computeActuacionHash,
  normalizeActuacionText,
} from './adapter-interface';

export class ExternalApiAdapter implements ScrapingAdapter {
  readonly id = 'external-rama-judicial-api';
  readonly name = 'API Nueva Rama Judicial (Server-side via Edge Functions)';
  readonly description = 'Consulta de procesos judiciales via Edge Functions - sin URLs hardcodeadas';
  readonly active = true;
  readonly capabilities: AdapterCapability[] = ['ACTUACIONES', 'CASE_METADATA', 'NOTIFICATIONS'];
  readonly supportedWorkflows: SupportedWorkflowType[] = ['CGP', 'CPACA', 'TUTELA', 'LABORAL', 'PENAL_906'];
  readonly priority = 10; // Highest priority - preferred adapter

  async isReady(): Promise<boolean> {
    // Always ready since it delegates to edge functions
    return true;
  }

  /**
   * Lookup a radicado by calling the sync-by-radicado edge function in LOOKUP mode
   * All external API calls happen server-side.
   */
  async lookup(radicadoNumber: string): Promise<LookupResult> {
    try {
      const cleanRadicado = radicadoNumber.replace(/\D/g, '');
      
      if (cleanRadicado.length !== 23) {
        return {
          status: 'NOT_FOUND',
          matches: [],
          errorMessage: 'El radicado debe tener exactamente 23 dígitos',
          errorCode: 'INVALID_FORMAT',
        };
      }

      console.log('🔍 ExternalApiAdapter: Calling sync-by-radicado (LOOKUP mode):', cleanRadicado);

      // Call edge function for server-side lookup
      const { data, error } = await supabase.functions.invoke('sync-by-radicado', {
        body: {
          radicado: cleanRadicado,
          mode: 'LOOKUP',
          create_if_missing: false,
        },
      });

      if (error) {
        console.error('ExternalApiAdapter lookup error:', error);
        return {
          status: 'ERROR',
          matches: [],
          errorMessage: error.message,
          errorCode: 'EDGE_FUNCTION_ERROR',
        };
      }

      if (!data?.ok) {
        if (data?.code === 'UNAUTHORIZED') {
          return {
            status: 'UNAVAILABLE',
            matches: [],
            errorMessage: 'Sesión expirada. Por favor inicie sesión nuevamente.',
            errorCode: 'UNAUTHORIZED',
          };
        }
        
        return {
          status: data?.found_in_source === false ? 'NOT_FOUND' : 'ERROR',
          matches: [],
          errorMessage: data?.error || data?.message || 'Error en consulta',
          errorCode: data?.code || 'UNKNOWN',
        };
      }

      if (!data.found_in_source || !data.process_data) {
        return {
          status: 'NOT_FOUND',
          matches: [],
          errorMessage: 'No se encontró información del proceso',
        };
      }

      const processData = data.process_data;
      
      const match: RadicadoMatch = {
        radicado: cleanRadicado,
        despacho: processData.despacho || '',
        demandante: processData.demandante,
        demandado: processData.demandado,
        lastActionDate: processData.fecha_ultima_actuacion,
        sourceUrl: `edge-function://sync-by-radicado?radicado=${cleanRadicado}`,
        confidence: 1.0,
      };

      return {
        status: 'FOUND',
        matches: [match],
        rawResponse: data,
      };

    } catch (err) {
      console.error('ExternalApiAdapter lookup error:', err);
      
      return {
        status: 'ERROR',
        matches: [],
        errorMessage: err instanceof Error ? err.message : 'Error de conexión',
        errorCode: 'NETWORK_ERROR',
      };
    }
  }

  /**
   * Scrape case details by calling sync-by-radicado in SYNC_AND_APPLY mode
   * This will create/update the work_item server-side.
   */
  async scrapeCase(match: RadicadoMatch): Promise<ScrapeResult> {
    try {
      console.log('🔍 ExternalApiAdapter: Calling sync-by-radicado (SYNC_AND_APPLY):', match.radicado);

      const { data, error } = await supabase.functions.invoke('sync-by-radicado', {
        body: {
          radicado: match.radicado,
          mode: 'SYNC_AND_APPLY',
          create_if_missing: true,
        },
      });

      if (error) {
        return {
          status: 'FAILED',
          actuaciones: [],
          errorMessage: error.message,
          errorCode: 'EDGE_FUNCTION_ERROR',
          scrapedAt: new Date().toISOString(),
        };
      }

      if (!data?.ok) {
        return {
          status: 'FAILED',
          actuaciones: [],
          errorMessage: data?.error || data?.message || 'Sync failed',
          errorCode: data?.code || 'UNKNOWN',
          scrapedAt: new Date().toISOString(),
        };
      }

      const processData = data.process_data || {};

      // Transform actuaciones to the expected format
      const actuaciones: RawActuacion[] = (processData.actuaciones || []).map((act: {
        fecha?: string;
        actuacion?: string;
        anotacion?: string;
        fecha_inicia_termino?: string;
        fecha_finaliza_termino?: string;
      }) => ({
        fechaActuacion: act.fecha || '',
        actuacion: act.actuacion || '',
        anotacion: act.anotacion,
        fechaInicial: act.fecha_inicia_termino,
        fechaFinal: act.fecha_finaliza_termino,
        conDocumentos: false,
        documentos: [],
      }));

      return {
        status: 'SUCCESS',
        caseMetadata: {
          radicado: match.radicado,
          despacho: processData.despacho,
          demandantes: processData.demandante,
          demandados: processData.demandado,
          tipoProceso: processData.tipo_proceso,
          clase: processData.clase_proceso,
          fechaRadicacion: processData.fecha_radicacion,
          ultimaActuacion: processData.fecha_ultima_actuacion,
          sourceUrl: match.sourceUrl,
          sujetosProcesales: processData.sujetos_procesales,
          totalActuaciones: processData.total_actuaciones,
        },
        actuaciones,
        scrapedAt: new Date().toISOString(),
      };

    } catch (err) {
      console.error('ExternalApiAdapter scrape error:', err);

      return {
        status: 'FAILED',
        actuaciones: [],
        errorMessage: err instanceof Error ? err.message : 'Error de conexión',
        errorCode: 'NETWORK_ERROR',
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

      // Detect action type
      const actTypeGuess = this.guessActionType(rawText);

      // Extract attachments
      const attachments: Array<{ label: string; url: string }> = [];
      if (act.documentos) {
        act.documentos.forEach(doc => {
          attachments.push({ label: doc.nombre, url: doc.url });
        });
      }

      const hashFingerprint = computeActuacionHash(actDate, normalizedText, sourceUrl);

      return {
        rawText,
        normalizedText,
        actDate,
        actTime: null,
        actDateRaw: act.fechaActuacion,
        actTypeGuess,
        confidence: 0.8,
        attachments,
        sourceUrl,
        hashFingerprint,
      };
    });
  }

  private parseColombianDate(dateStr: string): string | null {
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

  private guessActionType(text: string): string | null {
    const lowerText = text.toLowerCase();
    
    if (/auto\s+admisorio|admite\s+(la\s+)?demanda|auto\s+que\s+admite/i.test(lowerText)) {
      return 'AUTO_ADMISORIO';
    }
    if (/sentencia/i.test(lowerText)) {
      return 'SENTENCIA';
    }
    if (/audiencia/i.test(lowerText)) {
      return 'AUDIENCIA';
    }
    if (/traslado/i.test(lowerText)) {
      return 'TRASLADO';
    }
    if (/notifica/i.test(lowerText)) {
      return 'NOTIFICACION';
    }
    if (/auto\s+interlocutorio|auto(?!\s+admisorio)/i.test(lowerText)) {
      return 'AUTO';
    }
    if (/memorial|escrito/i.test(lowerText)) {
      return 'MEMORIAL';
    }
    
    return 'ACTUACION';
  }
}

// Singleton export
export const externalApiAdapter = new ExternalApiAdapter();
