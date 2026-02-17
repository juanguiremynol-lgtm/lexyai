/**
 * Email Provider Admin Gateway
 * 
 * Allows platform super admins to securely store/retrieve email provider secrets.
 * Mirrors the billing-admin-gateway pattern (Wompi) for email providers.
 * 
 * Supported providers: Resend, SendGrid, AWS SES, Mailgun, SMTP Custom
 * 
 * GET  — returns config status (keys masked)
 * POST actions:
 *   set_provider     — sets the active provider type
 *   save_key         — upserts a config key/value pair
 *   activate         — marks provider as fully configured
 *   test_connection  — verifies API credentials via provider API
 *   send_test_email  — sends a real test email through email_outbox pipeline
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

// Required keys per provider (excludes optional webhook secrets)
const REQUIRED_KEYS: Record<string, string[]> = {
  resend: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
  sendgrid: ["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL"],
  aws_ses: ["AWS_SES_ACCESS_KEY_ID", "AWS_SES_SECRET_ACCESS_KEY", "AWS_SES_REGION", "AWS_SES_FROM_EMAIL"],
  mailgun: ["MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAILGUN_FROM_EMAIL"],
  smtp: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM_EMAIL", "SMTP_TLS"],
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ═══════════════════════════════════════════
// PROVIDER-SPECIFIC CONNECTION TESTS
// ═══════════════════════════════════════════

async function testResendConnection(configMap: Record<string, string>): Promise<{ ok: boolean; test: string; message: string; details?: unknown }> {
  const apiKey = configMap["RESEND_API_KEY"];
  if (!apiKey) return { ok: false, test: "failed", message: "RESEND_API_KEY no configurada" };

  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (res.ok) {
    const domains = await res.json();
    const domainCount = domains?.data?.length ?? 0;
    return {
      ok: true,
      test: "passed",
      message: `Conexión exitosa con Resend. ${domainCount} dominio(s) encontrado(s).`,
      details: { domains_count: domainCount },
    };
  } else {
    const err = await res.text();
    return { ok: false, test: "failed", message: `Resend respondió ${res.status}: ${err}` };
  }
}

async function testSendGridConnection(configMap: Record<string, string>): Promise<{ ok: boolean; test: string; message: string; details?: unknown }> {
  const apiKey = configMap["SENDGRID_API_KEY"];
  if (!apiKey) return { ok: false, test: "failed", message: "SENDGRID_API_KEY no configurada" };

  const res = await fetch("https://api.sendgrid.com/v3/scopes", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (res.ok) {
    const data = await res.json();
    const scopes = data?.scopes || [];
    const hasMailSend = scopes.includes("mail.send");
    return {
      ok: true,
      test: "passed",
      message: `SendGrid API key válida. ${scopes.length} scope(s).${hasMailSend ? " ✅ mail.send disponible." : " ⚠️ Falta scope mail.send — agregue permisos de envío."}`,
      details: { scopes_count: scopes.length, has_mail_send: hasMailSend },
    };
  } else {
    const err = await res.text();
    return { ok: false, test: "failed", message: `SendGrid respondió ${res.status}: ${err}` };
  }
}

async function testMailgunConnection(configMap: Record<string, string>): Promise<{ ok: boolean; test: string; message: string; details?: unknown }> {
  const apiKey = configMap["MAILGUN_API_KEY"];
  const domain = configMap["MAILGUN_DOMAIN"];
  if (!apiKey) return { ok: false, test: "failed", message: "MAILGUN_API_KEY no configurada" };
  if (!domain) return { ok: false, test: "failed", message: "MAILGUN_DOMAIN no configurado" };

  const res = await fetch(`https://api.mailgun.net/v3/${domain}`, {
    headers: { Authorization: `Basic ${btoa(`api:${apiKey}`)}` },
  });

  if (res.ok) {
    const data = await res.json();
    const state = data?.domain?.state || "unknown";
    return {
      ok: true,
      test: "passed",
      message: `Mailgun conectado. Dominio ${domain} en estado "${state}".${state === "active" ? " ✅ Listo para envío." : " ⚠️ El dominio no está activo — verifique DNS en Mailgun."}`,
      details: { domain, state },
    };
  } else {
    const err = await res.text();
    return { ok: false, test: "failed", message: `Mailgun respondió ${res.status}: ${err}` };
  }
}

async function testAwsSesConnection(configMap: Record<string, string>): Promise<{ ok: boolean; test: string; message: string; details?: unknown }> {
  const accessKeyId = configMap["AWS_SES_ACCESS_KEY_ID"];
  const secretKey = configMap["AWS_SES_SECRET_ACCESS_KEY"];
  const region = configMap["AWS_SES_REGION"];
  if (!accessKeyId || !secretKey) return { ok: false, test: "failed", message: "Credenciales AWS SES incompletas" };
  if (!region) return { ok: false, test: "failed", message: "AWS_SES_REGION no configurada" };

  // Use AWS SES GetSendQuota to validate credentials
  const host = `email.${region}.amazonaws.com`;
  const date = new Date();
  const dateStamp = date.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");

  try {
    // Simple credential check via SES v2 GetAccount
    const url = `https://${host}/v2/email/account`;

    // AWS Signature V4 is complex; use a simpler approach via SES v1 Action
    const params = new URLSearchParams({
      Action: "GetSendQuota",
      Version: "2010-12-01",
    });

    // For SES v1, we can use query auth
    const sigUrl = `https://${host}/?${params.toString()}`;

    // AWS SigV4 signing (simplified — we'll use fetch with basic auth headers)
    // Since full SigV4 is complex in edge functions, we'll test via the v1 API with basic headers
    const encoder = new TextEncoder();

    // Create the canonical request for AWS SigV4
    const method = "GET";
    const canonicalUri = "/";
    const canonicalQueryString = "Action=GetSendQuota&Version=2010-12-01";
    const payloadHash = await sha256Hex("");
    const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-date";
    const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;

    const signingKey = await getSignatureKey(secretKey, dateStamp, region, "ses");
    const signature = await hmacHex(signingKey, stringToSign);
    const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(`https://${host}/?${canonicalQueryString}`, {
      method: "GET",
      headers: {
        "x-amz-date": amzDate,
        Authorization: authorizationHeader,
      },
    });

    if (res.ok) {
      const text = await res.text();
      // Parse XML response for quota info
      const max24h = text.match(/<Max24HourSend>([\d.]+)<\/Max24HourSend>/)?.[1] || "?";
      const sentLast24h = text.match(/<SentLast24Hours>([\d.]+)<\/SentLast24Hours>/)?.[1] || "?";
      return {
        ok: true,
        test: "passed",
        message: `AWS SES conectado en ${region}. Cuota: ${sentLast24h}/${max24h} emails en 24h.`,
        details: { region, max_24h: max24h, sent_24h: sentLast24h },
      };
    } else {
      const err = await res.text();
      return { ok: false, test: "failed", message: `AWS SES respondió ${res.status}: ${err.substring(0, 200)}` };
    }
  } catch (err) {
    return { ok: false, test: "failed", message: `Error de conexión AWS SES: ${err}` };
  }
}

// AWS SigV4 helpers
async function sha256Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

async function hmacHex(key: ArrayBuffer, message: string): Promise<string> {
  const sig = await hmac(key, message);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmac(new TextEncoder().encode("AWS4" + key), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

async function testSmtpConnection(configMap: Record<string, string>): Promise<{ ok: boolean; test: string; message: string; details?: unknown }> {
  const host = configMap["SMTP_HOST"];
  const port = configMap["SMTP_PORT"];
  if (!host || !port) return { ok: false, test: "failed", message: "SMTP_HOST y SMTP_PORT requeridos" };

  // Edge functions can't do raw TCP connections, so validate config presence
  const user = configMap["SMTP_USER"];
  const pass = configMap["SMTP_PASS"];
  const from = configMap["SMTP_FROM_EMAIL"];

  const issues: string[] = [];
  if (!user) issues.push("SMTP_USER falta");
  if (!pass) issues.push("SMTP_PASS falta");
  if (!from) issues.push("SMTP_FROM_EMAIL falta");

  if (issues.length > 0) {
    return { ok: false, test: "failed", message: `Configuración SMTP incompleta: ${issues.join(", ")}` };
  }

  return {
    ok: true,
    test: "keys_present",
    message: `Configuración SMTP completa (${host}:${port}). La conexión real se verificará al enviar el email de prueba.`,
    details: { host, port, user_set: !!user, from },
  };
}

// ═══════════════════════════════════════════
// SEND TEST EMAIL — Full pipeline test
// ═══════════════════════════════════════════

function generateWizardTestEmailHtml(providerName: string, adminEmail: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:20px;background:#f3f4f6;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
      <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2d4a6f 100%);color:white;padding:24px;text-align:center;">
          <h1 style="margin:0;font-size:24px;font-weight:600;">⚖️ Andromeda Legal</h1>
          <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">Email de Prueba — Configuración de Proveedor</p>
        </div>
        <div style="padding:24px;color:#374151;">
          <p style="margin:0 0 16px;font-size:15px;">¡Configuración exitosa!</p>
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin:16px 0;">
            <p style="margin:0;font-size:14px;color:#166534;">
              ✅ <strong>${providerName}</strong> está correctamente configurado y puede enviar emails.
            </p>
          </div>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Proveedor</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:600;">${providerName}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Enviado a</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:600;">${adminEmail}</td></tr>
            <tr><td style="padding:8px;font-size:13px;color:#6b7280;">Timestamp</td><td style="padding:8px;font-size:13px;font-weight:600;">${new Date().toISOString()}</td></tr>
          </table>
          <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">
            Este email fue enviado a través del pipeline completo (email_outbox → process-email-outbox → ${providerName}).
            Si lo recibiste, el proveedor está listo para producción.
          </p>
        </div>
        <div style="background:#f9fafb;padding:16px 24px;text-align:center;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;">
          <p style="margin:0;">© ${new Date().getFullYear()} Andromeda Legal — Email Provider Wizard Test</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check
  try {
    const body = req.method === "POST" ? await req.clone().json().catch(() => null) : null;
    if (body?.health_check) {
      return json({ ok: true, service: "email-provider-admin" });
    }
  } catch { /* ignore */ }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Unauthorized" }, 401);
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
      return json({ ok: false, error: "Invalid token" }, 401);
    }

    const userId = user.id;
    const { data: adminCheck } = await serviceClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!adminCheck) {
      return json({ ok: false, error: "Platform admin required" }, 403);
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

      return json({
        ok: true,
        active_provider: providerType,
        is_configured: settings?.email_provider_configured || false,
        environment: settings?.email_provider_environment || "sandbox",
        providers,
      });
    }

    if (req.method === "POST") {
      const reqBody = await req.json();
      const { action } = reqBody;

      // ─── Action: set_provider ───
      if (action === "set_provider") {
        const { provider_type, environment = "sandbox" } = reqBody;
        const validProviders = Object.keys(PROVIDER_KEYS);
        if (!validProviders.includes(provider_type)) {
          return json({ ok: false, error: `Invalid provider. Allowed: ${validProviders.join(", ")}` }, 400);
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

        return json({ ok: true, provider_type, environment });
      }

      // ─── Action: save_key ───
      if (action === "save_key") {
        const { config_key, config_value, environment = "sandbox" } = reqBody;

        if (!ALL_KEYS.includes(config_key)) {
          return json({ ok: false, error: `Invalid config key: ${config_key}` }, 400);
        }

        if (!config_value || typeof config_value !== "string" || config_value.trim().length < 2) {
          return json({ ok: false, error: "Value must be at least 2 characters" }, 400);
        }

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
          return json({ ok: false, error: "Database error" }, 500);
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

        return json({ ok: true, config_key, environment });
      }

      // ─── Action: activate ───
      if (action === "activate") {
        const { data: settings } = await serviceClient
          .from("platform_settings")
          .select("email_provider_type")
          .eq("id", "singleton")
          .maybeSingle();

        if (!settings?.email_provider_type) {
          return json({ ok: false, error: "No provider type selected" }, 400);
        }

        const requiredKeys = REQUIRED_KEYS[settings.email_provider_type] || PROVIDER_KEYS[settings.email_provider_type] || [];
        const { data: configs } = await serviceClient
          .from("email_provider_config")
          .select("config_key")
          .in("config_key", requiredKeys);

        const configuredKeys = new Set((configs || []).map((c: any) => c.config_key));
        const missing = requiredKeys.filter((k) => !configuredKeys.has(k));

        if (missing.length > 0) {
          return json({ ok: false, error: `Missing required keys: ${missing.join(", ")}` }, 400);
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

        return json({ ok: true, activated: true });
      }

      // ─── Action: test_connection — verify API credentials ───
      if (action === "test_connection") {
        const { data: settings } = await serviceClient
          .from("platform_settings")
          .select("email_provider_type")
          .eq("id", "singleton")
          .maybeSingle();

        if (!settings?.email_provider_type) {
          return json({ ok: false, error: "No provider selected" }, 400);
        }

        const providerType = settings.email_provider_type;
        const allKeys = PROVIDER_KEYS[providerType] || [];
        const { data: configs } = await serviceClient
          .from("email_provider_config")
          .select("config_key, config_value")
          .in("config_key", allKeys);

        const configMap: Record<string, string> = {};
        for (const c of configs || []) {
          configMap[c.config_key] = c.config_value;
        }

        try {
          let result: { ok: boolean; test: string; message: string; details?: unknown };

          switch (providerType) {
            case "resend":
              result = await testResendConnection(configMap);
              break;
            case "sendgrid":
              result = await testSendGridConnection(configMap);
              break;
            case "mailgun":
              result = await testMailgunConnection(configMap);
              break;
            case "aws_ses":
              result = await testAwsSesConnection(configMap);
              break;
            case "smtp":
              result = await testSmtpConnection(configMap);
              break;
            default:
              result = { ok: false, test: "failed", message: `Proveedor no soportado: ${providerType}` };
          }

          // Audit the test attempt
          await serviceClient.from("audit_logs").insert({
            organization_id: "00000000-0000-0000-0000-000000000000",
            actor_user_id: userId,
            actor_type: "PLATFORM_ADMIN",
            action: "EMAIL_PROVIDER_TEST_CONNECTION",
            entity_type: "platform_settings",
            entity_id: "email_provider_test",
            metadata: { provider: providerType, result: result.test, details: result.details },
          });

          return json(result);
        } catch (err) {
          return json({ ok: false, test: "error", message: `Error de conexión: ${err}` });
        }
      }

      // ─── Action: send_test_email — full pipeline E2E test ───
      if (action === "send_test_email") {
        const { to_email } = reqBody;

        // Resolve admin's email as default recipient
        const recipientEmail = to_email || user.email;
        if (!recipientEmail) {
          return json({ ok: false, error: "No recipient email. Provide to_email or log in with email." }, 400);
        }

        const { data: settings } = await serviceClient
          .from("platform_settings")
          .select("email_provider_type, email_provider_configured")
          .eq("id", "singleton")
          .maybeSingle();

        if (!settings?.email_provider_type) {
          return json({ ok: false, error: "No email provider selected. Complete Step 1 first." }, 400);
        }

        const providerName = settings.email_provider_type.charAt(0).toUpperCase() + settings.email_provider_type.slice(1);
        const dedupeKey = `wizard-test-${userId}-${Date.now()}`;

        // Insert into email_outbox — the process-email-outbox function will pick it up
        const { error: insertError } = await serviceClient.from("email_outbox").insert({
          organization_id: "00000000-0000-0000-0000-000000000000",
          to_email: recipientEmail,
          subject: `✅ Test de Email — ${providerName} configurado correctamente`,
          html: generateWizardTestEmailHtml(providerName, recipientEmail),
          status: "PENDING",
          trigger_event: "WIZARD_TEST_EMAIL",
          dedupe_key: dedupeKey,
          next_attempt_at: new Date().toISOString(),
          metadata: { wizard_test: true, admin_user_id: userId, provider: settings.email_provider_type },
        });

        if (insertError) {
          console.error("Failed to queue test email:", insertError);
          return json({ ok: false, error: "Error al encolar el email de prueba" }, 500);
        }

        // Trigger process-email-outbox immediately so the admin doesn't have to wait for the scheduler
        try {
          await fetch(`${supabaseUrl}/functions/v1/process-email-outbox`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
          });
        } catch (triggerErr) {
          console.warn("Could not trigger process-email-outbox immediately:", triggerErr);
          // Not fatal — scheduler will pick it up
        }

        // Audit
        await serviceClient.from("audit_logs").insert({
          organization_id: "00000000-0000-0000-0000-000000000000",
          actor_user_id: userId,
          actor_type: "PLATFORM_ADMIN",
          action: "EMAIL_PROVIDER_SEND_TEST",
          entity_type: "email_outbox",
          entity_id: dedupeKey,
          metadata: { provider: settings.email_provider_type, to_email: recipientEmail },
        });

        // Wait briefly and check result
        await new Promise(resolve => setTimeout(resolve, 3000));

        const { data: outboxResult } = await serviceClient
          .from("email_outbox")
          .select("status, error, provider_message_id, sent_at")
          .eq("dedupe_key", dedupeKey)
          .maybeSingle();

        if (outboxResult?.status === "SENT") {
          return json({
            ok: true,
            test: "sent",
            message: `✅ Email de prueba enviado exitosamente a ${recipientEmail} vía ${providerName}. Revisa tu bandeja de entrada.`,
            details: {
              provider_message_id: outboxResult.provider_message_id,
              sent_at: outboxResult.sent_at,
              to_email: recipientEmail,
            },
          });
        } else if (outboxResult?.status === "FAILED") {
          return json({
            ok: false,
            test: "failed",
            message: `❌ El email de prueba falló: ${outboxResult.error || "Error desconocido"}`,
            details: { error: outboxResult.error, to_email: recipientEmail },
          });
        } else {
          return json({
            ok: true,
            test: "queued",
            message: `📬 Email de prueba encolado. Status actual: ${outboxResult?.status || "PENDING"}. Debería llegar en unos segundos a ${recipientEmail}.`,
            details: { status: outboxResult?.status || "PENDING", to_email: recipientEmail },
          });
        }
      }

      return json({ ok: false, error: "Unknown action" }, 400);
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("email-provider-admin error:", error);
    return json({ ok: false, error: String(error) }, 500);
  }
});
