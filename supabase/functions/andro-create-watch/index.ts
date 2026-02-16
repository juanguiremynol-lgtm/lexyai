/**
 * andro-create-watch — Create a "Watch until next run" notification.
 *
 * The watch will be evaluated during POST_DAILY_SYNC audits.
 * NO sync is triggered. Read-only + write a watch record.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VALID_CONDITIONS = [
  "ZERO_ESTADOS",
  "NO_NEW_ACTUACIONES",
  "STILL_FAILING",
  "STILL_DEAD_LETTERED",
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const workItemId = body.work_item_id as string;
    const conditionType = body.condition_type as string;

    if (!workItemId) {
      return new Response(JSON.stringify({ error: "work_item_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!conditionType || !VALID_CONDITIONS.includes(conditionType as any)) {
      return new Response(JSON.stringify({
        error: `Invalid condition_type. Valid: ${VALID_CONDITIONS.join(", ")}`,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user has access to this work item (RLS-enforced)
    const { data: wi } = await userClient
      .from("work_items")
      .select("id, organization_id")
      .eq("id", workItemId)
      .maybeSingle();

    if (!wi) {
      return new Response(JSON.stringify({ error: "Work item not found or not authorized" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check for existing active watch on same item + condition
    const { data: existing } = await userClient
      .from("sync_watches")
      .select("id")
      .eq("user_id", user.id)
      .eq("work_item_id", workItemId)
      .eq("condition_type", conditionType)
      .eq("status", "ACTIVE")
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({
        ok: true,
        watch_id: existing.id,
        message: "Ya tienes una vigilancia activa para esta condición.",
        already_exists: true,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create watch (expires in 72h)
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const { data: watch, error: insertErr } = await userClient
      .from("sync_watches")
      .insert({
        user_id: user.id,
        organization_id: wi.organization_id,
        work_item_id: workItemId,
        condition_type: conditionType,
        condition_params: body.condition_params || {},
        expires_at: expiresAt,
      })
      .select("id, created_at, expires_at")
      .single();

    if (insertErr) {
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log action
    await adminClient.from("atenia_assistant_actions").insert({
      organization_id: wi.organization_id,
      user_id: user.id,
      action_type: "CREATE_SYNC_WATCH",
      work_item_id: workItemId,
      input: { condition_type: conditionType, expires_at: expiresAt },
      status: "EXECUTED",
    }).catch(() => {});

    return new Response(JSON.stringify({
      ok: true,
      watch_id: watch?.id,
      expires_at: expiresAt,
      message: `Vigilancia creada. Serás notificado después del próximo sync diario si la condición "${conditionType}" persiste. Expira en 72 horas.`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    console.error("[andro-create-watch] Error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
