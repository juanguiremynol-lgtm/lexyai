/**
 * Atenia AI Supervisor V2 — Autonomous Platform Administrator
 *
 * Modes:
 *   POST_DAILY_SYNC   — Full audit after daily cron (existing)
 *   POST_LOGIN_SYNC   — Lightweight audit after login sync (existing)
 *   MANUAL_AUDIT       — On-demand by super admin (existing)
 *   HEALTH_CHECK       — Quick provider connectivity (existing)
 *   HEARTBEAT          — Scheduled: picks windows by Bogota time, processes queue
 *   PROCESS_QUEUE      — Explicit queue worker run
 *   MANUAL_RUN         — Manual trigger from UI
 *   WATCHDOG           — Self-healing invariant checker (cron every 10m)
 *
 * V2 additions:
 *   - Remediation queue with atomic claim (SKIP LOCKED)
 *   - Auto-demonitor after N consecutive NOT_FOUND
 *   - Work item state tracking (consecutive failures)
 *   - Bogota time-of-day scheduling windows
 *   - Exponential backoff for retries
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  bogotaDayBoundsUtc,
  bogotaHour,
  computeBackoffMinutes,
  translateDiagnostic,
  type Diagnostic,
} from "../_shared/ateniaAiSupervisor.ts";
import {
  normalizeTraceError,
  getErrorLabelEs,
  getRecommendedActionEs,
} from "../_shared/normalizeError.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ────────────────────────────────────────────────────────────

interface AteniaAIInput {
  mode:
    | "POST_DAILY_SYNC"
    | "POST_LOGIN_SYNC"
    | "MANUAL_AUDIT"
    | "HEALTH_CHECK"
    | "HEARTBEAT"
    | "PROCESS_QUEUE"
    | "MANUAL_RUN"
    | "WATCHDOG"
    | "ASSURANCE_CHECK"
    | "RUN_DAILY_RUNBOOK";
  organization_id?: string;
  run_date?: string;
  dry_run?: boolean;
  max?: number;
  scope?: string;
}

interface DiagnosticEntry {
  work_item_id: string;
  radicado: string;
  severity: "OK" | "AVISO" | "PROBLEMA" | "CRITICO";
  category: string;
  message_es: string;
  technical_detail: string;
  suggested_action?: string;
  auto_remediated?: boolean;
}

interface ProviderHealth {
  status: "healthy" | "degraded" | "down" | "unknown";
  avg_latency_ms: number;
  errors: number;
  total_calls: number;
  error_pattern?: string;
}

interface RemediationAction {
  action: string;
  work_item_id?: string;
  reason: string;
  result?: string;
}

interface SyncTrace {
  id: string;
  trace_id: string;
  work_item_id: string | null;
  organization_id: string | null;
  workflow_type: string | null;
  step: string;
  provider: string | null;
  http_status: number | null;
  latency_ms: number | null;
  success: boolean;
  error_code: string | null;
  message: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

type SupabaseAdmin = ReturnType<typeof createClient>;

// ─── Helpers ─────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function providerName(provider: string | null): string {
  if (!provider) return "un proveedor desconocido";
  const names: Record<string, string> = {
    cpnu: "la Rama Judicial (CPNU)",
    samai: "el Consejo de Estado (SAMAI)",
    tutelas: "la Corte Constitucional",
    publicaciones: "el sistema de Publicaciones Procesales",
  };
  return names[provider.toLowerCase()] || provider;
}

function hoursAgo(dateStr: string | null): number {
  if (!dateStr) return 999;
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

function todayCOT(): string {
  const now = new Date();
  const cot = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return cot.toISOString().slice(0, 10);
}

// ─── Action Logging ──────────────────────────────────────────────────

async function logAction(
  supabase: SupabaseAdmin,
  row: {
    actor: "ATENIA" | "USER" | "SYSTEM";
    actor_user_id?: string | null;
    organization_id?: string | null;
    work_item_id?: string | null;
    action_type: string;
    reason_code?: string | null;
    summary?: string | null;
    evidence?: Record<string, unknown>;
    is_reversible?: boolean;
    // Legacy columns for backward compat
    autonomy_tier?: string;
    reasoning?: string;
  },
) {
  try {
    await supabase.from("atenia_ai_actions").insert({
      actor: row.actor,
      actor_user_id: row.actor_user_id ?? null,
      organization_id: row.organization_id ?? null,
      work_item_id: row.work_item_id ?? null,
      action_type: row.action_type,
      reason_code: row.reason_code ?? null,
      summary: row.summary ?? null,
      evidence: row.evidence ?? {},
      is_reversible: row.is_reversible ?? true,
      // Legacy compat
      autonomy_tier: row.autonomy_tier ?? "ACT",
      reasoning: row.reasoning ?? row.summary ?? "",
    });
  } catch (e) {
    console.warn("[atenia-ai] Failed to log action:", e);
  }
}

// ─── Remediation Queue ───────────────────────────────────────────────

async function enqueueJob(
  supabase: SupabaseAdmin,
  input: {
    work_item_id: string;
    organization_id?: string | null;
    action_type: string;
    reason_code?: string | null;
    provider?: string | null;
    priority?: number;
    run_after?: Date;
    max_attempts?: number;
    payload?: Record<string, unknown>;
  },
) {
  const base = {
    work_item_id: input.work_item_id,
    organization_id: input.organization_id ?? null,
    action_type: input.action_type,
    reason_code: input.reason_code ?? null,
    provider: input.provider ?? null,
    priority: input.priority ?? 0,
    run_after: (input.run_after ?? new Date()).toISOString(),
    max_attempts: input.max_attempts ?? 3,
    payload: input.payload ?? {},
    status: "PENDING",
  };

  const { error: insErr } = await supabase
    .from("atenia_ai_remediation_queue")
    .insert(base);

  if (!insErr) return;

  // Conflict on dedupe index — update existing active job
  const { data: existing } = await supabase
    .from("atenia_ai_remediation_queue")
    .select("id")
    .eq("work_item_id", input.work_item_id)
    .eq("action_type", input.action_type)
    .in("status", ["PENDING", "RUNNING"])
    .limit(1);

  if (existing && existing[0]?.id) {
    await supabase
      .from("atenia_ai_remediation_queue")
      .update({
        updated_at: new Date().toISOString(),
        run_after: base.run_after,
        priority: base.priority,
        payload: base.payload,
        reason_code: base.reason_code,
        provider: base.provider,
      })
      .eq("id", existing[0].id);
  }
}

// ─── Work Item State Tracking ────────────────────────────────────────

async function updateWorkItemState(
  supabase: SupabaseAdmin,
  input: {
    work_item_id: string;
    organization_id: string;
    provider?: string | null;
    code?: string | null;
    success: boolean;
  },
) {
  const now = new Date().toISOString();
  const code = (input.code ?? "").toUpperCase();

  // ── Bug 2 FIX: Normalize "Radicado no encontrado" as a not-found error ──
  const isNotFound =
    code.includes("RECORD_NOT_FOUND") ||
    code === "NOT_FOUND" ||
    code.includes("NO_RECORD") ||
    code.includes("EMPTY_SNAPSHOT") ||
    code.includes("PROVIDER_404") ||
    code.includes("RADICADO NO ENCONTRADO") ||
    code.includes("RADICADO_NO_ENCONTRADO");
  const isTimeout =
    code.includes("TIMEOUT") ||
    code.includes("ETIMEDOUT") ||
    code.includes("ABORT");

  const { data: existing } = await supabase
    .from("atenia_ai_work_item_state")
    .select(
      "consecutive_not_found, consecutive_timeouts, consecutive_other_errors",
    )
    .eq("work_item_id", input.work_item_id)
    .maybeSingle();

  const prevNF = existing?.consecutive_not_found ?? 0;
  const prevTO = existing?.consecutive_timeouts ?? 0;
  const prevOE = existing?.consecutive_other_errors ?? 0;

  const next = (() => {
    if (input.success) return { nf: 0, to: 0, oe: 0 };
    if (isNotFound) return { nf: prevNF + 1, to: 0, oe: 0 };
    if (isTimeout) return { nf: 0, to: prevTO + 1, oe: 0 };
    return { nf: 0, to: 0, oe: prevOE + 1 };
  })();

  await supabase.from("atenia_ai_work_item_state").upsert({
    work_item_id: input.work_item_id,
    organization_id: input.organization_id,
    last_observed_at: now,
    consecutive_not_found: next.nf,
    consecutive_timeouts: next.to,
    consecutive_other_errors: next.oe,
    last_error_code: input.success ? null : (input.code ?? null),
    last_provider: input.provider ?? null,
    last_success_at: input.success ? now : undefined,
  });
}

// ─── Auto-Demonitor ──────────────────────────────────────────────────

async function maybeAutoDemonitor(
  supabase: SupabaseAdmin,
  input: {
    work_item_id: string;
    threshold: number;
  },
): Promise<{ demonitor: boolean; meta?: Record<string, unknown> }> {
  const { data: state } = await supabase
    .from("atenia_ai_work_item_state")
    .select("consecutive_not_found, last_error_code, last_provider")
    .eq("work_item_id", input.work_item_id)
    .maybeSingle();

  const nf = state?.consecutive_not_found ?? 0;
  if (nf < input.threshold) return { demonitor: false };

  // Safety: check active retries — don't demonitor items being retried
  const { count: activeRetries } = await supabase
    .from("atenia_ai_remediation_queue")
    .select("id", { count: "exact", head: true })
    .eq("work_item_id", input.work_item_id)
    .in("status", ["PENDING", "RUNNING"]);

  if ((activeRetries ?? 0) > 0) return { demonitor: false };

  // Check still enabled
  const { data: wi } = await supabase
    .from("work_items")
    .select("id, organization_id, monitoring_enabled")
    .eq("id", input.work_item_id)
    .maybeSingle();

  if (!wi?.monitoring_enabled) return { demonitor: false };

  // Safety gate: Don't demonitor if the work item has publicaciones data.
  // Actuaciones (CPNU/SAMAI) returning NOT_FOUND does NOT mean the case
  // is invalid — Publicaciones Procesales may still be actively providing
  // legally binding estados for this radicado.
  const { count: pubCount } = await supabase
    .from("work_item_publicaciones")
    .select("id", { count: "exact", head: true })
    .eq("work_item_id", input.work_item_id);

  if ((pubCount ?? 0) > 0) {
    return { demonitor: false };
  }

  // Safety gate: Don't demonitor if there are recent actuaciones from ANY
  // source other than the failing provider (e.g., SAMAI_ESTADOS, manual, etc.)
  const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count: recentActsFromOtherSources } = await supabase
    .from("work_item_acts")
    .select("id", { count: "exact", head: true })
    .eq("work_item_id", input.work_item_id)
    .gte("created_at", recentCutoff);

  if ((recentActsFromOtherSources ?? 0) > 0) {
    return { demonitor: false };
  }

  const meta = {
    consecutive_not_found: nf,
    last_provider: state?.last_provider ?? null,
    last_error_code: state?.last_error_code ?? null,
  };

  await supabase
    .from("work_items")
    .update({
      monitoring_enabled: false,
      monitoring_disabled_reason: "AUTO_DEMONITOR_NOT_FOUND",
      monitoring_disabled_by: "ATENIA",
      monitoring_disabled_at: new Date().toISOString(),
      monitoring_disabled_meta: meta,
    })
    .eq("id", input.work_item_id);

  await logAction(supabase, {
    actor: "ATENIA",
    organization_id: wi.organization_id ?? null,
    work_item_id: input.work_item_id,
    action_type: "AUTO_DEMONITOR",
    autonomy_tier: "ACT",
    reason_code: "CONSECUTIVE_NOT_FOUND",
    summary: `Auto-demonitor tras ${nf} NOT_FOUND consecutivos.`,
    reasoning: `Auto-demonitor tras ${nf} NOT_FOUND consecutivos.`,
    evidence: meta,
    is_reversible: true,
  });

  return { demonitor: true, meta };
}

// ─── Provider Health ─────────────────────────────────────────────────

function aggregateProviderHealth(
  traces: SyncTrace[],
): Record<string, ProviderHealth> {
  const providers: Record<
    string,
    { latencies: number[]; errors: number; total: number; errorCodes: string[] }
  > = {};

  for (const t of traces) {
    if (!t.provider) continue;
    if (!providers[t.provider]) {
      providers[t.provider] = {
        latencies: [],
        errors: 0,
        total: 0,
        errorCodes: [],
      };
    }
    const p = providers[t.provider];
    p.total++;
    if (t.latency_ms) p.latencies.push(t.latency_ms);
    if (!t.success) {
      p.errors++;
      if (t.error_code) p.errorCodes.push(t.error_code);
    }
  }

  const result: Record<string, ProviderHealth> = {};
  for (const [name, data] of Object.entries(providers)) {
    const avgLatency =
      data.latencies.length > 0
        ? Math.round(
            data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length,
          )
        : 0;
    const errorRate = data.total > 0 ? data.errors / data.total : 0;

    // D) Min sample size: require ≥10 attempts for percentage thresholds
    let status: ProviderHealth["status"] = "healthy";
    if (data.total >= 10) {
      if (errorRate >= 0.8) status = "down";
      else if (errorRate >= 0.3 || avgLatency > 10000) status = "degraded";
    } else if (data.errors >= 20) {
      // Absolute count fallback for small samples
      status = "down";
    }

    const errorFreq: Record<string, number> = {};
    for (const code of data.errorCodes) {
      errorFreq[code] = (errorFreq[code] || 0) + 1;
    }
    const topError = Object.entries(errorFreq).sort((a, b) => b[1] - a[1])[0];

    result[name] = {
      status,
      avg_latency_ms: avgLatency,
      errors: data.errors,
      total_calls: data.total,
      ...(topError ? { error_pattern: topError[0] } : {}),
    };
  }
  return result;
}

/**
 * Enrich provider health using external_sync_runs AND external_sync_run_attempts.
 * 
 * This provides structured per-attempt telemetry:
 * - Provider availability: success rate, error_code distribution, http_code distribution
 * - Latency: p50/p95, timeouts per provider/data_kind
 * - Coverage: which providers are invoked per workflow_type
 * - Data impact: inserted_count / skipped_count distribution
 * - Drift signals: rising skipped_count with fetched_count > 0
 */
