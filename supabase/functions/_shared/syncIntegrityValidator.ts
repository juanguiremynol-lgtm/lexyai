/**
 * Sync Integrity Validator — Layer 2A
 * 
 * Post-sync consistency check that runs INSIDE the sync orchestrator.
 * Ensures "if I'm about to mark this item as synced, data must be present 
 * or the provider must have explicitly returned empty."
 * 
 * This layer prevents the class of regression where last_synced_at is updated
 * despite all providers failing, making stale items appear fresh.
 */

// ── Provider Result Types (Layer 2B: Provider Result Accountability) ──

export type ProviderResultStatus = 'SUCCESS' | 'EMPTY' | 'ERROR' | 'TIMEOUT' | 'SKIPPED';

export interface ProviderResult {
  status: ProviderResultStatus;
  called: boolean;
  statusCode: number;
  recordsReceived: number;
  recordsUpserted: number;
  recordsDeduped?: number;
  error?: string;
  retryable?: boolean;
  durationMs?: number;
}

export interface PostSyncCheck {
  workItemId: string;
  providersAttempted: string[];
  providerResults: Record<string, ProviderResult>;
}

export interface IntegrityVerdict {
  canMarkSynced: boolean;
  reason: string;
  severity: 'OK' | 'WARNING' | 'ERROR';
  details?: Record<string, unknown>;
}

/**
 * Validates sync integrity before allowing last_synced_at to advance.
 * 
 * Invariants checked:
 * 1. At least one provider must have been called
 * 2. No provider should have a non-200 status without an error being logged
 * 3. If a provider returned records but none were upserted, log a warning
 * 4. If ALL providers failed, do NOT mark as synced
 * 5. If a provider returned 200 with zero records, that's legitimate (EMPTY)
 */
export function validateSyncIntegrity(check: PostSyncCheck): IntegrityVerdict {
  const { providerResults, providersAttempted } = check;

  // INVARIANT 1: At least one provider must have been called
  const anyProviderCalled = providersAttempted.some(
    p => providerResults[p]?.called
  );
  if (!anyProviderCalled) {
    return {
      canMarkSynced: false,
      reason: 'NO_PROVIDERS_CALLED',
      severity: 'ERROR',
      details: { providersAttempted },
    };
  }

  // INVARIANT 2: No provider should have a >=400 status without an error logged
  for (const [provider, result] of Object.entries(providerResults)) {
    if (result.called && result.statusCode >= 400 && !result.error) {
      return {
        canMarkSynced: false,
        reason: `UNLOGGED_ERROR_${provider}_${result.statusCode}`,
        severity: 'ERROR',
        details: { provider, statusCode: result.statusCode },
      };
    }
  }

  // INVARIANT 4: If ALL providers failed, do NOT mark as synced
  const calledProviders = Object.entries(providerResults).filter(([, r]) => r.called);
  const allFailed = calledProviders.length > 0 && calledProviders.every(
    ([, r]) => r.status === 'ERROR' || r.status === 'TIMEOUT' || r.statusCode >= 400
  );
  if (allFailed) {
    return {
      canMarkSynced: false,
      reason: 'ALL_PROVIDERS_FAILED',
      severity: 'ERROR',
      details: {
        providers: Object.fromEntries(
          calledProviders.map(([p, r]) => [p, { status: r.status, statusCode: r.statusCode, error: r.error }])
        ),
      },
    };
  }

  // INVARIANT 3: If a provider returned records but none were upserted (all deduped) — warn
  for (const [provider, result] of Object.entries(providerResults)) {
    if (result.called && result.recordsReceived > 0 && result.recordsUpserted === 0) {
      return {
        canMarkSynced: true,
        reason: `ALL_DEDUPED_${provider}`,
        severity: 'WARNING',
        details: { provider, recordsReceived: result.recordsReceived },
      };
    }
  }

  // INVARIANT 5: If providers returned 200 with zero records, that's legitimate
  const anySuccess = calledProviders.some(([, r]) => r.status === 'SUCCESS' || r.status === 'EMPTY');
  if (anySuccess) {
    return { canMarkSynced: true, reason: 'OK', severity: 'OK' };
  }

  // Fallback: if we got here, at least one provider was called and didn't hard-fail
  return { canMarkSynced: true, reason: 'OK', severity: 'OK' };
}

/**
 * Ensure every provider in the fan-out produced an explicit result.
 * Returns list of providers that have no result (adapter bugs).
 */
export function findMissingProviderResults(
  expectedProviders: string[],
  providerResults: Record<string, ProviderResult | undefined>,
): string[] {
  return expectedProviders.filter(p => !providerResults[p]);
}

/**
 * Fill in missing provider results with a synthetic ERROR result.
 * Ensures no provider silently drops.
 */
export function ensureProviderAccountability(
  expectedProviders: string[],
  providerResults: Record<string, ProviderResult | undefined>,
): Record<string, ProviderResult> {
  const complete: Record<string, ProviderResult> = {};
  for (const provider of expectedProviders) {
    const result = providerResults[provider];
    if (result) {
      complete[provider] = result;
    } else {
      complete[provider] = {
        status: 'ERROR',
        called: false,
        statusCode: 0,
        recordsReceived: 0,
        recordsUpserted: 0,
        error: 'ADAPTER_NO_RESULT',
        retryable: true,
      };
    }
  }
  return complete;
}
