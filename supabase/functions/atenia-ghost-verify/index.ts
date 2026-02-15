/**
 * atenia-ghost-verify — Ghost Item Verification with Control Run
 *
 * Before labeling a work item as "ghost" (item-specific issue), this function
 * runs a comparative diagnostic using a known-good "control radicado" from the
 * same category. This ensures we never blame a work item when the real problem
 * is a system-wide regression.
 *
 * Flow:
 *   1. Recheck the failing work item (full trace)
 *   2. Pick a control radicado for the same category
 *   3. Run the same sync pipeline against the control radicado
 *   4. Compare results → classify as SYSTEM_ISSUE or ITEM_SPECIFIC
 *
 * Input: { work_item_id: string, organization_id?: string, trigger?: string }
 * Output: { classification, recheck, control_run, decision_reason }
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Provider strategy by category (mirrors sync-by-work-item)
const CATEGORY_PROVIDERS: Record<string, string[]> = {
  CGP: ["cpnu", "publicaciones"],
  LABORAL: ["cpnu", "publicaciones"],
  PENAL_906: ["cpnu", "publicaciones"],
  CPACA: ["samai", "samai_estados"],
  TUTELA: ["cpnu", "samai", "tutelas", "publicaciones", "samai_estados"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json().catch(() => ({}));

    // Health check
    if (body.health_check) {
      return json({ ok: true, service: "atenia-ghost-verify" });
    }

    const { work_item_id, trigger = "CONSECUTIVE_FAILURES" } = body;

    if (!work_item_id) {
      return json({ error: "work_item_id required" }, 400);
    }

    // ── 1. Load the failing work item ──
    const { data: workItem, error: wiErr } = await supabase
      .from("work_items")
      .select(
        "id, organization_id, radicado, workflow_type, monitoring_enabled, consecutive_404_count"
      )
      .eq("id", work_item_id)
      .maybeSingle();

    if (wiErr || !workItem) {
      return json({ error: "Work item not found", detail: wiErr?.message }, 404);
    }

    const orgId = body.organization_id || workItem.organization_id;
    const category = workItem.workflow_type;

    // ── 2. Load failure state ──
    const { data: state } = await (supabase as any)
      .from("atenia_ai_work_item_state")
      .select("consecutive_not_found, consecutive_timeouts, consecutive_other_errors, last_error_code")
      .eq("work_item_id", work_item_id)
      .maybeSingle();

    const consecutiveFailures =
      (state?.consecutive_not_found ?? 0) +
      (state?.consecutive_timeouts ?? 0) +
      (state?.consecutive_other_errors ?? 0);

    // ── 3. Create verification run record ──
    const { data: run, error: runErr } = await (supabase as any)
      .from("ghost_verification_runs")
      .insert({
        work_item_id,
        organization_id: orgId,
        trigger_reason: trigger,
        consecutive_failures: consecutiveFailures,
        classification: "PENDING",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (runErr) {
      console.error("[ghost-verify] Failed to create run:", runErr.message);
      return json({ error: "Failed to create verification run" }, 500);
    }

    const runId = run.id;

    // ── 4. Recheck the failing work item ──
    console.log(`[ghost-verify] Step A: Rechecking work item ${work_item_id}`);
    let recheckResult: any = null;
    try {
      const { data, error } = await supabase.functions.invoke("sync-by-work-item", {
        body: {
          work_item_id,
          force_refresh: true,
          _scheduled: true,
          _ghost_verify: true,
        },
      });
      recheckResult = error ? { ok: false, error: error.message } : data;
    } catch (e) {
      recheckResult = { ok: false, error: String(e) };
    }

    const recheckStatus = recheckResult?.ok
      ? recheckResult.inserted_count > 0
        ? "FOUND_COMPLETE"
        : "FOUND_PARTIAL"
      : recheckResult?.code === "RECORD_NOT_FOUND" || recheckResult?.code === "NOT_FOUND"
        ? "NOT_FOUND"
        : "ERROR";

    const recheckProviders = (recheckResult?.provider_attempts || []).map(
      (p: any) => p.provider
    );
    const recheckSucceeded = (recheckResult?.provider_attempts || [])
      .filter((p: any) => p.status === "success")
      .map((p: any) => p.provider);

    // Update run with recheck results
    await (supabase as any)
      .from("ghost_verification_runs")
      .update({
        recheck_status: recheckStatus,
        recheck_providers_attempted: recheckProviders,
        recheck_providers_succeeded: recheckSucceeded,
        recheck_trace_id: recheckResult?.trace_id || null,
      })
      .eq("id", runId);

    // If recheck succeeded (data found), item is NOT a ghost
    if (recheckStatus === "FOUND_COMPLETE" || recheckStatus === "FOUND_PARTIAL") {
      await finalizeRun(supabase, runId, work_item_id, orgId, "RESOLVED", 
        "El recheck encontró datos. El item no es fantasma — posible recuperación del proveedor.", "NO_ACTION");
      return json({
        classification: "RESOLVED",
        run_id: runId,
        recheck: { status: recheckStatus, providers: recheckProviders },
        control_run: null,
        decision_reason: "Recheck succeeded — item recovered.",
      });
    }

    // ── 5. Find a control radicado for the same category ──
    console.log(`[ghost-verify] Step B: Finding control radicado for ${category}`);
    const { data: controlRadicados } = await (supabase as any)
      .from("control_radicados")
      .select("id, radicado, category, dane_code, city")
      .eq("category", category)
      .eq("is_active", true)
      .order("last_verified_at", { ascending: true, nullsFirst: true })
      .limit(3);

    if (!controlRadicados || controlRadicados.length === 0) {
      // No control radicado available — classify as INCONCLUSIVE
      await finalizeRun(supabase, runId, work_item_id, orgId, "INCONCLUSIVE",
        `No hay radicado de control configurado para la categoría ${category}. No se puede determinar si es un problema del sistema o del item.`,
        "NO_ACTION");
      return json({
        classification: "INCONCLUSIVE",
        run_id: runId,
        recheck: { status: recheckStatus, providers: recheckProviders },
        control_run: null,
        decision_reason: `No control radicado available for category ${category}.`,
      });
    }

    // Pick one (round-robin by least-recently-verified)
    const controlRad = controlRadicados[0];

    // ── 6. Run control radicado through the same pipeline ──
    console.log(`[ghost-verify] Step C: Control run with radicado ${controlRad.radicado}`);
    let controlResult: any = null;
    try {
      const { data, error } = await supabase.functions.invoke("sync-by-radicado", {
        body: {
          radicado: controlRad.radicado,
          workflow_type: category,
          _scheduled: true,
          _ghost_verify_control: true,
        },
      });
      controlResult = error ? { ok: false, error: error.message } : data;
    } catch (e) {
      controlResult = { ok: false, error: String(e) };
    }

    const controlStatus = controlResult?.ok
      ? controlResult.inserted_count > 0 || controlResult.skipped_count > 0
        ? "FOUND_COMPLETE"
        : "FOUND_PARTIAL"
      : controlResult?.code === "RECORD_NOT_FOUND" || controlResult?.code === "NOT_FOUND"
        ? "NOT_FOUND"
        : "ERROR";

    const controlProviders = (controlResult?.provider_attempts || []).map(
      (p: any) => p.provider
    );
    const controlSucceeded = (controlResult?.provider_attempts || [])
      .filter((p: any) => p.status === "success")
      .map((p: any) => p.provider);

    // Update control radicado's last verified status
    await (supabase as any)
      .from("control_radicados")
      .update({
        last_verified_at: new Date().toISOString(),
        last_verified_status: controlStatus,
      })
      .eq("id", controlRad.id);

    // ── 7. Decision logic ──
    let classification: string;
    let classificationReason: string;
    let actionTaken: string;
    let incidentId: string | null = null;

    if (controlStatus === "ERROR" || controlStatus === "NOT_FOUND") {
      // CONTROL RUN FAILED → System issue, not item-specific
      classification = "SYSTEM_ISSUE";
      classificationReason = `El radicado de control (${controlRad.radicado}) también falló con estado "${controlStatus}". ` +
        `Esto indica un problema sistémico en la ruta de sincronización para categoría ${category}, no un problema del radicado del usuario.`;
      actionTaken = "INCIDENT_CREATED";

      // Create system incident
      const { data: incident, error: incidentErr } = await supabase
        .from("atenia_ai_conversations")
        .insert({
          title: `[SISTEMA] Falla de sync detectada para categoría ${category}`,
          scope: "ORG",
          channel: "SYSTEM",
          status: "OPEN",
          severity: "CRITICAL",
          summary: classificationReason,
          organization_id: orgId,
          related_work_item_ids: [work_item_id],
          related_workflows: [category],
        })
        .select("id")
        .single();

      if (incidentErr) {
        console.error("[ghost-verify] Failed to create incident:", incidentErr.message);
      }
      incidentId = incident?.id || null;

      // Log action
      await supabase.from("atenia_ai_actions").insert({
        actor: "ATENIA",
        organization_id: orgId,
        work_item_id,
        action_type: "GHOST_VERIFY_SYSTEM_ISSUE",
        autonomy_tier: "OBSERVE",
        reasoning: classificationReason,
        evidence: {
          run_id: runId,
          recheck_status: recheckStatus,
          control_radicado: controlRad.radicado,
          control_status: controlStatus,
          control_providers: controlProviders,
          expected_providers: CATEGORY_PROVIDERS[category] || [],
        },
        is_reversible: false,
      });
    } else {
      // CONTROL RUN SUCCEEDED → Item-specific issue
      classification = "ITEM_SPECIFIC";
      classificationReason = `El radicado de control (${controlRad.radicado}) se sincronizó exitosamente (${controlStatus}), ` +
        `pero el radicado del usuario sigue sin encontrarse. Esto confirma que la ruta de sync funciona correctamente para ${category}. ` +
        `El problema es específico de este radicado (posible digitación incorrecta, juzgado sin publicación digital, o proceso archivado).`;
      actionTaken = "PARKED";

      // Log action
      await supabase.from("atenia_ai_actions").insert({
        actor: "ATENIA",
        organization_id: orgId,
        work_item_id,
        action_type: "GHOST_VERIFY_ITEM_SPECIFIC",
        autonomy_tier: "OBSERVE",
        reasoning: classificationReason,
        evidence: {
          run_id: runId,
          recheck_status: recheckStatus,
          control_radicado: controlRad.radicado,
          control_status: controlStatus,
          control_providers: controlProviders,
          expected_providers: CATEGORY_PROVIDERS[category] || [],
        },
        is_reversible: false,
      });
    }

    // ── 8. Finalize ──
    await (supabase as any)
      .from("ghost_verification_runs")
      .update({
        control_radicado_id: controlRad.id,
        control_radicado: controlRad.radicado,
        control_category: category,
        control_run_status: controlStatus,
        control_providers_attempted: controlProviders,
        control_providers_succeeded: controlSucceeded,
        classification,
        classification_reason: classificationReason,
        action_taken: actionTaken,
        incident_id: incidentId,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    // Update work_items ghost verification fields
    await supabase
      .from("work_items")
      .update({
        ghost_candidate_at: new Date().toISOString(),
        ghost_verification_status: classification,
        ghost_verification_run_id: runId,
        ...(classification === "ITEM_SPECIFIC"
          ? { monitoring_mode: "PARKED" }
          : {}),
      } as any)
      .eq("id", work_item_id);

    // Provider coverage metric
    const expectedProviders = CATEGORY_PROVIDERS[category] || [];
    const attemptedProviders = [...new Set([...recheckProviders, ...controlProviders])];

    return json({
      classification,
      run_id: runId,
      recheck: {
        status: recheckStatus,
        providers_attempted: recheckProviders,
        providers_succeeded: recheckSucceeded,
        trace_id: recheckResult?.trace_id,
      },
      control_run: {
        radicado: controlRad.radicado,
        status: controlStatus,
        providers_attempted: controlProviders,
        providers_succeeded: controlSucceeded,
      },
      provider_coverage: {
        expected: expectedProviders,
        attempted: attemptedProviders,
        coverage_pct: expectedProviders.length > 0
          ? Math.round((attemptedProviders.filter(p => expectedProviders.includes(p)).length / expectedProviders.length) * 100)
          : 100,
      },
      decision_reason: classificationReason,
      incident_id: incidentId,
    });
  } catch (err) {
    console.error("[ghost-verify] Unhandled error:", err);
    return json({ error: "Internal server error", detail: String(err) }, 500);
  }
});

// ── Helper: Finalize run with classification ──
async function finalizeRun(
  supabase: any,
  runId: string,
  workItemId: string,
  orgId: string,
  classification: string,
  reason: string,
  action: string,
) {
  await supabase
    .from("ghost_verification_runs")
    .update({
      classification,
      classification_reason: reason,
      action_taken: action,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (classification !== "PENDING") {
    await supabase
      .from("work_items")
      .update({
        ghost_verification_status: classification,
        ghost_verification_run_id: runId,
      })
      .eq("id", workItemId);
  }
}
