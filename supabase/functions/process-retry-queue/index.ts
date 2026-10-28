/** Bounded retry drain. Cadence remains UTC 05–13 hourly plus 18:00. */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requirePrivilegedCaller } from "../_shared/privilegedCaller.ts";
import { dispatchRetry } from "../_shared/retryDispatch.ts";
import { breakerDeferral, ppDurableDeferral, retryOutcome } from "../_shared/retryOutcome.ts";
import { isExclusiveSamaiPublication, retryItemDisposition, samaiEnrollmentDecision } from "../_shared/retryEligibility.ts";

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const gate = await requirePrivilegedCaller(req, corsHeaders);
  if (!gate.ok && gate.response) return gate.response;
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
    headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (!url || !key) return json({ ok: false, error: "MISSING_ENV" }, 500);
  const db = createClient(url, key);
  const start = Date.now(), results: unknown[] = [];
  // Reserve both first-query channels and both recovery channels. Claim only
  // immediately before execution; timeout never locks a batch of unused work.
  const slots = [
    ["ACT_SCRAPE_RETRY", true], ["PUB_RETRY", true],
    ["ACT_SCRAPE_RETRY", false], ["PUB_RETRY", false],
  ] as const;
  try {
    for (const [kind, initial] of slots) {
      if (Date.now() - start > 100_000) break;
      const { data, error } = await db.rpc("claim_sync_retry", { p_kind: kind, p_initial: initial });
      if (error) throw error;
      const task = data?.[0];
      if (!task?.lease_token) continue;
      const traceId = crypto.randomUUID();
      const { data: item, error: itemError } = await db.from("work_items")
        .select("id,monitoring_enabled,lifecycle_state,deleted_at,workflow_type").eq("id", task.work_item_id).maybeSingle();
      if (itemError) throw itemError;
      let outcome: "SUCCESS" | "RETRY" | "EXHAUSTED" | "INELIGIBLE" | "DEFERRED" = "RETRY";
      let code: string | null = null;
      let result: Record<string, unknown> = { trace_id: traceId };
      let delaySeconds = kind === "PUB_RETRY" ? 86400 : 900;
      const disposition = retryItemDisposition(item);
      if (disposition === "MISSING" || disposition === "DELETED") {
        outcome = "INELIGIBLE"; code = disposition === "MISSING" ? "ITEM_NOT_FOUND" : "ITEM_DELETED";
      } else if (disposition === "PAUSED") {
        outcome = "DEFERRED"; code = "MONITORING_PAUSED"; delaySeconds = 86400;
      } else if (task.attempt >= task.max_attempts) {
        outcome = "EXHAUSTED"; code = task.last_error_code ?? "RETRY_EXHAUSTED";
      } else {
        try {
          // CPACA publications use SAMAI Estados exclusively. Do not let the
          // generic retry route bypass this matter's source enrolment.
          if (item && isExclusiveSamaiPublication(kind, item.workflow_type)) {
            const { data: enrollment, error: enrollmentError } = await db.from("work_item_provider_enrollment")
              .select("enabled").eq("work_item_id", task.work_item_id).eq("provider_key", "samai_estados")
              .eq("scope", "PUBS").maybeSingle();
            const enrollmentDecision = samaiEnrollmentDecision(enrollmentError, enrollment);
            if (enrollmentDecision === "UNAVAILABLE") {
              outcome = "DEFERRED"; code = "SOURCE_ENROLLMENT_UNAVAILABLE"; delaySeconds = 130;
            } else if (enrollmentDecision === "DISABLED") {
              outcome = "INELIGIBLE"; code = "SOURCE_NOT_ENABLED";
            } else {
              const { data: breaker, error: breakerError } = await db.rpc("peek_samai_estados_breaker");
              if (breakerError || breaker?.[0]?.paused) {
                outcome = "DEFERRED";
                code = breakerError ? "PROVIDER_BREAKER_UNAVAILABLE" : "PROVIDER_BREAKER_OPEN";
                const retryAt = Date.parse(breaker?.[0]?.retry_at ?? "");
                delaySeconds = Number.isFinite(retryAt) ? Math.max(5, Math.min(1800, Math.ceil((retryAt-Date.now())/1000))) : 130;
              }
            }
          }
          if (outcome === "INELIGIBLE" || outcome === "DEFERRED") {
            result = { trace_id: traceId, error_code: code };
          } else {
          const response = await dispatchRetry(url, key, kind === "ACT_SCRAPE_RETRY"
            ? "sync-by-work-item" : "sync-publicaciones-by-work-item", task.work_item_id, task.id, traceId);
          const payload = await response.json().catch(() => null);
          const decision = retryOutcome(response.status, payload);
          outcome = decision.outcome; code = decision.code;
          // Close the race where the shared breaker opens after the peek but
          // before the adapter acquires a permit.
          const deferred = item && isExclusiveSamaiPublication(kind, item.workflow_type) ? breakerDeferral(payload) : null;
          if (deferred) { outcome = "DEFERRED"; code = deferred.code; delaySeconds = deferred.delaySeconds; }
          // Only a durable PP admission can defer without consuming attempts;
          // its original admission timestamp puts a hard bound on polling.
          const ppDeferred = kind === "PUB_RETRY" ? ppDurableDeferral(payload) : null;
          if (ppDeferred) { outcome = "DEFERRED"; code = ppDeferred.code; delaySeconds = ppDeferred.delaySeconds; }
          result = { trace_id: traceId, http_status: response.status, response: payload };
          }
        } catch {
          code = "INVOCATION_TIMEOUT";
          result = { trace_id: traceId, error_code: code };
        }
      }
      const { data: committed, error: finishError } = await db.rpc("finish_sync_retry", {
        p_id: task.id, p_token: task.lease_token, p_outcome: outcome, p_error: code,
        p_result: result, p_delay_seconds: delaySeconds,
      });
      if (finishError) throw finishError;
      if (!committed) throw new Error("RETRY_LEASE_LOST");
      results.push({ task_id: task.id, work_item_id: task.work_item_id, trace_id: traceId, outcome, code });
    }
    // No synthetic work-item SUCCESS timestamp: the provider ingestion owns it.
    const { count: overdueInitial, error: slaError } = await db.from("sync_retry_queue")
      .select("id", { count: "exact", head: true }).eq("attempt", 0)
      .lt("created_at", new Date(Date.now() - 48 * 3600_000).toISOString());
    if (slaError) throw slaError;
    return json({ ok: true, revision: "retry-fenced-20261026", processed: results.length, results,
      first_query_target_hours: 48, overdue_initial_queries: overdueInitial,
      sla_met: overdueInitial === 0 });
  } catch (error) {
    console.error("[retry] drain failed", error instanceof Error ? error.message : "unknown");
    return json({ ok: false, error: "RETRY_DRAIN_FAILED", results }, 500);
  }
});
