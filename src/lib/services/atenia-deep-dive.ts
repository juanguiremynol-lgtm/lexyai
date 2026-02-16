/**
 * atenia-deep-dive.ts — Automatic Deep Dive Engine
 *
 * Intensive multi-step diagnostic investigation of a single work item.
 * Triggered automatically when items meet failure/anomaly criteria.
 * Rate limited: max 1 dive per work item per 4 hours.
 */

import { supabase } from "@/integrations/supabase/client";
import { deduplicateDeepDiveTrigger, updateDeepDiveHeartbeat } from "./atenia-deep-dive-ttl";

export interface DeepDiveStep {
  name: string;
  ok: boolean;
  latency_ms?: number;
  findings: Record<string, any>;
  error?: string;
}

export interface DeepDiveResult {
  dive_id: string;
  work_item_id: string;
  radicado: string;
  status: "COMPLETED" | "ESCALATED" | "FAILED";
  severity: string;
  diagnosis: string;
  root_cause: string;
  steps: DeepDiveStep[];
  recommended_actions: Array<{ action_type: string; description: string; auto_executable: boolean }>;
  remediation_applied: boolean;
  gemini_analysis?: string;
  duration_ms: number;
}

/**
 * Execute a deep dive for a single work item.
 * Returns null if rate-limited (already investigated recently).
 */