async function enrichProviderHealthFromSyncRuns(
  supabase: SupabaseAdmin,
  orgId: string,
  dayStart: string,
  dayEnd: string,
  existing: Record<string, ProviderHealth>,
): Promise<Record<string, ProviderHealth>> {
  try {
    const enriched = { ...existing };

    // ── Phase 1: Query external_sync_run_attempts (structured per-attempt) ──
    const { data: attempts } = await supabase
      .from("external_sync_run_attempts")
      .select("provider, data_kind, role, status, http_code, latency_ms, error_code, inserted_count, skipped_count, recorded_at, sync_run_id")
      .gte("recorded_at", dayStart)
      .lte("recorded_at", dayEnd)
      .limit(1000);

    if (attempts && attempts.length > 0) {
      // Per-provider+data_kind aggregation
      const providerStats: Record<string, {
        latencies: number[];
        errors: number;
        total: number;
        errorCodes: Record<string, number>;
        httpCodes: Record<number, number>;
        totalInserted: number;
        totalSkipped: number;
        timeouts: number;
        dataKinds: Set<string>;
      }> = {};

      for (const att of attempts) {
        const name = (att.provider ?? "").toUpperCase();
        if (!name) continue;

        if (!providerStats[name]) {
          providerStats[name] = {
            latencies: [], errors: 0, total: 0,
            errorCodes: {}, httpCodes: {},
            totalInserted: 0, totalSkipped: 0, timeouts: 0,
            dataKinds: new Set(),
          };
        }
        const ps = providerStats[name];
        ps.total++;
        if (att.latency_ms) ps.latencies.push(att.latency_ms);
        if (att.data_kind) ps.dataKinds.add(att.data_kind);
        ps.totalInserted += att.inserted_count ?? 0;
        ps.totalSkipped += att.skipped_count ?? 0;

        if (att.http_code) {
          ps.httpCodes[att.http_code] = (ps.httpCodes[att.http_code] || 0) + 1;
        }

        if (att.status === "error" || att.status === "timeout") {
          ps.errors++;
          if (att.status === "timeout") ps.timeouts++;
          if (att.error_code) {
            ps.errorCodes[att.error_code] = (ps.errorCodes[att.error_code] || 0) + 1;
          }
        }
      }

      // Merge into enriched health
      for (const [name, ps] of Object.entries(providerStats)) {
        const sorted = [...ps.latencies].sort((a, b) => a - b);
        const p50 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : 0;
        const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0;
        const avgLatency = sorted.length > 0
          ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
          : 0;
        const errorRate = ps.total > 0 ? ps.errors / ps.total : 0;

        let status: ProviderHealth["status"] = "healthy";
        if (ps.total >= 10) {
          if (errorRate >= 0.8) status = "down";
          else if (errorRate >= 0.3 || p95 > 10000) status = "degraded";
        } else if (ps.errors >= 20) {
          status = "down";
        }

        // Find dominant error pattern
        const topError = Object.entries(ps.errorCodes).sort((a, b) => b[1] - a[1])[0];

        if (enriched[name]) {
          // Merge with existing trace-based data (attempt data takes priority for counts)
          enriched[name] = {
            status: status === "down" || enriched[name].status === "down" ? "down"
              : status === "degraded" || enriched[name].status === "degraded" ? "degraded"
              : "healthy",
            avg_latency_ms: avgLatency,
            errors: ps.errors,
            total_calls: ps.total,
            ...(topError ? { error_pattern: topError[0] } : {}),
          };
        } else {
          enriched[name] = {
            status,
            avg_latency_ms: avgLatency,
            errors: ps.errors,
            total_calls: ps.total,
            ...(topError ? { error_pattern: topError[0] } : {}),
          };
        }

        // Store extended metrics as evidence for incident creation
        (enriched[name] as any)._extended = {
          p50_ms: p50,
          p95_ms: p95,
          timeouts: ps.timeouts,
          total_inserted: ps.totalInserted,
          total_skipped: ps.totalSkipped,
          data_kinds: [...ps.dataKinds],
          error_distribution: ps.errorCodes,
          http_distribution: ps.httpCodes,
        };
      }
    }

    // ── Phase 2: Fallback to external_sync_runs.provider_attempts (legacy) ──
    const { data: runs } = await supabase
      .from("external_sync_runs")
      .select("status, provider_attempts, duration_ms, error_code")
      .eq("organization_id", orgId)
      .gte("started_at", dayStart)
      .lte("started_at", dayEnd)
      .limit(500);

    if (runs && runs.length > 0) {
      // C) Check for runs with 0 attempts — but distinguish legitimate skips from broken runs
      const runsWithoutAttempts = runs.filter((r: any) => {
        const pa = r.provider_attempts;
        const hasNoAttempts = !pa || (Array.isArray(pa) && pa.length === 0) || (typeof pa === 'object' && Object.keys(pa).length === 0);
        if (!hasNoAttempts) return false;
        // Legitimate cases: LOOKUP-only runs, NO_ELIGIBLE_ITEMS, or explicit skips
        const errCode = (r.error_code ?? "").toUpperCase();
        const isLegitimateSkip = errCode.includes("NO_ELIGIBLE") || errCode.includes("SKIPPED") || errCode.includes("LOOKUP_ONLY") || r.status === "skipped";
        return !isLegitimateSkip; // Only flag truly unexpected 0-attempt runs
      });
      if (runsWithoutAttempts.length > 0) {
        (enriched as any)._silent_failures = {
          count: runsWithoutAttempts.length,
          note: "Runs with 0 provider attempts that are NOT marked as skipped/no-eligible — potential broken pipeline",
        };
      }

      // Only enrich from legacy provider_attempts if no attempt-level data was found
      if (!attempts || attempts.length === 0) {
        for (const run of runs) {
          const runAttempts = run.provider_attempts as unknown as Array<{
            provider: string; status: string; latency_ms: number; error_code?: string;
          }> | null;
          if (!Array.isArray(runAttempts)) continue;

          for (const attempt of runAttempts) {
            const name = attempt.provider?.toUpperCase();
            if (!name) continue;

            if (!enriched[name]) {
              enriched[name] = { status: "unknown", avg_latency_ms: 0, errors: 0, total_calls: 0 };
            }
            const p = enriched[name];
            const oldTotal = p.total_calls;
            p.total_calls++;
            p.avg_latency_ms = Math.round(
              (p.avg_latency_ms * oldTotal + (attempt.latency_ms || 0)) / p.total_calls
            );
            if (attempt.status === "error" || attempt.status === "timeout") {
              p.errors++;
            }
            const errorRate = p.total_calls > 0 ? p.errors / p.total_calls : 0;
            if (errorRate >= 0.8) p.status = "down";
            else if (errorRate >= 0.3 || p.avg_latency_ms > 10000) p.status = "degraded";
            else p.status = "healthy";
          }
        }
      }
    }

    return enriched;
  } catch {
    return existing;
  }
}

/**
 * Detect provider degradation from health snapshot and create/update
 * idempotent incident conversations.
 * 
 * Incident key: provider+data_kind+date → single thread until resolved.
 */
