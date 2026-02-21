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
import { startHeartbeat, finishHeartbeat, KNOWN_PLATFORM_JOBS } from "../_shared/platformJobHeartbeat.ts";

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

  // ── Record watchdog platform heartbeat ──
  const wdHbHandle = await startHeartbeat(admin, "atenia-cron-watchdog", "cron");

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
    // 5d) Per-Org Daily Sync Verification — ensure every active org
    //     has a ledger entry for today and no org was silently skipped
    // ================================================================
    const todayStr = getBogotaNow().toISOString().slice(0, 10);

    const { data: activeOrgs } = await admin
      .from("work_items")
      .select("organization_id")
      .eq("monitoring_enabled", true)
      .is("deleted_at", null)
      .not("radicado", "is", null);

    const activeOrgIds = [...new Set((activeOrgs ?? []).map((o: any) => o.organization_id).filter(Boolean))];

    if (activeOrgIds.length > 0 && bogotaHour >= 12) {
      const { data: todayLedger } = await admin
        .from("auto_sync_daily_ledger")
        .select("organization_id, status")
        .eq("run_date", todayStr);

      const ledgerOrgIds = new Set((todayLedger ?? []).map((l: any) => l.organization_id));
      const missingOrgs = activeOrgIds.filter((id: string) => !ledgerOrgIds.has(id));

      results.org_sync_verification = {
        active_orgs: activeOrgIds.length,
        ledger_entries: todayLedger?.length ?? 0,
        missing_orgs: missingOrgs.length,
      };

      if (missingOrgs.length > 0) {
        alerts.push({
          title: "⚠️ Organizaciones sin sync diario",
          message: `${missingOrgs.length} org(s) activa(s) sin entrada en ledger para hoy. IDs: ${missingOrgs.slice(0, 5).join(", ")}${missingOrgs.length > 5 ? "..." : ""}`,
          severity: "CRITICAL",
        });

        for (const orgId of missingOrgs.slice(0, 20)) {
          try {
            await admin.from("atenia_ai_remediation_queue").upsert(
              {
                action_type: "SYNC_ORG_DAILY",
                organization_id: orgId,
                status: "PENDING",
                priority: 2,
                payload: { source: "watchdog_org_verification", run_date: todayStr },
                dedupe_key: `ORG_DAILY:${todayStr}:${orgId}`,
              },
              { onConflict: "dedupe_key" }
            );
          } catch (_) { /* non-fatal */ }
        }
      }

      const failedLedger = (todayLedger ?? []).filter((l: any) => l.status === "FAILED");
      if (failedLedger.length > 0) {
        results.failed_ledger_entries = failedLedger.length;
        alerts.push({
          title: "⚠️ Sync diario fallido sin reintentar",
          message: `${failedLedger.length} org(s) con sync FAILED para hoy sin reintento exitoso.`,
          severity: "WARNING",
        });
      }
    }

    // ================================================================
    // 5e) Work Item Freshness Audit — catch items stale > 48h
    // ================================================================
    const CRITICAL_STALE_HOURS = 48;
    const staleCutoff48h = new Date(Date.now() - CRITICAL_STALE_HOURS * 60 * 60 * 1000).toISOString();

    const { count: criticallyStaleCount } = await admin
      .from("work_items")
      .select("id", { count: "exact", head: true })
      .eq("monitoring_enabled", true)
      .is("deleted_at", null)
      .not("radicado", "is", null)
      .or(`last_synced_at.is.null,last_synced_at.lt.${staleCutoff48h}`);

    const staleCount = criticallyStaleCount ?? 0;
    results.freshness_audit = {
      critically_stale_items: staleCount,
      threshold_hours: CRITICAL_STALE_HOURS,
    };

    if (staleCount > 0) {
      const fSeverity = staleCount > 50 ? "CRITICAL" : "WARNING";
      alerts.push({
        title: `⚠️ ${staleCount} items sin sync en ${CRITICAL_STALE_HOURS}h`,
        message: `${staleCount} work items monitoreados sin sync en más de ${CRITICAL_STALE_HOURS} horas.`,
        severity: fSeverity,
      });

      try {
        await admin.from("atenia_ai_actions").insert({
          organization_id: "a0000000-0000-0000-0000-000000000001",
          action_type: "WATCHDOG_FRESHNESS_AUDIT",
          autonomy_tier: "AUTONOMOUS",
          reasoning: `${staleCount} items monitoreados sin sync en ${CRITICAL_STALE_HOURS}h.`,
          action_taken: "FRESHNESS_AUDIT_ALERT",
          action_result: fSeverity,
          evidence: { stale_count: staleCount, threshold_hours: CRITICAL_STALE_HOURS },
        });
      } catch (_) { /* non-fatal */ }

      const { data: stalestItems } = await admin
        .from("work_items")
        .select("id, organization_id")
        .eq("monitoring_enabled", true)
        .is("deleted_at", null)
        .not("radicado", "is", null)
        .or(`last_synced_at.is.null,last_synced_at.lt.${staleCutoff48h}`)
        .order("last_synced_at", { ascending: true, nullsFirst: true })
        .limit(30);

      if (stalestItems && stalestItems.length > 0) {
        for (const item of stalestItems) {
          try {
            await admin.from("atenia_ai_remediation_queue").upsert(
              {
                action_type: "SYNC_WORK_ITEM",
                work_item_id: item.id,
                organization_id: item.organization_id,
                status: "PENDING",
                priority: 2,
                payload: { source: "watchdog_freshness_audit", threshold_hours: CRITICAL_STALE_HOURS },
                dedupe_key: `FRESH:${todayStr}:${item.id}`,
              },
              { onConflict: "dedupe_key" }
            );
          } catch (_) { /* non-fatal */ }
        }
        results.freshness_enqueued = stalestItems.length;
      }
    }

    // ================================================================
    // 5e2) LAYER 3A: Freshness vs Data Consistency (Sync Invariant Guard)
    // Catches regression: last_synced_at advancing while zero data present
    // ================================================================
    try {
      const { data: suspiciousItems } = await admin.rpc("execute_readonly_query" as any, {
        query_text: `
          SELECT wi.id, wi.workflow_type, wi.last_synced_at::text,
            (SELECT COUNT(*) FROM work_item_acts WHERE work_item_id = wi.id)::int as act_count,
            (SELECT COUNT(*) FROM work_item_publicaciones WHERE work_item_id = wi.id)::int as pub_count
          FROM work_items wi
          WHERE wi.monitoring_enabled = true
            AND wi.last_synced_at > NOW() - INTERVAL '48 hours'
            AND wi.created_at < NOW() - INTERVAL '24 hours'
            AND wi.deleted_at IS NULL
            AND (SELECT COUNT(*) FROM work_item_acts WHERE work_item_id = wi.id) = 0
          LIMIT 50
        `.trim(),
      }).catch(() => ({ data: null }));

      // Fallback: use direct query if RPC not available
      let freshnessViolations: any[] = [];
      if (suspiciousItems && Array.isArray(suspiciousItems)) {
        freshnessViolations = suspiciousItems;
      } else {
        // Direct query approach
        const { data: directCheck } = await admin
          .from("work_items")
          .select("id, workflow_type, last_synced_at")
          .eq("monitoring_enabled", true)
          .is("deleted_at", null)
          .gt("last_synced_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
          .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .limit(200);

        if (directCheck) {
          // Check each for zero acts (requires N queries, limit sample)
          for (const item of directCheck.slice(0, 50)) {
            const { count } = await admin
              .from("work_item_acts")
              .select("id", { count: "exact", head: true })
              .eq("work_item_id", item.id);
            if ((count ?? 0) === 0) {
              freshnessViolations.push({ ...item, act_count: 0 });
            }
          }
        }
      }

      results.freshness_vs_data = {
        violations: freshnessViolations.length,
      };

      if (freshnessViolations.length > 0) {
        const itemList = freshnessViolations.slice(0, 5).map((i: any) =>
          `${i.id} (${i.workflow_type})`
        ).join(", ");

        alerts.push({
          title: `🚨 [INVARIANT] ${freshnessViolations.length} items show synced but have zero data`,
          message: `last_synced_at is lying: ${freshnessViolations.length} monitored item(s) have recent last_synced_at but zero actuaciones. Sample: ${itemList}`,
          severity: "CRITICAL",
        });

        // Log as AI action for audit trail
        try {
          await admin.from("atenia_ai_actions").insert({
            organization_id: "a0000000-0000-0000-0000-000000000001",
            action_type: "WATCHDOG_INVARIANT_VIOLATION",
            autonomy_tier: "AUTONOMOUS",
            reasoning: `FRESHNESS_VS_DATA invariant violated: ${freshnessViolations.length} items with recent last_synced_at but zero acts.`,
            action_taken: "INVARIANT_ALERT_FIRED",
            action_result: "CRITICAL",
            evidence: {
              violation_type: "FRESHNESS_VS_DATA",
              count: freshnessViolations.length,
              sample: freshnessViolations.slice(0, 10).map((i: any) => ({
                id: i.id,
                workflow_type: i.workflow_type,
                last_synced_at: i.last_synced_at,
              })),
            },
          });
        } catch (_) { /* non-fatal */ }

        // Reset last_synced_at for affected items (auto-remediation)
        for (const item of freshnessViolations) {
          try {
            await admin.from("work_items").update({
              last_synced_at: null,
              last_error_code: "FRESHNESS_VS_DATA_VIOLATION",
            } as any).eq("id", item.id);
          } catch (_) { /* non-fatal */ }
        }
      }
    } catch (e) {
      console.warn("[watchdog] Freshness vs data check error:", e);
    }

    //
    // 5f) Fix D: Deep Dive TTL — auto-timeout RUNNING deep dives > 30min
    // ================================================================
    const DEEP_DIVE_TTL_MS = 30 * 60 * 1000; // 30 minutes
    const deepDiveCutoff = new Date(Date.now() - DEEP_DIVE_TTL_MS).toISOString();
    try {
      const { data: stuckDives } = await admin
        .from("atenia_deep_dives")
        .select("id, started_at, work_item_id, radicado, trigger_criteria")
        .eq("status", "RUNNING")
        .lt("started_at", deepDiveCutoff);

      let deepDivesTimedOut = 0;
      for (const dive of stuckDives ?? []) {
        const elapsed = Date.now() - new Date(dive.started_at).getTime();
        await admin.from("atenia_deep_dives").update({
          status: "TIMED_OUT",
          root_cause: "DEEP_DIVE_TTL_EXCEEDED",
          diagnosis: `Deep dive excedió TTL de 30min (elapsed: ${Math.round(elapsed / 60000)}min). Auto-terminado por watchdog.`,
          finished_at: new Date().toISOString(),
          duration_ms: elapsed,
        }).eq("id", dive.id);
        deepDivesTimedOut++;
      }
      results.deep_dive_ttl = { checked: stuckDives?.length ?? 0, timed_out: deepDivesTimedOut };
      if (deepDivesTimedOut > 0) {
        alerts.push({
          title: "⏱️ Deep dives con TTL excedido",
          message: `${deepDivesTimedOut} deep dive(s) RUNNING > 30min auto-terminado(s).`,
          severity: "WARNING",
        });
      }
    } catch (e) {
      console.warn("[watchdog] Deep dive TTL check error:", e);
    }

    // ================================================================
    // 5g) Fix E: Remediation Queue Liveness — reclaim stuck RUNNING items
    // ================================================================
    const REMEDIATION_STUCK_TTL_MS = 60 * 60 * 1000; // 1 hour (not 24h, be aggressive)
    const remediationStuckCutoff = new Date(Date.now() - REMEDIATION_STUCK_TTL_MS).toISOString();
    try {
      const { data: stuckJobs } = await admin
        .from("atenia_ai_remediation_queue")
        .select("id, work_item_id, action_type, attempts, max_attempts, updated_at, provider")
        .eq("status", "RUNNING")
        .lt("updated_at", remediationStuckCutoff);

      let remediationReclaimed = 0;
      let remediationFailed = 0;
      for (const job of stuckJobs ?? []) {
        const attempts = (job.attempts ?? 1) + 1;
        const maxAttempts = job.max_attempts ?? 3;
        if (attempts >= maxAttempts) {
          // Terminal: mark FAILED
          await admin.from("atenia_ai_remediation_queue").update({
            status: "FAILED",
            updated_at: new Date().toISOString(),
            last_error: "REMEDIATION_STUCK: RUNNING > 1h without progress, max attempts reached",
          }).eq("id", job.id);
          remediationFailed++;
        } else {
          // Reclaim: reset to PENDING with incremented attempt
          await admin.from("atenia_ai_remediation_queue").update({
            status: "PENDING",
            updated_at: new Date().toISOString(),
            attempts,
            run_after: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5min backoff
            last_error: `REMEDIATION_STUCK: Reclaimed by watchdog after RUNNING > 1h (attempt ${attempts}/${maxAttempts})`,
          }).eq("id", job.id);
          remediationReclaimed++;
        }
      }
      results.remediation_liveness = { stuck_found: stuckJobs?.length ?? 0, reclaimed: remediationReclaimed, failed: remediationFailed };
      if ((stuckJobs?.length ?? 0) > 0) {
        alerts.push({
          title: "🔧 Remediation queue items reclamados",
          message: `${stuckJobs!.length} item(s) RUNNING > 1h: ${remediationReclaimed} reclamados, ${remediationFailed} terminales.`,
          severity: "WARNING",
        });
      }
    } catch (e) {
      console.warn("[watchdog] Remediation liveness check error:", e);
    }

    // ================================================================
    // 5h) Fix F: Ghost Items — deterministic remediation
    // ================================================================
    try {
      // Find monitored items with no sync attempts ever
      const { data: ghostItems } = await admin
        .from("work_items")
        .select("id, organization_id, radicado, workflow_type, created_at, ghost_bootstrap_attempts")
        .eq("monitoring_enabled", true)
        .is("deleted_at", null)
        .is("last_synced_at", null)
        .is("last_attempted_sync_at", null)
        .not("radicado", "is", null)
        .limit(20);

      const GHOST_MAX_ATTEMPTS = 2;
      let ghostBootstrapped = 0;
      let ghostTerminalized = 0;

      for (const ghost of ghostItems ?? []) {
        const attempts = (ghost as any).ghost_bootstrap_attempts ?? 0;
        if (attempts >= GHOST_MAX_ATTEMPTS) {
          // Terminalize: disable monitoring
          await admin.from("work_items").update({
            monitoring_enabled: false,
            monitoring_disabled_reason: "GHOST_NO_INITIAL_SYNC",
            monitoring_disabled_at: new Date().toISOString(),
          } as any).eq("id", ghost.id);
          ghostTerminalized++;
        } else {
          // Enqueue one-time bootstrap sync
          const today = new Date().toISOString().slice(0, 10);
          await admin.from("atenia_ai_remediation_queue").upsert({
            action_type: "SYNC_WORK_ITEM",
            work_item_id: ghost.id,
            organization_id: ghost.organization_id,
            status: "PENDING",
            priority: 4,
            payload: { source: "watchdog_ghost_bootstrap", attempt: attempts + 1 },
            dedupe_key: `GHOST:${today}:${ghost.id}`,
          }, { onConflict: "dedupe_key" });
          // Increment bootstrap attempts
          await admin.from("work_items").update({
            ghost_bootstrap_attempts: attempts + 1,
          } as any).eq("id", ghost.id);
          ghostBootstrapped++;
        }
      }
      results.ghost_remediation = { found: ghostItems?.length ?? 0, bootstrapped: ghostBootstrapped, terminalized: ghostTerminalized };

      // Fix F: Only emit warning if there are NEW ghosts (not already terminalized/bootstrapped)
      if ((ghostItems?.length ?? 0) > 0 && ghostTerminalized > 0) {
        alerts.push({
          title: "👻 Ghost items terminalizados",
          message: `${ghostTerminalized} asunto(s) monitoreado(s) sin sync inicial deshabilitado(s) tras ${GHOST_MAX_ATTEMPTS} intentos.`,
          severity: "INFO",
        });
      }
    } catch (e) {
      console.warn("[watchdog] Ghost remediation error:", e);
    }

    // ================================================================
    // 5i) Fix G: Auto-escalate stale CRITICAL incidents
    // ================================================================
    try {
      const STALE_INCIDENT_HOURS = 48;
      const staleCutoffIncident = new Date(Date.now() - STALE_INCIDENT_HOURS * 60 * 60 * 1000).toISOString();

      const { data: staleIncidents } = await admin
        .from("atenia_ai_conversations")
        .select("id, title, severity, created_at, observation_count, action_count, status, organization_id")
        .eq("status", "OPEN")
        .eq("severity", "CRITICAL")
        .lt("created_at", staleCutoffIncident);

      let escalated = 0;
      for (const incident of staleIncidents ?? []) {
        const obsCount = incident.observation_count ?? 0;
        const actCount = incident.action_count ?? 0;
        if (obsCount > 0 && actCount === 0) {
          await admin.from("atenia_ai_actions").insert({
            organization_id: incident.organization_id ?? "a0000000-0000-0000-0000-000000000001",
            action_type: "STALE_INCIDENT_ESCALATION",
            autonomy_tier: "ACT",
            actor: "WATCHDOG",
            reasoning: `⚠️ Incidente CRITICAL "${incident.title}" abierto ${Math.round((Date.now() - new Date(incident.created_at).getTime()) / 3600000)}h con ${obsCount} observaciones y 0 acciones. Escalado automáticamente.`,
            action_result: "escalated",
            status: "EXECUTED",
            evidence: {
              incident_id: incident.id,
              age_hours: Math.round((Date.now() - new Date(incident.created_at).getTime()) / 3600000),
              observation_count: obsCount,
              action_count: actCount,
            },
          });
          await admin.from("atenia_ai_conversations").update({
            action_count: (actCount ?? 0) + 1,
            auto_escalated_at: new Date().toISOString(),
          }).eq("id", incident.id);
          escalated++;

          alerts.push({
            title: `🚨 Incidente CRITICAL escalado: ${incident.title?.slice(0, 50)}`,
            message: `Incidente abierto ${Math.round((Date.now() - new Date(incident.created_at).getTime()) / 3600000)}h con ${obsCount} observaciones sin acción. Requiere atención inmediata.`,
            severity: "CRITICAL",
          });
        }
      }
      results.stale_incident_escalation = { checked: staleIncidents?.length ?? 0, escalated };
    } catch (e) {
      console.warn("[watchdog] Stale incident escalation error:", e);
    }

    // ================================================================
    // 5j) Missed Platform Job Heartbeat Detection
    // ================================================================
    try {
      const missedJobs: string[] = [];
      for (const [jobName, config] of Object.entries(KNOWN_PLATFORM_JOBS)) {
        const windowMs = config.expectedIntervalMinutes * 60 * 1000;
        const cutoff = new Date(Date.now() - windowMs * 1.5).toISOString(); // 1.5x grace

        const { data: lastHb } = await admin
          .from("platform_job_heartbeats")
          .select("id, status, finished_at, started_at, error_code")
          .eq("job_name", jobName)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!lastHb) {
          // No heartbeat ever recorded — skip until first execution
          continue;
        }

        const lastAt = lastHb.finished_at ?? lastHb.started_at;
        if (new Date(lastAt) < new Date(cutoff)) {
          missedJobs.push(jobName);
        }

        // Detect stuck RUNNING jobs (started > expected interval ago, never finished)
        if (lastHb.status === "RUNNING" && new Date(lastHb.started_at) < new Date(cutoff)) {
          // Mark as TIMEOUT
          await admin.from("platform_job_heartbeats").update({
            status: "TIMEOUT",
            finished_at: new Date().toISOString(),
            error_message: `Auto-timeout by watchdog: RUNNING > ${config.expectedIntervalMinutes}min`,
          }).eq("id", lastHb.id);

          missedJobs.push(`${jobName}(STUCK)`);
        }

        // Detect repeated failures
        const { data: recentHbs } = await admin
          .from("platform_job_heartbeats")
          .select("status")
          .eq("job_name", jobName)
          .order("started_at", { ascending: false })
          .limit(3);

        const consecutiveErrors = (recentHbs ?? [])
          .filter((h: any) => h.status === "ERROR" || h.status === "TIMEOUT").length;

        if (consecutiveErrors >= 3) {
          alerts.push({
            title: `🚨 Job ${config.label} con fallos consecutivos`,
            message: `${jobName} ha fallado ${consecutiveErrors} veces consecutivas. Requiere intervención.`,
            severity: "CRITICAL",
          });

          // Create incident conversation (idempotent)
          const today = new Date().toISOString().slice(0, 10);
          const { data: existingIncident } = await admin
            .from("atenia_ai_conversations")
            .select("id")
            .eq("status", "OPEN")
            .eq("channel", "HEARTBEAT")
            .ilike("title", `%${jobName}%`)
            .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .limit(1)
            .maybeSingle();

          if (!existingIncident) {
            await admin.from("atenia_ai_conversations").insert({
              channel: "HEARTBEAT",
              scope: "PLATFORM",
              severity: "CRITICAL",
              status: "OPEN",
              title: `Job ${config.label} (${jobName}): ${consecutiveErrors} fallos consecutivos`,
            });
          }
        }
      }

      if (missedJobs.length > 0) {
        alerts.push({
          title: "⚠️ Jobs de plataforma sin heartbeat reciente",
          message: `${missedJobs.length} job(s) sin heartbeat dentro de su ventana esperada: ${missedJobs.join(", ")}`,
          severity: "WARNING",
        });
      }

      results.missed_heartbeats = { checked: Object.keys(KNOWN_PLATFORM_JOBS).length, missed: missedJobs };
    } catch (e) {
      console.warn("[watchdog] Missed heartbeat detection error:", e);
    }

    // ================================================================
    // 5k) LAYER 3: Trigger Health — check trigger_error_log for recent failures
    // ================================================================
    try {
      const triggerCheckCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // last hour
      const { data: triggerErrors } = await admin
        .from("trigger_error_log")
        .select("id, trigger_name, table_name, error_message, work_item_id, created_at")
        .gte("created_at", triggerCheckCutoff)
        .order("created_at", { ascending: false })
        .limit(50);

      const triggerErrorCount = triggerErrors?.length ?? 0;
      results.trigger_health = { errors_last_hour: triggerErrorCount };

      if (triggerErrorCount > 0) {
        const uniqueTriggers = [...new Set(triggerErrors!.map((e: any) => e.trigger_name))];
        const severity = triggerErrorCount > 10 ? "CRITICAL" : "WARNING";

        // Check if any are DATA_LOSS_DETECTED (from post-insert verification)
        const dataLossCount = triggerErrors!.filter((e: any) => 
          e.trigger_name === 'POST_INSERT_VERIFY'
        ).length;

        if (dataLossCount > 0) {
          alerts.push({
            title: "🚨 DATA LOSS: Trigger silently blocking inserts",
            message: `${dataLossCount} post-insert verification failure(s) detected — new data is NOT persisting to ${uniqueTriggers.join(", ")}. Immediate investigation required.`,
            severity: "CRITICAL",
          });
        } else {
          alerts.push({
            title: `⚠️ ${triggerErrorCount} trigger error(s) in last hour`,
            message: `Triggers failing: ${uniqueTriggers.join(", ")}. Latest: ${triggerErrors![0]?.error_message?.slice(0, 150)}`,
            severity,
          });
        }
      }
    } catch (e) {
      console.warn("[watchdog] Trigger health check error:", e);
    }

    for (const alert of alerts) {
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

    // ── Finish watchdog platform heartbeat ──
    await finishHeartbeat(admin, wdHbHandle, alerts.some(a => a.severity === "CRITICAL") ? "ERROR" : "OK", {
      metadata: { alerts_fired: alerts.length, checks: Object.keys(results).length },
    });

    return new Response(JSON.stringify({ ok: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[watchdog] Fatal error:", msg);

    // ── Record failure heartbeat ──
    await finishHeartbeat(admin, wdHbHandle, "ERROR", { errorMessage: msg.slice(0, 500) });

    return new Response(JSON.stringify({ ok: false, error: msg.slice(0, 500) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
