/**
 * genericRemoteAdapter.ts — ProviderFetchFn adapter for dynamic (wizard-registered) providers.
 *
 * This adapter bridges the orchestrator's ProviderFetchFn interface with the existing
 * `provider-sync-external-provider` edge function. It allows new providers added via
 * the wizard to be used by the orchestrator WITHOUT code changes.
 *
 * Flow:
 *   1. Orchestrator calls this adapter with standard params
 *   2. Adapter invokes `provider-sync-external-provider` edge function
 *   3. Edge function handles: secret resolution, SSRF-safe fetch, snapshot parsing,
 *      mapping, canonical upsert, provenance, and trace recording
 *   4. Adapter translates the response into ProviderFetchFn return shape
 *
 * This is the KEY to "no-code provider addition":
 *   - Wizard creates connector + instance + secret + coverage override
 *   - Orchestrator discovers the override via getProviderCoverageWithOverrides()
 *   - Orchestrator uses this adapter to call the provider through the existing pipeline
 */

import type { ProviderFetchFn } from "./syncOrchestrator.ts";

export interface DynamicProviderConfig {
  providerKey: string;
  connectorId: string;
  /** If known, the instance ID to use; otherwise resolved by the edge function */
  instanceId?: string;
  timeoutMs?: number;
}

/**
 * Creates a ProviderFetchFn that invokes provider-sync-external-provider
 * for a dynamically registered provider.
 */
export function createDynamicProviderAdapter(
  config: DynamicProviderConfig,
): ProviderFetchFn {
  return async (params) => {
    const startTime = Date.now();

    try {
      const supabaseUrl = params.supabaseUrl;
      const functionUrl = `${supabaseUrl}/functions/v1/provider-sync-external-provider`;

      const body: Record<string, unknown> = {
        work_item_id: params.workItemId,
      };

      // If we have an instanceId, pass it directly
      if (config.instanceId) {
        body.provider_instance_id = config.instanceId;
      }

      const response = await fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: params.authHeader,
        },
        body: JSON.stringify(body),
        signal: params.signal,
      });

      const latencyMs = Date.now() - startTime;
      const result = await response.json().catch(() => ({}));

      if (response.ok && result.ok !== false) {
        // Success: provider-sync-external-provider already handled DB writes
        const insertedCount = (result.inserted_acts || 0) + (result.inserted_pubs || 0);
        const skippedCount = (result.skipped_acts || 0) + (result.skipped_pubs || 0);

        return {
          ok: true,
          found: true,
          isEmpty: insertedCount === 0 && skippedCount === 0,
          insertedCount,
          skippedCount,
          httpStatus: response.status,
          errorCode: null,
          errorMessage: null,
          latencyMs,
          metadata: {
            _dynamicProvider: true,
            providerKey: config.providerKey,
            connectorId: config.connectorId,
            instanceId: config.instanceId || result.instance_id,
            // Mark that DB writes already happened (no post-processing needed)
            _dbWritesComplete: true,
            rawResult: result,
          },
        };
      }

      // Error or non-OK response
      const errorCode = result.code || classifyHttpError(response.status, result.error);
      const isEmpty = errorCode === "PROVIDER_EMPTY_RESULT" || result.code === "EMPTY";

      return {
        ok: false,
        found: !isEmpty && response.status !== 404,
        isEmpty,
        insertedCount: 0,
        skippedCount: 0,
        httpStatus: response.status,
        errorCode,
        errorMessage: (result.error || result.message || `HTTP ${response.status}`).slice(0, 500),
        latencyMs,
        metadata: {
          _dynamicProvider: true,
          providerKey: config.providerKey,
          connectorId: config.connectorId,
        },
      };
    } catch (err: any) {
      const isTimeout = err.name === "AbortError";
      return {
        ok: false,
        found: false,
        isEmpty: true,
        insertedCount: 0,
        skippedCount: 0,
        httpStatus: null,
        errorCode: isTimeout ? "PROVIDER_TIMEOUT" : "ADAPTER_ERROR",
        errorMessage: (err.message || String(err)).slice(0, 500),
        latencyMs: Date.now() - startTime,
        metadata: {
          _dynamicProvider: true,
          providerKey: config.providerKey,
        },
      };
    }
  };
}

function classifyHttpError(status: number, errorMsg?: string): string {
  if (status === 401 || status === 403) return "PROVIDER_AUTH_FAILED";
  if (status === 404) return "PROVIDER_404";
  if (status === 424) return "SECRET_RESOLUTION_FAILED";
  if (status === 429) return "PROVIDER_RATE_LIMITED";
  if (status >= 500) return "PROVIDER_SERVER_ERROR";
  const msg = (errorMsg || "").toLowerCase();
  if (msg.includes("timeout")) return "PROVIDER_TIMEOUT";
  if (msg.includes("empty")) return "PROVIDER_EMPTY_RESULT";
  return "PROVIDER_ERROR";
}
