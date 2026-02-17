/**
 * system-email-send — Multi-provider email sender for Platform Compose.
 * Super Admin only. Reads `outbound_provider` from system_email_settings
 * and dispatches to the correct adapter: Resend, SendGrid, Mailgun, AWS SES, or SMTP.
 * Logs to system_email_messages using service role.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Provider Adapter Interface ─────────────────────────

interface SendPayload {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
  cc?: string[];
  bcc?: string[];
}

interface SendResult {
  ok: boolean;
  provider_message_id: string | null;
  error: string | null;
}

// ─── Resend Adapter ─────────────────────────────────────

async function sendViaResend(payload: SendPayload): Promise<SendResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, provider_message_id: null, error: "RESEND_API_KEY no configurada" };

  const body: Record<string, unknown> = {
    from: payload.from,
    to: payload.to,
    subject: payload.subject,
  };
  if (payload.html) body.html = payload.html;
  if (payload.text) body.text = payload.text;
  if (payload.reply_to) body.reply_to = payload.reply_to;
  if (payload.cc?.length) body.cc = payload.cc;
  if (payload.bcc?.length) body.bcc = payload.bcc;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (res.ok && data.id) {
    return { ok: true, provider_message_id: data.id, error: null };
  }
  return { ok: false, provider_message_id: null, error: data.message || data.error || JSON.stringify(data) };
}

// ─── SendGrid Adapter ───────────────────────────────────

async function sendViaSendGrid(payload: SendPayload): Promise<SendResult> {
  const apiKey = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey) return { ok: false, provider_message_id: null, error: "SENDGRID_API_KEY no configurada" };

  const sgPayload: Record<string, unknown> = {
    personalizations: [{
      to: payload.to.map(e => ({ email: e })),
      ...(payload.cc?.length ? { cc: payload.cc.map(e => ({ email: e })) } : {}),
      ...(payload.bcc?.length ? { bcc: payload.bcc.map(e => ({ email: e })) } : {}),
    }],
    from: parseEmailAddress(payload.from),
    subject: payload.subject,
    content: [],
  };

  const content: { type: string; value: string }[] = [];
  if (payload.text) content.push({ type: "text/plain", value: payload.text });
  if (payload.html) content.push({ type: "text/html", value: payload.html });
  if (content.length === 0) content.push({ type: "text/plain", value: "" });
  (sgPayload as any).content = content;

  if (payload.reply_to) {
    (sgPayload as any).reply_to = parseEmailAddress(payload.reply_to);
  }

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(sgPayload),
  });

  // SendGrid returns 202 on success with no body
  if (res.status === 202 || res.status === 200) {
    const messageId = res.headers.get("X-Message-Id") || crypto.randomUUID();
    return { ok: true, provider_message_id: messageId, error: null };
  }

  let errorMsg: string;
  try {
    const data = await res.json();
    errorMsg = data.errors?.map((e: any) => e.message).join("; ") || JSON.stringify(data);
  } catch {
    errorMsg = `SendGrid HTTP ${res.status}`;
  }
  return { ok: false, provider_message_id: null, error: errorMsg };
}

// ─── Mailgun Adapter ────────────────────────────────────

async function sendViaMailgun(payload: SendPayload): Promise<SendResult> {
  const apiKey = Deno.env.get("MAILGUN_API_KEY");
  const domain = Deno.env.get("MAILGUN_DOMAIN");
  if (!apiKey) return { ok: false, provider_message_id: null, error: "MAILGUN_API_KEY no configurada" };
  if (!domain) return { ok: false, provider_message_id: null, error: "MAILGUN_DOMAIN no configurado" };

  const form = new FormData();
  form.append("from", payload.from);
  payload.to.forEach(t => form.append("to", t));
  form.append("subject", payload.subject);
  if (payload.html) form.append("html", payload.html);
  if (payload.text) form.append("text", payload.text);
  if (payload.reply_to) form.append("h:Reply-To", payload.reply_to);
  if (payload.cc?.length) payload.cc.forEach(c => form.append("cc", c));
  if (payload.bcc?.length) payload.bcc.forEach(b => form.append("bcc", b));

  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`api:${apiKey}`)}`,
    },
    body: form,
  });

  const data = await res.json();
  if (res.ok && data.id) {
    return { ok: true, provider_message_id: data.id, error: null };
  }
  return { ok: false, provider_message_id: null, error: data.message || JSON.stringify(data) };
}

// ─── AWS SES Adapter ────────────────────────────────────

async function sendViaAWSSES(payload: SendPayload): Promise<SendResult> {
  const accessKeyId = Deno.env.get("AWS_SES_ACCESS_KEY_ID");
  const secretKey = Deno.env.get("AWS_SES_SECRET_ACCESS_KEY");
  const region = Deno.env.get("AWS_SES_REGION") || "us-east-1";

  if (!accessKeyId || !secretKey) {
    return { ok: false, provider_message_id: null, error: "AWS_SES_ACCESS_KEY_ID o AWS_SES_SECRET_ACCESS_KEY no configuradas" };
  }

  // Use SES v2 SendEmail API via raw HTTP with AWS Signature V4
  const endpoint = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
  const now = new Date();

  const sesPayload: Record<string, unknown> = {
    Content: {
      Simple: {
        Subject: { Data: payload.subject, Charset: "UTF-8" },
        Body: {},
      },
    },
    Destination: {
      ToAddresses: payload.to,
      ...(payload.cc?.length ? { CcAddresses: payload.cc } : {}),
      ...(payload.bcc?.length ? { BccAddresses: payload.bcc } : {}),
    },
    FromEmailAddress: payload.from,
  };

  const bodyContent: Record<string, { Data: string; Charset: string }> = {};
  if (payload.text) bodyContent.Text = { Data: payload.text, Charset: "UTF-8" };
  if (payload.html) bodyContent.Html = { Data: payload.html, Charset: "UTF-8" };
  if (Object.keys(bodyContent).length === 0) bodyContent.Text = { Data: "", Charset: "UTF-8" };
  (sesPayload.Content as any).Simple.Body = bodyContent;

  if (payload.reply_to) {
    (sesPayload as any).ReplyToAddresses = [payload.reply_to];
  }

  // AWS Sig V4 signing
  const bodyStr = JSON.stringify(sesPayload);
  const headers = await signAWSRequest("POST", endpoint, bodyStr, region, "ses", accessKeyId, secretKey, now);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: bodyStr,
  });

  if (res.ok) {
    const data = await res.json();
    return { ok: true, provider_message_id: data.MessageId || crypto.randomUUID(), error: null };
  }

  let errorMsg: string;
  try {
    const data = await res.json();
    errorMsg = data.message || data.Message || JSON.stringify(data);
  } catch {
    errorMsg = `AWS SES HTTP ${res.status}`;
  }
  return { ok: false, provider_message_id: null, error: errorMsg };
}

// ─── AWS Signature V4 Helper ────────────────────────────

async function signAWSRequest(
  method: string, url: string, body: string,
  region: string, service: string,
  accessKeyId: string, secretKey: string,
  now: Date
): Promise<Record<string, string>> {
  const encoder = new TextEncoder();

  const dateStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const dateOnly = dateStamp.substring(0, 8);
  const parsedUrl = new URL(url);
  const host = parsedUrl.host;
  const path = parsedUrl.pathname;

  const payloadHash = await sha256Hex(body);
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${dateStamp}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateOnly}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", dateStamp, credentialScope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmacSha256(encoder.encode(`AWS4${secretKey}`), dateOnly);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");

  const signatureBytes = await hmacSha256(kSigning, stringToSign);
  const signature = Array.from(new Uint8Array(signatureBytes)).map(b => b.toString(16).padStart(2, "0")).join("");

  return {
    "X-Amz-Date": dateStamp,
    "X-Amz-Content-Sha256": payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: Uint8Array | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

// ─── SMTP Adapter ───────────────────────────────────────
// Note: Deno Edge runtime blocks raw TCP sockets, so we use a lightweight
// SMTP-over-HTTP bridge pattern. If the user has a real SMTP server,
// they'd need to proxy it. For now, we attempt a direct connection
// but return a clear error if the runtime blocks it.

async function sendViaSMTP(payload: SendPayload): Promise<SendResult> {
  const host = Deno.env.get("SMTP_HOST");
  const port = Deno.env.get("SMTP_PORT");
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");

  if (!host || !user || !pass) {
    return { ok: false, provider_message_id: null, error: "SMTP_HOST, SMTP_USER o SMTP_PASS no configurados" };
  }

  // Supabase Edge runtime blocks raw TLS sockets required for direct SMTP.
  // Return a clear error guiding the user to use an API-based provider instead.
  return {
    ok: false,
    provider_message_id: null,
    error: `SMTP directo no soportado en Edge Functions (el runtime bloquea sockets TCP/TLS). ` +
           `Use un proveedor basado en API (Resend, SendGrid, Mailgun, AWS SES) ` +
           `o configure un proxy SMTP-to-HTTP. Host configurado: ${host}:${port || 587}`,
  };
}

// ─── Provider Registry ──────────────────────────────────

const PROVIDER_ADAPTERS: Record<string, (payload: SendPayload) => Promise<SendResult>> = {
  resend: sendViaResend,
  sendgrid: sendViaSendGrid,
  mailgun: sendViaMailgun,
  aws_ses: sendViaAWSSES,
  smtp: sendViaSMTP,
};

// ─── Helpers ────────────────────────────────────────────

function parseEmailAddress(input: string): { email: string; name?: string } {
  const match = input.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { email: input.trim() };
}

// ─── Email Template Wrapper ─────────────────────────────

const LOGO_URL = "https://qvuukbqcvlnvmcvcruji.supabase.co/storage/v1/object/public/email-assets/andromeda-logo.png";

function wrapWithBrandedHeader(htmlBody: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;">
    <tr><td align="center" style="padding:24px 16px 0;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- Header with logo -->
        <tr><td align="center" style="padding:24px 32px;background-color:#0c1529;border-radius:12px 12px 0 0;">
          <img src="${LOGO_URL}" alt="Andromeda" width="160" height="auto" style="display:block;max-width:160px;height:auto;" />
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;background-color:#ffffff;">
          ${htmlBody}
        </td></tr>
        <!-- Footer -->
        <tr><td align="center" style="padding:16px 32px;background-color:#f8f9fa;border-radius:0 0 12px 12px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#6b7280;">
            Enviado desde <strong>Andromeda</strong> · info@andromeda.legal
          </p>
          <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">
            © ${new Date().getFullYear()} Andromeda Legal. Todos los derechos reservados.
          </p>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="height:24px;"></td></tr>
  </table>
</body>
</html>`;
}

// ─── Main Handler ───────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Health check short-circuit ────────────────────
    const clonedReq = req.clone();
    const maybeBody = await clonedReq.json().catch(() => null);
    if (maybeBody?.health_check) {
      return json({ status: "OK", function: "system-email-send" });
    }

    // ── Auth ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ ok: false, error_code: "UNAUTHORIZED", error_message: "Missing auth token", phase: "auth" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ ok: false, error_code: "UNAUTHORIZED", error_message: "Invalid token", phase: "auth" }, 401);
    }
    const userId = userData.user.id;

    // ── Super Admin check ────────────────────────────
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: adminRec } = await adminClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!adminRec) {
      return json({ ok: false, error_code: "FORBIDDEN", error_message: "Acceso denegado: no eres Super Admin", phase: "auth" }, 403);
    }

    // ── Parse body ───────────────────────────────────
    const body = await req.json();
    const { to, subject, html, text, cc, bcc } = body;

    const toArray = !to ? [] : Array.isArray(to) ? to : [to];
    if (toArray.length === 0) {
      return json({ ok: false, error_code: "MISSING_RECIPIENT", error_message: "El campo 'to' es obligatorio", phase: "validation" }, 400);
    }
    if (!subject?.trim()) {
      return json({ ok: false, error_code: "MISSING_SUBJECT", error_message: "El campo 'subject' es obligatorio", phase: "validation" }, 400);
    }
    if (!html?.trim() && !text?.trim()) {
      return json({ ok: false, error_code: "MISSING_BODY", error_message: "El cuerpo del email (html o text) es obligatorio", phase: "validation" }, 400);
    }

    // ── Get settings ─────────────────────────────────
    const { data: settings } = await adminClient
      .from("system_email_settings")
      .select("from_email, from_name, reply_to, is_enabled, outbound_provider")
      .maybeSingle();

    if (!settings?.is_enabled) {
      return json({ ok: false, error_code: "EMAIL_DISABLED", error_message: "El sistema de email no está habilitado. Actívalo en el Setup Wizard.", phase: "validation" }, 400);
    }

    // ── Resolve provider ─────────────────────────────
    const providerKey = settings.outbound_provider || "resend";
    const adapter = PROVIDER_ADAPTERS[providerKey];

    if (!adapter) {
      return json({
        ok: false,
        error_code: "UNKNOWN_PROVIDER",
        error_message: `Proveedor '${providerKey}' no soportado. Proveedores válidos: ${Object.keys(PROVIDER_ADAPTERS).join(", ")}`,
        phase: "provider",
      }, 400);
    }

    // ── Build send payload ───────────────────────────
    const fromField = settings.from_name
      ? `${settings.from_name} <${settings.from_email}>`
      : settings.from_email;

    // Wrap HTML with branded header/footer
    const rawHtml = html?.trim() || undefined;
    const brandedHtml = rawHtml ? wrapWithBrandedHeader(rawHtml) : undefined;

    const sendPayload: SendPayload = {
      from: fromField,
      to: toArray,
      subject: subject.trim(),
      html: brandedHtml,
      text: text?.trim() || undefined,
      reply_to: settings.reply_to || undefined,
      cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
    };

    // ── Dispatch to adapter ──────────────────────────
    console.log(`[system-email-send] Dispatching via ${providerKey} to ${toArray.join(", ")}`);
    const result = await adapter(sendPayload);

    // ── Log to system_email_messages ─────────────────
    let insertedMessageId: string | null = null;
    try {
      const { data: inserted, error: dbErr } = await adminClient.from("system_email_messages").insert({
        direction: "outbound",
        folder: "SENT",
        provider: providerKey,
        provider_message_id: result.provider_message_id,
        provider_status: result.ok ? "sent" : "failed",
        from_raw: settings.from_email,
        to_raw: toArray,
        cc_raw: cc ? (Array.isArray(cc) ? cc : [cc]) : [],
        bcc_raw: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : [],
        subject: subject.trim(),
        snippet: (text || html || "").substring(0, 200),
        text_body: text || null,
        html_body: html || null,
        sent_at: result.ok ? new Date().toISOString() : null,
      }).select("id").maybeSingle();

      if (dbErr) {
        console.error("[system-email-send] DB log failed:", dbErr);
        if (result.ok) {
          return json({
            ok: false,
            error_code: "DB_INSERT_FAILED",
            error_message: `Email enviado via ${providerKey} pero no se pudo registrar en la BD: ${dbErr.message}`,
            phase: "insert",
            provider: providerKey,
            provider_message_id: result.provider_message_id,
          }, 500);
        }
      } else {
        insertedMessageId = inserted?.id || null;
      }
    } catch (dbErr: any) {
      console.error("[system-email-send] DB log exception:", dbErr);
      if (result.ok) {
        return json({
          ok: false,
          error_code: "DB_INSERT_FAILED",
          error_message: `Email enviado via ${providerKey} pero falló el registro: ${dbErr.message}`,
          phase: "insert",
          provider: providerKey,
          provider_message_id: result.provider_message_id,
        }, 500);
      }
    }

    if (!result.ok) {
      return json({
        ok: false,
        error_code: "PROVIDER_SEND_FAILED",
        error_message: `${providerKey} rechazó el envío: ${result.error}`,
        phase: "provider",
        provider: providerKey,
        provider_error: result.error,
      }, 502);
    }

    return json({
      ok: true,
      provider: providerKey,
      provider_message_id: result.provider_message_id,
      inserted_message_id: insertedMessageId,
      message: `Email enviado via ${providerKey} a ${toArray.join(", ")}`,
    });
  } catch (err: any) {
    console.error("[system-email-send] Unexpected:", err);
    return json({ ok: false, error_code: "INTERNAL_ERROR", error_message: err.message || "Error interno", phase: "unknown" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
