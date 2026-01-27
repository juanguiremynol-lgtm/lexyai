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

import { supabase } from '@/integrations/supabase/client';
import { 
  ScrapingAdapter, 
  AdapterRegistry, 
  AdapterCapability,
  SupportedWorkflowType,
  OrgAdapterConfig,
  OrgFeatureFlags,
} from './adapter-interface';
import { defaultAdapter } from './default-adapter';
import { externalApiAdapter } from './external-api-adapter';
import { noopAdapter } from './noop-adapter';

// Cache configuration
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const configCache = new Map<string, { config: OrgAdapterConfig; fetchedAt: number }>();

class AdapterRegistryImpl implements AdapterRegistry {
  private adapters: Map<string, ScrapingAdapter> = new Map();
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
   * Load org config from database with caching
   */
  private async loadOrgConfigFromDb(organizationId: string): Promise<OrgAdapterConfig | null> {
    // Check cache first
    const cached = configCache.get(organizationId);
    if (cached && Date.now() - cached.fetchedAt < CONFIG_CACHE_TTL_MS) {
      return cached.config;
    }

    try {
      const { data, error } = await supabase
        .from('org_integration_settings')
        .select('adapter_priority_order, feature_flags, workflow_overrides')
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (error) {
        console.warn(`[AdapterRegistry] Error loading org config for ${organizationId}:`, error.message);
        return null;
      }

      if (!data) {
        return null;
      }

      // Cast feature_flags from Json to typed object
      const flags = data.feature_flags as Record<string, unknown> | null;

      const config: OrgAdapterConfig = {
        organizationId,
        adapterPriorityOrder: data.adapter_priority_order || ['external-rama-judicial-api', 'default-rama-judicial', 'noop-stub'],
        featureFlags: {
          enableExternalApi: (flags?.enableExternalApi as boolean) ?? true,
          enableLegacyCpnu: (flags?.enableLegacyCpnu as boolean) ?? false,
          enableGoogleIntegration: (flags?.enableGoogleIntegration as boolean) ?? false,
          enableAwsIntegration: (flags?.enableAwsIntegration as boolean) ?? false,
        },
        workflowOverrides: data.workflow_overrides as Record<SupportedWorkflowType, string> | undefined,
      };

      // Cache the config
      configCache.set(organizationId, { config, fetchedAt: Date.now() });

      return config;
    } catch (err) {
      console.error(`[AdapterRegistry] Exception loading org config:`, err);
      return null;
    }
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
      const orgConfig = await this.loadOrgConfigFromDb(organizationId);
      
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
          if (adapterId === 'default-rama-judicial' && !orgConfig.featureFlags.enableLegacyCpnu) {
            continue;
          }
          // Future: Check Google/AWS flags here
          // if (adapterId === 'google-api' && !orgConfig.featureFlags.enableGoogleIntegration) continue;
          // if (adapterId === 'aws-api' && !orgConfig.featureFlags.enableAwsIntegration) continue;

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
   * Save organization-level adapter configuration to database
   */
  async setOrgConfig(config: OrgAdapterConfig): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('org_integration_settings')
        .upsert({
          organization_id: config.organizationId,
          adapter_priority_order: config.adapterPriorityOrder,
          feature_flags: config.featureFlags,
          workflow_overrides: config.workflowOverrides || {},
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'organization_id',
        });

      if (error) {
        console.error(`[AdapterRegistry] Error saving org config:`, error.message);
        return false;
      }

      // Update cache
      configCache.set(config.organizationId, { config, fetchedAt: Date.now() });
      console.log(`[AdapterRegistry] Org config saved for ${config.organizationId}`);
      return true;
    } catch (err) {
      console.error(`[AdapterRegistry] Exception saving org config:`, err);
      return false;
    }
  }

  /**
   * Get organization-level adapter configuration (from cache or DB)
   */
  async getOrgConfig(organizationId: string): Promise<OrgAdapterConfig | null> {
    return this.loadOrgConfigFromDb(organizationId);
  }

  /**
   * Clear cache for an organization (call when settings change externally)
   */
  clearOrgConfigCache(organizationId: string): void {
    configCache.delete(organizationId);
  }

  /**
   * Clear all cached configs
   */
  clearAllCache(): void {
    configCache.clear();
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
