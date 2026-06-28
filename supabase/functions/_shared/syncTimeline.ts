/**
 * syncTimeline — Records a per-work-item sync event with the deployed code
 * version (DEPLOY_SHA + adapter_version), so we can quickly spot
 * "repo says X, production runs Y" discrepancies.
 *
 * Usage (recommended): wrap your Deno.serve handler:
 *
 *   Deno.serve(withSyncTimeline(handler, {
 *     function_name: "sync-by-work-item",
 *     default_operation: "acts",
 *   }));
 *
 * The wrapper:
 *  - clones the request to read `work_item_id` from the JSON body
 *  - times the handler invocation
 *  - inspects the response JSON for `provider_used`, `inserted_count`,
 *    `skipped_count`, `error_code`, `code`, etc.
 *  - writes one row into `work_item_sync_timeline` (best-effort, never
 *    blocks the response on failure)
 */

import { createClient } from "npm:@supabase/supabase-js@2";

export const DEPLOY_SHA = Deno.env.get("DEPLOY_SHA") ?? "unset";

export interface SyncTimelineEvent {
  work_item_id: string;
  organization_id?: string | null;
  sync_run_id?: string | null;
  provider: string;
  workflow_type?: string | null;
  operation: string;
  function_name?: string | null;
  adapter_version?: string | null;
  deploy_sha?: string | null;
  status: "success" | "error" | "empty" | "skipped" | "partial";
  error_code?: string | null;
  error_message?: string | null;
  records_inserted?: number;
  records_skipped?: number;
  latency_ms?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  metadata?: Record<string, unknown>;
}

/** Best-effort write. Never throws — failures are logged and swallowed. */
export async function recordSyncTimelineEvent(
  event: SyncTimelineEvent,
): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  try {
    const supabase = createClient(url, key);
    const { error } = await supabase.from("work_item_sync_timeline").insert({
      work_item_id: event.work_item_id,
      organization_id: event.organization_id ?? null,
      sync_run_id: event.sync_run_id ?? null,
      provider: event.provider,
      workflow_type: event.workflow_type ?? null,
      operation: event.operation,
      function_name: event.function_name ?? null,
      adapter_version: event.adapter_version ?? null,
      deploy_sha: event.deploy_sha ?? DEPLOY_SHA,
      status: event.status,
      error_code: event.error_code ?? null,
      error_message: event.error_message ?? null,
      records_inserted: event.records_inserted ?? 0,
      records_skipped: event.records_skipped ?? 0,
      latency_ms: event.latency_ms ?? null,
      started_at: event.started_at ?? null,
      finished_at: event.finished_at ?? new Date().toISOString(),
      metadata: event.metadata ?? {},
    });
    if (error) {
      console.warn("[syncTimeline] insert failed:", error.message);
    }
  } catch (err) {
    console.warn("[syncTimeline] insert exception:", err);
  }
}

interface WrapperOptions {
  function_name: string;
  /** Operation name written when the handler doesn't override it. */
  default_operation: "acts" | "publicaciones" | "estados" | "orchestrator";
  /** Optional code-side adapter version tag for this function. */
  adapter_version?: string;
}

/**
 * Wrap a Deno.serve handler so every invocation that targets a single
 * work_item gets recorded into work_item_sync_timeline.
 */
export function withSyncTimeline(
  handler: (req: Request) => Promise<Response> | Response,
  opts: WrapperOptions,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const startedAt = new Date();
    const startMs = Date.now();

    // Snapshot the request body so the inner handler still sees a fresh body.
    let workItemId: string | null = null;
    let isHealthCheck = false;
    try {
      if (req.method !== "OPTIONS" && req.headers.get("content-type")?.includes("json")) {
        const cloned = req.clone();
        const body = await cloned.json().catch(() => null) as Record<string, unknown> | null;
        if (body) {
          workItemId = typeof body.work_item_id === "string" ? body.work_item_id : null;
          isHealthCheck = body.health_check === true;
        }
      }
    } catch { /* ignore */ }

    const response = await handler(req);

    // Don't record CORS preflights or health probes.
    if (req.method === "OPTIONS" || isHealthCheck || !workItemId) {
      return response;
    }

    // Clone so the caller still consumes the original body.
    const clone = response.clone();
    let parsed: any = null;
    try {
      const ct = clone.headers.get("content-type") ?? "";
      if (ct.includes("json")) {
        parsed = await clone.json().catch(() => null);
      }
    } catch { /* ignore */ }

    const finishedAt = new Date();
    const latencyMs = Date.now() - startMs;

    // Heuristic classification from common response shapes.
    const ok = parsed?.ok === true || (response.ok && parsed?.error == null);
    const inserted = numberOr(parsed?.inserted_count ?? parsed?.inserted, 0);
    const skipped = numberOr(parsed?.skipped_count ?? parsed?.skipped, 0);
    const provider =
      strOr(parsed?.provider_used) ??
      strOr(parsed?.provider) ??
      "unknown";
    const workflowType =
      strOr(parsed?.workflow_type) ??
      strOr(parsed?.workflow) ??
      null;
    const errorCode = strOr(parsed?.error_code ?? parsed?.code);
    const errorMsg = strOr(parsed?.error_message ?? parsed?.error);

    let status: SyncTimelineEvent["status"];
    if (!ok) status = "error";
    else if (parsed?.code === "SCRAPING_INITIATED" || parsed?.scraping_initiated) status = "skipped";
    else if (inserted === 0 && skipped === 0) status = "empty";
    else status = "success";

    // Fire-and-forget; never block response delivery.
    recordSyncTimelineEvent({
      work_item_id: workItemId,
      provider,
      workflow_type: workflowType,
      operation: opts.default_operation,
      function_name: opts.function_name,
      adapter_version: opts.adapter_version ?? null,
      deploy_sha: DEPLOY_SHA,
      status,
      error_code: ok ? null : (errorCode ?? null),
      error_message: ok ? null : (errorMsg ?? null),
      records_inserted: inserted,
      records_skipped: skipped,
      latency_ms: latencyMs,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      sync_run_id: strOr(parsed?.sync_run_id ?? parsed?.run_id) ?? null,
      metadata: {
        http_status: response.status,
        trace_id: strOr(parsed?.trace_id),
        warnings: parsed?.warnings ?? undefined,
      },
    }).catch(() => { /* swallowed */ });

    return response;
  };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function strOr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}