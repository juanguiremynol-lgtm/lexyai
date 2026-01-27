/**
 * Scraping Module
 * 
 * This module provides a pluggable adapter layer for scraping Rama Judicial
 * and other judicial data sources.
 * 
 * INTEGRATION READY: The architecture supports per-organization adapter selection,
 * capability-based routing, and feature flags for future Google/AWS integrations.
 * 
 * @note "Scraping Adapter is designed to be enhanced/replaced by a user-provided script later."
 * 
 * The architecture allows:
 * 1. Multiple adapters to be registered for different sources
 * 2. Per-org + per-workflow adapter selection with priority ordering
 * 3. Capability-based routing (which adapter supports documents? estados?)
 * 4. Feature flags to enable/disable integrations without code changes
 * 5. Noop stub for graceful degradation when external APIs are unavailable
 */

export * from './adapter-interface';
export * from './default-adapter';
export * from './external-api-adapter';
export * from './noop-adapter';
export * from './adapter-registry';
export * from './milestone-mapper';
export * from './scraping-service';
