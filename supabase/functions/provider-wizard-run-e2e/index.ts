import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { work_item_id, connector_id, instance_id, input_type, value } = body;

    if (!work_item_id || !instance_id || !value) {
      return new Response(JSON.stringify({ error: "Missing required fields: work_item_id, instance_id, value" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const steps: Array<{ step: string; status: string; detail?: any; duration_ms?: number }> = [];

    // Step 1: Resolve
    const resolveStart = Date.now();
    let resolveResult: any = null;
    try {
      const resolveResp = await fetch(`${supabaseUrl}/functions/v1/provider-resolve-source`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          work_item_id,
          provider_instance_id: instance_id,
          input_type: input_type || "RADICADO",
          value,
        }),
      });
      resolveResult = await resolveResp.json();
      steps.push({
        step: "RESOLVE",
        status: resolveResult?.ok ? "OK" : "FAIL",
        detail: { provider_case_id: resolveResult?.provider_case_id, source_id: resolveResult?.source?.id },
        duration_ms: Date.now() - resolveStart,
      });
    } catch (err: any) {
      steps.push({ step: "RESOLVE", status: "ERROR", detail: { error: err.message }, duration_ms: Date.now() - resolveStart });
      return new Response(JSON.stringify({ ok: false, steps }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!resolveResult?.ok || !resolveResult?.source?.id) {
      return new Response(JSON.stringify({ ok: false, steps, error: "Resolve failed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 2: Sync
    const syncStart = Date.now();
    let syncResult: any = null;
    try {
      const syncResp = await fetch(`${supabaseUrl}/functions/v1/provider-sync-external-provider`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ work_item_source_id: resolveResult.source.id }),
      });
      syncResult = await syncResp.json();
      steps.push({
        step: "SYNC",
        status: syncResult?.ok ? "OK" : syncResult?.code || "FAIL",
        detail: {
          inserted_actuaciones: syncResult?.inserted_actuaciones ?? 0,
          inserted_publicaciones: syncResult?.inserted_publicaciones ?? 0,
          code: syncResult?.code,
        },
        duration_ms: Date.now() - syncStart,
      });
    } catch (err: any) {
      steps.push({ step: "SYNC", status: "ERROR", detail: { error: err.message }, duration_ms: Date.now() - syncStart });
    }

    // Write audit trace
    try {
      await supabase.from("provider_sync_traces").insert({
        provider_instance_id: instance_id,
        work_item_id,
        scope: "E2E_WIZARD",
        outcome: syncResult?.ok ? "OK" : "ERROR",
        duration_ms: steps.reduce((sum, s) => sum + (s.duration_ms || 0), 0),
        detail: { steps, wizard: true, actor: user.id },
      });
    } catch (_) {
      // Trace write is best-effort
    }

    const allOk = steps.every((s) => s.status === "OK");
    return new Response(JSON.stringify({ ok: allOk, steps }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
