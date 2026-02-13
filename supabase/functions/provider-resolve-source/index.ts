import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptSecret } from "../_shared/secretsCrypto.ts";
import {
  safeFetchProvider,
  buildAuthHeaders,
  type ProviderInstanceInfo,
  type ProviderSecurityWarning,
} from "../_shared/externalProviderClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session",
};

/** Decode Supabase hex-encoded bytea to Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^\\x/, "");
  return new Uint8Array(clean.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
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

    const adminClient = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { work_item_id, provider_instance_id, input_type, value } = body;

    if (!work_item_id || !provider_instance_id || !input_type || !value) {
      return new Response(
        JSON.stringify({ error: "work_item_id, provider_instance_id, input_type, value required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load work item to get org scoping
    const { data: workItem } = await adminClient
      .from("work_items")
      .select("id, organization_id, owner_id, radicado")
      .eq("id", work_item_id)
      .single();

    if (!workItem) {
      return new Response(JSON.stringify({ error: "Work item not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify org membership
    const { data: membership } = await adminClient
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", workItem.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return new Response(JSON.stringify({ error: "Not a member of this organization" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load instance + connector
    const { data: instance } = await adminClient
      .from("provider_instances")
      .select("*, provider_connectors(*)")
      .eq("id", provider_instance_id)
      .eq("organization_id", workItem.organization_id)
      .single();

    if (!instance) {
      return new Response(JSON.stringify({ error: "Provider instance not found in your org" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decrypt secret
    const { data: secretRow } = await adminClient
      .from("provider_instance_secrets")
      .select("cipher_text, nonce")
      .eq("provider_instance_id", provider_instance_id)
      .eq("is_active", true)
      .single();

    if (!secretRow) {
      return new Response(JSON.stringify({ error: "No active secret" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const decrypted = await decryptSecret(
      hexToBytes(secretRow.cipher_text as string),
      hexToBytes(secretRow.nonce as string),
    );

    const connector = instance.provider_connectors;
    const providerInfo: ProviderInstanceInfo = {
      id: instance.id,
      base_url: instance.base_url,
      auth_type: instance.auth_type,
      timeout_ms: instance.timeout_ms,
      rpm_limit: instance.rpm_limit,
      allowed_domains: connector?.allowed_domains || [],
    };

    // Call /resolve
    const resolveUrl = `${instance.base_url.replace(/\/$/, "")}/resolve`;
    const resolveBody = JSON.stringify({ input_type, value });
    const headers = await buildAuthHeaders({
      instance: providerInfo,
      decryptedSecret: decrypted,
      method: "POST",
      path: "/resolve",
      body: resolveBody,
      orgId: workItem.organization_id,
    });

    const resolveStart = Date.now();
    const securityWarnings: ProviderSecurityWarning[] = [];
    const resolveRes = await safeFetchProvider({
      url: resolveUrl,
      allowlist: providerInfo.allowed_domains,
      init: { method: "POST", headers, body: resolveBody },
      timeoutMs: providerInfo.timeout_ms,
      onSecurityWarning: (w) => securityWarnings.push(w),
    });
    const resolveLatency = Date.now() - resolveStart;
    const resolveData = await resolveRes.json();

    // Write security warning trace if any
    if (securityWarnings.length > 0) {
      await adminClient.from("provider_sync_traces").insert({
        organization_id: workItem.organization_id,
        work_item_id,
        provider_instance_id,
        stage: "SECURITY",
        result_code: "WARN",
        ok: true,
        latency_ms: 0,
        payload: { warnings: securityWarnings },
      });
    }

    // Write trace
    await adminClient.from("provider_sync_traces").insert({
      organization_id: workItem.organization_id,
      work_item_id,
      provider_instance_id,
      stage: "RESOLVE",
      result_code: resolveRes.ok ? "OK" : "ERROR",
      ok: resolveRes.ok,
      latency_ms: resolveLatency,
      payload: { status: resolveRes.status, body: resolveData },
    });

    if (!resolveRes.ok || !resolveData.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: resolveData.error || "Resolve failed",
          status: resolveRes.status,
          duration_ms: Date.now() - startTime,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Upsert work_item_sources
    const providerCaseId = resolveData.provider_case_id || resolveData.case_id || null;
    const sourceUrl = resolveData.source_url || null;

    const { data: source, error: srcErr } = await adminClient
      .from("work_item_sources")
      .upsert(
        {
          organization_id: workItem.organization_id,
          work_item_id,
          provider_instance_id,
          provider_case_id: providerCaseId,
          source_input_type: input_type,
          source_input_value: value,
          source_url: sourceUrl,
          status: "ACTIVE",
          scrape_status: "ERROR", // initial; will be updated by sync
          last_error_code: null,
          last_error_message: null,
          consecutive_failures: 0,
          consecutive_404_count: 0,
          created_by: user.id,
        },
        { onConflict: "work_item_id,provider_instance_id" },
      )
      .select()
      .single();

    if (srcErr) {
      return new Response(
        JSON.stringify({ error: "Failed to upsert source", detail: srcErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Audit
    await adminClient.from("atenia_ai_actions").insert({
      organization_id: workItem.organization_id,
      action_type: "WORK_ITEM_SOURCE_ATTACH",
      autonomy_tier: "USER",
      reasoning: `Attached source "${input_type}:${value}" to work item via provider "${instance.name}"`,
      target_entity_type: "work_item_source",
      target_entity_id: source.id,
      evidence: {
        work_item_id,
        provider_instance_id,
        provider_case_id: providerCaseId,
        input_type,
        resolve_latency_ms: resolveLatency,
        duration_ms: Date.now() - startTime,
      },
    });

    // Trigger initial sync (fire-and-forget)
    try {
      const syncUrl = `${supabaseUrl}/functions/v1/provider-sync-external-provider`;
      await fetch(syncUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ work_item_source_id: source.id }),
      });
    } catch {
      // Non-fatal; sync will be picked up by retry queue
    }

    return new Response(
      JSON.stringify({
        ok: true,
        source,
        provider_case_id: providerCaseId,
        duration_ms: Date.now() - startTime,
      }),
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
