/**
 * Billing Admin Gateway Configuration
 * 
 * Allows platform super admins to securely store/retrieve Wompi gateway secrets
 * via the platform_gateway_config table. Secret values are never returned to frontend—
 * only masked indicators ("configured" / "not configured").
 * 
 * GET  — returns config status (keys masked)
 * POST — upserts a config key/value pair
 * 
 * Auth: platform admin only (via getClaims + platform_admins check)
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_KEYS = [
  "WOMPI_PUBLIC_KEY",
  "WOMPI_PRIVATE_KEY",
  "WOMPI_WEBHOOK_SECRET",
  "WOMPI_INTEGRITY_SECRET",
  "WOMPI_ENVIRONMENT",
];

const SECRET_KEYS = new Set([
  "WOMPI_PRIVATE_KEY",
  "WOMPI_WEBHOOK_SECRET",
  "WOMPI_INTEGRITY_SECRET",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify platform admin
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claims?.claims) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claims.claims.sub;
    const { data: adminCheck } = await serviceClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!adminCheck) {
      return new Response(JSON.stringify({ ok: false, error: "Platform admin required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "GET") {
      // Return masked config status
      const { data: configs } = await serviceClient
        .from("platform_gateway_config")
        .select("config_key, is_secret, environment, updated_at")
        .eq("gateway", "wompi");

      const configMap: Record<string, { configured: boolean; environment: string; updated_at: string }> = {};
      for (const c of configs || []) {
        configMap[c.config_key] = {
          configured: true,
          environment: c.environment,
          updated_at: c.updated_at,
        };
      }

      const status = ALLOWED_KEYS.map((key) => ({
        key,
        is_secret: SECRET_KEYS.has(key),
        configured: !!configMap[key],
        environment: configMap[key]?.environment || null,
        updated_at: configMap[key]?.updated_at || null,
      }));

      return new Response(JSON.stringify({ ok: true, gateway: "wompi", config: status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { config_key, config_value, environment = "sandbox" } = body;

      if (!ALLOWED_KEYS.includes(config_key)) {
        return new Response(JSON.stringify({ ok: false, error: `Invalid config key. Allowed: ${ALLOWED_KEYS.join(", ")}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!config_value || typeof config_value !== "string" || config_value.trim().length < 3) {
        return new Response(JSON.stringify({ ok: false, error: "Config value must be at least 3 characters" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Upsert the config
      const { error: upsertError } = await serviceClient
        .from("platform_gateway_config")
        .upsert(
          {
            gateway: "wompi",
            config_key,
            config_value: config_value.trim(),
            is_secret: SECRET_KEYS.has(config_key),
            environment,
            updated_by: userId,
          },
          { onConflict: "gateway,config_key,environment" }
        );

      if (upsertError) {
        console.error("Failed to upsert gateway config:", upsertError);
        return new Response(JSON.stringify({ ok: false, error: "Database error" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Audit log
      await serviceClient.from("audit_logs").insert({
        organization_id: null,
        actor_user_id: userId,
        actor_type: "PLATFORM_ADMIN",
        action: "GATEWAY_CONFIG_UPDATED",
        entity_type: "platform_gateway_config",
        entity_id: config_key,
        metadata: {
          gateway: "wompi",
          config_key,
          environment,
          is_secret: SECRET_KEYS.has(config_key),
          value_preview: SECRET_KEYS.has(config_key) ? "***REDACTED***" : config_value.slice(0, 8) + "...",
        },
      });

      return new Response(JSON.stringify({ ok: true, config_key, environment }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("billing-admin-gateway error:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
