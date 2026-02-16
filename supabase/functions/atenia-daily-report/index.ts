/**
 * Atenia Daily Ops Report — Autonomous daily orchestrator
 *
 * Runs daily at 08:30 COT (13:30 UTC), after daily sync expected convergence.
 * Executes all diagnostic tools, collects KPIs, and generates a structured TXT report.
 * Stores report in DB + storage bucket, logs DAILY_OPS_REPORT action.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Tool definitions ────────────────────────────────────────────────

interface ToolDef {
  name: string;
  label: string;
  fn: (sb: any) => Promise<Record<string, unknown>>;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function todayCOT(): string {
  const now = new Date();
  const cot = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return cot.toISOString().slice(0, 10);
}

// ─── Individual tool runners ─────────────────────────────────────────

async function toolHealthSnapshot(sb: any): Promise<Record<string, unknown>> {
  const { data, error } = await sb.rpc("daily_sync_health_snapshot", {
    p_days: 7,
    p_target_date: todayCOT(),
  });
  if (error) return { error: error.message };
  return data as Record<string, unknown>;
}

async function toolKPIReport(sb: any): Promise<Record<string, unknown>> {
  const { data } = await sb
    .from("atenia_ai_actions")
    .select("id, summary, evidence, created_at")
    .eq("action_type", "DAILY_SYNC_KPI_REPORT")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? { note: "No KPI report found for today" };
}

async function toolProviderStatus(sb: any): Promise<Record<string, unknown>> {
  const today = todayCOT();
  const { data: traces } = await sb
    .from("provider_sync_traces")
    .select("provider, success, error_code, latency_ms")
    .gte("created_at", `${today}T00:00:00Z`)
    .limit(500);

  if (!traces || traces.length === 0) return { note: "No provider traces today" };

  const providers: Record<string, { total: number; errors: number; avgLatency: number; errorCodes: Record<string, number> }> = {};
  for (const t of traces) {
    const p = t.provider || "unknown";
    if (!providers[p]) providers[p] = { total: 0, errors: 0, avgLatency: 0, errorCodes: {} };
    providers[p].total++;
    if (!t.success) {
      providers[p].errors++;
      const code = t.error_code || "UNKNOWN";
      providers[p].errorCodes[code] = (providers[p].errorCodes[code] || 0) + 1;
    }
    providers[p].avgLatency += (t.latency_ms || 0);
  }
  for (const p of Object.keys(providers)) {
    providers[p].avgLatency = Math.round(providers[p].avgLatency / providers[p].total);
  }
  return { providers, total_traces: traces.length };
}

async function toolRemediationQueue(sb: any): Promise<Record<string, unknown>> {
  const { data, count } = await sb
    .from("atenia_ai_remediation_queue")
    .select("status, action_type, attempts, last_error, work_item_id, provider", { count: "exact" })
    .in("status", ["PENDING", "RUNNING", "FAILED"])
    .limit(50);

  const statusCounts: Record<string, number> = {};
  for (const r of (data || [])) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  }
  return { total: count ?? 0, by_status: statusCounts, sample: (data || []).slice(0, 10) };
}

async function toolCronWatchdogStatus(sb: any): Promise<Record<string, unknown>> {
  const { data: cronRuns } = await sb
    .from("atenia_cron_runs")
    .select("job_name, status, started_at, finished_at, details")
    .order("started_at", { ascending: false })
    .limit(20);

  const { data: tasks } = await sb
    .from("atenia_ai_scheduled_tasks")
    .select("task_key, task_name, status, last_success_at, last_attempt_at, last_error, run_count")
    .limit(20);

  return {
    recent_cron_runs: cronRuns || [],
    scheduled_tasks: tasks || [],
  };
}

async function toolDeadLetterSummary(sb: any): Promise<Record<string, unknown>> {
  const { data } = await sb
    .from("sync_item_failure_tracker")
    .select("work_item_id, organization_id, consecutive_failures, last_failure_reason, dead_lettered, provider")
    .eq("dead_lettered", true)
    .order("consecutive_failures", { ascending: false })
    .limit(50);

  return { dead_lettered_items: data || [], count: (data || []).length };
}

async function toolPerOrgKPIs(sb: any): Promise<Record<string, unknown>> {
  const today = todayCOT();
  const { data: rows } = await sb
    .from("auto_sync_daily_ledger")
    .select("organization_id, status, started_at, finished_at, items_succeeded, items_failed, items_skipped, dead_letter_count, timeout_count, chain_id, is_continuation, failure_reason")
    .eq("run_date", today)
    .order("created_at", { ascending: true });

  if (!rows || rows.length === 0) return { note: "No ledger entries for today" };

  // Aggregate per org
  const orgMap: Record<string, any[]> = {};
  for (const r of rows) {
    const oid = r.organization_id;
    if (!orgMap[oid]) orgMap[oid] = [];
    orgMap[oid].push(r);
  }

  const orgs = Object.entries(orgMap).map(([orgId, rws]) => {
    const last = rws[rws.length - 1];
    const first = rws[0];
    const totalSucceeded = rws.reduce((s: number, r: any) => s + (r.items_succeeded || 0), 0);
    const totalFailed = rws.reduce((s: number, r: any) => s + (r.items_failed || 0), 0);
    const totalSkipped = rws.reduce((s: number, r: any) => s + (r.items_skipped || 0), 0);
    const totalDL = rws.reduce((s: number, r: any) => s + (r.dead_letter_count || 0), 0);
    const totalTO = rws.reduce((s: number, r: any) => s + (r.timeout_count || 0), 0);
    let convSec: number | null = null;
    if (first.started_at && last.finished_at) {
      convSec = Math.round((new Date(last.finished_at).getTime() - new Date(first.started_at).getTime()) / 1000);
    }
    return {
      org_id: orgId,
      fully_synced: last.status === "SUCCESS" && totalSkipped === 0,
      chain_length: rws.length,
      convergence_seconds: convSec,
      last_status: last.status,
      last_failure_reason: last.failure_reason,
      total_succeeded: totalSucceeded,
      total_failed: totalFailed,
      total_skipped: totalSkipped,
      dead_letter_count: totalDL,
      timeout_count: totalTO,
    };
  });

  return { orgs, count: orgs.length };
}

async function toolRecentActions(sb: any): Promise<Record<string, unknown>> {
  const today = todayCOT();
  const { data } = await sb
    .from("atenia_ai_actions")
    .select("id, action_type, status, summary, created_at, organization_id")
    .gte("created_at", `${today}T00:00:00Z`)
    .order("created_at", { ascending: false })
    .limit(50);

  const typeCounts: Record<string, number> = {};
  for (const a of (data || [])) {
    typeCounts[a.action_type] = (typeCounts[a.action_type] || 0) + 1;
  }
  return { total: (data || []).length, by_type: typeCounts, recent: (data || []).slice(0, 15) };
}

async function toolPreflightChecks(sb: any): Promise<Record<string, unknown>> {
  const { data } = await sb
    .from("atenia_preflight_checks")
    .select("id, trigger, overall_status, providers_tested, providers_passed, providers_failed, started_at, finished_at, duration_ms")
    .order("started_at", { ascending: false })
    .limit(5);
  return { recent_checks: data || [] };
}

async function toolDeepDives(sb: any): Promise<Record<string, unknown>> {
  const today = todayCOT();
  const { data } = await sb
    .from("atenia_deep_dives")
    .select("id, radicado, severity, status, diagnosis, root_cause, started_at, finished_at, duration_ms")
    .gte("started_at", `${today}T00:00:00Z`)
    .order("started_at", { ascending: false })
    .limit(20);
  return { today_deep_dives: data || [], count: (data || []).length };
}

async function toolE2eTests(sb: any): Promise<Record<string, unknown>> {
  const today = todayCOT();
  const { data } = await sb
    .from("atenia_e2e_test_results")
    .select("id, radicado, workflow_type, overall, trigger, started_at, duration_ms")
    .gte("started_at", `${today}T00:00:00Z`)
    .order("started_at", { ascending: false })
    .limit(20);
  return { today_e2e_tests: data || [], count: (data || []).length };
}

async function toolObservations(sb: any): Promise<Record<string, unknown>> {
  const today = todayCOT();
  const { data } = await sb
    .from("atenia_ai_observations")
    .select("id, kind, severity, title, created_at")
    .gte("created_at", `${today}T00:00:00Z`)
    .order("created_at", { ascending: false })
    .limit(30);

  const bySeverity: Record<string, number> = {};
  for (const o of (data || [])) {
    bySeverity[o.severity] = (bySeverity[o.severity] || 0) + 1;
  }
  return { total: (data || []).length, by_severity: bySeverity, recent: (data || []).slice(0, 10) };
}

async function toolIncidents(sb: any): Promise<Record<string, unknown>> {
  const { data } = await sb
    .from("atenia_ai_conversations")
    .select("id, title, status, severity, channel, created_at, resolved_at, action_count, observation_count")
    .in("status", ["OPEN", "IN_PROGRESS"])
    .order("created_at", { ascending: false })
    .limit(20);
  return { open_incidents: data || [], count: (data || []).length };
}

async function toolWorkItemFreshness(sb: any): Promise<Record<string, unknown>> {
  const { data } = await sb
    .from("work_items")
    .select("id, radicado, organization_id, last_synced_at, monitoring_enabled")
    .eq("monitoring_enabled", true)
    .not("radicado", "is", null)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(20);

  const stale = (data || []).filter((w: any) => {
    if (!w.last_synced_at) return true;
    const hours = (Date.now() - new Date(w.last_synced_at).getTime()) / (1000 * 60 * 60);
    return hours > 24;
  });

  return { stale_items: stale.length, total_monitored: (data || []).length, oldest: (data || []).slice(0, 5) };
}

// ─── Tool registry ───────────────────────────────────────────────────

function getTools(): ToolDef[] {
  return [
    { name: "HEALTH_SNAPSHOT", label: "Health Snapshot (7d)", fn: toolHealthSnapshot },
    { name: "KPI_REPORT", label: "Latest KPI Report", fn: toolKPIReport },
    { name: "PER_ORG_KPIS", label: "Per-Org KPIs (today)", fn: toolPerOrgKPIs },
    { name: "PROVIDER_STATUS", label: "Provider Status", fn: toolProviderStatus },
    { name: "REMEDIATION_QUEUE", label: "Remediation Queue", fn: toolRemediationQueue },
    { name: "DEAD_LETTER_SUMMARY", label: "Dead Letter Summary", fn: toolDeadLetterSummary },
    { name: "CRON_WATCHDOG", label: "Cron / Watchdog Status", fn: toolCronWatchdogStatus },
    { name: "PREFLIGHT_CHECKS", label: "Preflight Checks", fn: toolPreflightChecks },
    { name: "DEEP_DIVES", label: "Deep Dives (today)", fn: toolDeepDives },
    { name: "E2E_TESTS", label: "E2E Tests (today)", fn: toolE2eTests },
    { name: "OBSERVATIONS", label: "Observations (today)", fn: toolObservations },
    { name: "INCIDENTS", label: "Open Incidents", fn: toolIncidents },
    { name: "RECENT_ACTIONS", label: "Recent AI Actions", fn: toolRecentActions },
    { name: "WORK_ITEM_FRESHNESS", label: "Work Item Freshness", fn: toolWorkItemFreshness },
  ];
}

// ─── TXT Report Generator ────────────────────────────────────────────

interface ToolResult {
  name: string;
  label: string;
  status: "OK" | "ERROR";
  duration_ms: number;
  action_id?: string;
  output: Record<string, unknown>;
  error?: string;
}

function generateTxtReport(
  runDate: string,
  runId: string,
  results: ToolResult[],
  generatedAt: string,
): string {
  const lines: string[] = [];
  const ln = (s = "") => lines.push(s);

  ln("═══════════════════════════════════════════════════════════════════");
  ln("                  ATENIA DAILY OPS REPORT");
  ln("═══════════════════════════════════════════════════════════════════");
  ln(`Date:          ${runDate} (COT)`);
  ln(`Run ID:        ${runId}`);
  ln(`Generated at:  ${generatedAt}`);
  ln(`Environment:   production`);
  ln(`Tools run:     ${results.length}`);
  ln(`Tools OK:      ${results.filter(r => r.status === "OK").length}`);
  ln(`Tools ERROR:   ${results.filter(r => r.status === "ERROR").length}`);
  ln();

  // ─── SECTION 1: EXEC SUMMARY ──────────────────────────────────────
  ln("───────────────────────────────────────────────────────────────────");
  ln("SECTION 1 — EXECUTIVE SUMMARY");
  ln("───────────────────────────────────────────────────────────────────");

  const healthResult = results.find(r => r.name === "HEALTH_SNAPSHOT");
  const perOrgResult = results.find(r => r.name === "PER_ORG_KPIS");

  if (healthResult?.status === "OK") {
    const snap = healthResult.output;
    const summary = ((snap as any)?.platform_summary || [])[0];
    if (summary) {
      ln(`  pct_fully_synced:              ${summary.pct_fully_synced ?? "N/A"}%`);
      ln(`  p95_convergence_min:           ${summary.p95_convergence_min ?? "N/A"}`);
      ln(`  avg_chain_length:              ${summary.avg_chain_length ?? "N/A"}`);
      ln(`  total_dead_lettered:           ${summary.total_dead_lettered ?? 0}`);
      ln(`  total_timeouts:                ${summary.total_timeouts ?? 0}`);
      ln(`  orgs_long_chains (>=8):        ${summary.orgs_long_chains ?? 0}`);
      ln(`  p95_first_sync_min_midnight:   ${summary.p95_first_sync_min_after_midnight ?? "N/A"}`);
    }
    const problems = (snap as any)?.problem_orgs_today || [];
    ln(`  problem_orgs_today:            ${problems.length}`);
  } else {
    ln("  [Health snapshot unavailable]");
  }

  // Alerts
  const queueResult = results.find(r => r.name === "REMEDIATION_QUEUE");
  const incidentResult = results.find(r => r.name === "INCIDENTS");
  const dlResult = results.find(r => r.name === "DEAD_LETTER_SUMMARY");
  ln();
  ln("  Alerts:");
  if (queueResult?.status === "OK") ln(`    Remediation queue pending:  ${(queueResult.output as any)?.total ?? 0}`);
  if (incidentResult?.status === "OK") ln(`    Open incidents:            ${(incidentResult.output as any)?.count ?? 0}`);
  if (dlResult?.status === "OK") ln(`    Dead-lettered items:       ${(dlResult.output as any)?.count ?? 0}`);
  ln();

  // ─── SECTION 2: PLATFORM KPI REPORT ───────────────────────────────
  ln("───────────────────────────────────────────────────────────────────");
  ln("SECTION 2 — PLATFORM KPI REPORT (raw)");
  ln("───────────────────────────────────────────────────────────────────");
  const kpiResult = results.find(r => r.name === "KPI_REPORT");
  if (kpiResult?.status === "OK") {
    ln(`Source: atenia_ai_actions (action_type=DAILY_SYNC_KPI_REPORT)`);
    ln(`Action ID: ${(kpiResult.output as any)?.id ?? "N/A"}`);
    ln(`Created at: ${(kpiResult.output as any)?.created_at ?? "N/A"}`);
    ln("RAW_EVIDENCE_START");
    ln(JSON.stringify(kpiResult.output, null, 2));
    ln("RAW_EVIDENCE_END");
  } else {
    ln("  [No KPI report found]");
  }
  ln();

  // ─── SECTION 3: PER-ORG KPI TABLE ─────────────────────────────────
  ln("───────────────────────────────────────────────────────────────────");
  ln("SECTION 3 — PER-ORG KPI TABLE");
  ln("───────────────────────────────────────────────────────────────────");
  if (perOrgResult?.status === "OK") {
    const orgs = (perOrgResult.output as any)?.orgs || [];
    if (orgs.length > 0) {
      ln("org_id | synced | chain | conv_s | DL | TO | skipped | status");
      ln("-------|--------|-------|--------|----|----|---------|-------");
      for (const o of orgs) {
        ln(`${o.org_id.slice(0, 8)}... | ${o.fully_synced ? "YES" : "NO "} | ${String(o.chain_length).padStart(5)} | ${String(o.convergence_seconds ?? "N/A").padStart(6)} | ${String(o.dead_letter_count).padStart(2)} | ${String(o.timeout_count).padStart(2)} | ${String(o.total_skipped).padStart(7)} | ${o.last_status}`);
      }
    } else {
      ln("  [No orgs synced today]");
    }
  } else {
    ln("  [Per-org KPIs unavailable]");
  }

  // Dead-lettered items detail
  if (dlResult?.status === "OK") {
    const items = (dlResult.output as any)?.dead_lettered_items || [];
    if (items.length > 0) {
      ln();
      ln("Dead-Lettered Items:");
      for (const d of items) {
        ln(`  - ${d.work_item_id}: ${d.consecutive_failures} failures, reason=${d.last_failure_reason}, provider=${d.provider || "N/A"}`);
      }
    }
  }
  ln();

  // ─── SECTION 4: TOOL RUN MANIFEST ─────────────────────────────────
  ln("───────────────────────────────────────────────────────────────────");
  ln("SECTION 4 — TOOL RUN MANIFEST");
  ln("───────────────────────────────────────────────────────────────────");
  for (const r of results) {
    ln(`Tool:      ${r.label} (${r.name})`);
    ln(`Status:    ${r.status}`);
    ln(`Duration:  ${r.duration_ms}ms`);
    if (r.action_id) ln(`Action ID: ${r.action_id}`);
    if (r.error) ln(`Error:     ${r.error}`);
    ln("RAW_OUTPUT_START");
    try {
      const str = JSON.stringify(r.output, null, 2);
      // Truncate very large outputs
      ln(str.length > 5000 ? str.slice(0, 5000) + "\n... [TRUNCATED]" : str);
    } catch {
      ln("[Serialization error]");
    }
    ln("RAW_OUTPUT_END");
    ln();
  }

  // ─── SECTION 5: CRON / WATCHDOG / HEARTBEAT ────────────────────────
  ln("───────────────────────────────────────────────────────────────────");
  ln("SECTION 5 — CRON / WATCHDOG / HEARTBEAT STATUS");
  ln("───────────────────────────────────────────────────────────────────");
  const cronResult = results.find(r => r.name === "CRON_WATCHDOG");
  if (cronResult?.status === "OK") {
    const cronRuns = (cronResult.output as any)?.recent_cron_runs || [];
    const tasks = (cronResult.output as any)?.scheduled_tasks || [];
    ln("Recent cron runs:");
    for (const cr of cronRuns.slice(0, 10)) {
      ln(`  [${cr.status}] ${cr.job_name} — started=${cr.started_at}, finished=${cr.finished_at}`);
    }
    ln();
    ln("Scheduled tasks:");
    for (const t of tasks) {
      ln(`  [${t.status}] ${t.task_key} — last_success=${t.last_success_at}, runs=${t.run_count}`);
      if (t.last_error) ln(`    last_error: ${JSON.stringify(t.last_error).slice(0, 200)}`);
    }
  } else {
    ln("  [Cron/Watchdog data unavailable]");
  }
  ln();

  // ─── SECTION 6: ERRORS / ANOMALIES ────────────────────────────────
  ln("───────────────────────────────────────────────────────────────────");
  ln("SECTION 6 — ERRORS / ANOMALIES");
  ln("───────────────────────────────────────────────────────────────────");

  const errors: string[] = [];

  // Tool failures
  const failedTools = results.filter(r => r.status === "ERROR");
  if (failedTools.length > 0) {
    errors.push(`${failedTools.length} tool(s) failed: ${failedTools.map(t => t.name).join(", ")}`);
  }

  // Provider errors
  const provResult = results.find(r => r.name === "PROVIDER_STATUS");
  if (provResult?.status === "OK") {
    const providers = (provResult.output as any)?.providers || {};
    for (const [name, stats] of Object.entries(providers) as [string, any][]) {
      const errorRate = stats.total > 0 ? (stats.errors / stats.total * 100).toFixed(1) : 0;
      if (Number(errorRate) > 20) {
        errors.push(`Provider ${name}: ${errorRate}% error rate (${stats.errors}/${stats.total})`);
        const codes = Object.entries(stats.errorCodes || {}).map(([c, n]) => `${c}=${n}`).join(", ");
        if (codes) errors.push(`  Error codes: ${codes}`);
      }
    }
  }

  // Stale items
  const freshResult = results.find(r => r.name === "WORK_ITEM_FRESHNESS");
  if (freshResult?.status === "OK" && (freshResult.output as any)?.stale_items > 0) {
    errors.push(`${(freshResult.output as any).stale_items} work items stale > 24h`);
  }

  // Problem orgs
  if (healthResult?.status === "OK") {
    const problems = (healthResult.output as any)?.problem_orgs_today || [];
    if (problems.length > 0) {
      errors.push(`${problems.length} org(s) with sync problems today`);
      for (const p of problems.slice(0, 5)) {
        errors.push(`  ${p.organization_id.slice(0, 8)}...: status=${p.last_status}, skipped=${p.total_skipped}, DL=${p.total_dead_lettered}`);
      }
    }
  }

  if (errors.length === 0) {
    ln("  ✅ No anomalies detected.");
  } else {
    for (const e of errors) {
      ln(`  ⚠️  ${e}`);
    }
  }
  ln();

  ln("═══════════════════════════════════════════════════════════════════");
  ln("                      END OF REPORT");
  ln("═══════════════════════════════════════════════════════════════════");

  return lines.join("\n");
}

// ─── SHA-256 hash ────────────────────────────────────────────────────

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Health check
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch { /* empty body ok */ }

    if ((body as any)?.health_check) {
      return json({ ok: true, service: "atenia-daily-report", status: "healthy" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const runDate = todayCOT();
    const runId = crypto.randomUUID();
    const generatedAt = new Date().toISOString();

    console.log(`[atenia-daily-report] Starting daily ops report for ${runDate}, run_id=${runId}`);

    // Check idempotency — if a SUCCESS report already exists for today, skip
    const { data: existing } = await supabase
      .from("atenia_daily_ops_reports")
      .select("id, status")
      .eq("report_date", runDate)
      .eq("status", "SUCCESS")
      .maybeSingle();

    if (existing && !(body as any)?.force) {
      console.log(`[atenia-daily-report] Report already exists for ${runDate}, skipping.`);
      return json({ ok: true, skipped: true, existing_id: existing.id });
    }

    // Create RUNNING row
    const { data: reportRow, error: insertErr } = await supabase
      .from("atenia_daily_ops_reports")
      .insert({
        report_date: runDate,
        run_id: runId,
        status: "RUNNING",
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("[atenia-daily-report] Failed to create report row:", insertErr.message);
      return json({ ok: false, error: insertErr.message }, 500);
    }

    const reportId = reportRow.id;

    // ─── Execute all tools ───────────────────────────────────────────
    const tools = getTools();
    const results: ToolResult[] = [];
    const PLATFORM_ORG = "a0000000-0000-0000-0000-000000000001";

    for (const tool of tools) {
      const toolStart = Date.now();
      let output: Record<string, unknown> = {};
      let status: "OK" | "ERROR" = "OK";
      let error: string | undefined;
      let actionId: string | undefined;

      // Budget guard: stop if we're approaching 120s
      if (Date.now() - startTime > 110000) {
        results.push({
          name: tool.name,
          label: tool.label,
          status: "ERROR",
          duration_ms: 0,
          output: {},
          error: "BUDGET_EXHAUSTED",
        });
        continue;
      }

      try {
        output = await tool.fn(supabase);
      } catch (e: unknown) {
        status = "ERROR";
        error = e instanceof Error ? e.message : String(e);
        output = { error };
      }

      const duration = Date.now() - toolStart;

      // Log action for each tool
      try {
        const { data: actionRow } = await supabase
          .from("atenia_ai_actions")
          .insert({
            organization_id: PLATFORM_ORG,
            action_type: `DAILY_REPORT_TOOL_${tool.name}`,
            autonomy_tier: "OBSERVE",
            reasoning: `Herramienta del reporte diario: ${tool.label}`,
            status: status === "OK" ? "EXECUTED" : "FAILED",
            action_result: status === "OK" ? "logged" : error,
            evidence: { run_id: runId, report_date: runDate, duration_ms: duration, output_keys: Object.keys(output) },
          })
          .select("id")
          .maybeSingle();
        actionId = actionRow?.id;
      } catch { /* non-fatal */ }

      results.push({ name: tool.name, label: tool.label, status, duration_ms: duration, action_id: actionId, output, error });
    }

    // ─── Generate TXT ────────────────────────────────────────────────
    const txtContent = generateTxtReport(runDate, runId, results, generatedAt);
    const txtHash = await sha256Hex(txtContent);

    // ─── Upload to storage ───────────────────────────────────────────
    const storagePath = `${runDate}/atenia-daily-ops-report-${runId.slice(0, 8)}.txt`;
    let storageUploaded = false;
    try {
      const { error: uploadErr } = await supabase.storage
        .from("atenia-daily-reports")
        .upload(storagePath, new Blob([txtContent], { type: "text/plain" }), {
          contentType: "text/plain",
          upsert: true,
        });
      if (uploadErr) {
        console.warn("[atenia-daily-report] Storage upload failed:", uploadErr.message);
      } else {
        storageUploaded = true;
      }
    } catch (e) {
      console.warn("[atenia-daily-report] Storage upload error:", e);
    }

    // ─── Build summary ───────────────────────────────────────────────
    const summaryJson = {
      tools_run: results.length,
      tools_ok: results.filter(r => r.status === "OK").length,
      tools_failed: results.filter(r => r.status === "ERROR").length,
      total_duration_ms: Date.now() - startTime,
      errors: results.filter(r => r.status === "ERROR").map(r => ({ name: r.name, error: r.error })),
    };

    const runMetadata = {
      run_id: runId,
      run_date: runDate,
      generated_at: generatedAt,
      tool_manifest: results.map(r => ({
        name: r.name,
        label: r.label,
        status: r.status,
        duration_ms: r.duration_ms,
        action_id: r.action_id,
      })),
    };

    // ─── Update report row ───────────────────────────────────────────
    await supabase
      .from("atenia_daily_ops_reports")
      .update({
        status: "SUCCESS",
        txt_content: txtContent,
        txt_storage_path: storageUploaded ? storagePath : null,
        txt_sha256: txtHash,
        summary_json: summaryJson,
        raw_run_metadata_json: runMetadata,
      })
      .eq("id", reportId);

    // ─── Log DAILY_OPS_REPORT action ─────────────────────────────────
    await supabase.from("atenia_ai_actions").insert({
      organization_id: PLATFORM_ORG,
      action_type: "DAILY_OPS_REPORT",
      autonomy_tier: "OBSERVE",
      reasoning: `Reporte diario de operaciones generado: ${summaryJson.tools_ok}/${summaryJson.tools_run} herramientas OK.`,
      summary: `Daily Ops Report ${runDate}: ${summaryJson.tools_ok}/${summaryJson.tools_run} tools OK, ${summaryJson.tools_failed} failed`,
      status: "EXECUTED",
      action_result: "report_generated",
      evidence: {
        report_id: reportId,
        run_id: runId,
        storage_path: storagePath,
        txt_sha256: txtHash,
        ...summaryJson,
      },
      is_reversible: false,
    });

    const totalDuration = Date.now() - startTime;
    console.log(`[atenia-daily-report] Report generated in ${totalDuration}ms. ${summaryJson.tools_ok}/${summaryJson.tools_run} tools OK.`);

    return json({
      ok: true,
      report_id: reportId,
      run_id: runId,
      report_date: runDate,
      storage_path: storageUploaded ? storagePath : null,
      summary: summaryJson,
      duration_ms: totalDuration,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[atenia-daily-report] Fatal error:", msg);
    return json({ ok: false, error: msg, duration_ms: Date.now() - startTime }, 500);
  }
});
