import { invokeInternal } from "../_shared/internalInvoke.ts";
import { requirePrivilegedCaller } from "../_shared/privilegedCaller.ts";
import { publicReadVerdict } from "../_shared/publicReadVerdict.ts";
import { canonicalizeProvider, isProviderAttributable } from "../_shared/syncVocabulary.ts";
/**
 * atenia-e2e-scheduled — Server-side scheduled E2E pipeline tests.
 *
 * Runs full-pipeline E2E tests on sentinel + rotating work items.
 * Also handles E2E registry refresh (sentinel auto-selection).
 *
 * Modes:
 *   - E2E_BATCH: Run scheduled E2E tests (every 6h or pre-daily-sync)
 *   - REFRESH_REGISTRY: Ensure sentinel coverage per workflow type
 *   - FULL: Both (default)
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { logAction } from "../_shared/action-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Provider coverage matrix per workflow type */
const PROVIDERS_FOR_TYPE: Record<string, string[]> = {
  CPACA: ["CPNU", "SAMAI", "PUBLICACIONES", "SAMAI_ESTADOS"],
  CGP: ["CPNU", "PUBLICACIONES"],
  Laboral: ["CPNU", "SAMAI", "PUBLICACIONES"],
  Penal: ["CPNU", "PUBLICACIONES"],
  PENAL_906: ["CPNU", "PUBLICACIONES"],
  Tutelas: ["TUTELAS", "PUBLICACIONES"],
  "Proceso Administrativo": ["SAMAI", "PUBLICACIONES"],
  Peticiones: ["CPNU"],
};

/** A transport response is not itself proof that a source was read. */
type SyncEvidenceKind = "VERIFIED" | "FAILED" | "DEFERRED" | "INCOMPLETE" | "UNVERIFIED";
type SyncEvidence = { ok: boolean; kind: SyncEvidenceKind; code: string; deduplicated?: boolean; empty?: boolean };

