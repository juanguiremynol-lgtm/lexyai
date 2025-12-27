/**
 * Adapter Registry
 * 
 * Manages available scraping adapters and allows switching between them.
 * This is designed to support future user-provided enhancement scripts.
 * 
 * @note "Scraping Adapter is designed to be enhanced/replaced by a user-provided script later."
 */

import { ScrapingAdapter, AdapterRegistry } from './adapter-interface';
import { defaultAdapter } from './default-adapter';

class AdapterRegistryImpl implements AdapterRegistry {
  private adapters: Map<string, ScrapingAdapter> = new Map();
  private defaultAdapterId: string = 'default-rama-judicial';

  constructor() {
    // Register the default adapter
    this.register(defaultAdapter);
  }

  getDefault(): ScrapingAdapter {
    const adapter = this.adapters.get(this.defaultAdapterId);
    if (!adapter) {
      // Fallback to default if configured one is missing
      return defaultAdapter;
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
}

// Export singleton registry
export const adapterRegistry = new AdapterRegistryImpl();

// Re-export types
export type { ScrapingAdapter, AdapterRegistry } from './adapter-interface';