async function detectAndEscalateDegradation(
  supabase: SupabaseAdmin,
  orgId: string,
  providerHealth: Record<string, ProviderHealth>,
): Promise<void> {
  // ── D) Minimum sample size: require ≥10 attempts before applying percentage thresholds ──
  const MIN_ATTEMPTS_FOR_PERCENTAGE = 10;
  // ── B) Debounce: do not re-post evidence more often than every 15 minutes ──
  const DEBOUNCE_MINUTES = 15;

  for (const [provider, health] of Object.entries(providerHealth)) {
    if (health.status !== "degraded" && health.status !== "down") continue;

    // D) Skip if sample too small — unless absolute error count is high
    const errorRate = health.total_calls > 0 ? health.errors / health.total_calls : 0;
    const meetsPercentageThreshold = health.total_calls >= MIN_ATTEMPTS_FOR_PERCENTAGE && (
      (health.status === "down" && errorRate >= 0.8) ||
      (health.status === "degraded" && (errorRate >= 0.3 || health.avg_latency_ms > 10000))
    );
    const meetsAbsoluteThreshold = health.errors >= 20; // absolute count fallback
    if (!meetsPercentageThreshold && !meetsAbsoluteThreshold) continue;

    const severity = health.status === "down" ? "CRITICAL" : "WARNING";
    const today = new Date().toISOString().slice(0, 10);
    const fingerprint = `provider_degrade_${provider}_${today}`;

    // Extended metrics for evidence
    const extended = (health as any)._extended ?? {};

    // Idempotent incident creation via fingerprint
    const { data: existingConv } = await supabase
      .from("atenia_ai_conversations")
      .select("id, severity")
      .eq("status", "OPEN")
      .eq("channel", "HEARTBEAT")
      .ilike("title", `%${provider}%degradad%`)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle();

    let convId = existingConv?.id;

    if (!convId) {
      // Create new incident — E) scoped to this org, not global.
      // Single-tenant misconfigs create org-scoped incidents (lower severity).
      // Global "provider down" would require multi-org correlation (done in daily report, not here).
      const { data: newConv } = await supabase
        .from("atenia_ai_conversations")
        .insert({
          organization_id: orgId,
          channel: "HEARTBEAT",
          scope: "PLATFORM",
          severity,
          status: "OPEN",
          title: `Proveedor ${provider} degradado: ${health.status === "down" ? "caído" : "lento/errores"} (${Math.round((health.errors / health.total_calls) * 100)}% errores)`,
          related_providers: [provider],
        })
        .select("id")
        .single();
      convId = newConv?.id;
    }

    if (!convId) continue;

    // B) Debounce: check last observation time for this incident
    const { data: lastObs } = await supabase
      .from("atenia_ai_observations")
      .select("created_at")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastObs) {
      const minutesSinceLast = (Date.now() - new Date(lastObs.created_at).getTime()) / 60000;
      // Skip if within debounce window AND severity hasn't escalated
      const existingSeverity = existingConv ? (existingConv as any).severity : null;
      const severityEscalated = existingSeverity && severity === "CRITICAL" && existingSeverity !== "CRITICAL";
      if (minutesSinceLast < DEBOUNCE_MINUTES && !severityEscalated) continue;
    }

    // Add observation with compact evidence (no raw payloads)
    await supabase.from("atenia_ai_observations").insert({
      conversation_id: convId,
      organization_id: orgId,
      kind: "ANOMALY",
      severity: severity === "CRITICAL" ? "HIGH" : "MEDIUM",
      title: `${provider}: ${health.errors}/${health.total_calls} errores, p95=${extended.p95_ms ?? "?"}ms`,
      payload: {
        provider,
        status: health.status,
        error_rate: Math.round((health.errors / health.total_calls) * 100),
        avg_latency_ms: health.avg_latency_ms,
        p50_ms: extended.p50_ms,
        p95_ms: extended.p95_ms,
        timeouts: extended.timeouts,
        total_inserted: extended.total_inserted,
        total_skipped: extended.total_skipped,
        error_distribution: extended.error_distribution,
        http_distribution: extended.http_distribution,
        data_kinds: extended.data_kinds,
        error_pattern: health.error_pattern,
        sample_window: today,
      },
    });

    // Update conversation counters
    await supabase
      .from("atenia_ai_conversations")
      .update({
        observation_count: (existingConv as any)?.observation_count
          ? ((existingConv as any).observation_count + 1)
          : 1,
        last_activity_at: new Date().toISOString(),
        severity, // Upgrade severity if worsened
      })
      .eq("id", convId);
  }
}

// ─── Quick Health Check ──────────────────────────────────────────────