function classifySyncEvidence(payload: unknown, transportFailed = false, now = Date.now()): SyncEvidence {
  if (transportFailed) return { ok: false, kind: "FAILED", code: "TRANSPORT_FAILED" };
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return { ok: false, kind: "UNVERIFIED", code: "UNKNOWN_RESPONSE" };
  const p = payload as Record<string, unknown>;
  if (
    [p.status, p.code, p.result_code, p.run_status, p.outcome].some((v) => v != null && typeof v !== "string") ||
    [
      p.deduplicated,
      p.reused_completed_read,
      p.source_query_attempted,
      p.source_complete,
      p.consulta_completa,
      p.persistencia_completa,
      p.partial,
      p.pending_upstream,
      p.scraping_initiated,
      p.cpnu_buscar_deferred,
      p.snapshot_stale,
      p.stale,
    ].some((v) => v != null && typeof v !== "boolean") ||
    (p.persistence_unknown != null && !Array.isArray(p.persistence_unknown)) ||
    (p.errors != null && !Array.isArray(p.errors)) ||
    (p.error != null && typeof p.error !== "string") ||
    (p.error_code != null && typeof p.error_code !== "string")
  )
    return { ok: false, kind: "UNVERIFIED", code: "UNKNOWN_RESPONSE_SHAPE" };
  const statuses = [p.status, p.code, p.result_code, p.run_status, p.outcome].map((v) =>
    typeof v === "string" ? v.toUpperCase() : "",
  );
  if (p.error_code === "PP_STORED_READ_INCOMPLETE")
    return { ok: false, kind: "INCOMPLETE", code: "PP_STORED_READ_INCOMPLETE", deduplicated: p.deduplicated === true };
  if (p.deduplicated === true || statuses.some((s) => s === "DAILY_LIMIT" || s === "DAILY_UPDATE_ALREADY_STARTED"))
    return { ok: false, kind: "DEFERRED", code: "DAILY_UPDATE_ALREADY_STARTED", deduplicated: true };
  const errors = Array.isArray(p.errors) ? p.errors : [];
  const causes = [
    ...statuses,
    typeof p.error_code === "string" ? p.error_code.toUpperCase() : "",
    ...errors.map((e) =>
      typeof e === "string"
        ? e.toUpperCase()
        : e && typeof e === "object" && typeof (e as Record<string, unknown>).code === "string"
          ? String((e as Record<string, unknown>).code).toUpperCase()
          : "",
    ),
  ];
  // A privacy/absence response is not a provider outage; conflicting evidence
  // stays unverified rather than guessing which signal is right.
  const absence = new Set([
    "PROCESO_PRIVADO",
    "PRIVATE",
    "PROVIDER_NOT_FOUND",
    "RADICADO_NOT_FOUND",
    "NOT_FOUND",
    "PROVIDER_NO_DOCUMENT",
  ]);
  if (causes.some((code) => absence.has(code))) return { ok: false, kind: "UNVERIFIED", code: "PRIVATE_OR_NOT_FOUND" };
  if (
    causes.includes("PERSISTENCE_UNKNOWN") ||
    (Array.isArray(p.persistence_unknown) && p.persistence_unknown.length > 0)
  )
    return { ok: false, kind: "UNVERIFIED", code: "PERSISTENCE_UNKNOWN" };
  // Only documented, unambiguous technical errors count as a failed E2E.
  const technical = new Set([
    "SYNC_FAILED",
    "NETWORK_ERROR",
    "FETCH_ERROR",
    "SOURCE_READ_FAILED",
    "PROVIDER_TIMEOUT",
    "SOURCE_TIMEOUT",
    "PERSISTENCE_FAILED",
    "PERSIST_FAILED",
    "PP_CALLER_TIMEOUT",
  ]);
  const technicalCode = causes.find((code) => technical.has(code));
  if (p.ok === false && technicalCode) return { ok: false, kind: "FAILED", code: technicalCode };
  if (statuses.some((s) => /^(ERROR|FAILED|FAILURE|REJECTED|FORBIDDEN|UNAUTHORIZED)$/.test(s)))
    return p.ok === false
      ? { ok: false, kind: "FAILED", code: "SOURCE_FAILED" }
      : { ok: false, kind: "UNVERIFIED", code: "CONTRADICTORY_RESPONSE" };
  if (p.reused_completed_read === true || p.source_query_attempted === false)
    return { ok: false, kind: "UNVERIFIED", code: "STORED_READ_NOT_NEW" };
  if (
    p.source_complete === false ||
    p.consulta_completa === false ||
    p.persistencia_completa === false ||
    p.partial === true ||
    (Array.isArray(p.errors) && p.errors.length > 0) ||
    p.pending_upstream === true ||
    p.scraping_initiated === true ||
    statuses.some((s) => /PENDING|PARTIAL|PARCIAL|STALE|DEFERRED|SCRAPING|PROCESSING/.test(s))
  )
    return { ok: false, kind: "INCOMPLETE", code: "SOURCE_INCOMPLETE" };
  if (statuses.some((s) => /SKIP|NOT_APPLICABLE|NO_APLICA/.test(s)))
    return { ok: false, kind: "UNVERIFIED", code: "SOURCE_NOT_ATTEMPTED" };
  if (p.error_code === "PROVIDER_UNRESOLVED" || p.error_code === "PROVIDER_UNDECLARED")
    return { ok: false, kind: "UNVERIFIED", code: "PROVIDER_UNRESOLVED" };
  const allowed = new Set([
    "",
    "OK",
    "SUCCESS",
    "SUCCESS_EMPTY",
    "SUCCESS_WITH_DATA",
    "EMPTY",
    "PROVIDER_EMPTY_RESULT",
  ]);
  if (statuses.some((s) => !allowed.has(s) && !(s === "NO_DATA" && p.result_code === "SUCCESS_EMPTY")))
    return { ok: false, kind: "UNVERIFIED", code: "UNKNOWN_RESPONSE_STATUS" };
  const verdict = publicReadVerdict(true, p);
  if (!verdict.success || p.source_complete !== true)
    return { ok: false, kind: "UNVERIFIED", code: "COMPLETION_NOT_PROVEN" };
  const provider = typeof p.provider_used === "string" ? canonicalizeProvider(p.provider_used) : null;
  if (!provider || provider.undeclared.length || !isProviderAttributable(provider.providers))
    return { ok: false, kind: "UNVERIFIED", code: "PROVIDER_UNRESOLVED" };
  const observed =
    typeof p.source_observed_at === "string" && /(?:Z|[+-]\d{2}:\d{2})$/i.test(p.source_observed_at)
      ? Date.parse(p.source_observed_at)
      : NaN;
  if (
    !Number.isFinite(observed) ||
    observed > now + 60_000 ||
    now - observed > 24 * 60 * 60_000 ||
    new Date(observed - 5 * 60 * 60_000).toISOString().slice(0, 10) !==
      new Date(now - 5 * 60 * 60_000).toISOString().slice(0, 10)
  )
    return { ok: false, kind: "UNVERIFIED", code: "OBSERVATION_TIME_UNPROVEN" };
  const empty = p.result_code === "SUCCESS_EMPTY" || p.code === "PROVIDER_EMPTY_RESULT" || p.status === "EMPTY";
  return { ok: true, kind: "VERIFIED", code: "SOURCE_READ_VERIFIED", ...(empty ? { empty: true } : {}) };
}

