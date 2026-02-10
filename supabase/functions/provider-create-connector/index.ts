import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Auth: require platform admin
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller identity
    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check platform admin
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: adminRow } = await adminClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!adminRow) {
      return new Response(JSON.stringify({ error: "Not a platform admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { key, name, description, capabilities, allowed_domains, schema_version } = body;

    if (!key || !name) {
      return new Response(JSON.stringify({ error: "key and name are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert connector
    const { data: connector, error: insertErr } = await adminClient
      .from("provider_connectors")
      .insert({
        key,
        name,
        description: description || null,
        schema_version: schema_version || "atenia.v1",
        capabilities: capabilities || [],
        allowed_domains: allowed_domains || [],
        is_enabled: true,
        created_by: user.id,
      })
      .select()
      .single();

    if (insertErr) {
      const status = insertErr.code === "23505" ? 409 : 500;
      return new Response(
        JSON.stringify({ error: insertErr.message, code: insertErr.code }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Audit
    await adminClient.from("atenia_ai_actions").insert({
      organization_id: "a0000000-0000-0000-0000-000000000001", // platform-level
      action_type: "PROVIDER_CONNECTOR_CREATE",
      autonomy_tier: "SYSTEM",
      reasoning: `Platform admin created connector "${key}"`,
      target_entity_type: "provider_connector",
      target_entity_id: connector.id,
      evidence: {
        key,
        name,
        capabilities: capabilities || [],
        allowed_domains: allowed_domains || [],
        duration_ms: Date.now() - startTime,
      },
    });

    return new Response(
      JSON.stringify({ ok: true, connector, duration_ms: Date.now() - startTime }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
