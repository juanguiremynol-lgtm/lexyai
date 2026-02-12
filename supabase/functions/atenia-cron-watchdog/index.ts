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
            ).then(() => {}).catch(() => {});
          }
          results.coverage_enqueued = missingRaw.length;
        }
      }
    }

    // ================================================================
    // 6) Write alerts
    // ================================================================
    for (const alert of alerts) {
      // Use platform-level alert (no specific work_item)
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
      }).catch(() => {});
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
