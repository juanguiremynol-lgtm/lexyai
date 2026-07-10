/**
 * gcp-lifecycle-broadcaster
 *
 * Consumes `public.gcp_lifecycle_outbox` (delivered_at IS NULL) in FIFO order,
 * POSTs each event to the GCP lifecycle webhook, and marks it delivered
 * on success. Failures increment `delivery_attempts` and record
 * `last_delivery_error`, leaving the row for a future run.
 *
 * Contract (POST body):
 *   {
 *     work_item_id, radicado, workflow_type,
 *     prev_state, new_state, reason,
 *     actor, actor_user_id, occurred_at, metadata
 *   }
 *
 * Env:
 *   GCP_LIFECYCLE_WEBHOOK_URL   — full URL to POST to
 *   GCP_LIFECYCLE_WEBHOOK_KEY   — API key sent in the `X-API-Key` header
 *                                 (accepts legacy GCP_LIFECYCLE_WEBHOOK_TOKEN as fallback)
 *
 * If GCP_LIFECYCLE_WEBHOOK_URL is not set, the run exits cleanly reporting
 * "no-op: webhook not configured". Outbox rows stay pending (no loss).
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_LIMIT = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const webhookUrl = Deno.env.get("GCP_LIFECYCLE_WEBHOOK_URL");
  const webhookKey =
    Deno.env.get("GCP_LIFECYCLE_WEBHOOK_KEY") ??
    Deno.env.get("GCP_LIFECYCLE_WEBHOOK_TOKEN");

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: pending, error } = await supabase
    .from("gcp_lifecycle_outbox")
    .select(
      "id, work_item_id, radicado, workflow_type, prev_state, new_state, reason, actor, actor_user_id, occurred_at, metadata, delivery_attempts",
    )
    .is("delivered_at", null)
    .order("occurred_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("[gcp-lifecycle-broadcaster] list error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const total = pending?.length ?? 0;

  if (!webhookUrl) {
    console.warn(
      "[gcp-lifecycle-broadcaster] GCP_LIFECYCLE_WEBHOOK_URL not configured — retaining " +
        total + " pending events for future delivery.",
    );
    return new Response(
      JSON.stringify({
        ok: true,
        no_op: true,
        reason: "GCP_LIFECYCLE_WEBHOOK_URL not configured",
        pending: total,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let delivered = 0;
  let failed = 0;
  let skipped_no_radicado = 0;

  for (const row of pending ?? []) {
    // Skip work items without radicado: GCP scraper never had a counterpart
    // to reconcile, so a POST would loop forever on legitimate 400 rejections.
    if (!row.radicado || String(row.radicado).trim() === "") {
      await supabase
        .from("gcp_lifecycle_outbox")
        .update({
          delivered_at: new Date().toISOString(),
          delivery_attempts: (row.delivery_attempts ?? 0) + 1,
          last_delivery_error: null,
          metadata: {
            ...(row.metadata ?? {}),
            skip_reason: "NO_RADICADO_NO_GCP_COUNTERPART",
          },
        })
        .eq("id", row.id);
      skipped_no_radicado++;
      continue;
    }

    const body = {
      work_item_id: row.work_item_id,
      radicado: row.radicado,
      workflow_type: row.workflow_type,
      prev_state: row.prev_state,
      new_state: row.new_state,
      reason: row.reason,
      actor: row.actor,
      actor_user_id: row.actor_user_id,
      occurred_at: row.occurred_at,
      metadata: row.metadata ?? {},
    };

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (webhookKey) {
        headers["X-API-Key"] = webhookKey;
      }
      const resp = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }

      await supabase
        .from("gcp_lifecycle_outbox")
        .update({
          delivered_at: new Date().toISOString(),
          delivery_attempts: (row.delivery_attempts ?? 0) + 1,
          last_delivery_error: null,
        })
        .eq("id", row.id);
      delivered++;
    } catch (err) {
      failed++;
      await supabase
        .from("gcp_lifecycle_outbox")
        .update({
          delivery_attempts: (row.delivery_attempts ?? 0) + 1,
          last_delivery_error: String((err as Error)?.message ?? err).slice(0, 500),
        })
        .eq("id", row.id);
      console.warn(`[gcp-lifecycle-broadcaster] delivery failed id=${row.id}:`, err);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      picked: total,
      delivered,
      failed,
      skipped_no_radicado,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});