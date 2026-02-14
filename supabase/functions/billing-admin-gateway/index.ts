/**
 * Billing Admin Gateway — Multi-Provider Configuration
 * 
 * Allows platform super admins to securely store/retrieve gateway secrets
 * for ANY registered payment provider (Wompi, Stripe, PayU, PlacetoPay, etc).
 * 
 * GET  — returns config status for all or specific gateway (keys masked)
 * POST — upserts a config key/value pair for any gateway
 * 
 * Auth: platform admin only (via getUser + platform_admins check)
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Provider registry — mirrors frontend PAYMENT_PROVIDERS for validation
const PROVIDER_KEYS: Record<string, { keys: string[]; secretKeys: Set<string> }> = {
  wompi: {
    keys: ["WOMPI_PUBLIC_KEY", "WOMPI_PRIVATE_KEY", "WOMPI_WEBHOOK_SECRET", "WOMPI_INTEGRITY_SECRET", "WOMPI_ENVIRONMENT"],
    secretKeys: new Set(["WOMPI_PRIVATE_KEY", "WOMPI_WEBHOOK_SECRET", "WOMPI_INTEGRITY_SECRET"]),
  },
  stripe: {
    keys: ["STRIPE_PUBLISHABLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    secretKeys: new Set(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]),
  },
  payu: {
    keys: ["PAYU_API_KEY", "PAYU_API_LOGIN", "PAYU_MERCHANT_ID", "PAYU_ACCOUNT_ID", "PAYU_WEBHOOK_SECRET"],
    secretKeys: new Set(["PAYU_API_KEY", "PAYU_WEBHOOK_SECRET"]),
  },
  placetopay: {
    keys: ["PLACETOPAY_LOGIN", "PLACETOPAY_TRANKEY", "PLACETOPAY_BASE_URL"],
    secretKeys: new Set(["PLACETOPAY_TRANKEY"]),
  },
  mercadopago: {
    keys: ["MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_PUBLIC_KEY", "MERCADOPAGO_WEBHOOK_SECRET"],
    secretKeys: new Set(["MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_WEBHOOK_SECRET"]),
  },
  epayco: {
    keys: ["EPAYCO_PUBLIC_KEY", "EPAYCO_PRIVATE_KEY", "EPAYCO_CUSTOMER_ID", "EPAYCO_P_KEY"],
    secretKeys: new Set(["EPAYCO_PRIVATE_KEY", "EPAYCO_P_KEY"]),
  },
};

const ALL_GATEWAYS = Object.keys(PROVIDER_KEYS);

function getAllowedKeysForGateway(gateway: string): string[] {
  return PROVIDER_KEYS[gateway]?.keys || [];
}

function isSecretKey(gateway: string, key: string): boolean {
  return PROVIDER_KEYS[gateway]?.secretKeys.has(key) || false;
}

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
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;
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
      const url = new URL(req.url);
      const gatewayFilter = url.searchParams.get("gateway"); // optional filter

      const gatewaysToQuery = gatewayFilter && ALL_GATEWAYS.includes(gatewayFilter)
        ? [gatewayFilter]
        : ALL_GATEWAYS;

      // Return masked config status for all requested gateways
      let query = serviceClient
        .from("platform_gateway_config")
        .select("gateway, config_key, is_secret, environment, updated_at");

      if (gatewayFilter) {
        query = query.eq("gateway", gatewayFilter);
      }

      const { data: configs } = await query;

      const result: Record<string, { keys: Array<{ key: string; is_secret: boolean; configured: boolean; environment: string | null; updated_at: string | null }> }> = {};

      for (const gw of gatewaysToQuery) {
        const allowedKeys = getAllowedKeysForGateway(gw);
        const gwConfigs = (configs || []).filter(c => c.gateway === gw);
        const configMap: Record<string, { environment: string; updated_at: string }> = {};
        for (const c of gwConfigs) {
          configMap[c.config_key] = { environment: c.environment, updated_at: c.updated_at };
        }

        result[gw] = {
          keys: allowedKeys.map(key => ({
            key,
            is_secret: isSecretKey(gw, key),
            configured: !!configMap[key],
            environment: configMap[key]?.environment || null,
            updated_at: configMap[key]?.updated_at || null,
          })),
        };
      }

      // Determine active gateway
      const { data: activeSetting } = await serviceClient
        .from("platform_gateway_config")
        .select("config_value")
        .eq("gateway", "_system")
        .eq("config_key", "ACTIVE_GATEWAY")
        .maybeSingle();

      return new Response(JSON.stringify({
        ok: true,
        active_gateway: activeSetting?.config_value || "mock",
        gateways: result,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { action } = body;

      // Action: set_active_gateway
      if (action === "set_active_gateway") {
        const { gateway: activeGw } = body;
        if (!ALL_GATEWAYS.includes(activeGw) && activeGw !== "mock") {
          return new Response(JSON.stringify({ ok: false, error: `Invalid gateway: ${activeGw}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await serviceClient
          .from("platform_gateway_config")
          .upsert({
            gateway: "_system",
            config_key: "ACTIVE_GATEWAY",
            config_value: activeGw,
            is_secret: false,
            environment: "production",
            updated_by: userId,
          }, { onConflict: "gateway,config_key,environment" });

        // Audit
        await serviceClient.from("audit_logs").insert({
          organization_id: null,
          actor_user_id: userId,
          actor_type: "PLATFORM_ADMIN",
          action: "ACTIVE_GATEWAY_CHANGED",
          entity_type: "platform_gateway_config",
          entity_id: "ACTIVE_GATEWAY",
          metadata: { new_gateway: activeGw },
        });

        return new Response(JSON.stringify({ ok: true, active_gateway: activeGw }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Action: save_key (default behavior)
      const { gateway, config_key, config_value, environment = "sandbox" } = body;

      if (!gateway || !ALL_GATEWAYS.includes(gateway)) {
        return new Response(JSON.stringify({ ok: false, error: `Invalid gateway. Allowed: ${ALL_GATEWAYS.join(", ")}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const allowedKeys = getAllowedKeysForGateway(gateway);
      if (!allowedKeys.includes(config_key)) {
        return new Response(JSON.stringify({ ok: false, error: `Invalid config key for ${gateway}. Allowed: ${allowedKeys.join(", ")}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!config_value || typeof config_value !== "string" || config_value.trim().length < 3) {
        return new Response(JSON.stringify({ ok: false, error: "Config value must be at least 3 characters" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: upsertError } = await serviceClient
        .from("platform_gateway_config")
        .upsert({
          gateway,
          config_key,
          config_value: config_value.trim(),
          is_secret: isSecretKey(gateway, config_key),
          environment,
          updated_by: userId,
        }, { onConflict: "gateway,config_key,environment" });

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
          gateway,
          config_key,
          environment,
          is_secret: isSecretKey(gateway, config_key),
          value_preview: isSecretKey(gateway, config_key) ? "***REDACTED***" : config_value.slice(0, 8) + "...",
        },
      });

      return new Response(JSON.stringify({ ok: true, gateway, config_key, environment }), {
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
