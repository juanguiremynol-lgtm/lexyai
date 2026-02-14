/**
 * Email Provider Admin Gateway
 * 
 * Allows platform super admins to securely store/retrieve email provider secrets.
 * Mirrors the billing-admin-gateway pattern (Wompi) for email providers.
 * 
 * Supported providers: Resend, SendGrid, AWS SES, Mailgun, SMTP Custom
 * 
 * GET  — returns config status (keys masked)
 * POST — upserts a config key/value pair
 * DELETE — removes a config key
 * 
 * Auth: platform admin only
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// All possible email provider config keys
const PROVIDER_KEYS: Record<string, string[]> = {
  resend: ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_WEBHOOK_SECRET"],
  sendgrid: ["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL", "SENDGRID_WEBHOOK_SECRET"],
  aws_ses: ["AWS_SES_ACCESS_KEY_ID", "AWS_SES_SECRET_ACCESS_KEY", "AWS_SES_REGION", "AWS_SES_FROM_EMAIL"],
  mailgun: ["MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAILGUN_FROM_EMAIL", "MAILGUN_WEBHOOK_SECRET"],
  smtp: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM_EMAIL", "SMTP_TLS"],
};

const SECRET_KEYS = new Set([
  "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET",
  "SENDGRID_API_KEY", "SENDGRID_WEBHOOK_SECRET",
  "AWS_SES_ACCESS_KEY_ID", "AWS_SES_SECRET_ACCESS_KEY",
  "MAILGUN_API_KEY", "MAILGUN_WEBHOOK_SECRET",
  "SMTP_PASS",
]);

const ALL_KEYS = Object.values(PROVIDER_KEYS).flat();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check
  try {
    const body = req.method === "POST" ? await req.clone().json().catch(() => null) : null;
    if (body?.health_check) {
      return new Response(JSON.stringify({ ok: true, service: "email-provider-admin" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch { /* ignore */ }

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
      // Return config status for all providers, masked
      const { data: configs } = await serviceClient
        .from("email_provider_config")
        .select("config_key, is_secret, environment, updated_at");

      const configMap: Record<string, { configured: boolean; environment: string; updated_at: string }> = {};
      for (const c of configs || []) {
        configMap[c.config_key] = {
          configured: true,
          environment: c.environment,
          updated_at: c.updated_at,
        };
      }

      // Get current provider type from platform_settings
      const { data: settings } = await serviceClient
        .from("platform_settings")
        .select("email_provider_type, email_provider_configured, email_provider_environment")
        .eq("id", "singleton")
        .maybeSingle();

      const providerType = settings?.email_provider_type || null;

      // Build status for each provider
      const providers = Object.entries(PROVIDER_KEYS).map(([provider, keys]) => ({
        provider,
        keys: keys.map((key) => ({
          key,
          is_secret: SECRET_KEYS.has(key),
          configured: !!configMap[key],
          environment: configMap[key]?.environment || null,
          updated_at: configMap[key]?.updated_at || null,
        })),
      }));

      return new Response(JSON.stringify({
        ok: true,
        active_provider: providerType,
        is_configured: settings?.email_provider_configured || false,
        environment: settings?.email_provider_environment || "sandbox",
        providers,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      const reqBody = await req.json();
      const { action } = reqBody;

      // Action: set_provider — sets the active provider type
      if (action === "set_provider") {
        const { provider_type, environment = "sandbox" } = reqBody;
        const validProviders = Object.keys(PROVIDER_KEYS);
        if (!validProviders.includes(provider_type)) {
          return new Response(JSON.stringify({ ok: false, error: `Invalid provider. Allowed: ${validProviders.join(", ")}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await serviceClient
          .from("platform_settings")
          .update({
            email_provider_type: provider_type,
            email_provider_environment: environment,
            email_provider_configured_at: new Date().toISOString(),
            email_provider_configured_by: userId,
          })
          .eq("id", "singleton");

        await serviceClient.from("audit_logs").insert({
          organization_id: "00000000-0000-0000-0000-000000000000",
          actor_user_id: userId,
          actor_type: "PLATFORM_ADMIN",
          action: "EMAIL_PROVIDER_SET",
          entity_type: "platform_settings",
          entity_id: "email_provider_type",
          metadata: { provider_type, environment },
        });

        return new Response(JSON.stringify({ ok: true, provider_type, environment }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Action: save_key — upsert a config key
      if (action === "save_key") {
        const { config_key, config_value, environment = "sandbox" } = reqBody;

        if (!ALL_KEYS.includes(config_key)) {
          return new Response(JSON.stringify({ ok: false, error: `Invalid config key: ${config_key}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!config_value || typeof config_value !== "string" || config_value.trim().length < 2) {
          return new Response(JSON.stringify({ ok: false, error: "Value must be at least 2 characters" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Upsert
        const { error: upsertError } = await serviceClient
          .from("email_provider_config")
          .upsert(
            {
              config_key,
              config_value: config_value.trim(),
              is_secret: SECRET_KEYS.has(config_key),
              environment,
              updated_by: userId,
            },
            { onConflict: "config_key" }
          );

        if (upsertError) {
          console.error("email-provider-admin upsert error:", upsertError);
          return new Response(JSON.stringify({ ok: false, error: "Database error" }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await serviceClient.from("audit_logs").insert({
          organization_id: "00000000-0000-0000-0000-000000000000",
          actor_user_id: userId,
          actor_type: "PLATFORM_ADMIN",
          action: "EMAIL_PROVIDER_CONFIG_UPDATED",
          entity_type: "email_provider_config",
          entity_id: config_key,
          metadata: {
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

      // Action: activate — mark provider as fully configured
      if (action === "activate") {
        const { data: settings } = await serviceClient
          .from("platform_settings")
          .select("email_provider_type")
          .eq("id", "singleton")
          .maybeSingle();

        if (!settings?.email_provider_type) {
          return new Response(JSON.stringify({ ok: false, error: "No provider type selected" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const requiredKeys = PROVIDER_KEYS[settings.email_provider_type] || [];
        const { data: configs } = await serviceClient
          .from("email_provider_config")
          .select("config_key")
          .in("config_key", requiredKeys);

        const configuredKeys = new Set((configs || []).map((c: any) => c.config_key));
        const missing = requiredKeys.filter((k) => !configuredKeys.has(k));

        if (missing.length > 0) {
          return new Response(JSON.stringify({ ok: false, error: `Missing required keys: ${missing.join(", ")}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await serviceClient
          .from("platform_settings")
          .update({
            email_provider_configured: true,
            email_provider_configured_at: new Date().toISOString(),
            email_provider_configured_by: userId,
          })
          .eq("id", "singleton");

        await serviceClient.from("audit_logs").insert({
          organization_id: "00000000-0000-0000-0000-000000000000",
          actor_user_id: userId,
          actor_type: "PLATFORM_ADMIN",
          action: "EMAIL_PROVIDER_ACTIVATED",
          entity_type: "platform_settings",
          entity_id: "email_provider",
          metadata: { provider: settings.email_provider_type, keys_configured: requiredKeys.length },
        });

        return new Response(JSON.stringify({ ok: true, activated: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Action: test_connection — verify credentials work
      if (action === "test_connection") {
        const { data: settings } = await serviceClient
          .from("platform_settings")
          .select("email_provider_type")
          .eq("id", "singleton")
          .maybeSingle();

        if (!settings?.email_provider_type) {
          return new Response(JSON.stringify({ ok: false, error: "No provider selected" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const providerType = settings.email_provider_type;
        const requiredKeys = PROVIDER_KEYS[providerType] || [];
        const { data: configs } = await serviceClient
          .from("email_provider_config")
          .select("config_key, config_value")
          .in("config_key", requiredKeys);

        const configMap: Record<string, string> = {};
        for (const c of configs || []) {
          configMap[c.config_key] = c.config_value;
        }

        // Test based on provider
        try {
          if (providerType === "resend") {
            const apiKey = configMap["RESEND_API_KEY"];
            if (!apiKey) return new Response(JSON.stringify({ ok: false, error: "RESEND_API_KEY not configured" }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });

            const res = await fetch("https://api.resend.com/domains", {
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (res.ok) {
              return new Response(JSON.stringify({ ok: true, test: "passed", message: "Resend API key is valid. Connection successful." }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            } else {
              const err = await res.text();
              return new Response(JSON.stringify({ ok: false, test: "failed", message: `Resend returned ${res.status}: ${err}` }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }

          if (providerType === "sendgrid") {
            const apiKey = configMap["SENDGRID_API_KEY"];
            if (!apiKey) return new Response(JSON.stringify({ ok: false, error: "SENDGRID_API_KEY not configured" }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });

            const res = await fetch("https://api.sendgrid.com/v3/scopes", {
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (res.ok) {
              return new Response(JSON.stringify({ ok: true, test: "passed", message: "SendGrid API key is valid." }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            } else {
              const err = await res.text();
              return new Response(JSON.stringify({ ok: false, test: "failed", message: `SendGrid returned ${res.status}: ${err}` }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }

          // For other providers, just verify keys are set
          return new Response(JSON.stringify({ ok: true, test: "keys_present", message: `All keys configured for ${providerType}. Manual verification recommended.` }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          return new Response(JSON.stringify({ ok: false, test: "error", message: `Connection test failed: ${err}` }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      return new Response(JSON.stringify({ ok: false, error: "Unknown action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("email-provider-admin error:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
