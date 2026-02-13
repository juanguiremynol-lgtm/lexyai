/**
 * Billing Module Exports
 */

export * from './types';
export * from './provider';
export * from './hooks';
export * from './pricing-windows';
export * from './pricing-engine';
export * from './billing-state-machine';
export * from './billing-clock';

// Re-export commonly used helpers
export { 
  normalizeTierFromPlanName, 
  tierToPlanName,
  useBillingPlans,
  useCurrentBillingState,
  useCreateCheckoutSessionV2,
  useGraceEnroll,
  isIntroPricingAvailable,
} from './hooks';

// Re-export pricing window utilities
export {
  LAUNCH_AT,
  PROMO_END_AT,
  TRIAL_DURATION_MONTHS,
  BETA_DISCOUNT_MONTHLY_PERCENT,
  BETA_DISCOUNT_ANNUAL_PERCENT,
  getBetaDiscountPercent,
  computeDiscountedPrice,
  computeTrialEndDate,
  isWithinPromoWindow,
  formatCOP,
  // Legacy compat (deprecated)
  GRACE_END_AT,
  isWithinGracePeriod,
  getGraceDaysRemaining,
} from './pricing-windows';
