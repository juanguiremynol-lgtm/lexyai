import { createClient } from "npm:@supabase/supabase-js@2";
import { isCronCaller, CRON_HEADER } from "./cronAuth.ts";
import { PP_ESTADOS_WORKFLOWS, SAMAI_ESTADOS_WORKFLOWS } from "./providerRouting.ts";

const BATCH_SIZE = 5;
const MAX_DEPTH = 12;
const COOLDOWN_MS = 1_500;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};
type Channel = "publicaciones" | "samai_estados";
type ClaimedItem = { work_item_id: string; ordinal: number };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function validRadicado(value: string | null): boolean {
  return Boolean(value && value.replace(/\D/g, "").length === 23);
}

/**
 * XX1(a) — the read must refresh the label it is displayed under.
 * `pp_estado` / `pp_ultima_sync` are what the lawyer's screen shows for the
 * Publicaciones channel. They were written on enrolment and then never again,
 * so matters read successfully yesterday still displayed "error" with a date
 * from May. Every read now restamps them.
 *
 * A routing skip (this source is not in the matter's canonical chain) is NOT a
 * read: it becomes `no_aplica` and must never be shown as a failure.
 */
function ppLabelFromResult(success: boolean, errorCode: string | null, result: Record<string, unknown>): string {
  const signal = String(result.result_code ?? result.outcome ?? errorCode ?? "").toUpperCase();
  if (signal.startsWith("ROUTING_SKIP") || signal.startsWith("SKIP")) return "no_aplica";
  if (signal.includes("PRIVADO")) return "privado";
  if (signal.startsWith("PENDING") || signal === "NO_DATA" || signal === "SCRAPING_INITIATED") return "pending";
  if (signal.includes("NOT_FOUND")) return "no_encontrado";
  return success ? "ok" : "error";
}


export async function runEstadosMonitor(req: Request, channel: Channel): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Método no permitido" }, 405);
  if (!isCronCaller(req)) return response({ error: "No autorizado" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronKey = Deno.env.get("CRON_SERVICE_KEY");
  if (!url || !serviceKey || !cronKey) return response({ error: "Configuración interna incompleta" }, 500);
  const db = createClient(url, serviceKey);
  const body = await req.json().catch(() => ({})) as { run_id?: string; depth_remaining?: number };
  const depthBudget = Math.max(1, Math.min(Number(body.depth_remaining ?? MAX_DEPTH), MAX_DEPTH));
  let runId = body.run_id;
  if (!runId) {
    const workflows = channel === "publicaciones" ? PP_ESTADOS_WORKFLOWS : SAMAI_ESTADOS_WORKFLOWS;
    const orderColumn = channel === "publicaciones" ? "pp_ultima_sync" : "last_synced_at";
    const { data: rows, error } = await db.from("work_items").select("id,radicado")
      .eq("monitoring_enabled", true).is("deleted_at", null).eq("lifecycle_state", "ACTIVE")
      .in("workflow_type", [...workflows]).not("radicado", "is", null)
      .order(orderColumn, { ascending: true, nullsFirst: true }).limit(500);
    if (error) return response({ error: error.message }, 500);
    const ids = (rows ?? []).filter((row) => validRadicado(row.radicado)).map((row) => row.id);
    const runDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
    const { data: claim, error: claimError } = await db.rpc("claim_estados_monitor_run", {
      _channel: channel, _run_date: runDate, _work_item_ids: ids, _depth_budget: depthBudget, _lease_seconds: 180,
    });
    if (claimError) return response({ error: claimError.message }, 500);
    const claimedRun = claim?.[0];
    if (!claimedRun?.acquired) return response({ ok: true, skipped: "single_flight" });
    runId = claimedRun.run_id;
  }
  if (!runId) return response({ error: "No se pudo identificar la corrida" }, 500);
  const { data: claimed, error: batchError } = await db.rpc("claim_estados_monitor_batch", {
    _run_id: runId, _limit: BATCH_SIZE, _lease_seconds: 180,
  });
  if (batchError) return response({ error: batchError.message }, 500);
  for (const item of (claimed ?? []) as ClaimedItem[]) {
    let success = false;
    let errorCode: string | null = null;
    let result: Record<string, unknown> = {};
    try {
      const sync = await fetch(`${url}/functions/v1/sync-publicaciones-by-work-item`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
        body: JSON.stringify({ work_item_id: item.work_item_id, _scheduled: true }),
      });
      result = await sync.json().catch(() => ({ http_status: sync.status }));
      success = sync.ok && result.ok === true;
      errorCode = success ? null : String(result.result_code ?? result.error ?? `HTTP_${sync.status}`);
    } catch (error) { errorCode = error instanceof Error ? error.message.slice(0, 200) : "SYNC_FAILED"; }
    await db.rpc("finish_estados_monitor_item", {
      _run_id: runId, _work_item_id: item.work_item_id, _success: success, _error_code: errorCode, _result: result,
    });
    if (channel === "publicaciones") {
      const label = ppLabelFromResult(success, errorCode, result);
      const patch: Record<string, unknown> = { pp_estado: label };
      // A skip is not a read: it may relabel, but it must not move the clock.
      if (label !== "no_aplica") patch.pp_ultima_sync = new Date().toISOString();
      const { error: labelError } = await db.from("work_items").update(patch).eq("id", item.work_item_id);
      if (labelError) console.error("[estadosMonitor] no se pudo refrescar pp_estado", labelError.message);
    }
  }

  const { data: finish, error: finishError } = await db.rpc("finish_estados_monitor_hop", { _run_id: runId });
  if (finishError) return response({ error: finishError.message }, 500);
  const state = finish?.[0];
  if (state?.remaining_count > 0 && state.depth_remaining > 0) {
    const nextHop = async () => {
      await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS));
      const endpoint = channel === "publicaciones" ? "scheduled-publicaciones-monitor" : "scheduled-samai-estados-monitor";
      const next = await fetch(`${url}/functions/v1/${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json", [CRON_HEADER]: cronKey },
        body: JSON.stringify({ run_id: runId, depth_remaining: state.depth_remaining }),
      });
      if (!next.ok) console.error(`[${endpoint}] chained hop failed: ${next.status}`);
    };
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
    if (runtime) runtime.waitUntil(nextHop()); else await nextHop();
  }
  return response({ ok: true, run_id: runId, channel, ...state });
}