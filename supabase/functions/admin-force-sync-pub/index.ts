/**
 * admin-force-sync-pub — Admin helper to invoke sync-publicaciones-by-work-item
 * for a single work_item with service-role auth. Used by:
 *   - Manual re-sync from the UI chip (Phase 2 step 6)
 *   - Backfill scripts (Phase 2 step 4)
 *   - Diagnostic gates during rollout
 *
 * Auth: requires the caller to present ADMIN_FORCE_SYNC_TOKEN in the
 * `x-admin-token` header. Never expose this endpoint to end users.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const adminToken = Deno.env.get("ADMIN_FORCE_SYNC_TOKEN") || "";

  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Missing Supabase env" }, 500);
  }
  if (!adminToken) {
    return json({ ok: false, error: "ADMIN_FORCE_SYNC_TOKEN not configured" }, 500);
  }
  const presented = req.headers.get("x-admin-token") || "";
  if (presented !== adminToken) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body: { work_item_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  const workItemId = body.work_item_id;
  if (!workItemId) return json({ ok: false, error: "work_item_id required" }, 400);

  const started = Date.now();
  const resp = await fetch(
    `${supabaseUrl}/functions/v1/sync-publicaciones-by-work-item`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ work_item_id: workItemId, _scheduled: true }),
    },
  );
  const text = await resp.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }

  return json({
    ok: resp.ok,
    http_status: resp.status,
    duration_ms: Date.now() - started,
    work_item_id: workItemId,
    result: parsed,
  }, resp.ok ? 200 : 502);
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}