/** Unknown/deferred evidence is neither a pass nor a proven provider outage. */
function e2eOverall(
  steps: ReadonlyArray<{
    name?: string;
    ok: boolean;
    detail?: { verification?: SyncEvidenceKind; check_unavailable?: boolean };
  }>,
) {
  if (steps.some((step) => step.name === "FIND_WORK_ITEM" && !step.ok)) return "FAIL" as const;
  const sync = steps.filter((step) => step.detail?.verification);
  if (sync.some((step) => step.detail?.verification === "FAILED")) return "FAIL" as const;
  if (["SYNC_ACTS", "SYNC_PUBS"].some((name) => !steps.some((step) => step.name === name && step.detail?.verification)))
    return "UNVERIFIED" as const;
  // Never let an old/empty data post-check turn a deferred read into a claimed outage.
  if (sync.some((step) => step.detail?.verification !== "VERIFIED")) return "UNVERIFIED" as const;
  if (steps.some((step) => !step.ok && step.detail?.check_unavailable)) return "UNVERIFIED" as const;
  return steps.every((step) => step.ok) ? ("ALL_PASS" as const) : ("FAIL" as const);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { ...corsHeaders, "X-Andromeda-E2E-Version": "evidence-auth-20261113-v1" } });
  }

  // This background job uses service role and may mutate state. No anonymous
  // request may reach health parsing, data access, a job or an AI action.
  const caller = await requirePrivilegedCaller(req, corsHeaders);
  if (!caller.ok) return caller.response!;

  // Health check
  try {
    const cloned = req.clone();
    const maybeBody = await cloned.json().catch(() => null);
    if (maybeBody?.health_check) {
      return new Response(JSON.stringify({ status: "OK", function: "atenia-e2e-scheduled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch {
    /* not JSON */
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let body: {
    organization_id?: string;
    mode?: "E2E_BATCH" | "REFRESH_REGISTRY" | "FULL";
    trigger?: "SCHEDULED" | "PRE_DAILY_SYNC";
  } = {};
  try {
    body = await req.json();
  } catch {
    /* no body */
  }

  const mode = body.mode ?? "FULL";
  const trigger = body.trigger ?? "SCHEDULED";
  const startTime = Date.now();

  try {
    // Determine orgs
    let orgIds: string[];
    if (body.organization_id) {
      orgIds = [body.organization_id];
    } else {
      const { data: orgRows, error: orgReadError } = await supabase
        .from("work_items")
        .select("organization_id")
        .eq("monitoring_enabled", true)
        .not("organization_id", "is", null);
      if (orgReadError || !Array.isArray(orgRows)) throw new Error("E2E_ORGANIZATIONS_UNAVAILABLE");
      orgIds = [...new Set((orgRows ?? []).map((r: any) => r.organization_id).filter(Boolean))];
    }

    const allResults: any[] = [];
    let budgetExceeded = false;

    for (const orgId of orgIds) {
      // Budget check: 120s max
      if (Date.now() - startTime > 120_000) {
        budgetExceeded = true;
        break;
      }

      try {
        let registryResult: any = null;
        let e2eResult: any = null;

        // REFRESH_REGISTRY
        if (mode === "REFRESH_REGISTRY" || mode === "FULL") {
          registryResult = await refreshE2ERegistry(supabase, orgId);
        }

        // E2E_BATCH
        if (mode === "E2E_BATCH" || mode === "FULL") {
          e2eResult = await runScheduledE2EBatch(supabase, orgId, trigger);
        }

        allResults.push({ org_id: orgId, registry: registryResult, e2e: e2eResult });
      } catch {
        allResults.push({ org_id: orgId, error: "E2E_ORGANIZATION_ERROR" });
      }
    }

    return new Response(
      JSON.stringify({
        ok:
          !budgetExceeded &&
          allResults.every(
            (r) => !r.error && !(r.e2e?.result_write_errors || r.e2e?.followup_errors || r.e2e?.execution_errors),
          ),
        budget_exceeded: budgetExceeded,
        duration_ms: Date.now() - startTime,
        results: allResults,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Registry Refresh ───

async function refreshE2ERegistry(supabase: any, orgId: string): Promise<{ sentinels_added: number }> {
  const { data: workItems, error: workItemsError } = await supabase
    .from("work_items")
    .select("id, radicado, workflow_type, last_successful_sync_at")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .is("deleted_at", null);
  if (workItemsError || !Array.isArray(workItems)) throw new Error("E2E_REGISTRY_SELECTION_FAILED");

  if (!workItems || workItems.length === 0) return { sentinels_added: 0 };

  const byType = new Map<string, typeof workItems>();
  for (const item of workItems) {
    const list = byType.get(item.workflow_type) ?? [];
    list.push(item);
    byType.set(item.workflow_type, list);
  }

  let sentinelsAdded = 0;

  for (const [wfType, items] of byType) {
    const { data: existing, error: existingError } = await supabase
      .from("atenia_e2e_test_registry")
      .select("id")
      .eq("organization_id", orgId)
      .eq("workflow_type", wfType)
      .eq("is_sentinel", true)
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error("E2E_REGISTRY_LOOKUP_FAILED");

    if (existing) continue;

    const sorted = items
      .filter((i: any) => i.last_successful_sync_at)
      .sort(
        (a: any, b: any) =>
          new Date(b.last_successful_sync_at).getTime() - new Date(a.last_successful_sync_at).getTime(),
      );
    const candidate = sorted[0] ?? items[0];
    if (!candidate) continue;

    const { error: registryInsertError } = await supabase.from("atenia_e2e_test_registry").insert({
      organization_id: orgId,
      work_item_id: candidate.id,
      radicado: candidate.radicado,
      workflow_type: candidate.workflow_type,
      providers_to_test: PROVIDERS_FOR_TYPE[candidate.workflow_type] ?? ["CPNU", "PUBLICACIONES"],
      is_sentinel: true,
    });
    if (registryInsertError) throw new Error("E2E_REGISTRY_INSERT_FAILED");
    sentinelsAdded++;
  }

  if (sentinelsAdded > 0) {
    const auditId = await logAction(supabase, {
      action_type: "REFRESH_E2E_REGISTRY",
      actor: "AI_AUTOPILOT",
      scope: "ORG",
      organization_id: orgId,
      autonomy_tier: "ACT",
      reasoning: `Registro E2E actualizado: ${sentinelsAdded} nuevos centinelas añadidos.`,
      action_result: "applied",
      status: "EXECUTED",
      evidence: { sentinels_added: sentinelsAdded },
    });
    if (!auditId) throw new Error("E2E_REGISTRY_AUDIT_FAILED");
  }

  return { sentinels_added: sentinelsAdded };
}

// ─── E2E Batch Runner ───

async function runScheduledE2EBatch(
  supabase: any,
  orgId: string,
  trigger: string,
): Promise<{
  passed: number;
  failed: number;
  unverified: number;
  total: number;
  result_write_errors: number;
  followup_errors: number;
  execution_errors: number;
}> {
  // Get sentinel items
  const { data: sentinels, error: sentinelsError } = await supabase
    .from("atenia_e2e_test_registry")
    .select("*")
    .eq("organization_id", orgId)
    .eq("is_sentinel", true);

  // Get 2 stalest rotating items
  const { data: staleItems, error: staleItemsError } = await supabase
    .from("work_items")
    .select("id, radicado, workflow_type")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .is("deleted_at", null)
    .order("last_successful_sync_at", { ascending: true, nullsFirst: true })
    .limit(2);
  if (sentinelsError || staleItemsError || !Array.isArray(sentinels) || !Array.isArray(staleItems))
    throw new Error("E2E_SELECTION_UNAVAILABLE");

  const sentinelIds = new Set((sentinels ?? []).map((s: any) => s.work_item_id));
  const testItems: Array<{ radicado: string; work_item_id: string; is_sentinel: boolean }> = [];

  for (const s of sentinels ?? []) {
    testItems.push({ radicado: s.radicado, work_item_id: s.work_item_id, is_sentinel: true });
  }
  for (const item of staleItems ?? []) {
    if (!sentinelIds.has(item.id)) {
      testItems.push({ radicado: item.radicado, work_item_id: item.id, is_sentinel: false });
    }
  }

  let passed = 0;
  let failed = 0;
  let unverified = 0;
  let resultWriteErrors = 0;
  let followupErrors = 0;
  let executionErrors = 0;

  for (const test of testItems) {
    let phase: "execution" | "result_write" | "followup" = "execution";
    let savedOutcome: "ALL_PASS" | "FAIL" | "UNVERIFIED" | null = null;
    try {
      // Fix B+C: Validate sentinel before running E2E
      const validation = validateSentinel(test.radicado, test.work_item_id);
      if (!validation.valid) {
        // Mark as PRECONDITION failure, not a real sync failure
        phase = "result_write";
        const { error: resultInsertError } = await supabase.from("atenia_e2e_test_results").insert({
          organization_id: orgId,
          registry_id: (sentinels ?? []).find((s: any) => s.work_item_id === test.work_item_id)?.id ?? null,
          work_item_id: test.work_item_id,
          radicado: test.radicado ?? "",
          workflow_type: "unknown",
          trigger,
          overall: "PRECONDITION_FAIL",
          failure_stage: "PRECONDITION",
          fail_reason: validation.reason,
          failure_summary: validation.detail,
          steps: [{ name: "SENTINEL_VALIDATION", ok: false, latency_ms: 0, error: validation.detail }],
          duration_ms: 0,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        });
        if (resultInsertError) throw new Error("E2E_RESULT_PERSISTENCE_FAILED");
        savedOutcome = "FAIL";
        phase = "followup";

        // Fix C: Auto-disable sentinel after 5 consecutive validation failures
        if (test.is_sentinel) {
          const registryEntry = (sentinels ?? []).find((s: any) => s.work_item_id === test.work_item_id);
          if (registryEntry) {
            const newConsecutive = (registryEntry.consecutive_failures ?? 0) + 1;
            if (newConsecutive >= 5) {
              // Remove sentinel — will be replaced on next registry refresh
              const { error: registryError } = await supabase
                .from("atenia_e2e_test_registry")
                .update({
                  is_sentinel: false,
                  last_tested_at: new Date().toISOString(),
                  last_test_result: "SENTINEL_INVALID",
                  consecutive_failures: newConsecutive,
                })
                .eq("id", registryEntry.id);
              if (registryError) throw new Error("E2E_REGISTRY_UPDATE_FAILED");
              console.warn(`[e2e] Sentinel disabled after ${newConsecutive} consecutive failures: ${test.radicado}`);
            } else {
              const { error: registryError } = await supabase
                .from("atenia_e2e_test_registry")
                .update({
                  last_tested_at: new Date().toISOString(),
                  last_test_result: "PRECONDITION_FAIL",
                  consecutive_failures: newConsecutive,
                })
                .eq("id", registryEntry.id);
              if (registryError) throw new Error("E2E_REGISTRY_UPDATE_FAILED");
            }
          }
        }
        failed++;
        continue;
      }

      const result = await executeServerE2E(supabase, test.work_item_id, test.radicado);
      const overall = e2eOverall(result.steps);

      // Fix B: Determine failure_stage based on which step failed and duration
      let failureStage: string | null = null;
      let failureReason: string | null = null;
      let failureSummary: string | null = null;
      if (overall === "FAIL") {
        const failedStep =
          result.steps.find(
            (s: any) => (!s.ok && s.name === "FIND_WORK_ITEM") || s.detail?.verification === "FAILED",
          ) ?? result.steps.find((s: any) => !s.ok);
        if (failedStep) {
          if (failedStep.name === "FIND_WORK_ITEM") {
            failureStage = "PRECONDITION";
            failureReason = "WORK_ITEM_NOT_FOUND";
          } else if (failedStep.name === "SYNC_ACTS" || failedStep.name === "SYNC_PUBS") {
            failureStage = "SYNC";
            failureReason =
              typeof failedStep.error === "string" && /timeout/i.test(failedStep.error)
                ? "PROVIDER_TIMEOUT"
                : "SYNC_ERROR";
          } else if (failedStep.name === "VERIFY_DB_DATA") {
            failureStage = "POSTCHECK";
            failureReason = "NO_DATA_AFTER_SYNC";
          } else {
            failureStage = "SYNC";
            failureReason = "UNKNOWN";
          }
          failureSummary = `${failedStep.name}: ${failedStep.error ?? "failed"}`.slice(0, 200);
        }
      }

      // Store result with structured failure fields
      const registryEntry = (sentinels ?? []).find((s: any) => s.work_item_id === test.work_item_id);
      phase = "result_write";
      const { error: resultInsertError } = await supabase.from("atenia_e2e_test_results").insert({
        organization_id: orgId,
        registry_id: registryEntry?.id ?? null,
        work_item_id: test.work_item_id,
        radicado: test.radicado,
        workflow_type: result.workflow_type ?? "unknown",
        trigger,
        overall,
        failure_stage: failureStage,
        fail_reason: failureReason,
        failure_summary: failureSummary,
        steps: result.steps,
        duration_ms: result.duration_ms,
        started_at: result.started_at,
        finished_at: result.finished_at,
      });
      if (resultInsertError) throw new Error("E2E_RESULT_PERSISTENCE_FAILED");
      savedOutcome = overall;
      phase = "followup";

      if (overall === "ALL_PASS") {
        if (test.is_sentinel) {
          const { error: registryError } = await supabase
            .from("atenia_e2e_test_registry")
            .update({ last_tested_at: new Date().toISOString(), last_test_result: "ALL_PASS", consecutive_failures: 0 })
            .eq("work_item_id", test.work_item_id)
            .eq("organization_id", orgId);
          if (registryError) throw new Error("E2E_REGISTRY_UPDATE_FAILED");
        }
        passed++;
      } else if (overall === "UNVERIFIED") {
        if (test.is_sentinel) {
          // Do not clear a past failure or increment it for an unverified read.
          const { error: registryError } = await supabase
            .from("atenia_e2e_test_registry")
            .update({ last_tested_at: new Date().toISOString(), last_test_result: "UNVERIFIED" })
            .eq("work_item_id", test.work_item_id)
            .eq("organization_id", orgId);
          if (registryError) throw new Error("E2E_REGISTRY_UPDATE_FAILED");
        }
        unverified++;
      } else {
        if (test.is_sentinel && registryEntry) {
          const newConsecutive = (registryEntry.consecutive_failures ?? 0) + 1;
          const { error: registryError } = await supabase
            .from("atenia_e2e_test_registry")
            .update({
              last_tested_at: new Date().toISOString(),
              last_test_result: "FAIL",
              consecutive_failures: newConsecutive,
            })
            .eq("work_item_id", test.work_item_id)
            .eq("organization_id", orgId);
          if (registryError) throw new Error("E2E_REGISTRY_UPDATE_FAILED");

          // Fix B: Only trigger deep dive for SYNC-stage failures (not PRECONDITION)
          if (newConsecutive >= 3 && failureStage === "SYNC") {
            await triggerDeepDive(supabase, orgId, test.work_item_id, "E2E_SENTINEL_FAILURE", {
              consecutive_e2e_failures: newConsecutive,
              failure_stage: failureStage,
              failure_reason: failureReason,
              last_steps: result.steps.map((s: any) => ({ name: s.name, ok: s.ok })),
            });
          }
        }
        failed++;
      }
    } catch {
      // Count each item once. A saved, proven failure remains a failure even if
      // its later registry/deep-dive effect fails; a pass with failed effects
      // is reported unverified until the whole operation is accounted for.
      if (savedOutcome === "FAIL") failed++;
      else unverified++;
      if (phase === "result_write") resultWriteErrors++;
      else if (phase === "followup") followupErrors++;
      else executionErrors++;
      console.warn(`[atenia-e2e] item incomplete at ${phase}`);
    }
  }

  // Log batch action
  const auditId = await logAction(supabase, {
    action_type: "SCHEDULED_E2E_BATCH",
    actor: "AI_AUTOPILOT",
    scope: "ORG",
    organization_id: orgId,
    autonomy_tier: "ACT",
    reasoning: `E2E programado (${trigger}): ${passed} verificados, ${failed} fallidos y ${unverified} sin verificar de ${testItems.length} asuntos; errores de registro ${resultWriteErrors}, efectos ${followupErrors}, ejecución ${executionErrors}.`,
    action_result:
      failed === 0 && unverified === 0 && resultWriteErrors === 0 && followupErrors === 0 && executionErrors === 0
        ? "applied"
        : "partial",
    status: "EXECUTED",
    evidence: {
      trigger,
      total: testItems.length,
      passed,
      failed,
      unverified,
      result_write_errors: resultWriteErrors,
      followup_errors: followupErrors,
      execution_errors: executionErrors,
    },
  });
  if (!auditId) throw new Error("E2E_BATCH_AUDIT_FAILED");

  return {
    passed,
    failed,
    unverified,
    total: testItems.length,
    result_write_errors: resultWriteErrors,
    followup_errors: followupErrors,
    execution_errors: executionErrors,
  };
}

// ─── Single E2E Execution (server-side, uses service role) ───

async function executeServerE2E(
  supabase: any,
  workItemId: string,
  radicado: string,
): Promise<{
  ok: boolean;
  steps: any[];
  duration_ms: number;
  started_at: string;
  finished_at: string;
  workflow_type?: string;
}> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const steps: Array<{ name: string; ok: boolean; latency_ms: number; detail?: any; error?: string }> = [];

  // Step 1: Find work item
  const s1 = Date.now();
  const { data: item, error: wiErr } = await supabase
    .from("work_items")
    .select("id, radicado, workflow_type, monitoring_enabled, deleted_at, last_successful_sync_at")
    .eq("id", workItemId)
    .single();

  steps.push({
    name: "FIND_WORK_ITEM",
    ok: !!item && !wiErr && !item?.deleted_at,
    latency_ms: Date.now() - s1,
    error: wiErr?.message || (item?.deleted_at ? "Soft-deleted" : undefined),
  });

  if (!item || wiErr) {
    return {
      ok: false,
      steps,
      duration_ms: Date.now() - t0,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
  }

  // Step 2: Sync acts
  const s2 = Date.now();
  try {
    const { data: syncData, error: syncErr } = await invokeInternal(
      "sync-by-work-item",
      { work_item_id: workItemId, trigger: "E2E_TEST", _scheduled: true },
      "atenia-e2e-scheduled",
    );
    const evidence = classifySyncEvidence(syncData, !!syncErr);
    steps.push({
      name: "SYNC_ACTS",
      ok: evidence.ok,
      latency_ms: Date.now() - s2,
      error: evidence.ok ? undefined : evidence.code,
      detail: {
        verification: evidence.kind,
        code: evidence.code,
        ...(evidence.deduplicated ? { deduplicated: true } : {}),
        ...(evidence.empty ? { empty: true } : {}),
      },
    });
  } catch {
    steps.push({
      name: "SYNC_ACTS",
      ok: false,
      latency_ms: Date.now() - s2,
      error: "TRANSPORT_FAILED",
      detail: { verification: "FAILED", code: "TRANSPORT_FAILED" },
    });
  }

  // Step 3: Sync publicaciones
  const s3 = Date.now();
  try {
    const { data: pubData, error: pubErr } = await invokeInternal(
      "sync-publicaciones-by-work-item",
      { work_item_id: workItemId, trigger: "E2E_TEST", _scheduled: true },
      "atenia-e2e-scheduled",
    );
    const evidence = classifySyncEvidence(pubData, !!pubErr);
    steps.push({
      name: "SYNC_PUBS",
      ok: evidence.ok,
      latency_ms: Date.now() - s3,
      error: evidence.ok ? undefined : evidence.code,
      detail: {
        verification: evidence.kind,
        code: evidence.code,
        ...(evidence.deduplicated ? { deduplicated: true } : {}),
        ...(evidence.empty ? { empty: true } : {}),
      },
    });
  } catch {
    steps.push({
      name: "SYNC_PUBS",
      ok: false,
      latency_ms: Date.now() - s3,
      error: "TRANSPORT_FAILED",
      detail: { verification: "FAILED", code: "TRANSPORT_FAILED" },
    });
  }

  // Step 4: Verify data in canonical tables
  const s4 = Date.now();
  const [{ count: actCount, error: actCountError }, { count: pubCount, error: pubCountError }] = await Promise.all([
    supabase.from("work_item_acts").select("id", { count: "exact", head: true }).eq("work_item_id", workItemId),
    supabase
      .from("work_item_publicaciones")
      .select("id", { count: "exact", head: true })
      .eq("work_item_id", workItemId),
  ]);
  const actEvidence = steps.find((s) => s.name === "SYNC_ACTS");
  const pubEvidence = steps.find((s) => s.name === "SYNC_PUBS");
  const actEmpty = actEvidence?.ok === true && actEvidence.detail?.empty === true;
  const pubEmpty = pubEvidence?.ok === true && pubEvidence.detail?.empty === true;
  const countsAvailable =
    !actCountError &&
    !pubCountError &&
    typeof actCount === "number" &&
    typeof pubCount === "number" &&
    Number.isInteger(actCount) &&
    actCount >= 0 &&
    Number.isInteger(pubCount) &&
    pubCount >= 0;
  // A certified empty source needs no stored row. Rows in the other table do
  // not prove materialization; missing evidence is unverified, not data loss.
  const dataVerified = countsAvailable && (actEmpty || actCount! > 0) && (pubEmpty || pubCount! > 0);
  steps.push({
    name: "VERIFY_DB_DATA",
    ok: dataVerified,
    latency_ms: Date.now() - s4,
    detail: {
      actuaciones: countsAvailable ? actCount : null,
      publicaciones: countsAvailable ? pubCount : null,
      acts_empty_certified: actEmpty,
      pubs_empty_certified: pubEmpty,
      check_unavailable: !dataVerified,
    },
    error: dataVerified ? undefined : countsAvailable ? "MATERIALIZATION_UNVERIFIED" : "DATABASE_READ_UNAVAILABLE",
  });

  // Step 5: Source breakdown
  const s5 = Date.now();
  const { data: sources, error: sourcesError } = await supabase
    .from("work_item_acts")
    .select("source")
    .eq("work_item_id", workItemId);
  const breakdown: Record<string, number> = {};
  for (const row of sources ?? []) {
    breakdown[row.source ?? "unknown"] = (breakdown[row.source ?? "unknown"] ?? 0) + 1;
  }
  const breakdownAvailable = !sourcesError && Array.isArray(sources);
  const namedSource = Object.keys(breakdown).some((source) => {
    const canonical = canonicalizeProvider(source);
    return canonical.undeclared.length === 0 && isProviderAttributable(canonical.providers);
  });
  const breakdownVerified = breakdownAvailable && (actEmpty || namedSource);
  steps.push({
    name: "SOURCE_BREAKDOWN",
    ok: breakdownVerified,
    latency_ms: Date.now() - s5,
    detail: { ...breakdown, check_unavailable: !breakdownVerified },
    error: breakdownVerified
      ? undefined
      : breakdownAvailable
        ? "SOURCE_BREAKDOWN_UNVERIFIED"
        : "DATABASE_READ_UNAVAILABLE",
  });

  const allOk = steps.every((s) => s.ok);
  return {
    ok: allOk,
    steps,
    duration_ms: Date.now() - t0,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    workflow_type: item.workflow_type,
  };
}

// ─── Sentinel Validation ───

function validateSentinel(
  radicado: string | null | undefined,
  workItemId: string,
): { valid: boolean; reason: string; detail: string } {
  if (!radicado || radicado.trim() === "") {
    return { valid: false, reason: "RADICADO_EMPTY", detail: `Sentinel ${workItemId.slice(0, 8)} has empty radicado` };
  }
  // Valid radicado format: 23 digits
  const cleaned = radicado.replace(/\D/g, "");
  if (cleaned.length !== 23) {
    return {
      valid: false,
      reason: "RADICADO_INVALID_FORMAT",
      detail: `Radicado ${radicado} has ${cleaned.length} digits, expected 23`,
    };
  }
  if (!workItemId || workItemId.trim() === "") {
    return { valid: false, reason: "WORK_ITEM_MISSING", detail: "No work_item_id provided" };
  }
  return { valid: true, reason: "", detail: "" };
}

// ─── Deep Dive Trigger (server-side) ───

async function triggerDeepDive(
  supabase: any,
  orgId: string,
  workItemId: string,
  criteria: string,
  evidence: Record<string, any>,
): Promise<void> {
  // Rate limit: max 1 per item per 4h
  const { data: recent, error: recentError } = await supabase
    .from("atenia_deep_dives")
    .select("id")
    .eq("work_item_id", workItemId)
    .gte("created_at", new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle();
  if (recentError) throw new Error("E2E_DIVE_LOOKUP_FAILED");

  if (recent) return;

  // Get work item info
  const { data: item, error: itemError } = await supabase
    .from("work_items")
    .select("radicado")
    .eq("id", workItemId)
    .single();
  if (itemError) throw new Error("E2E_DIVE_ITEM_LOOKUP_FAILED");

  // Fix D: Never create deep dive with empty radicado
  const radicado = item?.radicado ?? "";
  if (!radicado || radicado.trim() === "") {
    console.warn(`[e2e] Skipping deep dive for ${workItemId}: empty radicado`);
    return;
  }

  const { error: deepDiveError } = await supabase.from("atenia_deep_dives").insert({
    organization_id: orgId,
    work_item_id: workItemId,
    radicado,
    trigger_criteria: criteria,
    trigger_evidence: evidence,
    status: "RUNNING",
    diagnosis: `Deep dive pendiente — activado por ${criteria}`,
    severity: "HIGH",
  });
  if (deepDiveError) throw new Error("E2E_DIVE_INSERT_FAILED");

  const auditId = await logAction(supabase, {
    action_type: "TRIGGER_DEEP_DIVE",
    actor: "AI_AUTOPILOT",
    scope: "ORG",
    organization_id: orgId,
    work_item_id: workItemId,
    autonomy_tier: "ACT",
    reasoning: `Deep dive activado para ${radicado}: ${criteria}.`,
    action_result: "triggered",
    status: "EXECUTED",
    evidence,
  });
  if (!auditId) throw new Error("E2E_DIVE_AUDIT_FAILED");
}
