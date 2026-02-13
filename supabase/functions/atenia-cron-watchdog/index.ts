/**
 * atenia-cron-watchdog — Self-healing assurance layer for cron correctness.
 *
 * Runs every 10 minutes via pg_cron. Ensures:
 *   1. DAILY_ENQUEUE happened for today's Bogotá day
 *   2. Queue backlog is drained (bounded)
 *   3. Heartbeat has fired within expected interval
 *   4. Stale RUNNING cron runs are marked FAILED
 *   5. Invariant: all monitored items have sync attempt in 24h
 *   6. Generates alerts when invariants are violated
 *
 * Uses service_role — no user auth needed.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---- Bogotá time helpers (UTC-5, no DST) ----
const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;

function getBogotaNow(): Date {
  return new Date(Date.now() + BOGOTA_OFFSET_MS);
}

function getBogotaDayStartUTC(d: Date = new Date()): string {
  const bogota = new Date(d.getTime() + BOGOTA_OFFSET_MS);
  bogota.setHours(0, 0, 0, 0);
  const backUtc = new Date(bogota.getTime() - BOGOTA_OFFSET_MS);
  return backUtc.toISOString();
}

function getBogotaHour(): number {
  return getBogotaNow().getHours();
}

function minutesSince(d: Date | string): number {
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  return (Date.now() - t) / 60000;
}

// ---- Config ----
const HEARTBEAT_MAX_GAP_MINUTES = 35;
const STALE_RUNNING_LEASE_SECONDS = 900; // 15 min
const MAX_QUEUE_DRAIN_PER_RUN = 20;
const COVERAGE_ALERT_THRESHOLD = 80; // percent
const BACKLOG_ALERT_THRESHOLD = 500;
const DAILY_ENQUEUE_DEADLINE_HOUR = 10; // alert if not done by 10:00 COT

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const results: Record<string, unknown> = {};
  const alerts: Array<{ title: string; message: string; severity: string }> = [];
  const bogotaHour = getBogotaHour();

  try {
    // ================================================================
    // 0) Record watchdog run itself
    // ================================================================
    const watchdogScheduledFor = getBogotaDayStartUTC();
    // We use a unique key per 10-min window to allow multiple watchdog runs per day
    const windowKey = new Date(
      Math.floor(Date.now() / (10 * 60 * 1000)) * (10 * 60 * 1000)
    ).toISOString();

    // Just log it directly (watchdog doesn't need the claim pattern for itself)
    await admin.from("atenia_cron_runs").upsert(
      {
        job_name: "WATCHDOG",
        scheduled_for: windowKey,
        started_at: new Date().toISOString(),
        status: "RUNNING",
        details: {},
      },
      { onConflict: "job_name,scheduled_for" }
    );

    // ================================================================
    // 1) Ensure DAILY_ENQUEUE happened for today's Bogotá day
    // ================================================================
    const dailyScheduledFor = getBogotaDayStartUTC();

    const { data: claimData } = await admin.rpc("atenia_try_start_cron", {
      p_job_name: "DAILY_ENQUEUE",
      p_scheduled_for: dailyScheduledFor,
      p_lease_seconds: STALE_RUNNING_LEASE_SECONDS,
    });

    const claim = claimData?.[0];
    if (claim?.ok && claim?.run_id) {
      console.log("[watchdog] DAILY_ENQUEUE not yet done — triggering now");
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/scheduled-daily-sync`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ scope: "MONITORING_ONLY", _scheduled: true }),
        });
        const body = await resp.json().catch(() => ({ status: resp.status }));

        await admin.rpc("atenia_finish_cron", {
          p_run_id: claim.run_id,
          p_status: resp.ok ? "OK" : "FAILED",
          p_details: { triggered_by: "watchdog", result: body },
        });
        results.daily_enqueue = { triggered: true, ok: resp.ok };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await admin.rpc("atenia_finish_cron", {
          p_run_id: claim.run_id,
          p_status: "FAILED",
          p_details: { triggered_by: "watchdog", error: msg.slice(0, 500) },
        });
        results.daily_enqueue = { triggered: true, ok: false, error: msg.slice(0, 200) };
      }
    } else {
      // Check if it's late and never ran
      const { data: dailyRun } = await admin
        .from("atenia_cron_runs")
        .select("status, finished_at")
        .eq("job_name", "DAILY_ENQUEUE")
        .eq("scheduled_for", dailyScheduledFor)
        .maybeSingle();

      if (!dailyRun && bogotaHour >= DAILY_ENQUEUE_DEADLINE_HOUR) {
        alerts.push({
          title: "⚠️ Sync diario no ejecutado",
          message: `DAILY_ENQUEUE para hoy (${dailyScheduledFor}) no se ha ejecutado a las ${bogotaHour}:00 COT.`,
          severity: "CRITICAL",
        });
      }
      results.daily_enqueue = { triggered: false, existing_status: dailyRun?.status ?? "NOT_FOUND" };
    }

    // ================================================================
    // 2) Check queue backlog and drain if needed
    // ================================================================
    const { count: pendingCount } = await admin
      .from("atenia_ai_remediation_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "PENDING");

    const pending = pendingCount ?? 0;
    results.backlog = { pending };

    if (pending > 0) {
      console.log(`[watchdog] Queue backlog: ${pending} pending — draining up to ${MAX_QUEUE_DRAIN_PER_RUN}`);
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/atenia-ai-supervisor`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ mode: "PROCESS_QUEUE", max: MAX_QUEUE_DRAIN_PER_RUN }),
        });
        const body = await resp.json().catch(() => ({ status: resp.status }));
        results.queue_drain = { ok: resp.ok, result: body };
      } catch (err: unknown) {
        results.queue_drain = { ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
      }
    }

    if (pending > BACKLOG_ALERT_THRESHOLD) {
      alerts.push({
        title: "⚠️ Cola de remediación con backlog alto",
        message: `${pending} tareas pendientes en la cola de remediación (umbral: ${BACKLOG_ALERT_THRESHOLD}).`,
        severity: "WARNING",
      });
    }

    // ================================================================
    // 3) Ensure heartbeat has fired recently
    // ================================================================
    const { data: lastHeartbeat } = await admin
      .from("atenia_cron_runs")
      .select("finished_at")
      .eq("job_name", "HEARTBEAT")
      .eq("status", "OK")
      .order("finished_at", { ascending: false })
      .limit(1);

    const lastHbAt = lastHeartbeat?.[0]?.finished_at;
    const hbGap = lastHbAt ? minutesSince(lastHbAt) : Infinity;

    if (hbGap > HEARTBEAT_MAX_GAP_MINUTES) {
      console.log(`[watchdog] Heartbeat gap ${Math.round(hbGap)}min > ${HEARTBEAT_MAX_GAP_MINUTES}min — triggering`);
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/atenia-ai-supervisor`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ mode: "HEARTBEAT" }),
        });
        const body = await resp.json().catch(() => ({ status: resp.status }));
        results.heartbeat = { triggered: true, gap_minutes: Math.round(hbGap), ok: resp.ok };
      } catch (err: unknown) {
        results.heartbeat = { triggered: true, gap_minutes: Math.round(hbGap), ok: false };
      }
    } else {
      results.heartbeat = { triggered: false, gap_minutes: Math.round(hbGap) };
    }

    // ================================================================
    // 4) Clean stale RUNNING cron runs (lease expired)
    // ================================================================
    const staleThreshold = new Date(Date.now() - STALE_RUNNING_LEASE_SECONDS * 1000).toISOString();
    const { data: staleRuns } = await admin
      .from("atenia_cron_runs")
      .select("id, job_name, started_at")
      .eq("status", "RUNNING")
      .lt("started_at", staleThreshold);

    if (staleRuns && staleRuns.length > 0) {
      for (const run of staleRuns) {
        await admin.rpc("atenia_finish_cron", {
          p_run_id: run.id,
          p_status: "FAILED",
          p_details: { reason: "LEASE_EXPIRED", cleaned_by: "watchdog" },
        });
      }
      results.stale_cleaned = staleRuns.map((r: any) => ({ id: r.id, job: r.job_name }));
    } else {
      results.stale_cleaned = [];
    }

    // ================================================================
    // 5) Invariant check: sync coverage for monitored items
    // ================================================================
    const { data: coverage } = await admin.rpc("atenia_get_missing_sync_coverage");
    const cov = coverage?.[0] ?? coverage;
    results.coverage = cov;

    if (cov && cov.coverage_pct !== null && Number(cov.coverage_pct) < COVERAGE_ALERT_THRESHOLD && Number(cov.total_monitored) > 0) {
      alerts.push({
        title: "⚠️ Cobertura de sync baja",
        message: `Solo ${cov.coverage_pct}% de items monitoreados tienen intento de sync en 24h (${cov.attempted_24h}/${cov.total_monitored}). Faltan ${cov.missing_attempts}.`,
        severity: "WARNING",
      });

      // Enqueue missing items for sync
      if (Number(cov.missing_attempts) > 0 && Number(cov.missing_attempts) <= 100) {
        const { data: missingItems } = await admin
          .from("work_items")
          .select("id, organization_id")
          .eq("monitoring_enabled", true)
          .not("id", "in", `(SELECT DISTINCT work_item_id FROM sync_traces WHERE created_at > now() - interval '24 hours')`)
          .limit(50);

        // Use raw SQL for the subquery
        const { data: missingRaw } = await admin.rpc("atenia_get_missing_sync_items");
        if (missingRaw && Array.isArray(missingRaw)) {
          const today = new Date().toISOString().slice(0, 10);
          for (const item of missingRaw.slice(0, 50)) {
            try {
              await admin.from("atenia_ai_remediation_queue").upsert(
                {
                  action_type: "SYNC_WORK_ITEM",
                  work_item_id: item.id,
                  organization_id: item.organization_id,
                  status: "PENDING",
                  priority: 5,
                  payload: { source: "watchdog_coverage_invariant" },
                  dedupe_key: `COVERAGE:${today}:${item.id}`,
                },
                { onConflict: "dedupe_key" }
              );
            } catch (_) { /* non-fatal */ }
          }
          results.coverage_enqueued = missingRaw.length;
        }
      }
    }

    // ================================================================
    // 5b) Convergence: remediate stuck/omitted items
    // Items in SCRAPING_PENDING for > 30 min with no active retry must converge
    // ================================================================
    const STUCK_TTL_MINUTES = 30;
    const stuckCutoff = new Date(Date.now() - STUCK_TTL_MINUTES * 60 * 1000).toISOString();

    const { data: stuckSources } = await admin
      .from("work_item_sources")
      .select("id, work_item_id, organization_id, scrape_status, last_error_code, updated_at, consecutive_failures")
      .eq("scrape_status", "SCRAPING_PENDING")
      .lt("updated_at", stuckCutoff)
      .limit(50);

    let stuckRemediated = 0;
    let stuckMarkedTerminal = 0;

    if (stuckSources && stuckSources.length > 0) {
      for (const src of stuckSources) {
        // Check if there's an active retry queued
        const { data: retryRow } = await admin
          .from("sync_retry_queue")
          .select("id, next_run_at, attempt, max_attempts")
          .eq("work_item_id", src.work_item_id)
          .gt("next_run_at", new Date().toISOString())
          .maybeSingle();

        if (retryRow && retryRow.attempt < retryRow.max_attempts) {
          // Active retry exists — skip, it will converge
          continue;
        }

        // Check if retry is exhausted
        const { data: exhaustedRetry } = await admin
          .from("sync_retry_queue")
          .select("id, attempt, max_attempts")
          .eq("work_item_id", src.work_item_id)
          .gte("attempt", 3) // max_attempts typically 3
          .maybeSingle();

        if (exhaustedRetry || (src.consecutive_failures || 0) >= 5) {
          // Terminal: mark SCRAPING_STUCK
          await admin
            .from("work_item_sources")
            .update({
              scrape_status: "ERROR",
              last_error_code: "SCRAPING_STUCK",
              last_error_message: "Watchdog convergence: max retries exhausted, marking terminal",
            })
            .eq("id", src.id);

          // Write trace
          try {
            await admin.from("provider_sync_traces").insert({
              organization_id: src.organization_id,
              work_item_id: src.work_item_id,
              work_item_source_id: src.id,
              provider_instance_id: "00000000-0000-0000-0000-000000000000",
              run_id: crypto.randomUUID(),
              stage: "TERMINAL",
              result_code: "SCRAPING_STUCK",
              ok: false,
              latency_ms: 0,
              payload: {
                terminal_reason: "WATCHDOG_CONVERGENCE",
                consecutive_failures: src.consecutive_failures,
                stuck_since: src.updated_at,
              },
            });
          } catch (_) { /* non-fatal */ }

          stuckMarkedTerminal++;
        } else {
          // Enqueue remediation retry
          const today = new Date().toISOString().slice(0, 10);
          try {
            await admin.from("atenia_ai_remediation_queue").upsert(
              {
                action_type: "ACT_SCRAPE_RETRY",
                work_item_id: src.work_item_id,
                organization_id: src.organization_id,
                status: "PENDING",
                priority: 3,
                payload: { source: "watchdog_stuck_convergence", stuck_since: src.updated_at },
                dedupe_key: `STUCK:${today}:${src.work_item_id}`,
              },
              { onConflict: "dedupe_key" }
            );
            stuckRemediated++;
          } catch (_) { /* non-fatal */ }
        }
      }

      // Log corrective action
      if (stuckRemediated > 0 || stuckMarkedTerminal > 0) {
        try {
          await admin.from("atenia_ai_actions").insert({
            organization_id: "a0000000-0000-0000-0000-000000000001",
            action_type: "WATCHDOG_CORRECTIVE",
            autonomy_tier: "AUTONOMOUS",
            reasoning: `${stuckSources.length} items en SCRAPING_PENDING estancados. Remediados: ${stuckRemediated}, Terminales (STUCK): ${stuckMarkedTerminal}.`,
            action_taken: "CONVERGENCE_STUCK_ITEMS",
            action_result: "OK",
            evidence: {
              total_stuck: stuckSources.length,
              remediated: stuckRemediated,
              marked_terminal: stuckMarkedTerminal,
              ttl_minutes: STUCK_TTL_MINUTES,
            },
          });
        } catch (_) { /* non-fatal */ }
      }
    }

    results.stuck_convergence = {
      found: stuckSources?.length ?? 0,
      remediated: stuckRemediated,
      marked_terminal: stuckMarkedTerminal,
    };

    // ================================================================
    // 5c) Edge Function Liveness — detect undeployed critical functions
    // ================================================================
    const CRITICAL_FUNCTIONS = [
      "scheduled-daily-sync",
      "scheduled-publicaciones-monitor",
      "sync-by-work-item",
      "sync-publicaciones-by-work-item",
      "fallback-sync-check",
      "atenia-ai-supervisor",
      "provider-sync-external-provider",
    ];

    const livenessResults: Array<{ fn: string; ok: boolean; status?: number; error?: string }> = [];
    const LIVENESS_TIMEOUT_MS = 8000;

    // Probe all functions in parallel with OPTIONS request (lightweight, no auth needed)
    const probes = CRITICAL_FUNCTIONS.map(async (fnName) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), LIVENESS_TIMEOUT_MS);
        const resp = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
          method: "OPTIONS",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        // OPTIONS should return 200 or 204 if the function is deployed
        const ok = resp.status < 500;
        return { fn: fnName, ok, status: resp.status };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { fn: fnName, ok: false, error: msg.slice(0, 200) };
      }
    });

    const probeResults = await Promise.all(probes);
    const deadFunctions = probeResults.filter((p) => !p.ok);
    livenessResults.push(...probeResults);

    results.edge_function_liveness = {
      checked: CRITICAL_FUNCTIONS.length,
      alive: probeResults.filter((p) => p.ok).length,
      dead: deadFunctions.length,
      details: livenessResults,
    };

    if (deadFunctions.length > 0) {
      const fnList = deadFunctions.map((d) => d.fn).join(", ");
      const alertMsg = `${deadFunctions.length} función(es) Edge crítica(s) no responden (posiblemente no desplegadas): ${fnList}. Esto impide la sincronización automática.`;

      alerts.push({
        title: "🚨 Funciones Edge no desplegadas",
        message: alertMsg,
        severity: "CRITICAL",
      });

      // Log corrective action with full evidence
      try {
        await admin.from("atenia_ai_actions").insert({
          organization_id: "a0000000-0000-0000-0000-000000000001",
          action_type: "WATCHDOG_EDGE_FUNCTION_DOWN",
          autonomy_tier: "AUTONOMOUS",
          reasoning: alertMsg,
          action_taken: "ALERT_EDGE_FUNCTION_LIVENESS",
          action_result: "CRITICAL",
          evidence: {
            dead_functions: deadFunctions,
            all_probes: livenessResults,
            checked_at: new Date().toISOString(),
          },
        });
      } catch (_) { /* non-fatal */ }

      // Enqueue remediation tasks for each dead function
      const today = new Date().toISOString().slice(0, 10);
      for (const dead of deadFunctions) {
        try {
          await admin.from("atenia_ai_remediation_queue").upsert(
            {
              action_type: "EDGE_FUNCTION_REDEPLOY",
              status: "PENDING",
              priority: 1, // highest priority
              payload: {
                function_name: dead.fn,
                probe_status: dead.status,
                probe_error: dead.error,
                source: "watchdog_liveness",
                detected_at: new Date().toISOString(),
              },
              dedupe_key: `EDGE_LIVENESS:${today}:${dead.fn}`,
              reason_code: "EDGE_FUNCTION_NOT_DEPLOYED",
            },
            { onConflict: "dedupe_key" }
          );
        } catch (_) { /* non-fatal */ }
      }
    }

    // ================================================================
    // 6) Log watchdog actions into atenia_ai_actions for audit trail
    // ================================================================
    for (const alert of alerts) {
      // Write AI action for each alert (audit trail)
      try {
        await admin.from("atenia_ai_actions").insert({
          organization_id: "a0000000-0000-0000-0000-000000000001",
          action_type: "WATCHDOG_ALERT",
          autonomy_tier: "AUTONOMOUS",
          reasoning: alert.message,
          action_taken: alert.title,
          action_result: alert.severity,
          evidence: {
            source: "atenia-cron-watchdog",
            alert_title: alert.title,
            alert_severity: alert.severity,
            watchdog_window: windowKey,
          },
        });
      } catch (_) { /* non-fatal */ }

      // Also create alert_instance
      try {
        await admin.from("alert_instances").insert({
          entity_type: "platform",
          entity_id: "00000000-0000-0000-0000-000000000000",
          owner_id: "00000000-0000-0000-0000-000000000000",
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          status: "PENDING",
          fired_at: new Date().toISOString(),
          alert_type: "WATCHDOG_INVARIANT",
          alert_source: "atenia-cron-watchdog",
          fingerprint: `watchdog_${alert.title.slice(0, 30)}_${new Date().toISOString().slice(0, 13)}`,
        });
      } catch (_) { /* non-fatal */ }
    }

    // Log corrective actions as AI actions
    if (results.daily_enqueue && (results.daily_enqueue as any).triggered) {
      try {
        await admin.from("atenia_ai_actions").insert({
          organization_id: "a0000000-0000-0000-0000-000000000001",
          action_type: "WATCHDOG_CORRECTIVE",
          autonomy_tier: "AUTONOMOUS",
          reasoning: "DAILY_ENQUEUE no se había ejecutado para el día Bogotá. Watchdog lo disparó.",
          action_taken: "TRIGGER_DAILY_ENQUEUE",
          action_result: (results.daily_enqueue as any).ok ? "OK" : "FAILED",
          evidence: { daily_enqueue: results.daily_enqueue },
        });
      } catch (_) { /* non-fatal */ }
    }

    if (results.heartbeat && (results.heartbeat as any).triggered) {
      try {
        await admin.from("atenia_ai_actions").insert({
          organization_id: "a0000000-0000-0000-0000-000000000001",
          action_type: "WATCHDOG_CORRECTIVE",
          autonomy_tier: "AUTONOMOUS",
          reasoning: `Heartbeat no se registraba en ${(results.heartbeat as any).gap_minutes}min. Watchdog lo disparó.`,
          action_taken: "TRIGGER_HEARTBEAT",
          action_result: (results.heartbeat as any).ok ? "OK" : "FAILED",
          evidence: { heartbeat: results.heartbeat },
        });
      } catch (_) { /* non-fatal */ }
    }

    if (Array.isArray(results.stale_cleaned) && (results.stale_cleaned as any[]).length > 0) {
      try {
        await admin.from("atenia_ai_actions").insert({
          organization_id: "a0000000-0000-0000-0000-000000000001",
          action_type: "WATCHDOG_CORRECTIVE",
          autonomy_tier: "AUTONOMOUS",
          reasoning: `${(results.stale_cleaned as any[]).length} runs RUNNING con lease expirado marcados como FAILED.`,
          action_taken: "CLEAN_STALE_RUNS",
          action_result: "OK",
          evidence: { stale_cleaned: results.stale_cleaned },
        });
      } catch (_) { /* non-fatal */ }
    }

    if (results.coverage_enqueued && Number(results.coverage_enqueued) > 0) {
      try {
        await admin.from("atenia_ai_actions").insert({
          organization_id: "a0000000-0000-0000-0000-000000000001",
          action_type: "WATCHDOG_CORRECTIVE",
          autonomy_tier: "AUTONOMOUS",
          reasoning: `${results.coverage_enqueued} items monitoreados sin sync en 24h encolados para remediación.`,
          action_taken: "ENQUEUE_MISSING_COVERAGE",
          action_result: "OK",
          evidence: { coverage: results.coverage, enqueued: results.coverage_enqueued },
        });
      } catch (_) { /* non-fatal */ }
    }
    results.alerts_fired = alerts.length;

    // ================================================================
    // 7) Mark watchdog run complete
    // ================================================================
    await admin.from("atenia_cron_runs").update({
      status: "OK",
      finished_at: new Date().toISOString(),
      details: results,
    }).eq("job_name", "WATCHDOG").eq("scheduled_for", windowKey);

    return new Response(JSON.stringify({ ok: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[watchdog] Fatal error:", msg);

    return new Response(JSON.stringify({ ok: false, error: msg.slice(0, 500) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
