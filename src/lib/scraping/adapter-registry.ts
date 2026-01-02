/**
 * Adapter Registry
 * 
 * Manages available scraping adapters and allows switching between them.
 * This is designed to support future user-provided enhancement scripts.
 * 
 * The system defaults to the External API adapter (rama-judicial-api.onrender.com)
 * for all CGP process lookups and scraping.
 * 
 * @note "Scraping Adapter is designed to be enhanced/replaced by a user-provided script later."
 */

import { ScrapingAdapter, AdapterRegistry } from './adapter-interface';
import { defaultAdapter } from './default-adapter';
import { externalApiAdapter } from './external-api-adapter';

class AdapterRegistryImpl implements AdapterRegistry {
  private adapters: Map<string, ScrapingAdapter> = new Map();
  // Default to external API adapter for better performance and reliability
  private defaultAdapterId: string = 'external-rama-judicial-api';

  constructor() {
    // Register the CPNU adapter (legacy)
    this.register(defaultAdapter);
    // Register the external API adapter (preferred)
    this.register(externalApiAdapter);
  }

  getDefault(): ScrapingAdapter {
    const adapter = this.adapters.get(this.defaultAdapterId);
    if (!adapter) {
      // Fallback to external API adapter
      return externalApiAdapter;
    }
    return adapter;
  }

  getById(id: string): ScrapingAdapter | undefined {
    return this.adapters.get(id);
  }

  register(adapter: ScrapingAdapter): void {
    console.log(`[AdapterRegistry] Registering adapter: ${adapter.id} - ${adapter.name}`);
    this.adapters.set(adapter.id, adapter);
  }

  listAll(): ScrapingAdapter[] {
    return Array.from(this.adapters.values());
  }

  setDefault(id: string): void {
    if (!this.adapters.has(id)) {
      throw new Error(`Adapter with id "${id}" is not registered`);
    }
    this.defaultAdapterId = id;
    console.log(`[AdapterRegistry] Default adapter set to: ${id}`);
  }

  /**
   * Use the external API adapter
   */
  useExternalApi(): void {
    this.setDefault('external-rama-judicial-api');
  }

  /**
   * Use the legacy CPNU adapter
   */
  useLegacyCpnu(): void {
    this.setDefault('default-rama-judicial');
  }
}

// Export singleton registry
export const adapterRegistry = new AdapterRegistryImpl();

// Re-export types
export type { ScrapingAdapter, AdapterRegistry } from './adapter-interface';
