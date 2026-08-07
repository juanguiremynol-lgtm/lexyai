/**
 * accept-workflow-suggestion — ITER43.
 *
 * Accepting a workflow suggestion re-classifies a matter. Upstream, enrolment
 * is keyed by workflow_type and the only enrolment channel is
 * `POST /lifecycle` with state ACTIVE, whose allow-list
 * (andromeda-read-api/index.js:565) rejects unknown áreas with 400.
 *
 * Therefore a reclassification that is not confirmed upstream silently
 * unsubscribes the matter from monitoring — the worst possible outcome of this
 * feature. This function makes the accept path transactional in practice:
 *
 *   1. capability gate (fail closed) — is the target área enrollable at all?
 *   2. re-enrol upstream with the NEW workflow_type and verify the response;
 *   3. only then commit through `accept_workflow_suggestion(..., true, evidence)`;
 *   4. if the commit fails, roll the upstream enrolment back to the old área.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface EnrolResult {
  ok: boolean;
  status?: number;
  detail?: string;
}

async function enrolUpstream(
  workItem: { id: string; radicado: string | null },
  workflowType: string,
  reason: string,
): Promise<EnrolResult> {
  const url = Deno.env.get("GCP_LIFECYCLE_WEBHOOK_URL");
  const key =
    Deno.env.get("GCP_LIFECYCLE_WEBHOOK_KEY") ??
    Deno.env.get("GCP_LIFECYCLE_WEBHOOK_TOKEN");
  if (!url) {
    return { ok: false, detail: "GCP_LIFECYCLE_WEBHOOK_URL no configurado" };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers["X-API-Key"] = key;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        work_item_id: workItem.id,
        radicado: workItem.radicado,
        workflow_type: workflowType,
        prev_state: "ACTIVE",
        new_state: "ACTIVE",
        reason,
        actor: "USER",
        occurred_at: new Date().toISOString(),
        metadata: { iter43_reclassification: true },
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, status: resp.status, detail: text.slice(0, 300) };
    }
    return { ok: true, status: resp.status };
  } catch (err) {
    return { ok: false, detail: String((err as Error)?.message ?? err).slice(0, 300) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const service = createClient(supabaseUrl, serviceKey);

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ ok: false, error: "Invalid auth" }, 401);

  let body: { suggestion_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Cuerpo inválido" }, 400);
  }
  const suggestionId = body.suggestion_id;
  if (!suggestionId || typeof suggestionId !== "string") {
    return json({ ok: false, error: "Falta suggestion_id" }, 400);
  }

  const { data: sugg } = await service
    .from("work_item_workflow_suggestions")
    .select("id, work_item_id, current_workflow_type, suggested_workflow_type, status")
    .eq("id", suggestionId)
    .maybeSingle();

  if (!sugg) return json({ ok: false, error: "Sugerencia no encontrada" }, 404);
  if (sugg.status !== "PENDING") {
    return json({ ok: false, error: "La sugerencia ya fue resuelta" }, 409);
  }

  // ---- 1. capability gate (fail closed) ----
  const { data: cap } = await service
    .from("upstream_workflow_capability")
    .select("workflow_type, lifecycle_enrollable")
    .eq("workflow_type", sugg.suggested_workflow_type)
    .maybeSingle();

  if (!cap?.lifecycle_enrollable) {
    return json(
      {
        ok: false,
        blocked: "UPSTREAM_NOT_ENROLLABLE",
        error:
          "Pendiente de habilitación en el proveedor — al aplicar, el expediente dejaría de monitorearse",
      },
      409,
    );
  }

  const { data: wi } = await service
    .from("work_items")
    .select("id, radicado, workflow_type, lifecycle_state")
    .eq("id", sugg.work_item_id)
    .maybeSingle();
  if (!wi) return json({ ok: false, error: "Expediente no encontrado" }, 404);

  // ---- 2. re-enrol upstream and verify ----
  const enrol = await enrolUpstream(
    { id: wi.id, radicado: wi.radicado },
    sugg.suggested_workflow_type,
    `ITER43 reclasificación ${sugg.current_workflow_type ?? "?"} → ${sugg.suggested_workflow_type}`,
  );

  if (!enrol.ok) {
    return json(
      {
        ok: false,
        blocked: "UPSTREAM_ENROLMENT_FAILED",
        error:
          "No se pudo confirmar el re-enrolamiento en el proveedor: el cambio de área no se aplicó y el expediente sigue monitoreado como antes.",
        detail: enrol.detail ?? null,
      },
      502,
    );
  }

  // ---- 3. commit, carrying the upstream evidence ----
  const evidence = {
    verified_at: new Date().toISOString(),
    http_status: enrol.status ?? null,
    enrolled_workflow_type: sugg.suggested_workflow_type,
  };

  const { data: rpcData, error: rpcError } = await userClient.rpc(
    "accept_workflow_suggestion",
    {
      _suggestion_id: suggestionId,
      _upstream_enrolled: true,
      _upstream_evidence: evidence,
    },
  );

  if (rpcError) {
    // ---- 4. roll the upstream enrolment back to the previous área ----
    const rollback = await enrolUpstream(
      { id: wi.id, radicado: wi.radicado },
      wi.workflow_type as string,
      "ITER43 rollback: el cambio de área falló en Andromeda",
    );
    console.error(
      `[accept-workflow-suggestion] commit failed for ${suggestionId}; rollback ok=${rollback.ok}`,
      rpcError,
    );
    return json(
      {
        ok: false,
        error: rpcError.message,
        rollback_ok: rollback.ok,
        rollback_detail: rollback.detail ?? null,
      },
      500,
    );
  }

  return json({ ok: true, result: rpcData, upstream: evidence });
});
