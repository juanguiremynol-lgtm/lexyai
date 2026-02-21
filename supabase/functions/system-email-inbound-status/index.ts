/**
 * system-email-inbound-status — Returns secret readiness and last inbound event.
 * AUTH REQUIRED, super_admin only.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Invalid token" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: adminRec } = await adminClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (!adminRec) {
      return json({ error: "Forbidden" }, 403);
    }

    // Secret check
    const hasSecret = !!Deno.env.get("RESEND_INBOUND_WEBHOOK_SECRET");

    // Last event in 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: events } = await adminClient
      .from("system_email_events")
      .select("id, event_id, created_at")
      .eq("provider", "resend")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);

    const lastEvent = events?.[0] || null;

    return json({
      ok: true,
      hasSecret,
      lastEvent: lastEvent
        ? { id: lastEvent.event_id, at: lastEvent.created_at }
        : null,
      hasRecentEvent: !!lastEvent,
    });
  } catch (err: any) {
    console.error("[inbound-status]", err);
    return json({ error: err.message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
