/**
 * verify-generic-email — Handles two flows:
 * 
 * 1. POST { action: "send_verification" } — Called after signup when user has a generic email.
 *    Generates a verification token, enqueues a verification email via email_outbox.
 * 
 * 2. POST { action: "confirm", token: "..." } — Called when user clicks the verification link.
 *    Validates token, marks profile as verified.
 * 
 * Generic email domains: gmail.com, outlook.com, hotmail.com, yahoo.com, etc.
 * 
 * Auth: requires authenticated user for "send_verification", public for "confirm".
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Generic email domains that require extra verification
const GENERIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "outlook.com", "outlook.es", "hotmail.com", "hotmail.es", "live.com", "msn.com",
  "yahoo.com", "yahoo.es", "yahoo.com.co",
  "aol.com",
  "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me",
  "zoho.com",
  "mail.com",
  "yandex.com",
  "gmx.com", "gmx.net",
  "tutanota.com", "tuta.io",
]);

function isGenericEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain ? GENERIC_DOMAINS.has(domain) : false;
}

function generateToken(): { raw: string; hash: string } {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const raw = Array.from(array).map(b => b.toString(16).padStart(2, "0")).join("");
  // Hash for storage
  return { raw, hash: "" }; // hash computed below
}

async function hashToken(raw: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateVerificationEmailHtml(verifyUrl: string, userName?: string): string {
  const greeting = userName ? `Hola ${userName},` : "Hola,";
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:20px;background:#f3f4f6;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
      <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2d4a6f 100%);color:white;padding:24px;text-align:center;">
          <h1 style="margin:0;font-size:24px;font-weight:600;">⚖️ Andromeda Legal</h1>
          <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">Verificación de Email</p>
        </div>
        <div style="padding:24px;color:#374151;">
          <p style="margin:0 0 16px;font-size:15px;">${greeting}</p>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
            Detectamos que te registraste con un correo personal. Para garantizar la seguridad de tu cuenta
            y acceder a todas las funcionalidades de Andromeda, necesitamos verificar tu dirección de email.
          </p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${verifyUrl}" 
               style="display:inline-block;background:#1e3a5f;color:white;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;">
              ✅ Verificar mi email
            </a>
          </div>
          <p style="margin:16px 0;font-size:13px;color:#6b7280;">
            Este enlace expira en 24 horas. Si no solicitaste esta verificación, puedes ignorar este correo.
          </p>
        </div>
        <div style="background:#f9fafb;padding:16px 24px;text-align:center;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;">
          <p style="margin:0;">© ${new Date().getFullYear()} Andromeda Legal</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    
    if (body.health_check) {
      return json({ ok: true, service: "verify-generic-email" }, 200);
    }

    const { action } = body;

    // ═══ ACTION: check — Check if email is generic (no auth required) ═══
    if (action === "check") {
      const email = body.email;
      if (!email || typeof email !== "string") {
        return json({ ok: false, error: "Email required" }, 400);
      }
      return json({ ok: true, is_generic: isGenericEmail(email) }, 200);
    }

    // ═══ ACTION: send_verification — Requires authenticated user ═══
    if (action === "send_verification") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return json({ ok: false, error: "Authentication required" }, 401);
      }

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const token = authHeader.replace("Bearer ", "");
      const { data: claims, error: claimsError } = await userClient.auth.getClaims(token);
      if (claimsError || !claims?.claims) {
        return json({ ok: false, error: "Invalid token" }, 401);
      }

      const userId = claims.claims.sub;
      const userEmail = claims.claims.email as string;

      if (!userEmail) {
        return json({ ok: false, error: "No email in token" }, 400);
      }

      // Check if already verified
      const { data: profile } = await adminClient
        .from("profiles")
        .select("generic_email_verified, organization_id")
        .eq("id", userId)
        .maybeSingle();

      if (profile?.generic_email_verified === true) {
        return json({ ok: true, already_verified: true }, 200);
      }

      // Mark profile as generic email
      const generic = isGenericEmail(userEmail);
      await adminClient
        .from("profiles")
        .update({ is_generic_email: generic })
        .eq("id", userId);

      if (!generic) {
        // Not generic — auto-verify
        await adminClient
          .from("profiles")
          .update({ generic_email_verified: true })
          .eq("id", userId);
        return json({ ok: true, auto_verified: true, reason: "corporate_email" }, 200);
      }

      // Generate verification token
      const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, "0")).join("");
      const tokenHash = await hashToken(rawToken);

      // Upsert token (one per user)
      await adminClient
        .from("email_verification_tokens")
        .upsert({
          user_id: userId,
          email: userEmail,
          token_hash: tokenHash,
          verified_at: null,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: "user_id" });

      // Build verification URL
      const baseUrl = Deno.env.get("APP_BASE_URL") || "https://andromeda.legal";
      const verifyUrl = `${baseUrl}/verify-email?token=${rawToken}`;

      // Get user name for email
      const { data: profileData } = await adminClient
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();

      // Enqueue verification email via email_outbox (provider-agnostic)
      const orgId = profile?.organization_id || "00000000-0000-0000-0000-000000000000";
      const dedupeKey = `verify-email-${userId}-${new Date().toISOString().slice(0, 10)}`;

      const { error: insertError } = await adminClient
        .from("email_outbox")
        .insert({
          organization_id: orgId,
          to_email: userEmail,
          subject: "Verifica tu email — Andromeda Legal",
          html: generateVerificationEmailHtml(verifyUrl, profileData?.full_name || undefined),
          status: "PENDING",
          trigger_event: "GENERIC_EMAIL_VERIFICATION",
          dedupe_key: dedupeKey,
          next_attempt_at: new Date().toISOString(),
          metadata: { user_id: userId, is_generic: true },
        });

      if (insertError) {
        console.error("[verify-generic-email] Failed to queue email:", insertError);
        return json({ ok: false, error: "Failed to queue verification email" }, 500);
      }

      return json({ ok: true, sent: true }, 200);
    }

    // ═══ ACTION: confirm — Verify token (public, no auth needed) ═══
    if (action === "confirm") {
      const rawToken = body.token;
      if (!rawToken || typeof rawToken !== "string" || rawToken.length < 32) {
        return json({ ok: false, error: "Invalid token" }, 400);
      }

      const tokenHash = await hashToken(rawToken);

      // Find token
      const { data: tokenRow } = await adminClient
        .from("email_verification_tokens")
        .select("*")
        .eq("token_hash", tokenHash)
        .maybeSingle();

      if (!tokenRow) {
        return json({ ok: false, error: "Token no válido o expirado" }, 400);
      }

      if (tokenRow.verified_at) {
        return json({ ok: true, already_verified: true }, 200);
      }

      if (new Date(tokenRow.expires_at) < new Date()) {
        return json({ ok: false, error: "El enlace de verificación ha expirado. Solicita uno nuevo." }, 400);
      }

      // Mark as verified
      await adminClient
        .from("email_verification_tokens")
        .update({ verified_at: new Date().toISOString() })
        .eq("id", tokenRow.id);

      await adminClient
        .from("profiles")
        .update({ generic_email_verified: true })
        .eq("id", tokenRow.user_id);

      // Audit
      const { data: profile } = await adminClient
        .from("profiles")
        .select("organization_id")
        .eq("id", tokenRow.user_id)
        .maybeSingle();

      if (profile?.organization_id) {
        await adminClient.from("audit_logs").insert({
          organization_id: profile.organization_id,
          actor_user_id: tokenRow.user_id,
          actor_type: "USER",
          action: "GENERIC_EMAIL_VERIFIED",
          entity_type: "profile",
          entity_id: tokenRow.user_id,
          metadata: { email_domain: tokenRow.email.split("@")[1] },
        });
      }

      return json({ ok: true, verified: true }, 200);
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[verify-generic-email] Error:", err);
    return json({ ok: false, error: "Internal error" }, 500);
  }
});
