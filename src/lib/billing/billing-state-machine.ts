/**
 * Billing State Machine — Pure, deterministic functions for billing lifecycle.
 *
 * IMPORTANT: No side effects. No Supabase imports. No React.
 * Can be used in frontend, edge functions, and unit tests.
 * 
 * NEW POLICY:
 * - TRIAL: 3-month free trial for all new signups. No tickers, no paywall.
 * - Billing starts at trial_end_at. First due date = trial_end_at.
 * - Pre-due tickers start at trial_end_at - 5 days (only after trial is logically "ending").
 */

// ============================================================================
// TYPES
// ============================================================================

export type BillingStatus =
  | "ACTIVE"
  | "TRIAL"
  | "PENDING_PAYMENT"
  | "PAST_DUE"
  | "SUSPENDED"
  | "CANCELLED"
  | "EXPIRED"
  | "CHURNED";

export type RenewalUrgency =
  | "none"       // Active/trial, due date > 5 days away
  | "trial_ending" // Trial ending within 5 days (informational, no payment CTA yet)
  | "pre_due"    // 1-5 days before due date (billing active)
  | "due_today"  // Due date is today
  | "grace"      // Past due, within grace (2 days)
  | "suspended"; // Beyond grace period

export interface BillingStateInput {
  /** Current period end (due date) — ISO string or null */
  currentPeriodEnd: string | null;
  /** Trial end — ISO string or null */
  trialEndAt: string | null;
  /** Comped until — ISO string or null */
  compedUntilAt: string | null;
  /** Current status from DB */
  status: string | null;
  /** Was already suspended? */
  suspendedAt: string | null;
}