export async function executeDeepDive(
  orgId: string,
  workItemId: string,
  triggerCriteria: string,
  triggerEvidence: Record<string, any> = {}
): Promise<DeepDiveResult | null> {
  const startTime = Date.now();
  const steps: DeepDiveStep[] = [];

  // Dedup: check if already investigated recently for same trigger
  const existingDiveId = await deduplicateDeepDiveTrigger(workItemId, triggerCriteria, triggerEvidence);
  if (existingDiveId) return null;

  // Rate limit: max 1 per item per 4 hours
  const { data: recentDive } = await (supabase.from("atenia_deep_dives") as any)
    .select("id")
    .eq("work_item_id", workItemId)
    .gte("created_at", new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle();

  if (recentDive) return null;

  // Create dive record
  const { data: dive } = await (supabase.from("atenia_deep_dives") as any)
    .insert({
      organization_id: orgId,
      work_item_id: workItemId,
      radicado: "",
      trigger_criteria: triggerCriteria,
      trigger_evidence: triggerEvidence,
      status: "RUNNING",
      diagnosis: "",
      dedupe_key: `${workItemId}_${triggerCriteria}`,
      last_heartbeat_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (!dive) return null;

  try {
    // STEP 1: ITEM_PROFILE
    const s1 = Date.now();
    const { data: item } = await (supabase.from("work_items") as any)
      .select("id, radicado, workflow_type, monitoring_enabled, deleted_at, freshness_tier, last_successful_sync_at, sync_failure_streak, consecutive_not_found, consecutive_other_errors, last_error_code, created_at")
      .eq("id", workItemId)
      .single();

    if (!item) {
      await completeDive(dive.id, steps, "Item no encontrado en la base de datos.", "ITEM_NOT_FOUND", "CRITICAL", startTime);
      return { dive_id: dive.id, work_item_id: workItemId, radicado: "", status: "FAILED", severity: "CRITICAL", diagnosis: "Item not found", root_cause: "ITEM_NOT_FOUND", steps, recommended_actions: [], remediation_applied: false, duration_ms: Date.now() - startTime };
    }

    await (supabase.from("atenia_deep_dives") as any).update({ radicado: item.radicado }).eq("id", dive.id);

    const daysSinceCreation = Math.round((Date.now() - new Date(item.created_at).getTime()) / (24 * 60 * 60 * 1000));
    steps.push({
      name: "ITEM_PROFILE",
      ok: true,
      latency_ms: Date.now() - s1,
      findings: {
        radicado: item.radicado,
        workflow_type: item.workflow_type,
        monitoring_enabled: item.monitoring_enabled,
        freshness_tier: item.freshness_tier,
        last_successful_sync: item.last_successful_sync_at,
        sync_failure_streak: item.sync_failure_streak ?? 0,
        consecutive_not_found: item.consecutive_not_found ?? 0,
        days_since_creation: daysSinceCreation,
      },
    });

    // Heartbeat after profile step
    await updateDeepDiveHeartbeat(dive.id);

    // STEP 2: SYNC_HISTORY
    const s2 = Date.now();
    const { data: syncHistory } = await (supabase.from("work_item_scrape_jobs") as any)
      .select("id, status, source, error_code, error_message, started_at")
      .eq("work_item_id", workItemId)
      .order("created_at", { ascending: false })
      .limit(10);

    const successRate = syncHistory
      ? syncHistory.filter((s: any) => s.status === "completed" || s.status === "COMPLETED").length / Math.max(syncHistory.length, 1)
      : 0;

    const errorPatterns = analyzeErrorPatterns(syncHistory ?? []);
    steps.push({
      name: "SYNC_HISTORY",
      ok: successRate > 0.5,
      latency_ms: Date.now() - s2,
      findings: {
        total_attempts: syncHistory?.length ?? 0,
        success_rate: Math.round(successRate * 100) + "%",
        error_patterns: errorPatterns,
        last_10: (syncHistory ?? []).slice(0, 5).map((s: any) => ({
          status: s.status, source: s.source, error_code: s.error_code, when: s.started_at,
        })),
      },
    });

    // STEP 3: EXT_PROVIDER_TRACES
    const s3 = Date.now();
    const { data: extTraces } = await (supabase.from("provider_sync_traces") as any)
      .select("stage, ok, result_code, latency_ms, created_at")
      .eq("work_item_id", workItemId)
      .order("created_at", { ascending: false })
      .limit(30);

    const traceAnomalies: string[] = [];
    if (extTraces && extTraces.length > 0) {
      // Group traces by approximate session (5min windows)
      const sessions = groupTracesBySession(extTraces);
      for (const session of sessions.slice(0, 3)) {
        const stages = new Set(session.map((t: any) => t.stage));
        if (stages.has("EXT_PROVIDER_RESPONSE") && !stages.has("MAPPING_APPLIED")) {
          traceAnomalies.push("MAPPING_APPLIED missing despite EXT_PROVIDER_RESPONSE success");
        }
        if (stages.has("MAPPING_APPLIED") && !stages.has("UPSERTED_CANONICAL")) {
          traceAnomalies.push("UPSERTED_CANONICAL missing despite MAPPING_APPLIED");
        }
      }
    }

    steps.push({
      name: "EXT_PROVIDER_TRACES",
      ok: traceAnomalies.length === 0,
      latency_ms: Date.now() - s3,
      findings: {
        total_traces: extTraces?.length ?? 0,
        anomalies: traceAnomalies,
        recent_stages: extTraces?.slice(0, 10).map((t: any) => `${t.stage}: ${t.result_code}`),
      },
    });

    // STEP 4: DATA_INTEGRITY
    const s4 = Date.now();
    const [{ count: actCount }, { count: pubCount }] = await Promise.all([
      (supabase.from("work_item_acts") as any)
        .select("id", { count: "exact", head: true })
        .eq("work_item_id", workItemId)
        .eq("is_archived", false),
      supabase.from("work_item_publicaciones")
        .select("id", { count: "exact", head: true })
        .eq("work_item_id", workItemId)
        .eq("is_archived", false),
    ]);

    const { data: sourceBreakdown } = await (supabase.from("work_item_acts") as any)
      .select("source")
      .eq("work_item_id", workItemId)
      .eq("is_archived", false);

    const sources: Record<string, number> = {};
    for (const row of sourceBreakdown ?? []) {
      sources[row.source ?? "unknown"] = (sources[row.source ?? "unknown"] ?? 0) + 1;
    }

    steps.push({
      name: "DATA_INTEGRITY",
      ok: (actCount ?? 0) > 0 || (pubCount ?? 0) > 0,
      latency_ms: Date.now() - s4,
      findings: {
        actuaciones_count: actCount ?? 0,
        publicaciones_count: pubCount ?? 0,
        source_breakdown: sources,
        has_data: (actCount ?? 0) > 0 || (pubCount ?? 0) > 0,
      },
    });

    // STEP 5: RADICADO_VALIDITY
    const s5 = Date.now();
    const radicadoValid = /^\d{23}$/.test(item.radicado);
    steps.push({
      name: "RADICADO_VALIDITY",
      ok: radicadoValid,
      latency_ms: Date.now() - s5,
      findings: {
        radicado: item.radicado,
        length: item.radicado.length,
        format_valid: radicadoValid,
        despacho_code: item.radicado.substring(0, 10),
      },
    });

    // STEP 6: RECENT_SNAPSHOTS
    const s6 = Date.now();
    const { data: snapshots } = await (supabase.from("provider_raw_snapshots") as any)
      .select("id, connector_key, http_status, byte_length, created_at")
      .eq("work_item_id", workItemId)
      .order("created_at", { ascending: false })
      .limit(5);

    steps.push({
      name: "RECENT_SNAPSHOTS",
      ok: (snapshots?.length ?? 0) > 0,
      latency_ms: Date.now() - s6,
      findings: {
        snapshot_count: snapshots?.length ?? 0,
        latest: snapshots?.slice(0, 3).map((s: any) => ({
          connector: s.connector_key,
          http_status: s.http_status,
          bytes: s.byte_length,
          when: s.created_at,
        })),
      },
    });

    // === DIAGNOSIS ===
    const diagnosis = generateDiagnosis(item, steps, triggerCriteria, daysSinceCreation);

    // === AUTO-REMEDIATION (safe only) ===
    let remediationApplied = false;
    if (steps.find((s) => s.name === "DATA_INTEGRITY")?.findings.has_data === false && (item.sync_failure_streak ?? 0) >= 3) {
      try {
        await supabase.functions.invoke("sync-by-work-item", {
          body: { work_item_id: workItemId, trigger: "DEEP_DIVE_REMEDIATION" },
        });
        remediationApplied = true;
      } catch { /* logged below */ }
    }

    // === GEMINI ESCALATION for CRITICAL ===
    let geminiAnalysis: string | undefined;
    if (diagnosis.severity === "CRITICAL" || diagnosis.root_cause === "UNDETERMINED") {
      try {
        const apiKey = (await supabase.auth.getSession()).data.session?.access_token;
        if (apiKey) {
          const geminiPrompt = `Analiza el siguiente deep dive de un asunto judicial en ATENIA:\n\nRadicado: ${item.radicado}\nTipo: ${item.workflow_type}\nCriterio: ${triggerCriteria}\nPasos:\n${steps.map((s) => `- ${s.name}: ${s.ok ? "✅" : "❌"} ${JSON.stringify(s.findings)}`).join("\n")}\n\nProporciona: 1. Diagnóstico probable 2. Causa raíz 3. Acciones recomendadas`;

          const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/atenia-assistant`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              mode: "DEEP_DIVE_ANALYSIS",
              prompt: geminiPrompt,
            }),
          });
          if (resp.ok) {
            const data = await resp.json();
            geminiAnalysis = data.response ?? data.text;
          }
        }
      } catch { /* Gemini optional */ }
    }

    // === COMPLETE ===
    const status = geminiAnalysis ? "ESCALATED" : "COMPLETED";
    await (supabase.from("atenia_deep_dives") as any)
      .update({
        steps,
        diagnosis: diagnosis.text,
        root_cause: diagnosis.root_cause,
        severity: diagnosis.severity,
        recommended_actions: diagnosis.recommended_actions,
        remediation_applied: remediationApplied,
        gemini_analysis: geminiAnalysis ?? null,
        duration_ms: Date.now() - startTime,
        finished_at: new Date().toISOString(),
        status,
      })
      .eq("id", dive.id);

    // Log action
    await logDeepDiveAction(orgId, workItemId, item.radicado, triggerCriteria, diagnosis, dive.id, remediationApplied, !!geminiAnalysis, steps, startTime);

    return {
      dive_id: dive.id,
      work_item_id: workItemId,
      radicado: item.radicado,
      status: status as any,
      severity: diagnosis.severity,
      diagnosis: diagnosis.text,
      root_cause: diagnosis.root_cause,
      steps,
      recommended_actions: diagnosis.recommended_actions,
      remediation_applied: remediationApplied,
      gemini_analysis: geminiAnalysis,
      duration_ms: Date.now() - startTime,
    };
  } catch (err: any) {
    await (supabase.from("atenia_deep_dives") as any)
      .update({
        status: "FAILED",
        diagnosis: `Deep dive falló: ${err.message}`,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      })
      .eq("id", dive.id);

    return {
      dive_id: dive.id,
      work_item_id: workItemId,
      radicado: "",
      status: "FAILED",
      severity: "HIGH",
      diagnosis: `Deep dive falló: ${err.message}`,
      root_cause: "EXECUTION_ERROR",
      steps,
      recommended_actions: [],
      remediation_applied: false,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Evaluate deep dive trigger criteria across all monitored items.
 * Max 2 dives per cycle to avoid budget exhaustion.
 */
export async function evaluateDeepDiveTriggers(orgId: string): Promise<number> {
  let divesTriggered = 0;
  const MAX_DIVES = 2;

  // Criterion 1: Sync failure streak >= 5
  const { data: failStreakItems } = await (supabase.from("work_items") as any)
    .select("id, radicado, sync_failure_streak")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .is("deleted_at", null)
    .gte("sync_failure_streak", 5)
    .order("sync_failure_streak", { ascending: false })
    .limit(3);

  for (const item of failStreakItems ?? []) {
    if (divesTriggered >= MAX_DIVES) break;
    const result = await executeDeepDive(orgId, item.id, "SYNC_FAILURE_STREAK", { streak: item.sync_failure_streak });
    if (result) divesTriggered++;
  }

  // Criterion 2: Zero-data items (monitored > 7 days, never synced)
  if (divesTriggered < MAX_DIVES) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: zeroDataItems } = await (supabase.from("work_items") as any)
      .select("id, radicado")
      .eq("organization_id", orgId)
      .eq("monitoring_enabled", true)
      .is("deleted_at", null)
      .lt("created_at", sevenDaysAgo)
      .is("last_successful_sync_at", null)
      .limit(2);

    for (const item of zeroDataItems ?? []) {
      if (divesTriggered >= MAX_DIVES) break;
      const result = await executeDeepDive(orgId, item.id, "ZERO_DATA_ITEM");
      if (result) divesTriggered++;
    }
  }

  return divesTriggered;
}

// ─── Helpers ───

async function completeDive(
  diveId: string,
  steps: DeepDiveStep[],
  diagnosis: string,
  rootCause: string,
  severity: string,
  startTime: number
) {
  await (supabase.from("atenia_deep_dives") as any)
    .update({
      steps,
      diagnosis,
      root_cause: rootCause,
      severity,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: "COMPLETED",
    })
    .eq("id", diveId);
}

function generateDiagnosis(
  item: any,
  steps: DeepDiveStep[],
  trigger: string,
  daysSinceCreation: number
): { text: string; root_cause: string; severity: string; recommended_actions: Array<{ action_type: string; description: string; auto_executable: boolean }> } {
  const issues: string[] = [];
  const actions: Array<{ action_type: string; description: string; auto_executable: boolean }> = [];
  let rootCause = "UNDETERMINED";
  let severity = "MEDIUM";

  const dataStep = steps.find((s) => s.name === "DATA_INTEGRITY");
  const traceStep = steps.find((s) => s.name === "EXT_PROVIDER_TRACES");
  const radicadoStep = steps.find((s) => s.name === "RADICADO_VALIDITY");
  const syncStep = steps.find((s) => s.name === "SYNC_HISTORY");

  // Invalid radicado
  if (radicadoStep && !radicadoStep.ok) {
    rootCause = "INVALID_RADICADO";
    severity = "HIGH";
    issues.push("El radicado tiene formato inválido.");
    actions.push({ action_type: "SUSPEND_MONITORING", description: "Radicado inválido. Considerar desmonitorizar.", auto_executable: false });
  }

  // Mapping anomalies
  if (traceStep && (traceStep.findings.anomalies?.length ?? 0) > 0) {
    rootCause = "MAPPING_NOT_CONFIGURED";
    severity = "HIGH";
    issues.push("El proveedor externo responde pero el mapping no está configurado.");
    actions.push({ action_type: "CREATE_MAPPING_SPEC", description: "Crear mapping spec para transformar datos del proveedor externo.", auto_executable: false });
  }

  // Zero data chronic
  if (dataStep && !dataStep.findings.has_data && daysSinceCreation > 7) {
    rootCause = rootCause === "UNDETERMINED" ? "ZERO_DATA_CHRONIC" : rootCause;
    severity = "CRITICAL";
    issues.push(`El asunto fue creado hace ${daysSinceCreation} días y nunca ha recibido datos.`);
  }

  // Dominant error pattern
  if (syncStep?.findings.error_patterns?.dominant_error) {
    const p = syncStep.findings.error_patterns;
    issues.push(`Error dominante: "${p.dominant_error}" (${p.dominant_count} veces).`);
  }

  const text = issues.length > 0
    ? `${item.radicado} (${item.workflow_type}): ${issues.join(" ")}`
    : `${item.radicado} (${item.workflow_type}): No se encontraron problemas evidentes. Monitoreo continuo recomendado.`;

  return { text, root_cause: rootCause, severity, recommended_actions: actions };
}

function analyzeErrorPatterns(history: any[]): Record<string, any> {
  const errors = history.filter((h: any) => h.error_code);
  const counts: Record<string, number> = {};
  for (const h of errors) {
    counts[h.error_code] = (counts[h.error_code] ?? 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return {
    total_errors: errors.length,
    unique_codes: Object.keys(counts).length,
    dominant_error: sorted[0]?.[0],
    dominant_count: sorted[0]?.[1],
    all_codes: counts,
  };
}

function groupTracesBySession(traces: any[]): any[][] {
  if (!traces || traces.length === 0) return [];
  const sessions: any[][] = [];
  let currentSession: any[] = [traces[0]];

  for (let i = 1; i < traces.length; i++) {
    const gap = new Date(traces[i - 1].created_at).getTime() - new Date(traces[i].created_at).getTime();
    if (gap > 5 * 60 * 1000) {
      sessions.push(currentSession);
      currentSession = [traces[i]];
    } else {
      currentSession.push(traces[i]);
    }
  }
  sessions.push(currentSession);
  return sessions;
}

async function logDeepDiveAction(
  orgId: string,
  workItemId: string,
  radicado: string,
  trigger: string,
  diagnosis: { text: string; root_cause: string; severity: string },
  diveId: string,
  remediationApplied: boolean,
  geminiEscalated: boolean,
  steps: DeepDiveStep[],
  startTime: number
) {
  try {
    await (supabase.from("atenia_ai_actions") as any).insert({
      organization_id: orgId,
      action_type: "DEEP_DIVE_COMPLETED",
      actor: "AI_AUTOPILOT",
      autonomy_tier: "ACT",
      work_item_id: workItemId,
      reasoning: `Deep dive completado para ${radicado}: ${diagnosis.text}`,
      action_result: diagnosis.severity === "CRITICAL" ? "escalated" : "applied",
      status: "EXECUTED",
      evidence: {
        dive_id: diveId,
        trigger,
        severity: diagnosis.severity,
        root_cause: diagnosis.root_cause,
        steps_ok: steps.filter((s) => s.ok).length,
        steps_failed: steps.filter((s) => !s.ok).length,
        remediation_applied: remediationApplied,
        gemini_escalated: geminiEscalated,
        duration_ms: Date.now() - startTime,
      },
    });
  } catch { /* best-effort */ }
}