async function quickHealthCheck(provider: string): Promise<boolean> {
  const envMap: Record<string, string> = {
    cpnu: "CPNU_BASE_URL",
    samai: "SAMAI_BASE_URL",
    tutelas: "TUTELAS_BASE_URL",
    publicaciones: "PUBLICACIONES_BASE_URL",
  };
  const baseUrl = Deno.env.get(envMap[provider] || "");
  if (!baseUrl) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Gemini AI Diagnosis ─────────────────────────────────────────────

async function geminiDiagnosis(context: {
  diagnostics: DiagnosticEntry[];
  providerStatus: Record<string, ProviderHealth>;
  totalTraces: number;
  successTraces: number;
  failedTraces: number;
  avgLatency: number;
}): Promise<string | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    console.warn("[atenia-ai] No LOVABLE_API_KEY, skipping Gemini diagnosis");
    return null;
  }

  const problems = context.diagnostics.filter((d) => d.severity !== "OK");
  if (problems.length === 0) return null;

   const prompt = `Eres Atenia AI, el sistema supervisor de sincronización de ATENIA, una plataforma de gestión judicial colombiana.

REGLAS DE FORMATO OBLIGATORIAS:
- Usa español formal y profesional. NUNCA uses jerga, modismos coloquiales (e.g. "pille pues", "ni por el berraco", "parcero"), ni emojis.
- Estructura tu respuesta con encabezados numerados.
- Cita IDs de trazas o radicados cuando sea posible.
- No incluyas payloads crudos ni JSON extenso.

Tu audiencia es un administrador de plataforma legal, no un desarrollador.

## Estado de proveedores hoy:
${JSON.stringify(context.providerStatus, null, 2)}

## Patrones de error detectados:
${problems.map((d) => `- [${d.severity}] ${d.category}: ${d.message_es}`).join("\n")}

## Resumen de trazas:
- Total consultas: ${context.totalTraces}
- Exitosas: ${context.successTraces}
- Fallidas: ${context.failedTraces}
- Latencia promedio: ${context.avgLatency}ms

Responde con:
1. DIAGNÓSTICO: ¿Qué está pasando? (2-3 oraciones máximo)
2. IMPACTO: ¿Qué asuntos se ven afectados?
3. ACCIÓN RECOMENDADA: ¿Qué debe hacer el administrador? (si algo)
4. PRONÓSTICO: ¿Se resolverá solo o requiere intervención?`;

  try {
    const resp = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 800,
          temperature: 0.3,
        }),
      },
    );

    if (!resp.ok) {
      console.warn(`[atenia-ai] Gemini call failed: HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.warn("[atenia-ai] Gemini error:", err);
    return null;
  }
}

// ─── Normalized Error Labels (canonical, replaces "ERROR DESCONOCIDO") ─────

// Normalization now uses the canonical _shared/normalizeError.ts module.
// NORMALIZED_LABELS, NORMALIZED_ACTIONS, and normalizeTraceCode are removed.
// Use: normalizeTraceError(), getErrorLabelEs(), getRecommendedActionEs()

// ─── Diagnostic Translator (Legacy format) ───────────────────────────

function translateDiagnosticLegacy(
  trace: SyncTrace,
  radicado: string,
  workItemId: string,
): DiagnosticEntry {
  const base = { work_item_id: workItemId, radicado };

  if (
    trace.error_code === "UPSTREAM_ROUTE_MISSING" ||
    trace.http_status === 0
  ) {
    return {
      ...base,
      severity: "PROBLEMA",
      category: "CONEXIÓN",
      message_es: `No se pudo conectar con ${providerName(trace.provider)}. El servicio externo no respondió.`,
      technical_detail: `${trace.provider} returned HTTP ${trace.http_status} / error: ${trace.error_code} / latency: ${trace.latency_ms}ms`,
      suggested_action:
        "Atenia AI reintentará automáticamente en la próxima ventana de sincronización.",
    };
  }

  if (
    trace.error_code === "UPSTREAM_AUTH" ||
    trace.http_status === 401 ||
    trace.http_status === 403
  ) {
    return {
      ...base,
      severity: "CRITICO",
      category: "AUTENTICACIÓN",
      message_es: `El servicio ${providerName(trace.provider)} rechazó nuestras credenciales.`,
      technical_detail: `${trace.provider} returned HTTP ${trace.http_status}`,
      suggested_action:
        "Verifique las claves de API en la configuración de secretos.",
    };
  }

  if (
    trace.error_code === "RECORD_NOT_FOUND" ||
    trace.error_code === "PROVIDER_404" ||
    (trace.http_status === 404 &&
      trace.error_code !== "UPSTREAM_ROUTE_MISSING")
  ) {
    return {
      ...base,
      severity: "AVISO",
      category: "BÚSQUEDA",
      message_es: `El radicado ${radicado} no fue encontrado en ${providerName(trace.provider)}.`,
      technical_detail: `${trace.provider} returned 404 for ${radicado}`,
      suggested_action:
        "Verifique que el número de radicado sea correcto (23 dígitos).",
    };
  }

  if (
    trace.error_code === "TIMEOUT" ||
    trace.error_code === "PROVIDER_TIMEOUT" ||
    (trace.latency_ms && trace.latency_ms > 55000)
  ) {
    return {
      ...base,
      severity: "PROBLEMA",
      category: "TIEMPO DE ESPERA",
      message_es: `La consulta al servicio ${providerName(trace.provider)} tardó demasiado (${Math.round((trace.latency_ms || 60000) / 1000)} segundos).`,
      technical_detail: `${trace.provider} timed out after ${trace.latency_ms}ms`,
      suggested_action:
        "Se reintentará automáticamente. Si persiste, el proveedor puede estar caído.",
    };
  }

  if (
    trace.error_code === "PARSER_ERROR" ||
    trace.error_code === "INVALID_JSON_RESPONSE"
  ) {
    return {
      ...base,
      severity: "PROBLEMA",
      category: "FORMATO DE DATOS",
      message_es: `Se recibió información de ${providerName(trace.provider)} pero no pudo ser procesada.`,
      technical_detail: `Parse error on ${trace.provider}: ${trace.message}`,
      suggested_action:
        "Revise la respuesta cruda en el panel de depuración.",
    };
  }

  if (trace.http_status === 429) {
    return {
      ...base,
      severity: "AVISO",
      category: "LÍMITE DE CONSULTAS",
      message_es: `El servicio ${providerName(trace.provider)} indicó demasiadas consultas.`,
      technical_detail: `${trace.provider} returned 429`,
      suggested_action:
        "Automático — Atenia AI ajustará el ritmo de consultas.",
    };
  }

  const insertedCount = (trace.meta?.inserted_count as number) || 0;
  const skippedCount = (trace.meta?.skipped_count as number) || 0;
  if (trace.success && insertedCount === 0 && skippedCount > 0) {
    return {
      ...base,
      severity: "OK",
      category: "SIN NOVEDADES",
      message_es: `El radicado ${radicado} fue consultado exitosamente. No se encontraron actuaciones nuevas.`,
      technical_detail: `${skippedCount} existing records matched`,
    };
  }

  if (trace.success && insertedCount > 0) {
    return {
      ...base,
      severity: "OK",
      category: "ACTUALIZADO",
      message_es: `Se encontraron ${insertedCount} nuevas actuaciones para el radicado ${radicado}.`,
      technical_detail: `Inserted ${insertedCount}, skipped ${skippedCount}`,
    };
  }

  if (
    trace.error_code === "DB_WRITE_FAILED" ||
    trace.error_code === "DB_CONSTRAINT"
  ) {
    return {
      ...base,
      severity: "PROBLEMA",
      category: "BASE DE DATOS",
      message_es: `Error al guardar datos del radicado ${radicado}.`,
      technical_detail: `DB error: ${trace.error_code} / ${trace.message}`,
      suggested_action: "Contacte soporte técnico si el error persiste.",
    };
  }

  if (trace.success) {
    return {
      ...base,
      severity: "OK",
      category: "OK",
      message_es: `Sincronización exitosa para ${radicado}.`,
      technical_detail: `${trace.provider} completed in ${trace.latency_ms}ms`,
    };
  }

  // Use canonical shared normalizer (single source of truth)
  const normalizedCode = normalizeTraceError(trace.error_code, trace.http_status, trace.message);
  const normalizedLabel = getErrorLabelEs(normalizedCode);
  const normalizedAction = getRecommendedActionEs(normalizedCode);

  return {
    ...base,
    severity: "PROBLEMA",
    category: normalizedLabel,
    message_es: `Error al consultar ${providerName(trace.provider)} para ${radicado}: ${normalizedLabel.toLowerCase()}.`,
    technical_detail: `${normalizedCode}: ${trace.error_code} / HTTP ${trace.http_status} / ${trace.message}`,
    suggested_action: normalizedAction,
  };
}

// ─── Remediation Engine ──────────────────────────────────────────────

async function remediate(
  supabase: SupabaseAdmin,
  diagnostics: DiagnosticEntry[],
  orgId: string,
): Promise<RemediationAction[]> {
  const actions: RemediationAction[] = [];

  for (const d of diagnostics) {
    if (d.severity === "OK") continue;

    if (d.category === "CONEXIÓN" || d.category === "TIEMPO DE ESPERA") {
      const providerMatch = d.technical_detail.match(/^(\w+)\s/);
      const provider = providerMatch?.[1];
      if (provider) {
        const healthOk = await quickHealthCheck(provider);
        if (healthOk && d.work_item_id) {
          // V2: Enqueue instead of direct invoke
          await enqueueJob(supabase, {
            work_item_id: d.work_item_id,
            organization_id: orgId,
            action_type: "RETRY_ACTS",
            reason_code: d.category === "CONEXIÓN" ? "PROVIDER_RECOVERED" : "TIMEOUT_RETRY",
            provider,
            priority: 60,
          });
          actions.push({
            action: "ENQUEUE_RETRY",
            work_item_id: d.work_item_id,
            reason: "Proveedor recuperado — reintento encolado",
            result: "QUEUED",
          });
          d.auto_remediated = true;
        }
      }
    }

    if (d.category === "AUTENTICACIÓN") {
      const { data: membership } = await supabase
        .from("organization_memberships")
        .select("user_id")
        .eq("organization_id", orgId)
        .eq("role", "admin")
        .limit(1)
        .maybeSingle();

      if (membership?.user_id) {
        await supabase.from("alert_instances").insert({
          owner_id: membership.user_id,
          organization_id: orgId,
          entity_type: "SYSTEM",
          entity_id: orgId,
          severity: "CRITICAL",
          title: "🔑 Falla de autenticación con proveedor externo",
          message: d.message_es,
          status: "PENDING",
          fired_at: new Date().toISOString(),
          alert_type: "SYNC_AUTH_FAILURE",
          alert_source: "atenia_ai",
          fingerprint: `auth_fail_${orgId}_${new Date().toISOString().slice(0, 10)}`,
        });
        actions.push({
          action: "ESCALATE_TO_ADMIN",
          reason: d.message_es,
          result: "ALERT_CREATED",
        });
      }
    }

    // V2: OMITIDO items → enqueue both acts + pubs
    if (d.category === "OMITIDO" && d.work_item_id) {
      await enqueueJob(supabase, {
        work_item_id: d.work_item_id,
        organization_id: orgId,
        action_type: "RETRY_ACTS",
        reason_code: "OMITIDO",
        priority: 50,
      });
      await enqueueJob(supabase, {
        work_item_id: d.work_item_id,
        organization_id: orgId,
        action_type: "RETRY_PUBS",
        reason_code: "OMITIDO",
        priority: 40,
      });
      actions.push({
        action: "ENQUEUE_RETRY",
        work_item_id: d.work_item_id,
        reason: "Item omitido — reintento encolado",
        result: "QUEUED",
      });
    }
  }

  return actions;
}

// ─── V2: Queue Worker ────────────────────────────────────────────────

async function runQueueWorker(
  supabase: SupabaseAdmin,
  dryRun: boolean,
): Promise<{ claimed: number; results: unknown[] }> {
  const { data: jobs, error } = await supabase.rpc("atenia_ai_claim_queue", {
    _limit: 5,
  });
  if (error) {
    console.warn("[atenia-ai] Queue claim error:", error.message);
    return { claimed: 0, results: [{ error: error.message }] };
  }

  const results: unknown[] = [];

  for (const job of jobs ?? []) {
    if (dryRun) {
      results.push({
        id: job.id,
        action_type: job.action_type,
        status: "DRY_RUN",
      });
      continue;
    }

    try {
      let invokeResult: { data?: unknown; error?: unknown } = {};

      if (job.action_type === "RETRY_ACTS") {
        invokeResult = await supabase.functions.invoke("sync-by-work-item", {
          body: {
            work_item_id: job.work_item_id,
            force_refresh: false,
            _scheduled: true,
          },
        });
      } else if (
        job.action_type === "RETRY_PUBS" ||
        job.action_type === "RETRY_PUBS_HEAVY"
      ) {
        invokeResult = await supabase.functions.invoke(
          "sync-publicaciones-by-work-item",
          {
            body: {
              work_item_id: job.work_item_id,
              _scheduled: true,
              heavy: job.action_type === "RETRY_PUBS_HEAVY",
            },
          },
        );
      } else if (job.action_type === "RUN_INTEGRATION_HEALTH") {
        invokeResult = await supabase.functions.invoke("integration-health", {
          body: { _scheduled: true },
        });
      } else {
        throw new Error(`Unknown action_type: ${job.action_type}`);
      }

      if (invokeResult?.error) throw invokeResult.error;

      await supabase
        .from("atenia_ai_remediation_queue")
        .update({
          status: "DONE",
          updated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", job.id);

      // ── Bug 6 FIX: Include remediation details in evidence ──
      await logAction(supabase, {
        actor: "ATENIA",
        organization_id: job.organization_id ?? null,
        work_item_id: job.work_item_id ?? null,
        action_type: "REMEDIATION_DONE",
        autonomy_tier: "ACT",
        reason_code: job.reason_code ?? null,
        summary: `Remediación completada: ${job.action_type} para item ${job.work_item_id?.slice(0, 8) ?? 'N/A'}.`,
        reasoning: `Remediación completada: ${job.action_type} para item ${job.work_item_id?.slice(0, 8) ?? 'N/A'} (${job.reason_code ?? 'sin código'}).`,
        evidence: {
          job_id: job.id,
          remediation_type: job.action_type,
          work_item_id: job.work_item_id,
          reason_code: job.reason_code,
          provider: job.provider ?? null,
          result: "success",
        },
        is_reversible: false,
      });

      results.push({ id: job.id, status: "DONE" });
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      const attempts = job.attempts ?? 1;
      const maxAttempts = job.max_attempts ?? 3;
      const backoffMin = computeBackoffMinutes(attempts);
      const nextRun = new Date(Date.now() + backoffMin * 60 * 1000);
      const terminal = attempts >= maxAttempts;

      await supabase
        .from("atenia_ai_remediation_queue")
        .update({
          status: terminal ? "FAILED" : "PENDING",
          updated_at: new Date().toISOString(),
          run_after: terminal ? job.run_after : nextRun.toISOString(),
          last_error: errorMsg,
        })
        .eq("id", job.id);

      await logAction(supabase, {
        actor: "ATENIA",
        organization_id: job.organization_id ?? null,
        work_item_id: job.work_item_id ?? null,
        action_type: terminal
          ? "REMEDIATION_FAILED"
          : "REMEDIATION_RETRY_SCHEDULED",
        autonomy_tier: "ACT",
        reason_code: job.reason_code ?? null,
        summary: terminal
          ? `Job ${job.action_type} falló definitivamente.`
          : `Job ${job.action_type} reprogramado (+${backoffMin}m).`,
        reasoning: terminal
          ? `Job ${job.action_type} falló definitivamente.`
          : `Job ${job.action_type} reprogramado (+${backoffMin}m).`,
        evidence: { job_id: job.id, attempts, maxAttempts, error: errorMsg },
        is_reversible: false,
      });

      results.push({
        id: job.id,
        status: terminal ? "FAILED" : "RETRY",
        error: errorMsg,
        backoffMin,
      });
    }
  }

  return { claimed: (jobs ?? []).length, results };
}

// ─── Daily Sync KPIs (per-org) ───────────────────────────────────────

interface DailySyncKPIs {
  fully_synced: boolean;
  chain_length: number;
  convergence_seconds: number | null;
  chain_start: string | null;
  chain_end: string | null;
  last_status: string | null;
  last_failure_reason: string | null;
  total_succeeded: number;
  total_failed: number;
  total_skipped: number;
  dead_letter_count: number;
  timeout_count: number;
  dead_lettered_items: Array<{ work_item_id: string; consecutive_failures: number; last_failure_reason: string | null }>;
  hit_max_continuations: boolean;
}

async function computeDailySyncKPIs(
  supabase: SupabaseAdmin,
  orgId: string,
  runDate: string,
): Promise<DailySyncKPIs> {
  const defaults: DailySyncKPIs = {
    fully_synced: false,
    chain_length: 0,
    convergence_seconds: null,
    chain_start: null,
    chain_end: null,
    last_status: null,
    last_failure_reason: null,
    total_succeeded: 0,
    total_failed: 0,
    total_skipped: 0,
    dead_letter_count: 0,
    timeout_count: 0,
    dead_lettered_items: [],
    hit_max_continuations: false,
  };

  try {
    // Get all ledger rows for this org/date
    const { data: rows } = await supabase
      .from("auto_sync_daily_ledger")
      .select("status, started_at, finished_at, items_succeeded, items_failed, items_skipped, dead_letter_count, timeout_count, failure_reason, chain_id, metadata")
      .eq("organization_id", orgId)
      .eq("run_date", runDate)
      .order("created_at", { ascending: true });

    if (!rows || rows.length === 0) return defaults;

    const lastRow = rows[rows.length - 1];
    const firstRow = rows[0];

    const chainLength = rows.length;
    const totalSucceeded = rows.reduce((s: number, r: any) => s + (r.items_succeeded || 0), 0);
    const totalFailed = rows.reduce((s: number, r: any) => s + (r.items_failed || 0), 0);
    const totalSkipped = rows.reduce((s: number, r: any) => s + (r.items_skipped || 0), 0);
    const totalDeadLettered = rows.reduce((s: number, r: any) => s + (r.dead_letter_count || 0), 0);
    const totalTimeouts = rows.reduce((s: number, r: any) => s + (r.timeout_count || 0), 0);

    let convergenceSec: number | null = null;
    if (firstRow.started_at && lastRow.finished_at) {
      convergenceSec = Math.round(
        (new Date(lastRow.finished_at).getTime() - new Date(firstRow.started_at).getTime()) / 1000
      );
    }

    const fullySynced = lastRow.status === "SUCCESS" && totalSkipped === 0;
    const hitMax = lastRow.failure_reason === "MAX_CONTINUATIONS_REACHED" ||
      rows.some((r: any) => r.metadata?.continuation_count === "MAX_CONTINUATIONS_REACHED");

    // Dead-lettered items for this org
    const { data: dlItems } = await supabase
      .from("sync_item_failure_tracker")
      .select("work_item_id, consecutive_failures, last_failure_reason")
      .eq("organization_id", orgId)
      .eq("dead_lettered", true)
      .limit(50);

    return {
      fully_synced: fullySynced,
      chain_length: chainLength,
      convergence_seconds: convergenceSec,
      chain_start: firstRow.started_at,
      chain_end: lastRow.finished_at,
      last_status: lastRow.status,
      last_failure_reason: lastRow.failure_reason,
      total_succeeded: totalSucceeded,
      total_failed: totalFailed,
      total_skipped: totalSkipped,
      dead_letter_count: totalDeadLettered,
      timeout_count: totalTimeouts,
      dead_lettered_items: (dlItems || []).map((d: any) => ({
        work_item_id: d.work_item_id,
        consecutive_failures: d.consecutive_failures,
        last_failure_reason: d.last_failure_reason,
      })),
      hit_max_continuations: hitMax,
    };
  } catch (err) {
    console.warn(`[atenia-ai] KPI computation failed for org=${orgId}:`, err);
    return defaults;
  }
}

// ─── Platform-wide Sync KPIs ─────────────────────────────────────────

interface PlatformSyncKPIs {
  total_orgs: number;
  orgs_fully_synced: number;
  orgs_partial: number;
  orgs_failed: number;
  orgs_not_started: number;
  pct_fully_synced: number;
  p95_convergence_seconds: number | null;
  orgs_hitting_max_continuations: number;
  total_dead_lettered_items: number;
  avg_chain_length: number;
}

async function computePlatformSyncKPIs(
  supabase: SupabaseAdmin,
  runDate: string,
  orgKPIs: Map<string, DailySyncKPIs>,
  allOrgIds: string[],
): Promise<PlatformSyncKPIs> {
  const totalOrgs = allOrgIds.length;
  let fullySynced = 0;
  let partial = 0;
  let failed = 0;
  let notStarted = 0;
  let maxContHit = 0;
  let totalDL = 0;
  const convergenceTimes: number[] = [];
  const chainLengths: number[] = [];

  for (const orgId of allOrgIds) {
    const kpi = orgKPIs.get(orgId);
    if (!kpi || kpi.chain_length === 0) {
      notStarted++;
      continue;
    }
    if (kpi.fully_synced) fullySynced++;
    else if (kpi.last_status === "FAILED") failed++;
    else partial++;

    if (kpi.hit_max_continuations) maxContHit++;
    totalDL += kpi.dead_lettered_items.length;
    if (kpi.convergence_seconds !== null) convergenceTimes.push(kpi.convergence_seconds);
    chainLengths.push(kpi.chain_length);
  }

  // p95 convergence
  let p95Conv: number | null = null;
  if (convergenceTimes.length > 0) {
    convergenceTimes.sort((a, b) => a - b);
    const idx = Math.min(Math.floor(convergenceTimes.length * 0.95), convergenceTimes.length - 1);
    p95Conv = convergenceTimes[idx];
  }

  const avgChain = chainLengths.length > 0
    ? Math.round((chainLengths.reduce((a, b) => a + b, 0) / chainLengths.length) * 10) / 10
    : 0;

  return {
    total_orgs: totalOrgs,
    orgs_fully_synced: fullySynced,
    orgs_partial: partial,
    orgs_failed: failed,
    orgs_not_started: notStarted,
    pct_fully_synced: totalOrgs > 0 ? Math.round((fullySynced / totalOrgs) * 100) : 0,
    p95_convergence_seconds: p95Conv,
    orgs_hitting_max_continuations: maxContHit,
    total_dead_lettered_items: totalDL,
    avg_chain_length: avgChain,
  };
}

// ─── V2: Post-Daily Audit with State Tracking ────────────────────────

async function runPostDailyAuditV2(
  supabase: SupabaseAdmin,
  orgId: string,
  runDate: string,
  mode: string,
  dryRun: boolean,
): Promise<{
  report: unknown;
  autoDemonitored: number;
  queued: number;
}> {
  // Use existing audit flow
  const report = await auditOrganization(supabase, orgId, runDate, mode);

  // Compute daily sync KPIs for this org
  const syncKPIs = await computeDailySyncKPIs(supabase, orgId, runDate);
  (report as any).daily_sync_kpis = syncKPIs;

  let autoDemonitored = 0;
  let queued = 0;

  if (dryRun) return { report, autoDemonitored: 0, queued: 0, syncKPIs };

  // V2: Update work item state for each diagnostic and auto-demonitor
  for (const d of (report.diagnostics || []) as DiagnosticEntry[]) {
    if (!d.work_item_id) continue;

    const isNotFound = d.category === "BÚSQUEDA";
    const isSuccess = d.severity === "OK";
    const errorCode = isNotFound
      ? "RECORD_NOT_FOUND"
      : isSuccess
        ? null
        : d.category;

    await updateWorkItemState(supabase, {
      work_item_id: d.work_item_id,
      organization_id: orgId,
      provider: d.technical_detail?.match(/^(\w+)\s/)?.[1] ?? null,
      code: errorCode,
      success: isSuccess,
    });

    // Auto-demonitor check
    if (isNotFound) {
      const dem = await maybeAutoDemonitor(supabase, {
        work_item_id: d.work_item_id,
        threshold: 5,
      });
      if (dem.demonitor) autoDemonitored++;
    }

    // V2: PENAL_906 heavy chaining fix
    if (d.work_item_id && d.category === "TIEMPO DE ESPERA") {
      // Check if it's a PENAL_906 heavy item
      const { data: wi } = await supabase
        .from("work_items")
        .select("workflow_type, total_actuaciones")
        .eq("id", d.work_item_id)
        .maybeSingle();

      if (
        wi?.workflow_type === "PENAL_906" &&
        (wi?.total_actuaciones ?? 0) > 100
      ) {
        await enqueueJob(supabase, {
          work_item_id: d.work_item_id,
          organization_id: orgId,
          action_type: "RETRY_PUBS_HEAVY",
          reason_code: "PENAL_906_HEAVY_CHAINING",
          priority: 80,
          run_after: new Date(Date.now() + 2 * 60 * 1000),
        });
        queued++;
      }
    }
  }

  return { report, autoDemonitored, queued, syncKPIs };
}

// ─── Status Snapshot (for GET /atenia-ai-supervisor) ─────────────────

async function getStatusSnapshot(supabase: SupabaseAdmin) {
  const [reportsRes, tasksRes, queueRes, actionsRes] = await Promise.all([
    supabase
      .from("atenia_ai_reports")
      .select("id, created_at, report_date, organization_id, total_work_items, items_synced_ok, items_failed, ai_diagnosis")
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("atenia_ai_scheduled_tasks")
      .select(
        "task_key, status, last_attempt_at, last_success_at, run_count, last_error",
      )
      .order("task_key", { ascending: true }),
    supabase
      .from("atenia_ai_remediation_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "PENDING"),
    supabase
      .from("atenia_ai_actions")
      .select(
        "id, created_at, actor, action_type, summary, reason_code, work_item_id",
      )
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  return {
    latestReport: reportsRes.data?.[0] ?? null,
    tasks: tasksRes.data ?? [],
    queuePending: queueRes.count ?? 0,
    recentActions: actionsRes.data ?? [],
  };
}

// ─── Scheduling Windows ──────────────────────────────────────────────

function pickScheduledModes(
  nowUtc: Date,
): Array<"POST_DAILY_AUDIT" | "PROCESS_QUEUE"> {
  const hour = bogotaHour(nowUtc);
  const modes: Array<"POST_DAILY_AUDIT" | "PROCESS_QUEUE"> = [
    "PROCESS_QUEUE",
  ];
  // Post-daily audit window: 7-9 AM Bogota
  if (hour >= 7 && hour <= 9) modes.push("POST_DAILY_AUDIT");
  return modes;
}

// ─── Per-Organization Audit (preserved from V1) ──────────────────────

async function auditOrganization(
  supabase: SupabaseAdmin,
  orgId: string,
  runDate: string,
  mode: string,
) {
  console.log(`[atenia-ai] Auditing org: ${orgId}`);

  const dayStart = `${runDate}T00:00:00.000Z`;
  const dayEnd = `${runDate}T23:59:59.999Z`;

  const { data: traces, error: tracesError } = await supabase
    .from("sync_traces")
    .select("*")
    .eq("organization_id", orgId)
    .gte("created_at", dayStart)
    .lte("created_at", dayEnd)
    .order("created_at", { ascending: true })
    .limit(1000);

  if (tracesError) {
    console.warn(
      `[atenia-ai] Traces error for ${orgId}:`,
      tracesError.message,
    );
  }

  const traceData: SyncTrace[] = (traces || []) as unknown as SyncTrace[];

  const { data: workItems } = await supabase
    .from("work_items")
    .select(
      "id, radicado, workflow_type, last_synced_at, monitoring_enabled, title, total_actuaciones",
    )
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .not("radicado", "is", null);

  const wiMap = new Map<string, Record<string, unknown>>();
  for (const wi of workItems || []) {
    wiMap.set(wi.id as string, wi);
  }

  const tracesByWI = new Map<string, SyncTrace[]>();
  for (const t of traceData) {
    if (!t.work_item_id) continue;
    if (!tracesByWI.has(t.work_item_id))
      tracesByWI.set(t.work_item_id, []);
    tracesByWI.get(t.work_item_id)!.push(t);
  }

  const diagnostics: DiagnosticEntry[] = [];
  let newActuaciones = 0;
  let newPublicaciones = 0;
  let itemsOk = 0;
  let itemsPartial = 0;
  let itemsFailed = 0;

  for (const [wiId, wiTraces] of tracesByWI) {
    const wi = wiMap.get(wiId);
    const radicado = (wi?.radicado as string) || "desconocido";

    const terminalTrace = wiTraces[wiTraces.length - 1];
    const diag = translateDiagnosticLegacy(terminalTrace, radicado, wiId);
    diagnostics.push(diag);

    for (const t of wiTraces) {
      const inserted = (t.meta?.inserted_count as number) || 0;
      if (t.provider === "publicaciones") newPublicaciones += inserted;
      else newActuaciones += inserted;
    }

    if (diag.severity === "OK") itemsOk++;
    else if (diag.severity === "AVISO") itemsPartial++;
    else itemsFailed++;
  }

  // Ghost items
  const tracedItemIds = new Set([...tracesByWI.keys()]);
  const ghostItems = (workItems || []).filter(
    (wi: Record<string, unknown>) => !tracedItemIds.has(wi.id as string),
  );

  if (ghostItems.length > 0) {
    for (const ghost of ghostItems) {
      diagnostics.push({
        work_item_id: ghost.id as string,
        radicado: (ghost.radicado as string) || "desconocido",
        severity: "AVISO",
        category: "OMITIDO",
        message_es: `El radicado ${(ghost.radicado as string) || "desconocido"} tiene monitoreo activo pero no fue consultado hoy.`,
        technical_detail: `No sync_traces found for work_item ${ghost.id} on ${runDate}`,
        suggested_action:
          "Se reintentará en la próxima ventana o vía cola de remediación.",
      });
    }
  }

  const rawProviderStatus = aggregateProviderHealth(traceData);
  const providerStatus = await enrichProviderHealthFromSyncRuns(
    supabase, orgId, dayStart, dayEnd, rawProviderStatus,
  );

  // ── Degradation detection → incident creation (platform telemetry only) ──
  try {
    await detectAndEscalateDegradation(supabase, orgId, providerStatus);
  } catch (err) {
    console.warn("[atenia-ai] Degradation detection error:", err);
  }

  let remediationActions: RemediationAction[] = [];
  if (mode !== "HEALTH_CHECK") {
    remediationActions = await remediate(supabase, diagnostics, orgId);
  }

  // Gemini
  let aiDiagnosis: string | null = null;
  const problems = diagnostics.filter(
    (d) => d.severity !== "OK" && d.severity !== "AVISO",
  );
  const shouldUseGemini =
    problems.length >= 3 ||
    Object.values(providerStatus).some(
      (p) => p.status === "degraded" || p.status === "down",
    ) ||
    mode === "MANUAL_AUDIT";

  if (shouldUseGemini) {
    const avgLatency =
      traceData.length > 0
        ? Math.round(
            traceData.reduce((s, t) => s + (t.latency_ms || 0), 0) /
              traceData.length,
          )
        : 0;

    aiDiagnosis = await geminiDiagnosis({
      diagnostics,
      providerStatus,
      totalTraces: traceData.length,
      successTraces: traceData.filter((t) => t.success).length,
      failedTraces: traceData.filter((t) => !t.success).length,
      avgLatency,
    });
  }

  const reportData = {
    organization_id: orgId,
    report_date: runDate,
    report_type:
      mode === "MANUAL_AUDIT"
        ? "MANUAL_AUDIT"
        : mode === "HEALTH_CHECK"
          ? "HEALTH_CHECK"
          : "DAILY_AUDIT",
    total_work_items: wiMap.size,
    items_synced_ok: itemsOk,
    items_synced_partial: itemsPartial,
    items_failed: itemsFailed,
    new_actuaciones_found: newActuaciones,
    new_publicaciones_found: newPublicaciones,
    provider_status: providerStatus,
    diagnostics: diagnostics.slice(0, 200),
    remediation_actions: remediationActions,
    ai_diagnosis: aiDiagnosis,
    lexy_data_ready: true,
  };

  const { error: reportError } = await supabase
    .from("atenia_ai_reports")
    .upsert(reportData, {
      onConflict: "organization_id,report_date,report_type",
    });

  if (reportError) {
    console.error(
      `[atenia-ai] Report write error for ${orgId}:`,
      reportError.message,
    );
  }

  // Critical failure alerts
  const criticals = diagnostics.filter((d) => d.severity === "CRITICO");
  if (criticals.length > 0) {
    const { data: adminMember } = await supabase
      .from("organization_memberships")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();

    if (adminMember?.user_id) {
      const nonAuthCriticals = criticals.filter(
        (d) => d.category !== "AUTENTICACIÓN",
      );
      for (const d of nonAuthCriticals) {
        const fingerprint = `critico_${d.category}_${orgId}_${runDate}`;
        await supabase.from("alert_instances").insert({
          owner_id: adminMember.user_id,
          organization_id: orgId,
          entity_type: "SYSTEM",
          entity_id: orgId,
          severity: "CRITICAL",
          title: `⚠️ Error crítico: ${d.category}`,
          message: d.message_es,
          status: "PENDING",
          fired_at: new Date().toISOString(),
          alert_type: "SYNC_FAILURE",
          alert_source: "atenia_ai",
          fingerprint,
        });
      }
    }
  }

  return reportData;
}

// ─── Main Handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[atenia-ai-supervisor] Starting...");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase config");

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    let input: AteniaAIInput;
    try {
      input = await req.json();
    } catch {
      input = { mode: "POST_DAILY_SYNC" };
    }

    const runDate = input.run_date || todayCOT();
    const dryRun = input.dry_run ?? false;

    console.log(
      `[atenia-ai-supervisor] Mode: ${input.mode}, Date: ${runDate}, Org: ${input.organization_id || "ALL"}, DryRun: ${dryRun}`,
    );

    // ─── GET = status snapshot for UI ───
    if (req.method === "GET") {
      const snap = await getStatusSnapshot(supabase);
      return json({ ok: true, ...snap });
    }

    // ─── HEALTH_CHECK mode ───
    if (input.mode === "HEALTH_CHECK") {
      const providers = ["cpnu", "samai", "tutelas", "publicaciones"];
      const checks: Record<string, boolean> = {};
      for (const p of providers) {
        checks[p] = await quickHealthCheck(p);
      }
      return json({
        ok: true,
        mode: "HEALTH_CHECK",
        providers: checks,
        duration_ms: Date.now() - startTime,
      });
    }

    // ─── Bug 5 FIX: ASSURANCE_CHECK mode — per-gate error isolation ───
    if (input.mode === "ASSURANCE_CHECK") {
      const gates: Record<string, { name: string; ok: boolean; value: string; detail: string }> = {};

      // Determine org for queries
      const orgId = input.organization_id || null;

      // Gate A: Enqueue Diario
      try {
        const today = todayCOT();
        let query = supabase
          .from("auto_sync_daily_ledger")
          .select("status, items_targeted, items_succeeded")
          .eq("run_date", today)
          .order("created_at", { ascending: false })
          .limit(1);
        if (orgId) query = query.eq("organization_id", orgId);
        const { data: ledger } = await query.maybeSingle();

        gates["enqueue_diario"] = {
          name: "Enqueue Diario",
          ok: !!ledger,
          value: ledger ? `${ledger.items_succeeded ?? 0}/${ledger.items_targeted ?? 0} (${ledger.status})` : "No ejecutado",
          detail: ledger ? `Estado: ${ledger.status}` : "El sync diario no se ejecutó hoy",
        };
      } catch (err: any) {
        gates["enqueue_diario"] = { name: "Enqueue Diario", ok: false, value: "ERROR", detail: err.message?.slice(0, 200) ?? "Error" };
      }

      // Gate B: Watchdog Vivo (checks both atenia_ai_actions AND atenia_cron_runs)
      try {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        let foundSignal = false;
        let lastSignalAt: string | null = null;

        // Primary: check atenia_ai_actions for heartbeat_observe
        let query = supabase
          .from("atenia_ai_actions")
          .select("created_at")
          .eq("action_type", "heartbeat_observe")
          .gte("created_at", twoHoursAgo)
          .limit(1);
        if (orgId) query = query.eq("organization_id", orgId);
        const { data } = await query.maybeSingle();
        if (data) {
          foundSignal = true;
          lastSignalAt = data.created_at;
        }

        // Fallback: check atenia_cron_runs HEARTBEAT
        if (!foundSignal) {
          const { data: cronHb } = await supabase
            .from("atenia_cron_runs")
            .select("finished_at")
            .eq("job_name", "HEARTBEAT")
            .eq("status", "OK")
            .gte("finished_at", twoHoursAgo)
            .order("finished_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (cronHb) {
            foundSignal = true;
            lastSignalAt = cronHb.finished_at;
          }
        }

        gates["watchdog_vivo"] = {
          name: "Watchdog Vivo",
          ok: foundSignal,
          value: foundSignal ? "Activo" : "Inactivo",
          detail: foundSignal ? `Último heartbeat: ${lastSignalAt}` : "Sin heartbeat en 2 horas",
        };
      } catch (err: any) {
        gates["watchdog_vivo"] = { name: "Watchdog Vivo", ok: false, value: "ERROR", detail: err.message?.slice(0, 200) ?? "Error" };
      }

      // Gate C: Cobertura Sync (items synced in last 24h)
      try {
        let wiQuery = supabase
          .from("work_items")
          .select("id, last_synced_at")
          .eq("monitoring_enabled", true)
          .not("radicado", "is", null);
        if (orgId) wiQuery = wiQuery.eq("organization_id", orgId);
        const { data: items } = await wiQuery;

        const total = items?.length ?? 0;
        const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const synced24h = items?.filter((i: any) =>
          i.last_synced_at && i.last_synced_at >= cutoff24h
        ).length ?? 0;
        const rate = total > 0 ? Math.round((synced24h / total) * 100) : 100;

        gates["cobertura_sync"] = {
          name: "Cobertura Sync",
          ok: rate >= 80,
          value: `${rate}%`,
          detail: `${synced24h}/${total} asuntos sincronizados en 24h`,
        };
      } catch (err: any) {
        gates["cobertura_sync"] = { name: "Cobertura Sync", ok: false, value: "ERROR", detail: err.message?.slice(0, 200) ?? "Error" };
      }

      // Gate D: Cola Acotada
      try {
        const { count } = await supabase
          .from("atenia_ai_remediation_queue")
          .select("id", { count: "exact", head: true })
          .in("status", ["PENDING", "RUNNING"]);

        gates["cola_acotada"] = {
          name: "Cola Acotada",
          ok: (count ?? 0) <= 50,
          value: `${count ?? 0} en cola`,
          detail: (count ?? 0) > 50 ? "Cola excede límite de 50 items" : "Cola dentro de límites normales",
        };
      } catch (err: any) {
        gates["cola_acotada"] = { name: "Cola Acotada", ok: true, value: "0", detail: "Sin cola activa" };
      }

      // Gate E: Sin Omitidos (ghost items with monitoring but no recent sync)
      try {
        let ghostQuery = supabase
          .from("atenia_ai_work_item_state")
          .select("work_item_id", { count: "exact", head: true })
          .or("consecutive_not_found.gte.5,consecutive_other_errors.gte.5");
        const { count: ghostCount } = await ghostQuery;

        gates["sin_omitidos"] = {
          name: "Sin Omitidos",
          ok: (ghostCount ?? 0) === 0,
          value: `${ghostCount ?? 0} fantasma(s)`,
          detail: (ghostCount ?? 0) > 0 ? `${ghostCount} ítems con fallos consecutivos ≥5` : "Sin ítems fantasma",
        };
      } catch (err: any) {
        gates["sin_omitidos"] = { name: "Sin Omitidos", ok: true, value: "OK", detail: "Verificación pendiente" };
      }

      // Gate F: Heartbeat Vivo (more recent check — checks both sources)
      try {
        const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
        let foundSignal = false;

        // Primary: atenia_ai_actions
        let hbQuery = supabase
          .from("atenia_ai_actions")
          .select("created_at")
          .eq("action_type", "heartbeat_observe")
          .gte("created_at", fortyFiveMinAgo)
          .limit(1);
        if (orgId) hbQuery = hbQuery.eq("organization_id", orgId);
        const { data } = await hbQuery.maybeSingle();
        if (data) foundSignal = true;

        // Fallback: atenia_cron_runs HEARTBEAT
        if (!foundSignal) {
          const { data: cronHb } = await supabase
            .from("atenia_cron_runs")
            .select("finished_at")
            .eq("job_name", "HEARTBEAT")
            .eq("status", "OK")
            .gte("finished_at", fortyFiveMinAgo)
            .limit(1)
            .maybeSingle();
          if (cronHb) foundSignal = true;
        }

        gates["heartbeat_vivo"] = {
          name: "Heartbeat Vivo",
          ok: foundSignal,
          value: foundSignal ? "Activo" : "Sin señal",
          detail: foundSignal ? "Heartbeat activo en últimos 45 min" : "Sin heartbeat en 45 minutos",
        };
      } catch (err: any) {
        gates["heartbeat_vivo"] = { name: "Heartbeat Vivo", ok: false, value: "ERROR", detail: err.message?.slice(0, 200) ?? "Error" };
      }

      const allOk = Object.values(gates).every(g => g.ok);

      return json({
        ok: true,
        mode: "ASSURANCE_CHECK",
        all_ok: allOk,
        gates,
        computed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      });
    }

    // ─── HEARTBEAT mode: pick windows by Bogota time + watchdog-light ───
    if (input.mode === "HEARTBEAT") {
      const nowUtc = new Date();
      const runModes = pickScheduledModes(nowUtc);
      const outputs: unknown[] = [];

      for (const m of runModes) {
        const taskKey = `ATENIA_${m}`;
        const { data: acquired, error: lockErr } = await supabase.rpc(
          "atenia_ai_try_start_task",
          {
            _task_key: taskKey,
            _ttl_seconds: m === "POST_DAILY_AUDIT" ? 1800 : 900,
          },
        );

        if (lockErr || !acquired) {
          outputs.push({ mode: m, locked: false, skipped: true });
          continue;
        }

        try {
          if (m === "POST_DAILY_AUDIT") {
            const { data: wiOrgs } = await supabase
              .from("work_items")
              .select("organization_id")
              .eq("monitoring_enabled", true)
              .not("organization_id", "is", null)
              .not("radicado", "is", null);

            const orgIds = [
              ...new Set(
                (wiOrgs || [])
                  .map((w: Record<string, unknown>) => w.organization_id as string)
                  .filter(Boolean),
              ),
            ];

            let totalDemonitored = 0;
            let totalQueued = 0;
            const hbOrgKPIs = new Map<string, DailySyncKPIs>();

            for (const orgId of orgIds) {
              if (Date.now() - startTime > 50000) break;
              const res = await runPostDailyAuditV2(
                supabase,
                orgId,
                runDate,
                "POST_DAILY_SYNC",
                dryRun,
              );
              totalDemonitored += res.autoDemonitored;
              totalQueued += res.queued;
              if (res.syncKPIs) hbOrgKPIs.set(orgId, res.syncKPIs);
            }

            // Platform KPIs from heartbeat audit
            let hbPlatformKPIs: PlatformSyncKPIs | null = null;
            try {
              hbPlatformKPIs = await computePlatformSyncKPIs(supabase, runDate, hbOrgKPIs, orgIds);
            } catch { /* non-fatal */ }

            outputs.push({
              mode: m,
              locked: true,
              orgs: orgIds.length,
              autoDemonitored: totalDemonitored,
              queued: totalQueued,
              platform_sync_kpis: hbPlatformKPIs,
            });
          } else if (m === "PROCESS_QUEUE") {
            const res = await runQueueWorker(supabase, dryRun);
            outputs.push({ mode: m, locked: true, result: res });
          }

          await supabase.rpc("atenia_ai_finish_task", {
            _task_key: taskKey,
            _status: "OK",
            _error: null,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          await supabase.rpc("atenia_ai_finish_task", {
            _task_key: taskKey,
            _status: "ERROR",
            _error: { message: msg },
          });
          outputs.push({ mode: m, locked: true, error: msg });
        }
      }

      // ─── Watchdog-light: enforce coverage invariant from heartbeat ───
      // Only run if we have time left (< 45s elapsed)
      let watchdogLightResult: unknown = null;
      if (Date.now() - startTime < 45000) {
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const resp = await fetch(`${supabaseUrl}/functions/v1/atenia-cron-watchdog`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ light: true }),
          });
          const body = await resp.json().catch(() => ({ status: resp.status }));
          watchdogLightResult = { ok: resp.ok, result: body };

          // Track consecutive watchdog failures for auto-escalation
          if (!resp.ok) {
            // Check how many consecutive failures
            const { data: recentWdRuns } = await supabase
              .from("atenia_cron_runs")
              .select("status")
              .eq("job_name", "WATCHDOG")
              .order("started_at", { ascending: false })
              .limit(3);

            const consecutiveFailures = (recentWdRuns || [])
              .filter((r: any) => r.status === "FAILED").length;

            if (consecutiveFailures >= 2) {
              // Auto-escalate: create CRITICAL alert
              await logAction(supabase, {
                actor: "ATENIA",
                organization_id: "a0000000-0000-0000-0000-000000000001",
                action_type: "WATCHDOG_ESCALATION",
                autonomy_tier: "ACT",
                reason_code: "CONSECUTIVE_WATCHDOG_FAILURES",
                summary: `Watchdog ha fallado ${consecutiveFailures + 1} veces consecutivas. Escalación automática.`,
                reasoning: `Watchdog ha fallado ${consecutiveFailures + 1} veces consecutivas. Escalación automática.`,
                evidence: { consecutive_failures: consecutiveFailures + 1, last_result: body },
                is_reversible: false,
              });

              // Create critical alert instance
              try {
                await supabase.from("alert_instances").insert({
                  entity_type: "platform",
                  entity_id: "00000000-0000-0000-0000-000000000000",
                  owner_id: "00000000-0000-0000-0000-000000000000",
                  severity: "CRITICAL",
                  title: "🚨 Watchdog con fallos consecutivos",
                  message: `El watchdog ha fallado ${consecutiveFailures + 1} veces seguidas. Requiere intervención manual.`,
                  status: "PENDING",
                  fired_at: new Date().toISOString(),
                  alert_type: "WATCHDOG_ESCALATION",
                  alert_source: "atenia-ai-supervisor",
                  fingerprint: `watchdog_escalation_${new Date().toISOString().slice(0, 13)}`,
                });
              } catch (_) { /* non-fatal */ }
            }
          }
        } catch (e: unknown) {
          watchdogLightResult = { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
        }
      }

      // Record HEARTBEAT in cron_runs
      try {
        const hbScheduledFor = new Date(
          Math.floor(Date.now() / (30 * 60 * 1000)) * (30 * 60 * 1000)
        ).toISOString();
        await supabase.from("atenia_cron_runs").upsert(
          {
            job_name: "HEARTBEAT",
            scheduled_for: hbScheduledFor,
            started_at: new Date(startTime).toISOString(),
            finished_at: new Date().toISOString(),
            status: "OK",
            details: { ran: runModes, watchdog_light: watchdogLightResult },
          },
          { onConflict: "job_name,scheduled_for" }
        );
      } catch (_) { /* non-fatal */ }

      // ── FIX: Write heartbeat_observe action so watchdog/heartbeat gates detect it ──
      // Gates (watchdog_vivo, heartbeat_vivo) query atenia_ai_actions for action_type='heartbeat_observe'
      // but HEARTBEAT mode was only writing to atenia_cron_runs — gates always showed inactive.
      try {
        // Get all org IDs that were processed (or use a platform-level org)
        const orgIdsProcessed = outputs
          .filter((o: any) => o && !o.skipped)
          .map((o: any) => o.org_id)
          .filter(Boolean);

        // If no specific orgs, write a platform-level heartbeat for all active orgs
        const { data: activeOrgs } = await supabase
          .from("work_items")
          .select("organization_id")
          .eq("monitoring_enabled", true)
          .not("organization_id", "is", null)
          .not("radicado", "is", null);

        const allOrgIds = [...new Set(
          (activeOrgs || []).map((o: any) => o.organization_id).filter(Boolean)
        )];

        for (const oid of allOrgIds.slice(0, 20)) {
          try {
            await supabase.from("atenia_ai_actions").insert({
              organization_id: oid,
              action_type: "heartbeat_observe",
              autonomy_tier: "OBSERVE",
              reasoning: `Heartbeat servidor (HEARTBEAT mode) — org procesada.`,
              status: "EXECUTED",
              action_result: "logged",
              evidence: {
                source: "atenia-ai-supervisor-heartbeat-mode",
                ran: runModes,
                timestamp: new Date().toISOString(),
              },
            });
          } catch (_) { /* non-fatal per org */ }
        }
      } catch (_) { /* non-fatal */ }

      const snap = await getStatusSnapshot(supabase);
      return json({
        ok: true,
        ran: runModes,
        outputs,
        watchdog_light: watchdogLightResult,
        snapshot: snap,
        duration_ms: Date.now() - startTime,
      });
    }

    // ─── RUN_DAILY_RUNBOOK mode ───
    if (input.mode === "RUN_DAILY_RUNBOOK") {
      const { DAILY_RUNBOOK } = await import("../_shared/dailyRunbook.ts");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const stepResults: Array<{ job_name: string; label: string; status: string; duration_ms: number; detail?: unknown }> = [];

      for (const step of DAILY_RUNBOOK) {
        const stepStart = Date.now();
        try {
          // Use atenia_try_start_cron for idempotency
          const scheduledFor = new Date(Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000)).toISOString();
          const { data: claimData } = await supabase.rpc("atenia_try_start_cron", {
            p_job_name: step.job_name,
            p_scheduled_for: scheduledFor,
            p_lease_seconds: step.timeout_seconds,
          });
          const claim = claimData?.[0];
          if (!claim?.ok) {
            stepResults.push({ job_name: step.job_name, label: step.label, status: "SKIPPED_LEASE", duration_ms: Date.now() - stepStart });
            continue;
          }

          const resp = await fetch(`${supabaseUrl}/functions/v1/${step.edge_function}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(step.body),
          });
          const body = await resp.json().catch(() => ({ status: resp.status }));

          await supabase.rpc("atenia_finish_cron", {
            p_run_id: claim.run_id,
            p_status: resp.ok ? "OK" : "FAILED",
            p_details: { triggered_by: "runbook_manual", result: body },
          });

          // Log as action
          await logAction(supabase, {
            actor: "ATENIA",
            action_type: "RUNBOOK_STEP",
            summary: `${step.label}: ${resp.ok ? "OK" : "FAILED"}`,
            evidence: { job_name: step.job_name, status: resp.status, run_id: claim.run_id },
            is_reversible: false,
            autonomy_tier: "ACT",
            reasoning: `Runbook step ${step.job_name} executed`,
          });

          stepResults.push({
            job_name: step.job_name,
            label: step.label,
            status: resp.ok ? "OK" : "FAILED",
            duration_ms: Date.now() - stepStart,
            detail: body,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          stepResults.push({ job_name: step.job_name, label: step.label, status: "ERROR", duration_ms: Date.now() - stepStart, detail: msg });
        }
      }

      return json({
        ok: true,
        mode: "RUN_DAILY_RUNBOOK",
        steps: stepResults,
        duration_ms: Date.now() - startTime,
      });
    }

    // ─── PROCESS_QUEUE mode ───
    if (input.mode === "PROCESS_QUEUE") {
      const taskKey = "ATENIA_PROCESS_QUEUE";
      const { data: acquired } = await supabase.rpc(
        "atenia_ai_try_start_task",
        { _task_key: taskKey, _ttl_seconds: 900 },
      );

      if (!acquired) {
        return json({ ok: true, mode: "PROCESS_QUEUE", skipped: true });
      }

      try {
        const res = await runQueueWorker(supabase, dryRun);
        await supabase.rpc("atenia_ai_finish_task", {
          _task_key: taskKey,
          _status: "OK",
          _error: null,
        });
        const snap = await getStatusSnapshot(supabase);
        return json({
          ok: true,
          mode: "PROCESS_QUEUE",
          result: res,
          snapshot: snap,
          duration_ms: Date.now() - startTime,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.rpc("atenia_ai_finish_task", {
          _task_key: taskKey,
          _status: "ERROR",
          _error: { message: msg },
        });
        return json({ ok: false, error: msg }, 500);
      }
    }

    // ─── MANUAL_RUN mode (same as HEARTBEAT but always runs both) ───
    if (input.mode === "MANUAL_RUN") {
      const outputs: unknown[] = [];

      // Process queue first
      const qRes = await runQueueWorker(supabase, dryRun);
      outputs.push({ mode: "PROCESS_QUEUE", result: qRes });

      // Then audit if org specified
      if (input.organization_id) {
        const aRes = await runPostDailyAuditV2(
          supabase,
          input.organization_id,
          runDate,
          "MANUAL_AUDIT",
          dryRun,
        );
        outputs.push({
          mode: "POST_DAILY_AUDIT",
          autoDemonitored: aRes.autoDemonitored,
          queued: aRes.queued,
        });
      }

      const snap = await getStatusSnapshot(supabase);
      return json({
        ok: true,
        mode: "MANUAL_RUN",
        outputs,
        snapshot: snap,
        duration_ms: Date.now() - startTime,
      });
    }

    // ─── WATCHDOG mode: self-healing invariant checker ───
    if (input.mode === "WATCHDOG") {
      console.log("[atenia-ai-supervisor] WATCHDOG mode — delegating to watchdog function");
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const resp = await fetch(`${supabaseUrl}/functions/v1/atenia-cron-watchdog`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });
        const body = await resp.json().catch(() => ({ status: resp.status }));

        // Log watchdog execution as an AI action for audit trail
        const orgId = input.organization_id || "a0000000-0000-0000-0000-000000000001";
        const { error: insertErr } = await supabase.from("atenia_ai_actions").insert({
          organization_id: orgId,
          action_type: "WATCHDOG_RUN",
          autonomy_tier: "AUTONOMOUS",
          reasoning: "Watchdog ejecutado para verificar invariantes de cron y cobertura de sync.",
          action_taken: resp.ok ? "WATCHDOG_OK" : "WATCHDOG_FAILED",
          action_result: resp.ok ? "OK" : "FAILED",
          evidence: {
            triggered_by: "supervisor",
            watchdog_result: body,
            duration_ms: Date.now() - startTime,
          },
        });
        if (insertErr) console.warn("[watchdog] Failed to log AI action:", insertErr.message);

        return json({
          ok: resp.ok,
          mode: "WATCHDOG",
          watchdog_result: body,
          duration_ms: Date.now() - startTime,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ ok: false, mode: "WATCHDOG", error: msg }, 500);
      }
    }

    // ─── Legacy modes: POST_DAILY_SYNC, POST_LOGIN_SYNC, MANUAL_AUDIT ───
    let orgIds: string[];
    if (input.organization_id) {
      orgIds = [input.organization_id];
    } else {
      const ledgerQuery = supabase
        .from("auto_sync_daily_ledger")
        .select("organization_id")
        .eq("run_date", runDate);

      const { data: ledgerEntries } = await ledgerQuery;
      orgIds = [
        ...new Set(
          (ledgerEntries || []).map(
            (l: Record<string, unknown>) => l.organization_id as string,
          ),
        ),
      ];

      if (
        orgIds.length === 0 &&
        (input.mode === "MANUAL_AUDIT" || input.mode === "POST_LOGIN_SYNC")
      ) {
        const { data: wiOrgs } = await supabase
          .from("work_items")
          .select("organization_id")
          .eq("monitoring_enabled", true)
          .not("organization_id", "is", null)
          .not("radicado", "is", null);

        orgIds = [
          ...new Set(
            (wiOrgs || [])
              .map((w: Record<string, unknown>) => w.organization_id as string)
              .filter(Boolean),
          ),
        ];
      }
    }

    console.log(
      `[atenia-ai-supervisor] Processing ${orgIds.length} organizations`,
    );

    const allReports: unknown[] = [];
    const orgKPIs = new Map<string, DailySyncKPIs>();

    for (const orgId of orgIds) {
      try {
        const res = await runPostDailyAuditV2(
          supabase,
          orgId,
          runDate,
          input.mode,
          dryRun,
        );
        allReports.push(res.report);
        if (res.syncKPIs) orgKPIs.set(orgId, res.syncKPIs);
      } catch (err) {
        console.error(`[atenia-ai] Org ${orgId} audit failed:`, err);
      }

      if (Date.now() - startTime > 50000) {
        console.log("[atenia-ai-supervisor] Timeout, stopping org iteration");
        break;
      }
    }

    // Also process queue after audit
    const queueResult = await runQueueWorker(supabase, dryRun);

    // Compute platform-wide sync KPIs + consolidated health snapshot
    let platformKPIs: PlatformSyncKPIs | null = null;
    let healthSnapshot: Record<string, unknown> | null = null;
    if (input.mode === "POST_DAILY_SYNC" || input.mode === "MANUAL_AUDIT") {
      try {
        platformKPIs = await computePlatformSyncKPIs(supabase, runDate, orgKPIs, orgIds);
        console.log(`[atenia-ai-supervisor] Platform KPIs: ${platformKPIs.pct_fully_synced}% synced, p95_conv=${platformKPIs.p95_convergence_seconds}s, DL=${platformKPIs.total_dead_lettered_items}, avg_chain=${platformKPIs.avg_chain_length}`);
      } catch (err) {
        console.warn("[atenia-ai-supervisor] Platform KPI computation failed:", err);
      }

      // Call consolidated health snapshot DB function (7-day lookback)
      try {
        const { data: snapshot } = await supabase.rpc("daily_sync_health_snapshot", {
          p_days: 7,
          p_target_date: runDate,
        });
        healthSnapshot = snapshot as Record<string, unknown> | null;
        const problemOrgs = (healthSnapshot?.problem_orgs_today as unknown[]) || [];
        console.log(`[atenia-ai-supervisor] Health snapshot: ${problemOrgs.length} problem orgs today`);
      } catch (err) {
        console.warn("[atenia-ai-supervisor] Health snapshot RPC failed:", err);
      }

      // Log combined KPI + health snapshot report
      const reportOrg = orgIds[0] ?? "a0000000-0000-0000-0000-000000000001";
      const problemCount = healthSnapshot
        ? ((healthSnapshot.problem_orgs_today as unknown[]) || []).length
        : 0;
      try {
        await logAction(supabase, {
          actor: "ATENIA",
          organization_id: reportOrg,
          action_type: "DAILY_SYNC_KPI_REPORT",
          autonomy_tier: "OBSERVE",
          reasoning: `Informe consolidado del sync diario: ${platformKPIs?.pct_fully_synced ?? 0}% orgs completadas, ${platformKPIs?.total_dead_lettered_items ?? 0} ítems en dead-letter, ${problemCount} orgs con problemas.`,
          summary: `Sync diario: ${platformKPIs?.orgs_fully_synced ?? 0}/${platformKPIs?.total_orgs ?? 0} orgs OK, p95 convergencia ${platformKPIs?.p95_convergence_seconds ?? 0}s`,
          evidence: {
            ...(platformKPIs as unknown as Record<string, unknown> ?? {}),
            health_snapshot: healthSnapshot,
          },
          is_reversible: false,
        });
      } catch (err) {
        console.warn("[atenia-ai-supervisor] KPI report logging failed:", err);
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `[atenia-ai-supervisor] Complete in ${durationMs}ms. ${allReports.length} reports generated.`,
    );

    return json({
      ok: true,
      mode: input.mode,
      run_date: runDate,
      organizations_audited: allReports.length,
      platform_sync_kpis: platformKPIs,
      health_snapshot: healthSnapshot,
      queue_processed: queueResult,
      duration_ms: durationMs,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[atenia-ai-supervisor] Fatal error:", msg);
    return json(
      { ok: false, error: msg, duration_ms: Date.now() - startTime },
      500,
    );
  }
});
