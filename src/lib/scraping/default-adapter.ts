/**
 * Default Rama Judicial Scraping Adapter
 * 
 * This is the default implementation that uses Firecrawl to scrape
 * the Consulta de Procesos Nacional Unificada (CPNU) portal.
 * 
 * @note This adapter can be replaced or enhanced by a user-provided script later.
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

const CPNU_BASE_URL = 'https://consultaprocesos.ramajudicial.gov.co';

export class DefaultRamaJudicialAdapter implements ScrapingAdapter {
  readonly id = 'default-rama-judicial';
  readonly name = 'Consulta de Procesos Nacional Unificada (CPNU)';
  readonly description = 'Portal principal de consulta de procesos de la Rama Judicial';
  readonly active = true;
  readonly capabilities: AdapterCapability[] = ['ACTUACIONES', 'CASE_METADATA'];
  readonly supportedWorkflows: SupportedWorkflowType[] = ['CGP', 'CPACA', 'TUTELA', 'LABORAL'];
  readonly priority = 5; // Medium priority - legacy adapter

  async isReady(): Promise<boolean> {
    // This adapter uses Firecrawl via edge function, check if configured
    // For now, assume always ready if active
    return this.active;
  }

  async lookup(radicadoNumber: string): Promise<LookupResult> {
    try {
      const { data, error } = await supabase.functions.invoke('adapter-cpnu', {
        body: { 
          action: 'search',
          radicado: radicadoNumber 
        },
      });

      if (error) {
        console.error('CPNU lookup error:', error);
        return {
          status: 'ERROR',
          matches: [],
          errorMessage: error.message,
          errorCode: 'INVOKE_ERROR',
        };
      }

      if (!data.success) {
        if (data.errorCode === 'NOT_FOUND' || data.totalResults === 0) {
          return {
            status: 'NOT_FOUND',
            matches: [],
            errorMessage: 'No se encontraron procesos con este radicado',
          };
        }
        
        if (data.errorCode === 'RATE_LIMITED') {
          return {
            status: 'UNAVAILABLE',
            matches: [],
            errorMessage: 'Servicio temporalmente no disponible',
            errorCode: 'RATE_LIMITED',
          };
        }

        return {
          status: 'ERROR',
          matches: [],
          errorMessage: data.error || 'Error desconocido',
          errorCode: data.errorCode,
        };
      }

      const matches: RadicadoMatch[] = (data.procesos || []).map((p: any) => ({
        radicado: p.llaveProceso || radicadoNumber,
        despacho: p.despacho || '',
        demandante: p.sujetosProcesales?.find((s: any) => s.tipoParte === 'DEMANDANTE')?.nombre,
        demandado: p.sujetosProcesales?.find((s: any) => s.tipoParte === 'DEMANDADO')?.nombre,
        lastActionDate: p.fechaUltimaActuacion,
        sourceUrl: `${CPNU_BASE_URL}/Procesos/Detalle/${p.idProceso}`,
        confidence: 1.0,
      }));

      if (matches.length === 0) {
        return { status: 'NOT_FOUND', matches: [] };
      }

      if (matches.length === 1) {
        return { status: 'FOUND', matches };
      }

      return { status: 'AMBIGUOUS', matches };
      
    } catch (err) {
      console.error('Lookup exception:', err);
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
      const { data, error } = await supabase.functions.invoke('adapter-cpnu', {
        body: { 
          action: 'actuaciones',
          radicado: match.radicado 
        },
      });

      if (error) {
        console.error('CPNU scrape error:', error);
        return {
          status: 'FAILED',
          actuaciones: [],
          errorMessage: error.message,
          errorCode: 'INVOKE_ERROR',
          scrapedAt: new Date().toISOString(),
        };
      }

      if (!data.success) {
        return {
          status: 'FAILED',
          actuaciones: [],
          errorMessage: data.error || 'Error al consultar actuaciones',
          errorCode: data.errorCode,
          scrapedAt: new Date().toISOString(),
        };
      }

      const actuaciones: RawActuacion[] = (data.actuaciones || []).map((a: any) => ({
        fechaActuacion: a.fechaActuacion,
        actuacion: a.actuacion,
        anotacion: a.anotacion,
        fechaInicial: a.fechaInicial,
        fechaFinal: a.fechaFinal,
        fechaRegistro: a.fechaRegistro,
        conDocumentos: a.conDocumentos || false,
        documentos: a.documentos || [],
        rawData: a,
      }));

      return {
        status: 'SUCCESS',
        caseMetadata: {
          radicado: match.radicado,
          despacho: match.despacho,
          demandantes: match.demandante,
          demandados: match.demandado,
          sourceUrl: match.sourceUrl,
        },
        actuaciones,
        scrapedAt: new Date().toISOString(),
      };
      
    } catch (err) {
      console.error('Scrape exception:', err);
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

      // Parse time if available
      let actTime: string | null = null;
      // Time extraction would be enhanced by future scripts

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
        confidence: 0.5, // Base confidence, will be refined by mapping engine
        attachments,
        sourceUrl,
        hashFingerprint,
      };
    });
  }

  private parseColombianDate(dateStr: string): string | null {
    if (!dateStr) return null;
    
    // Try ISO format first
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
      return dateStr.split('T')[0];
    }

    // Try DD/MM/YYYY format
    const ddmmyyyy = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (ddmmyyyy) {
      return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
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

    return null;
  }

  private guessActType(normalizedText: string): string | null {
    // Basic type guessing - will be refined by mapping engine
    if (/auto\s+admisorio|admite\s+demanda/.test(normalizedText)) return 'AUTO_ADMISORIO';
    if (/mandamiento\s+de\s+pago/.test(normalizedText)) return 'MANDAMIENTO_DE_PAGO';
    if (/notificacion|notificado/.test(normalizedText)) return 'NOTIFICACION';
    if (/al\s+despacho/.test(normalizedText)) return 'EXPEDIENTE_AL_DESPACHO';
    if (/sentencia/.test(normalizedText)) return 'SENTENCIA';
    if (/audiencia/.test(normalizedText)) return 'AUDIENCIA';
    if (/recurso/.test(normalizedText)) return 'RECURSO';
    if (/traslado/.test(normalizedText)) return 'TRASLADO';
    return null;
  }
}

// Export a singleton instance
export const defaultAdapter = new DefaultRamaJudicialAdapter();
