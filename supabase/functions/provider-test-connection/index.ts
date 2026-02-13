import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptSecret } from "../_shared/secretsCrypto.ts";
import {
  safeFetchProvider,
  buildAuthHeaders,
  validateAllowlistPolicy,
  type ProviderInstanceInfo,
  type ProviderSecurityWarning,
} from "../_shared/externalProviderClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session",
};

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
    const { provider_instance_id } = body;

    if (!provider_instance_id) {
      return new Response(JSON.stringify({ error: "provider_instance_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load instance
    const { data: instance, error: instErr } = await adminClient
      .from("provider_instances")
      .select("*, provider_connectors(*)")
      .eq("id", provider_instance_id)
      .single();

    if (instErr || !instance) {
      return new Response(JSON.stringify({ error: "Instance not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify org membership (admin)
    const { data: membership } = await adminClient
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", instance.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Must be org admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decrypt secret
    const { data: secretRow, error: secErr } = await adminClient
      .from("provider_instance_secrets")
      .select("cipher_text, nonce")
      .eq("provider_instance_id", provider_instance_id)
      .eq("is_active", true)
      .single();

    if (secErr || !secretRow) {
      return new Response(JSON.stringify({ error: "No active secret found" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Convert from Supabase's hex encoding to Uint8Array
    const cipherBytes = new Uint8Array(
      (secretRow.cipher_text as string).replace(/\\x/g, "").match(/.{2}/g)!.map((h: string) => parseInt(h, 16)),
    );
    const nonceBytes = new Uint8Array(
      (secretRow.nonce as string).replace(/\\x/g, "").match(/.{2}/g)!.map((h: string) => parseInt(h, 16)),
    );

    const decrypted = await decryptSecret(cipherBytes, nonceBytes);

    const connector = instance.provider_connectors;
    const providerInfo: ProviderInstanceInfo = {
      id: instance.id,
      base_url: instance.base_url,
      auth_type: instance.auth_type,
      timeout_ms: instance.timeout_ms,
      rpm_limit: instance.rpm_limit,
      allowed_domains: connector?.allowed_domains || [],
    };

    // Eagerly check allowlist policy for warnings (independent of fetch)
    const allowlistWarning = validateAllowlistPolicy(providerInfo.allowed_domains);

    const results: Record<string, unknown> = {};
    const securityWarnings: ProviderSecurityWarning[] = [];
    if (allowlistWarning) securityWarnings.push(allowlistWarning);
    // Test /health
    try {
      const healthUrl = `${instance.base_url.replace(/\/$/, "")}/health`;
      const healthHeaders = await buildAuthHeaders({
        instance: providerInfo,
        decryptedSecret: decrypted,
        method: "GET",
        path: "/health",
        body: "",
        orgId: instance.organization_id,
      });

      const healthStart = Date.now();
      const healthRes = await safeFetchProvider({
        url: healthUrl,
        allowlist: providerInfo.allowed_domains,
        init: { method: "GET", headers: healthHeaders },
        timeoutMs: providerInfo.timeout_ms,
        onSecurityWarning: (w) => securityWarnings.push(w),
      });
      const healthLatency = Date.now() - healthStart;
      const healthBody = await healthRes.text();

      results.health = {
        status: healthRes.status,
        ok: healthRes.ok,
        latency_ms: healthLatency,
        body: healthBody.slice(0, 500),
      };
    } catch (e: unknown) {
      results.health = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    // Test /capabilities
    try {
      const capUrl = `${instance.base_url.replace(/\/$/, "")}/capabilities`;
      const capHeaders = await buildAuthHeaders({
        instance: providerInfo,
        decryptedSecret: decrypted,
        method: "GET",
        path: "/capabilities",
        body: "",
        orgId: instance.organization_id,
      });

      const capStart = Date.now();
      const capRes = await safeFetchProvider({
        url: capUrl,
        allowlist: providerInfo.allowed_domains,
        init: { method: "GET", headers: capHeaders },
        timeoutMs: providerInfo.timeout_ms,
        onSecurityWarning: (w) => securityWarnings.push(w),
      });
      const capLatency = Date.now() - capStart;
      const capBody = await capRes.text();

      results.capabilities = {
        status: capRes.status,
        ok: capRes.ok,
        latency_ms: capLatency,
        body: capBody.slice(0, 1000),
      };
    } catch (e: unknown) {
      results.capabilities = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    // Write security warning trace if any
    if (securityWarnings.length > 0) {
      await adminClient.from("provider_sync_traces").insert({
        organization_id: instance.organization_id,
        provider_instance_id: instance.id,
        stage: "SECURITY",
        result_code: "WARN",
        ok: true,
        latency_ms: 0,
        payload: { warnings: securityWarnings },
      });
    }

    // Write trace
    await adminClient.from("provider_sync_traces").insert({
      organization_id: instance.organization_id,
      provider_instance_id: instance.id,
      stage: "TEST_CONNECTION",
      result_code: (results.health as any)?.ok ? "OK" : "ERROR",
      ok: !!(results.health as any)?.ok,
      latency_ms: Date.now() - startTime,
      payload: results,
    });

    // Audit
    await adminClient.from("atenia_ai_actions").insert({
      organization_id: instance.organization_id,
      action_type: "PROVIDER_INSTANCE_TEST",
      autonomy_tier: "USER",
      reasoning: `Tested connection to "${instance.name}"`,
      target_entity_type: "provider_instance",
      target_entity_id: instance.id,
      evidence: {
        health_ok: !!(results.health as any)?.ok,
        capabilities_ok: !!(results.capabilities as any)?.ok,
        duration_ms: Date.now() - startTime,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        results,
        warnings: securityWarnings,
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
