/**
 * Pricing Windows & Beta Promo Configuration
 * 
 * SINGLE SOURCE OF TRUTH for trial, discount, and promo configuration.
 * 
 * NEW POLICY (replaces legacy "free until April"):
 * - Every new signup gets a 3-month free trial
 * - After trial: 50% off monthly, 60% off annual
 * - No hardcoded grace-period end date; trial is per-user from signup
 */

// ============================================================================
// PROMO / WINDOW DATES (global, not per-user)
// ============================================================================

// Launch date: February 1, 2026 at midnight Colombia time (America/Bogota = UTC-5)
export const LAUNCH_AT = "2026-02-01T00:00:00-05:00";

// Promo window end: July 31, 2026 at 23:59:59 Colombia time
// During promo window, 24-month commitment grants INTRO (locked) prices
export const PROMO_END_AT = "2026-07-31T23:59:59-05:00";

// Parsed Date objects for comparison
export const LAUNCH_DATE = new Date(LAUNCH_AT);
export const PROMO_END_DATE = new Date(PROMO_END_AT);

// ============================================================================
// TRIAL CONFIGURATION
// ============================================================================

/** Duration of trial for all new signups, in months */
export const TRIAL_DURATION_MONTHS = 3;

/** Compute trial end date from a signup/start date */
export function computeTrialEndDate(trialStartDate: Date): Date {
  const end = new Date(trialStartDate);
  end.setMonth(end.getMonth() + TRIAL_DURATION_MONTHS);
  return end;
}

// ============================================================================
// BETA DISCOUNT CONFIGURATION
// ============================================================================

/** Global monthly discount percentage (applied after trial ends) */
export const BETA_DISCOUNT_MONTHLY_PERCENT = 50;

/** Annual plan discount percentage (overrides monthly discount for annual) */
export const BETA_DISCOUNT_ANNUAL_PERCENT = 60;

/**
 * Get the applicable discount percent for a given billing cycle.
 * @param billingCycleMonths 1 for monthly, 12/24 for annual
 */
export function getBetaDiscountPercent(billingCycleMonths: number): number {
  if (billingCycleMonths >= 12) return BETA_DISCOUNT_ANNUAL_PERCENT;
  return BETA_DISCOUNT_MONTHLY_PERCENT;
}

/**
 * Compute discounted price in COP (integer).
 */
export function computeDiscountedPrice(basePriceCop: number, discountPercent: number): number {
  return Math.round(basePriceCop * (1 - discountPercent / 100));
}

// ============================================================================
// PROMO WINDOW HELPERS
// ============================================================================

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

// ============================================================================
// LEGACY COMPATIBILITY — kept for imports but no longer drives policy
// ============================================================================

/** @deprecated Use TRIAL_DURATION_MONTHS instead. Kept to avoid import errors. */
export const GRACE_END_AT = "2026-04-30T23:59:59-05:00";

/** @deprecated No longer used for access control. */
export const GRACE_END_DATE = new Date(GRACE_END_AT);

/** 
 * @deprecated Legacy grace period check. Now always returns false.
 * Trial access is per-user based on trial_end_at, not a global window.
 */
export function isWithinGracePeriod(_now: Date = new Date()): boolean {
  return false;
}

/** @deprecated Use trial_end_at per user instead. */
export function getGraceDaysRemaining(_now: Date = new Date()): number {
  return 0;
}

// ============================================================================
// FORMATTING
// ============================================================================

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
