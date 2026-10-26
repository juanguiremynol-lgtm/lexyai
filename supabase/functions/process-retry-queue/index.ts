/** Bounded retry drain. Cadence remains UTC 05–13 hourly plus 18:00. */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requirePrivilegedCaller } from "../_shared/privilegedCaller.ts";
import { dispatchRetry } from "../_shared/retryDispatch.ts";
import { retryOutcome } from "../_shared/retryOutcome.ts";

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
        .select("id,monitoring_enabled,lifecycle_state,deleted_at").eq("id", task.work_item_id).maybeSingle();
      if (itemError) throw itemError;
      let outcome: "SUCCESS" | "RETRY" | "EXHAUSTED" | "INELIGIBLE" = "RETRY";
      let code: string | null = null;
      let result: Record<string, unknown> = { trace_id: traceId };
      if (!item || item.deleted_at || item.lifecycle_state !== "ACTIVE" || !item.monitoring_enabled) {
        outcome = "INELIGIBLE"; code = "MONITORING_INELIGIBLE";
      } else if (task.attempt >= task.max_attempts) {
        outcome = "EXHAUSTED"; code = task.last_error_code ?? "RETRY_EXHAUSTED";
      } else {
        try {
          const response = await dispatchRetry(url, key, kind === "ACT_SCRAPE_RETRY"
            ? "sync-by-work-item" : "sync-publicaciones-by-work-item", task.work_item_id, task.id, traceId);
          const payload = await response.json().catch(() => null);
          const decision = retryOutcome(response.status, payload);
          outcome = decision.outcome; code = decision.code;
          result = { trace_id: traceId, http_status: response.status, response: payload };
        } catch {
          code = "INVOCATION_TIMEOUT";
          result = { trace_id: traceId, error_code: code };
        }
      }
      const { data: committed, error: finishError } = await db.rpc("finish_sync_retry", {
        p_id: task.id, p_token: task.lease_token, p_outcome: outcome, p_error: code,
        p_result: result, p_delay_seconds: kind === "PUB_RETRY" ? 86400 : 900,
      });
      if (finishError) throw finishError;
      if (!committed) throw new Error("RETRY_LEASE_LOST");
      results.push({ task_id: task.id, work_item_id: task.work_item_id, trace_id: traceId, outcome, code });
    }
    // No synthetic work-item SUCCESS timestamp: the provider ingestion owns it.
    return json({ ok: true, revision: "retry-fenced-20261026", processed: results.length, results });
  } catch (error) {
    console.error("[retry] drain failed", error instanceof Error ? error.message : "unknown");
    return json({ ok: false, error: "RETRY_DRAIN_FAILED", results }, 500);
  }
});
