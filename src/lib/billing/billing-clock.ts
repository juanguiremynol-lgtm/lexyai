/**
 * Billing Clock — Time abstraction for billing logic.
 *
 * In production: returns real Date.now()
 * In dev/staging: can be overridden by super admin via test console (client-side only)
 */

let clockOverride: Date | null = null;

export const billingClock = {
  now(): Date {
    if (clockOverride) return new Date(clockOverride.getTime());
    return new Date();
  },

  setOverride(date: Date | null) {
    clockOverride = date;
  },

  getOverride(): Date | null {
    return clockOverride ? new Date(clockOverride.getTime()) : null;
  },

  isOverridden(): boolean {
    return clockOverride !== null;
  },

  reset() {
    clockOverride = null;
  },
};
