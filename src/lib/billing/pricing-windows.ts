/**
 * Pricing Windows - Canonical dates for launch, grace period, and promo window
 * 
 * IMPORTANT: This is the SINGLE SOURCE OF TRUTH for pricing window dates.
 * All edge functions and UI components must reference these constants.
 */

// Launch date: February 1, 2026 at midnight Colombia time (America/Bogota = UTC-5)
export const LAUNCH_AT = "2026-02-01T00:00:00-05:00";

// Grace period end: April 30, 2026 at 23:59:59 Colombia time
// During grace period, new signups get trial access until this date
export const GRACE_END_AT = "2026-04-30T23:59:59-05:00";

// Promo window end: July 31, 2026 at 23:59:59 Colombia time
// During promo window, 24-month commitment grants INTRO (locked) prices
export const PROMO_END_AT = "2026-07-31T23:59:59-05:00";

// Parsed Date objects for comparison
export const LAUNCH_DATE = new Date(LAUNCH_AT);
export const GRACE_END_DATE = new Date(GRACE_END_AT);
export const PROMO_END_DATE = new Date(PROMO_END_AT);

/**
 * Check if we're currently within the grace period
 * During grace period, new users can access the app without payment
 */
export function isWithinGracePeriod(now: Date = new Date()): boolean {
  return now >= LAUNCH_DATE && now <= GRACE_END_DATE;
}

/**
 * Check if we're currently within the promo window
 * During promo window, 24-month commitment grants INTRO pricing
 */
export function isWithinPromoWindow(now: Date = new Date()): boolean {
  return now >= LAUNCH_DATE && now <= PROMO_END_DATE;
}

/**
 * Check if the launch has happened
 */
export function hasLaunched(now: Date = new Date()): boolean {
  return now >= LAUNCH_DATE;
}

/**
 * Get remaining days in grace period (0 if expired)
 */
export function getGraceDaysRemaining(now: Date = new Date()): number {
  if (now > GRACE_END_DATE) return 0;
  if (now < LAUNCH_DATE) {
    const diffMs = GRACE_END_DATE.getTime() - LAUNCH_DATE.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }
  const diffMs = GRACE_END_DATE.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Get remaining days in promo window (0 if expired)
 */
export function getPromoDaysRemaining(now: Date = new Date()): number {
  if (now > PROMO_END_DATE) return 0;
  if (now < LAUNCH_DATE) {
    const diffMs = PROMO_END_DATE.getTime() - LAUNCH_DATE.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }
  const diffMs = PROMO_END_DATE.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Format price in COP with proper Colombian formatting
 */
export function formatCOP(amount: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
