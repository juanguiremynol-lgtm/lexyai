/**
 * atenia-preflight-classifier.ts — Softened Preflight Severity
 *
 * Ops Hardening F:
 * - ALL_PASS if 0 providers failed.
 * - PARTIAL if 1-2 providers failed (not 50%+).
 * - CRITICAL_FAILURE only if >=50% failed for >=3 consecutive checks.
 */

import { supabase } from "@/integrations/supabase/client";

export type PreflightSeverity = "ALL_PASS" | "PARTIAL" | "CRITICAL_FAILURE";

export interface PreflightClassification {
  severity: PreflightSeverity;
  providers_failed: number;
  providers_total: number;
  consecutive_by_provider: Record<string, number>;
  reason: string;
}

const CONSECUTIVE_THRESHOLD = 3;

/**
 * Classify a preflight check result with softened severity.
 */
export function classifyPreflightResult(
  providersFailed: number,
  providersTotal: number,
  consecutiveFailuresByProvider: Record<string, number>
): PreflightClassification {
  if (providersFailed === 0) {
    return {
      severity: "ALL_PASS",
      providers_failed: 0,
      providers_total: providersTotal,
      consecutive_by_provider: consecutiveFailuresByProvider,
      reason: "Todos los proveedores respondieron correctamente.",
    };
  }

  const failureRate = providersTotal > 0 ? providersFailed / providersTotal : 0;

  // Check if >=50% failed AND at least one provider has >= CONSECUTIVE_THRESHOLD consecutive failures
  const hasConsecutiveCritical = Object.values(consecutiveFailuresByProvider).some(
    (count) => count >= CONSECUTIVE_THRESHOLD
  );

  if (failureRate >= 0.5 && hasConsecutiveCritical) {
    return {
      severity: "CRITICAL_FAILURE",
      providers_failed: providersFailed,
      providers_total: providersTotal,
      consecutive_by_provider: consecutiveFailuresByProvider,
      reason: `${providersFailed}/${providersTotal} proveedores fallaron con ${Object.entries(consecutiveFailuresByProvider).filter(([, v]) => v >= CONSECUTIVE_THRESHOLD).map(([k, v]) => `${k}(${v}x)`).join(", ")} fallos consecutivos.`,
    };
  }

  return {
    severity: "PARTIAL",
    providers_failed: providersFailed,
    providers_total: providersTotal,
    consecutive_by_provider: consecutiveFailuresByProvider,
    reason: `${providersFailed}/${providersTotal} proveedores fallaron (intermitente, no crítico).`,
  };
}

/**
 * Update consecutive failure counters per provider after a preflight check.
 * Returns the updated counters.
 */
export function updateConsecutiveFailures(
  previous: Record<string, number>,
  currentFailedProviders: string[],
  allProviders: string[]
): Record<string, number> {
  const updated: Record<string, number> = {};

  for (const provider of allProviders) {
    if (currentFailedProviders.includes(provider)) {
      updated[provider] = (previous[provider] ?? 0) + 1;
    } else {
      updated[provider] = 0; // Reset on success
    }
  }

  return updated;
}

/**
 * Persist updated consecutive failures to the latest preflight check record.
 */
export async function persistPreflightConsecutiveFailures(
  checkId: string,
  consecutiveFailures: Record<string, number>
): Promise<void> {
  await (supabase.from("atenia_preflight_checks") as any)
    .update({ consecutive_failures_by_provider: consecutiveFailures })
    .eq("id", checkId);
}
