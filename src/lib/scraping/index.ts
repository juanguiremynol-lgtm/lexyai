/**
 * Scraping Module
 * 
 * This module provides a pluggable adapter layer for scraping Rama Judicial
 * and other judicial data sources.
 * 
 * @note "Scraping Adapter is designed to be enhanced/replaced by a user-provided script later."
 * 
 * The architecture allows:
 * 1. Multiple adapters to be registered for different sources
 * 2. Default adapter to be swapped without code changes
 * 3. Future enhancement scripts to extend or replace current scraping
 */

export * from './adapter-interface';
export * from './default-adapter';
export * from './adapter-registry';
export * from './milestone-mapper';
export * from './scraping-service';
