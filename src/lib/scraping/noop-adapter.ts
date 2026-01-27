/**
 * No-Op Adapter
 * 
 * A stub adapter that returns empty results. Used when:
 * - No external API is configured
 * - Feature flag is disabled for an org
 * - Graceful degradation when external services are unavailable
 * 
 * This ensures the system keeps working without external dependencies.
 */

import {
  ScrapingAdapter,
  LookupResult,
  ScrapeResult,
  RadicadoMatch,
  RawActuacion,
  NormalizedActuacion,
  AdapterCapability,
  SupportedWorkflowType,
} from './adapter-interface';

export class NoopAdapter implements ScrapingAdapter {
  readonly id = 'noop-stub';
  readonly name = 'Stub Adapter (Sin conexión externa)';
  readonly description = 'Adaptador sin operación - no realiza consultas externas. Los datos se ingresan manualmente o via Excel.';
  readonly active = true;
  readonly capabilities: AdapterCapability[] = []; // No capabilities - manual data entry only
  readonly supportedWorkflows: SupportedWorkflowType[] = ['ALL'];
  readonly priority = 0; // Lowest priority - only used as fallback

  async isReady(): Promise<boolean> {
    // Always ready since it doesn't depend on external services
    return true;
  }

  async lookup(radicadoNumber: string): Promise<LookupResult> {
    console.log(`[NoopAdapter] Lookup requested for ${radicadoNumber} - returning NOT_CONFIGURED`);
    return {
      status: 'UNAVAILABLE',
      matches: [],
      errorMessage: 'No hay un proveedor de scraping configurado. Ingrese los datos manualmente o importe desde Excel.',
      errorCode: 'ADAPTER_NOT_CONFIGURED',
    };
  }

  async scrapeCase(_match: RadicadoMatch): Promise<ScrapeResult> {
    console.log(`[NoopAdapter] Scrape requested - returning empty result`);
    return {
      status: 'FAILED',
      actuaciones: [],
      errorMessage: 'No hay un proveedor de scraping configurado.',
      errorCode: 'ADAPTER_NOT_CONFIGURED',
      scrapedAt: new Date().toISOString(),
    };
  }

  normalizeActuaciones(_actuacionesRaw: RawActuacion[], _sourceUrl: string): NormalizedActuacion[] {
    // No actuaciones to normalize
    return [];
  }
}

// Export singleton instance
export const noopAdapter = new NoopAdapter();
