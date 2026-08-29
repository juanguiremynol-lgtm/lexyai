/**
 * scheduled-daily-estados — the ESTADOS channel, on its own cron.
 *
 * IQ2(a)(f): estados (Publicaciones Procesales for CGP/LABORAL/TUTELA/PENAL_906,
 * SAMAI Estados for CPACA) are read independently of the actuaciones channels
 * (CPNU / SAMAI). No channel's result may gate any other channel's execution,
 * so this function never inspects an actuaciones run, never invokes
 * sync-by-work-item, and never concludes anything about a matter from an empty
 * or failing actuaciones read.
 *
 * A matter is skipped ONLY when the lawyer's own decision removed it:
 * deleted, non-ACTIVE lifecycle, or monitoring disabled by the user.
 * Emptiness is never a reason to skip and never a reason to pause.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  PUBLICACIONES_WORKFLOWS,
  SAMAI_ESTADOS_ONLY_WORKFLOWS,
} from "../_shared/syncPolicy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ESTADOS_WORKFLOWS: string[] = [
  ...(PUBLICACIONES_WORKFLOWS as readonly string[]),
  ...(SAMAI_ESTADOS_ONLY_WORKFLOWS as readonly string[]),
];

const MAX_RUNTIME_MS = 50_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cron sends no body */ }
  const dryRun = body?.dry_run === true;
  const limit = Number(body?.limit ?? 400);

  const summary = {
    ok: true,
    dry_run: dryRun,
    targeted: 0,
    invoked: 0,
    queued: 0,
    failed: 0,
    skipped_user_paused: 0,
    errors: [] as Array<{ work_item_id: string; message: string }>,
  };

  try {
    const { data: items, error } = await supabase
      .from("work_items")
      .select("id, organization_id, radicado, workflow_type, stage, lifecycle_state, monitoring_enabled")
      .is("deleted_at", null)
      .eq("lifecycle_state", "ACTIVE")
      .eq("monitoring_enabled", true)
      .not("radicado", "is", null)
      .in("workflow_type", ESTADOS_WORKFLOWS)
      .limit(limit);

    if (error) throw error;

    summary.targeted = items?.length ?? 0;

    for (const item of items ?? []) {
      if (Date.now() - startedAt > MAX_RUNTIME_MS) break;
      if (dryRun) continue;

      try {
        if (item.workflow_type === "PENAL_906") {
          // Isolated execution path, unchanged: PENAL_906 estados run through
          // the retry queue so a slow provider cannot stall the sweep.
          await (supabase.from("sync_retry_queue") as any).upsert(
            {
              work_item_id: item.id,
              organization_id: item.organization_id,
              radicado: item.radicado,
              stage: item.stage ?? null,
              kind: "PUB_RETRY",
              provider: "publicaciones",
              attempt: 1,
              max_attempts: 3,
              next_run_at: new Date(Date.now() + 10_000).toISOString(),
              last_error_message: "Enqueued by scheduled-daily-estados",
            },
            { onConflict: "work_item_id,kind" },
          );
          summary.queued++;
          continue;
        }

        const resp = await fetch(`${supabaseUrl}/functions/v1/sync-publicaciones-by-work-item`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ work_item_id: item.id, _scheduled: true, _force: true }),
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
        }
        summary.invoked++;
      } catch (err) {
        // An estados failure is recorded on the estados channel only. It never
        // degrades, pauses or grades the actuaciones channel.
        summary.failed++;
        summary.errors.push({
          work_item_id: item.id,
          message: (err as Error)?.message ?? String(err),
        });
      }
    }

    return new Response(JSON.stringify({ ...summary, duration_ms: Date.now() - startedAt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error)?.message ?? String(err), ...summary }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
