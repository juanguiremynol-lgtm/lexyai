/**
 * Analytics Module — Public exports
 *
 * ALL analytics usage MUST go through this module.
 * Direct imports of posthog-js, @sentry/*, etc. are blocked by ESLint.
 */
export {
  track,
  pageView,
  identify,
  setTenant,
  flush,
  configureAnalytics,
  registerProvider,
  getAnalyticsState,
} from "./wrapper";

export type { AnalyticsProvider } from "./wrapper";

export {
  DEFAULT_ALLOWED_PROPERTIES,
  BLOCKED_PROPERTIES,
} from "./types";

export type {
  AnalyticsConfig,
  OrgAnalyticsOverride,
  ResolvedAnalyticsConfig,
} from "./types";

// Event catalog — single source of truth
export {
  ANALYTICS_EVENTS,
  EVENT_PROPERTIES,
  toSizeBucket,
  toLatencyMs,
  toFileTypeCategory,
  toSafeRoute,
} from "./events";

export type { AnalyticsEventName } from "./events";

// Providers
export { createConsoleProvider } from "./providers/console";