export interface ComputedBillingState {
  /** Resolved lifecycle status */
  status: BillingStatus;
  /** Renewal urgency level */
  urgency: RenewalUrgency;
  /** Days until due (0+ if not yet due) */
  daysUntilDue: number;
  /** Days past due (0+ if overdue) */
  daysOverdue: number;
  /** Whether in grace period */
  inGrace: boolean;
  /** Grace days remaining */
  graceDaysRemaining: number;
  /** Should show top ticker */
  showTopTicker: boolean;
  /** Should show bottom ticker */
  showBottomTicker: boolean;
  /** Should block access with paywall */
  showPaywall: boolean;
  /** The resolved due date */
  dueDate: Date | null;
  /** Whether in active trial */
  isInTrial: boolean;
  /** Days remaining in trial (0 if not in trial) */
  trialDaysRemaining: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const PRE_DUE_NOTICE_DAYS = 5;
export const GRACE_PERIOD_DAYS = 2;

// ============================================================================
// CORE PURE FUNCTION
// ============================================================================

/**
 * Compute billing state from inputs + current time.
 *
 * This is the SINGLE SOURCE OF TRUTH for billing lifecycle logic.
 * Same function is used by:
 *   - Frontend (useRenewalStatus hook)
 *   - Backend (billing-dunning-engine, daily cron)
 *   - Unit tests
 *
 * @param input  Billing data from DB
 * @param now    Current time (injectable for time-travel testing)
 */
export function computeBillingState(
  input: BillingStateInput,
  now: Date = new Date()
): ComputedBillingState {
  const defaults: ComputedBillingState = {
    status: "ACTIVE",
    urgency: "none",
    daysUntilDue: 999,
    daysOverdue: 0,
    inGrace: false,
    graceDaysRemaining: GRACE_PERIOD_DAYS,
    showTopTicker: false,
    showBottomTicker: false,
    showPaywall: false,
    dueDate: null,
    isInTrial: false,
    trialDaysRemaining: 0,
  };

  // If already cancelled/churned, keep that status
  if (input.status === "CANCELLED" || input.status === "CHURNED") {
    return { ...defaults, status: input.status as BillingStatus, urgency: "suspended", showPaywall: true };
  }

  // Comped accounts are always active until comped_until_at
  if (input.compedUntilAt) {
    const compedEnd = new Date(input.compedUntilAt);
    if (now < compedEnd) {
      return { ...defaults, status: "ACTIVE", dueDate: compedEnd };
    }
  }

  // ── TRIAL LOGIC ──
  // If trial_end_at exists AND we haven't passed it yet AND there's no current_period_end
  // (no billing cycle has started), we're in trial
  if (input.trialEndAt) {
    const trialEnd = new Date(input.trialEndAt);
    const trialDiffMs = trialEnd.getTime() - now.getTime();
    const trialDiffDays = Math.ceil(trialDiffMs / (1000 * 60 * 60 * 24));

    // Still in trial: trial hasn't ended AND no active billing period set
    if (trialDiffDays > 0 && !input.currentPeriodEnd) {
      const isInTrial = true;
      const trialDaysRemaining = trialDiffDays;

      // Show informational "trial ending" notice in last 5 days of trial
      // BUT no payment tickers (no CTA to pay yet)
      let urgency: RenewalUrgency = "none";
      let showTopTicker = false;
      if (trialDiffDays <= PRE_DUE_NOTICE_DAYS) {
        urgency = "trial_ending";
        showTopTicker = true;
      }

      return {
        ...defaults,
        status: "TRIAL",
        urgency,
        daysUntilDue: trialDaysRemaining,
        dueDate: trialEnd,
        isInTrial,
        trialDaysRemaining,
        showTopTicker,
      };
    }
  }

  // ── BILLING LOGIC (post-trial or no trial) ──
  // Determine due date: currentPeriodEnd takes precedence, fallback to trialEndAt
  const dueDateStr = input.currentPeriodEnd || input.trialEndAt;
  if (!dueDateStr) {
    // No due date — treat as active (new account, pending setup)
    return defaults;
  }

  const dueDate = new Date(dueDateStr);
  const diffMs = dueDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  const daysUntilDue = Math.max(0, diffDays);
  const daysOverdue = Math.max(0, -diffDays);
  const inGrace = daysOverdue > 0 && daysOverdue <= GRACE_PERIOD_DAYS;
  const graceDaysRemaining = inGrace ? GRACE_PERIOD_DAYS - daysOverdue : 0;
  const beyondGrace = daysOverdue > GRACE_PERIOD_DAYS;

  // Determine urgency
  let urgency: RenewalUrgency = "none";
  if (beyondGrace || input.status === "SUSPENDED") {
    urgency = "suspended";
  } else if (inGrace) {
    urgency = "grace";
  } else if (diffDays === 0) {
    urgency = "due_today";
  } else if (diffDays > 0 && diffDays <= PRE_DUE_NOTICE_DAYS) {
    urgency = "pre_due";
  }

  // Determine status
  let status: BillingStatus;
  if (urgency === "suspended") {
    status = "SUSPENDED";
  } else if (urgency === "grace" || urgency === "due_today") {
    status = "PAST_DUE";
  } else {
    status = "ACTIVE";
  }

  // Ticker visibility — NO tickers during trial (handled above)
  const showTopTicker = urgency !== "none";
  const showBottomTicker =
    urgency === "due_today" || urgency === "grace" || urgency === "suspended";
  const showPaywall = urgency === "suspended";

  return {
    status,
    urgency,
    daysUntilDue,
    daysOverdue,
    inGrace,
    graceDaysRemaining,
    showTopTicker,
    showBottomTicker,
    showPaywall,
    dueDate,
    isInTrial: false,
    trialDaysRemaining: 0,
  };
}

// ============================================================================
// STATUS TRANSITION HELPER (for server-side cron)
// ============================================================================

export interface StatusTransition {
  newStatus: BillingStatus;
  reason: string;
  shouldSuspend: boolean;
  shouldNotify: boolean;
}

/**
 * Determine the status transition for a given account.
 * Returns null if no transition is needed.
 */
export function computeStatusTransition(
  input: BillingStateInput,
  now: Date = new Date()
): StatusTransition | null {
  const computed = computeBillingState(input, now);
  const currentStatus = (input.status || "ACTIVE") as BillingStatus;

  // No change needed
  if (computed.status === currentStatus) return null;

  // TRIAL → ACTIVE (trial ended, billing starts)
  if (currentStatus === "TRIAL" && computed.status === "ACTIVE") {
    return {
      newStatus: "ACTIVE",
      reason: "Período de prueba finalizado. Facturación activa.",
      shouldSuspend: false,
      shouldNotify: true,
    };
  }

  // TRIAL → PAST_DUE (trial ended, already overdue)
  if (currentStatus === "TRIAL" && computed.status === "PAST_DUE") {
    return {
      newStatus: "PAST_DUE",
      reason: `Período de prueba finalizado. Pago vencido. Período de gracia de ${GRACE_PERIOD_DAYS} días inicia.`,
      shouldSuspend: false,
      shouldNotify: true,
    };
  }

  // TRIAL → SUSPENDED (trial ended, way past due)
  if (currentStatus === "TRIAL" && computed.status === "SUSPENDED") {
    return {
      newStatus: "SUSPENDED",
      reason: "Período de prueba finalizado. Cuenta suspendida por falta de pago.",
      shouldSuspend: true,
      shouldNotify: true,
    };
  }

  // Moving to PAST_DUE
  if (computed.status === "PAST_DUE" && currentStatus === "ACTIVE") {
    return {
      newStatus: "PAST_DUE",
      reason: `Pago vencido. Período de gracia de ${GRACE_PERIOD_DAYS} días inicia.`,
      shouldSuspend: false,
      shouldNotify: true,
    };
  }

  // Moving to SUSPENDED
  if (computed.status === "SUSPENDED" && currentStatus !== "SUSPENDED") {
    return {
      newStatus: "SUSPENDED",
      reason: "Período de gracia vencido. Cuenta suspendida por falta de pago.",
      shouldSuspend: true,
      shouldNotify: true,
    };
  }

  return {
    newStatus: computed.status,
    reason: `Transición de estado: ${currentStatus} → ${computed.status}`,
    shouldSuspend: computed.status === "SUSPENDED",
    shouldNotify: true,
  };
}

// ============================================================================
// TICKER MESSAGE BUILDER
// ============================================================================

export interface TickerMessages {
  admin: string;
  member: string;
}

/**
 * Build localized ticker messages for the given urgency.
 */
export function buildTickerMessages(
  urgency: RenewalUrgency,
  daysUntilDue: number,
  graceDaysRemaining: number
): TickerMessages {
  switch (urgency) {
    case "trial_ending":
      return {
        admin: `Tu período de prueba gratuito termina en ${daysUntilDue} día${daysUntilDue > 1 ? "s" : ""}. Elige un plan para continuar sin interrupciones.`,
        member: `El período de prueba de la cuenta termina en ${daysUntilDue} día${daysUntilDue > 1 ? "s" : ""}. Contacta al administrador.`,
      };
    case "pre_due":
      return {
        admin: `Tu renovación vence en ${daysUntilDue} día${daysUntilDue > 1 ? "s" : ""}. Paga ahora para evitar interrupciones.`,
        member: `La renovación de la cuenta vence en ${daysUntilDue} día${daysUntilDue > 1 ? "s" : ""}. Contacta al administrador de tu organización.`,
      };
    case "due_today":
      return {
        admin: "El pago vence hoy. El servicio se suspenderá en 2 días si no se realiza el pago.",
        member: "El pago de la cuenta vence hoy. Contacta al administrador de tu organización.",
      };
    case "grace":
      return {
        admin: `Pago vencido. El período de gracia termina en ${graceDaysRemaining} día${graceDaysRemaining > 1 ? "s" : ""}. Paga ahora para mantener el acceso.`,
        member: "Pago de la cuenta vencido. Contacta al administrador de tu organización.",
      };
    case "suspended":
      return {
        admin: "Tu cuenta está suspendida por falta de pago. Paga ahora para reactivar el servicio.",
        member: "La cuenta está suspendida. Contacta al administrador de tu organización.",
      };
    default:
      return { admin: "", member: "" };
  }
}
