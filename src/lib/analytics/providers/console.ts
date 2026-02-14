/**
 * Console Analytics Provider — Dev/Debug only
 *
 * Logs all events to browser console when in development mode.
 * Registered by default; other providers are additive.
 */
import type { AnalyticsProvider } from "../wrapper";

export function createConsoleProvider(): AnalyticsProvider {
  return {
    name: "console",
    track(event, props) {
      if (import.meta.env.DEV) {
        console.debug(`[analytics:console] track: ${event}`, props);
      }
    },
    pageView(props) {
      if (import.meta.env.DEV) {
        console.debug(`[analytics:console] pageView`, props);
      }
    },
    identify(userHash, traits) {
      if (import.meta.env.DEV) {
        console.debug(`[analytics:console] identify: ${userHash}`, traits);
      }
    },
    setTenant(tenantHash) {
      if (import.meta.env.DEV) {
        console.debug(`[analytics:console] setTenant: ${tenantHash}`);
      }
    },
  };
}
