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
import { canonicalizeProvider } from "./syncVocabulary.ts";
import { syncResponseOk } from "./syncResponseVerdict.ts";
import { dailyChannelStatus, takeAdmission } from "./dailyUpdateGate.ts";
import { enforceVerifiedOutcome, responseCause } from "./syncTimelineVerdict.ts";

export const DEPLOY_SHA = Deno.env.get("DEPLOY_SHA") ?? "unset";

export interface SyncTimelineEvent {
  work_item_id: string;
  organization_id?: string | null;
  sync_run_id?: string | null;
  provider: string;
  operation: string;
  function_name?: string | null;
  adapter_version?: string | null;
  deploy_sha?: string | null;
  status: "success" | "error" | "empty" | "skipped" | "partial" | "pending_upstream" | "rejected" | "deduplicated";
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
async function finishDailyUpdate(runDate: string, workItemId: string, channel: string, token: string, status: string, errorCode: string | null) {
  const url = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  await db.rpc("finish_daily_update", { _run_date: runDate, _work_item_id: workItemId, _channel: channel,
    _token: token, _status: status, _error_code: errorCode });
}

export async function recordSyncTimelineEvent(
  event: SyncTimelineEvent,
): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  try {
    const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    // ITER63 — one declared vocabulary, one stable multi-source ordering.
    const canon = canonicalizeProvider(event.provider);
    // Never persist success/empty without a fully attributable provider and a
    // null error code; evidence is kept, the row is marked non-success.
    const verdict = enforceVerifiedOutcome({ status: event.status, providers: canon.providers, error_code: event.error_code });
    const metadata = verdict.downgraded_from
      ? { ...(event.metadata ?? {}), unverified_outcome: { original_status: verdict.downgraded_from, original_error_code: event.error_code ?? null } }
      : (event.metadata ?? {});
    const { error } = await supabase.from("work_item_sync_timeline").insert({
      work_item_id: event.work_item_id,
      organization_id: event.organization_id ?? null,
      sync_run_id: event.sync_run_id ?? null,
      provider: canon.provider,
      providers: canon.providers,
      operation: event.operation,
      function_name: event.function_name ?? null,
      adapter_version: event.adapter_version ?? null,
      deploy_sha: event.deploy_sha ?? DEPLOY_SHA,
      status: verdict.status,
      error_code: verdict.error_code,
      error_message: event.error_message ?? null,
      records_inserted: event.records_inserted ?? 0,
      records_skipped: event.records_skipped ?? 0,
      latency_ms: event.latency_ms ?? null,
      started_at: event.started_at ?? null,
      finished_at: event.finished_at ?? new Date().toISOString(),
      metadata,
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
    let isHistoricalReplay = false;
    try {
      if (req.method !== "OPTIONS" && req.headers.get("content-type")?.includes("json")) {
        const cloned = req.clone();
        const body = await cloned.json().catch(() => null) as Record<string, unknown> | null;
        if (body) {
          workItemId = typeof body.work_item_id === "string" ? body.work_item_id : null;
          isHealthCheck = body.health_check === true;
          isHistoricalReplay = Object.prototype.hasOwnProperty.call(body, "_historical_pp_replay");
        }
      }
    } catch { /* ignore */ }

    const response = await handler(req);

    // Don't record CORS preflights or health probes.
    // The historical path has its own bounded evidence embedded in the row.
    // Never turn a stored replay (including a refusal) into today's sync.
    if (req.method === "OPTIONS" || isHealthCheck || isHistoricalReplay || !workItemId) {
      return response;
    }

    // Clone so the caller still consumes the original body.
    const clone = response.clone();
    let parsed: any = null;
    try {
      // Read the header from the original: some runtimes drop headers on clone().
      const ct = response.headers.get("content-type") ?? clone.headers.get("content-type") ?? "";
      if (ct.includes("json")) {
        parsed = await clone.json().catch(() => null);
      }
    } catch { /* ignore */ }

    const finishedAt = new Date();
    const latencyMs = Date.now() - startMs;

    // Heuristic classification from common response shapes.
    const ok = syncResponseOk(response.ok, parsed);
    const inserted = numberOr(parsed?.inserted_count ?? parsed?.inserted, 0);
    const skipped = numberOr(parsed?.skipped_count ?? parsed?.skipped, 0);
    const provider =
      strOr(parsed?.provider_used) ??
      strOr(parsed?.provider) ??
      "unknown";
    const errorCode = responseCause(parsed);
    const errorMsg = strOr(parsed?.error_message ?? parsed?.error);

    // Iteration 62 — a run must never report absence it did not observe.
    //   rejected        → our own gate refused the call (auth/precondition);
    //                     no provider was ever contacted.
    //   pending_upstream→ the provider was still working when we asked.
    //   skipped         → scraping kicked off; the answer is not in yet.
    //   empty           → a named provider answered with zero rows.
    const resultCode = strOr(parsed?.result_code) ?? errorCode;
    const authRejected =
      response.status === 401 || response.status === 403 ||
      errorCode === "UNAUTHORIZED" || errorCode === "FORBIDDEN";
    const pendingUpstream =
      parsed?.pending_upstream === true ||
      resultCode === "PENDING_UPSTREAM" ||
      strOr(parsed?.status) === "PENDING_UPSTREAM";

    // An untrusted caller can supply any work_item_id. A rejected request has
    // not proved entitlement to that row; retain only unattributed telemetry.
    if (authRejected) {
      console.warn(`[syncTimeline] caller rejected function=${opts.function_name} http_status=${response.status}`);
      return response;
    }

    let status: SyncTimelineEvent["status"];
    if (authRejected) status = "rejected";
    else if (strOr(parsed?.status) === "DAILY_LIMIT") status = "deduplicated";
    else if (pendingUpstream) status = "pending_upstream";
    else if (parsed?.partial === true) status = "partial";
    else if (!ok) status = "error";
    else if (parsed?.code === "SCRAPING_INITIATED" || parsed?.scraping_initiated) status = "skipped";
    else if (inserted === 0 && skipped === 0) {
      // A run that cannot name its provider has no standing to assert "empty".
      status = provider === "unknown" ? "skipped" : "empty";
    } else status = "success";

    // A transport/body ok flag never erases an explicit failure cause.
    const eventErrorCode = status === "pending_upstream" ? (errorCode ?? "PENDING_UPSTREAM") : errorCode;
    const verifiedOutcome = enforceVerifiedOutcome({
      status, providers: canonicalizeProvider(provider).providers, error_code: eventErrorCode,
    });

    // Complete the evidence write before returning; edge runtimes do not
    // guarantee progress of a detached promise after the response ends.
    await recordSyncTimelineEvent({
      work_item_id: workItemId,
      // Never attribute a caller-side rejection to a provider we never called.
      provider: authRejected ? "none" : provider,
      operation: opts.default_operation,
      function_name: opts.function_name,
      adapter_version: opts.adapter_version ?? null,
      deploy_sha: DEPLOY_SHA,
      status,
      error_code: eventErrorCode,
      error_message: ok && !authRejected ? null : (errorMsg ?? errorCode ?? null),
      records_inserted: inserted,
      records_skipped: skipped,
      latency_ms: latencyMs,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      sync_run_id: strOr(parsed?.sync_run_id ?? parsed?.run_id) ?? null,
      metadata: {
        http_status: response.status,
        trace_id: strOr(parsed?.trace_id),
        source_observed_at: strOr(parsed?.source_observed_at),
        // Missing evidence is unknown, not an explicit incomplete verdict.
        source_complete: typeof parsed?.source_complete === "boolean" ? parsed.source_complete : null,
        invoker_function: req.headers.get("x-invoker-function"),
        retry_task_id: req.headers.get("x-retry-task-id"),
        scheduled_requested: req.headers.get("x-invoker-function") === "process-retry-queue",
        auth_mechanism: req.headers.has("x-cron-key") ? "cron_header" : req.headers.has("authorization") ? "bearer" : "none",
        warnings: parsed?.warnings ?? undefined,
        persistence_summary: parsed?.persistence_summary ?? undefined,
      },
    }).catch(() => { /* swallowed */ });

    // Seal the daily channel admitted by this request (token-fenced; evidence
    // only — a terminal status never re-admits the same Bogotá day).
    const du = takeAdmission(req);
    if (du?.token && du.run_date && du.channel) {
      await finishDailyUpdate(du.run_date, workItemId, du.channel, du.token, dailyChannelStatus(verifiedOutcome.status),
        verifiedOutcome.error_code).catch(() => {});
    }

    return response;
  };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function strOr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
