/**
 * Unified Analytics Wrapper
 * 
 * Single abstraction for all analytics providers.
 * Enforces: global/per-tenant kill switches, property allowlists,
 * automatic PII redaction. Provider calls are NOOP when disabled.
 * 
 * Currently wraps: console (dev) + existing trackMascotEvent.
 * Future: PostHog, Sentry (behind same interface).
 */

import { BLOCKED_PROPERTIES, DEFAULT_ALLOWED_PROPERTIES, type ResolvedAnalyticsConfig } from "./types";

// --- State ---
let _globalEnabled = false;
let _tenantEnabled: boolean | null = null; // null = inherit global
let _allowedProperties: string[] = [...DEFAULT_ALLOWED_PROPERTIES];
let _tenantHash: string | null = null;
let _userHash: string | null = null;
let _providers: AnalyticsProvider[] = [];

export interface AnalyticsProvider {
  name: string;
  track: (event: string, props: Record<string, unknown>) => void;
  pageView: (props: Record<string, unknown>) => void;
  identify: (userHash: string, traits: Record<string, unknown>) => void;
  setTenant: (tenantHash: string) => void;
  flush?: () => void;
}

// --- Configuration ---

export function configureAnalytics(config: {
  globalEnabled: boolean;
  tenantEnabled?: boolean | null;
  allowedProperties?: string[];
}) {
  _globalEnabled = config.globalEnabled;
  _tenantEnabled = config.tenantEnabled ?? null;
  if (config.allowedProperties) {
    _allowedProperties = config.allowedProperties;
  }
}

export function registerProvider(provider: AnalyticsProvider) {
  // Avoid duplicate registration
  if (!_providers.find(p => p.name === provider.name)) {
    _providers.push(provider);
  }
}

export function resolveConfig(config: ResolvedAnalyticsConfig) {
  _globalEnabled = config.enabled;
  _allowedProperties = config.allowedProperties;
}

// --- Core guard ---

function isEnabled(): boolean {
  if (!_globalEnabled) return false;
  if (_tenantEnabled === false) return false; // explicitly disabled
  return true; // global on + tenant inherits or explicitly on
}

// --- Property sanitization ---

function sanitizeProperties(props: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(props)) {
    const keyLower = key.toLowerCase();
    
    // Block known PII keys
    if (BLOCKED_PROPERTIES.some(blocked => keyLower.includes(blocked.toLowerCase()))) {
      if (import.meta.env.DEV) {
        console.warn(`[analytics] Blocked property "${key}" — PII not allowed`);
      }
      continue;
    }
    
    // Check allowlist
    if (!_allowedProperties.includes(key)) {
      if (import.meta.env.DEV) {
        console.warn(`[analytics] Dropped property "${key}" — not in allowlist`);
      }
      continue;
    }
    
    // Never send string values longer than 200 chars (safety net)
    if (typeof value === 'string' && value.length > 200) {
      sanitized[key] = value.slice(0, 200) + '…';
    } else {
      sanitized[key] = value;
    }
  }
  
  // Always include hashes if set
  if (_tenantHash) sanitized.tenant_id_hash = _tenantHash;
  if (_userHash) sanitized.user_id_hash = _userHash;
  sanitized.timestamp = new Date().toISOString();
  
  return sanitized;
}

// --- Public API ---

export function track(eventName: string, properties: Record<string, unknown> = {}) {
  if (!isEnabled()) return;
  
  const safe = sanitizeProperties({ event_name: eventName, ...properties });
  
  if (import.meta.env.DEV) {
    console.debug(`[analytics:track] ${eventName}`, safe);
  }
  
  for (const provider of _providers) {
    try {
      provider.track(eventName, safe);
    } catch (err) {
      console.warn(`[analytics] Provider ${provider.name} track error:`, err);
    }
  }
}

export function pageView(properties: Record<string, unknown> = {}) {
  if (!isEnabled()) return;
  
  const safe = sanitizeProperties(properties);
  
  if (import.meta.env.DEV) {
    console.debug(`[analytics:pageView]`, safe);
  }
  
  for (const provider of _providers) {
    try {
      provider.pageView(safe);
    } catch (err) {
      console.warn(`[analytics] Provider ${provider.name} pageView error:`, err);
    }
  }
}

export function identify(userHash: string, traits: Record<string, unknown> = {}) {
  if (!isEnabled()) return;
  
  _userHash = userHash;
  const safe = sanitizeProperties(traits);
  
  for (const provider of _providers) {
    try {
      provider.identify(userHash, safe);
    } catch (err) {
      console.warn(`[analytics] Provider ${provider.name} identify error:`, err);
    }
  }
}

export function setTenant(tenantHash: string) {
  _tenantHash = tenantHash;
  
  if (!isEnabled()) return;
  
  for (const provider of _providers) {
    try {
      provider.setTenant(tenantHash);
    } catch (err) {
      console.warn(`[analytics] Provider ${provider.name} setTenant error:`, err);
    }
  }
}

export function flush() {
  for (const provider of _providers) {
    try {
      provider.flush?.();
    } catch {
      // ignore
    }
  }
}

/**
 * Get current analytics state for debugging / admin UI
 */
export function getAnalyticsState() {
  return {
    globalEnabled: _globalEnabled,
    tenantEnabled: _tenantEnabled,
    effectivelyEnabled: isEnabled(),
    tenantHash: _tenantHash ? '***' : null,
    userHash: _userHash ? '***' : null,
    providerCount: _providers.length,
    providerNames: _providers.map(p => p.name),
    allowedPropertiesCount: _allowedProperties.length,
  };
}
