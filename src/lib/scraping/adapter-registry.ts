/**
 * Adapter Registry
 * 
 * Manages available scraping adapters and allows switching between them.
 * Supports per-organization + per-workflow selection and capability-based routing.
 * 
 * INTEGRATION READY: This registry is designed to support future external APIs
 * (Google, AWS, etc.) without refactoring. New adapters just need to be registered.
 * 
 * @note "Scraping Adapter is designed to be enhanced/replaced by a user-provided script later."
 */

import { 
  ScrapingAdapter, 
  AdapterRegistry, 
  AdapterCapability,
  SupportedWorkflowType,
  OrgAdapterConfig,
} from './adapter-interface';
import { defaultAdapter } from './default-adapter';
import { externalApiAdapter } from './external-api-adapter';
import { noopAdapter } from './noop-adapter';

class AdapterRegistryImpl implements AdapterRegistry {
  private adapters: Map<string, ScrapingAdapter> = new Map();
  private orgConfigs: Map<string, OrgAdapterConfig> = new Map();
  // Default to external API adapter for better performance and reliability
  private defaultAdapterId: string = 'external-rama-judicial-api';

  constructor() {
    // Register all available adapters
    this.register(noopAdapter);      // Priority 0 - fallback
    this.register(defaultAdapter);    // Priority 5 - legacy CPNU
    this.register(externalApiAdapter); // Priority 10 - preferred
  }

  getDefault(): ScrapingAdapter {
    const adapter = this.adapters.get(this.defaultAdapterId);
    if (!adapter) {
      // Fallback to noop adapter if nothing is configured
      return noopAdapter;
    }
    return adapter;
  }

  getById(id: string): ScrapingAdapter | undefined {
    return this.adapters.get(id);
  }

  register(adapter: ScrapingAdapter): void {
    console.log(`[AdapterRegistry] Registering adapter: ${adapter.id} - ${adapter.name} (priority: ${adapter.priority})`);
    this.adapters.set(adapter.id, adapter);
  }

  listAll(): ScrapingAdapter[] {
    return Array.from(this.adapters.values())
      .sort((a, b) => b.priority - a.priority); // Highest priority first
  }

  setDefault(id: string): void {
    if (!this.adapters.has(id)) {
      throw new Error(`Adapter with id "${id}" is not registered`);
    }
    this.defaultAdapterId = id;
    console.log(`[AdapterRegistry] Default adapter set to: ${id}`);
  }

  /**
   * Get adapter for a specific org and workflow context
   * 
   * Resolution order:
   * 1. Org-specific workflow override
   * 2. Org priority order
   * 3. Global default
   * 4. Noop fallback
   */
  async getForContext(
    organizationId: string | null, 
    workflowType: SupportedWorkflowType
  ): Promise<ScrapingAdapter> {
    // If we have org config, use it
    if (organizationId) {
      const orgConfig = this.orgConfigs.get(organizationId);
      
      if (orgConfig) {
        // Check for workflow-specific override
        if (orgConfig.workflowOverrides?.[workflowType]) {
          const overrideId = orgConfig.workflowOverrides[workflowType];
          const overrideAdapter = this.adapters.get(overrideId!);
          if (overrideAdapter && await overrideAdapter.isReady()) {
            console.log(`[AdapterRegistry] Using workflow override: ${overrideId} for ${workflowType}`);
            return overrideAdapter;
          }
        }

        // Check feature flags and priority order
        for (const adapterId of orgConfig.adapterPriorityOrder) {
          const adapter = this.adapters.get(adapterId);
          if (!adapter) continue;

          // Check if adapter is enabled via feature flags
          if (adapterId === 'external-rama-judicial-api' && !orgConfig.featureFlags.enableExternalApi) {
            continue;
          }
          // Future: Check Google/AWS flags here
          // if (adapterId === 'google-api' && !orgConfig.featureFlags.enableGoogleIntegration) continue;

          // Check if adapter supports this workflow
          const supportsWorkflow = adapter.supportedWorkflows.includes('ALL') || 
                                   adapter.supportedWorkflows.includes(workflowType);
          if (!supportsWorkflow) continue;

          // Check if adapter is ready
          if (await adapter.isReady()) {
            console.log(`[AdapterRegistry] Using org-configured adapter: ${adapterId} for org ${organizationId}`);
            return adapter;
          }
        }
      }
    }

    // Fallback to default
    const defaultAdapter = this.getDefault();
    if (await defaultAdapter.isReady()) {
      return defaultAdapter;
    }

    // Ultimate fallback
    console.log(`[AdapterRegistry] All adapters unavailable, using noop fallback`);
    return noopAdapter;
  }

  /**
   * Get all adapters that have a specific capability
   */
  getByCapability(capability: AdapterCapability): ScrapingAdapter[] {
    return this.listAll().filter(a => a.capabilities.includes(capability));
  }

  /**
   * Set organization-level adapter configuration
   */
  setOrgConfig(config: OrgAdapterConfig): void {
    this.orgConfigs.set(config.organizationId, config);
    console.log(`[AdapterRegistry] Org config set for ${config.organizationId}:`, {
      priorityOrder: config.adapterPriorityOrder,
      flags: config.featureFlags,
    });
  }

  /**
   * Get organization-level adapter configuration
   */
  getOrgConfig(organizationId: string): OrgAdapterConfig | undefined {
    return this.orgConfigs.get(organizationId);
  }

  // ============= Convenience Methods =============

  /**
   * Use the external API adapter (default behavior)
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

  /**
   * Disable external scraping (use noop)
   */
  disableExternalScraping(): void {
    this.setDefault('noop-stub');
  }

  /**
   * Check if any adapter with a capability is available
   */
  hasCapability(capability: AdapterCapability): boolean {
    return this.getByCapability(capability).length > 0;
  }

  /**
   * Get adapter IDs in priority order
   */
  getPriorityOrder(): string[] {
    return this.listAll().map(a => a.id);
  }
}

// Export singleton registry
export const adapterRegistry = new AdapterRegistryImpl();

// Re-export types
export type { ScrapingAdapter, AdapterRegistry, OrgAdapterConfig } from './adapter-interface';
