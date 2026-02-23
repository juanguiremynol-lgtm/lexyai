/**
 * manage-alert-email — Membership-level alert email management
 * 
 * Actions:
 *   "set"    — Set/change alert email for a membership (triggers verification if different from login email)
 *   "verify" — Confirm a verification token (public, no auth)
 *   "resend" — Resend verification email for pending change
 *   "cancel" — Cancel a pending alert email change
 *   "status" — Get current alert email status for a membership
 *   "test"   — Send a test alert email
 * 
 * Auth: All actions except "verify" require authenticated user.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hashToken(raw: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateRawToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255;
}

function generateVerificationHtml(verifyUrl: string, userName?: string, orgName?: string): string {
  const greeting = userName ? `Hola ${userName},` : "Hola,";
  const orgLine = orgName ? ` para la organización <strong>${orgName}</strong>` : "";
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:20px;background:#f3f4f6;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
      <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2d4a6f 100%);color:white;padding:24px;text-align:center;">
          <h1 style="margin:0;font-size:24px;font-weight:600;">⚖️ Andromeda Legal</h1>
          <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">Verificación de Email de Alertas</p>
        </div>
        <div style="padding:24px;color:#374151;">
          <p style="margin:0 0 16px;font-size:15px;">${greeting}</p>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
            Has solicitado recibir alertas de la plataforma${orgLine} en esta dirección de correo.
            Para confirmar, haz clic en el botón:
          </p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${verifyUrl}" 
               style="display:inline-block;background:#1e3a5f;color:white;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;">
              ✅ Confirmar email de alertas
            </a>
          </div>
          <p style="margin:16px 0;font-size:13px;color:#6b7280;">
            Este enlace expira en 24 horas. Si no solicitaste este cambio, puedes ignorar este correo.
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

function generateTestAlertHtml(userName?: string): string {
  const greeting = userName ? `Hola ${userName},` : "Hola,";
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:20px;background:#f3f4f6;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
      <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2d4a6f 100%);color:white;padding:24px;text-align:center;">
          <h1 style="margin:0;font-size:24px;font-weight:600;">⚖️ Andromeda Legal</h1>
          <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">Correo de Prueba</p>
        </div>
        <div style="padding:24px;color:#374151;">
          <p style="margin:0 0 16px;font-size:15px;">${greeting}</p>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
            ✅ Este es un correo de prueba. Si lo recibiste, tu email de alertas está configurado correctamente.
          </p>
          <p style="margin:0;font-size:13px;color:#6b7280;">
            Las alertas de la plataforma (vencimientos, audiencias, hitos) se enviarán a esta dirección.
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

async function getAuthUser(req: Request, supabaseUrl: string, anonKey: string) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  return user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));

    if (body.health_check) {
      return json({ ok: true, service: "manage-alert-email" }, 200);
    }

    const { action } = body;

    // ═══ ACTION: status — Get alert email status for a membership ═══
    if (action === "status") {
      const user = await getAuthUser(req, supabaseUrl, anonKey);
      if (!user) return json({ ok: false, error: "Authentication required" }, 401);

      const { membership_id, organization_id } = body;

      // Fetch membership (user must own it)
      let query = admin.from("organization_memberships").select("*");
      if (membership_id) {
        query = query.eq("id", membership_id).eq("user_id", user.id);
      } else if (organization_id) {
        query = query.eq("organization_id", organization_id).eq("user_id", user.id);
      } else {
        return json({ ok: false, error: "membership_id or organization_id required" }, 400);
      }

      const { data: membership, error } = await query.maybeSingle();
      if (error || !membership) return json({ ok: false, error: "Membership not found" }, 404);

      // Get login email for fallback display
      const { data: profile } = await admin
        .from("profiles")
        .select("email, default_alert_email, reminder_email")
        .eq("id", user.id)
        .maybeSingle();

      const loginEmail = user.email || profile?.email;
      const effectiveEmail = membership.alert_email && membership.alert_email_verified_at
        ? membership.alert_email
        : profile?.default_alert_email || profile?.reminder_email || loginEmail;

      return json({
        ok: true,
        membership_id: membership.id,
        alert_email: membership.alert_email,
        alert_email_verified_at: membership.alert_email_verified_at,
        pending_alert_email: membership.pending_alert_email,
        pending_expires_at: membership.pending_alert_email_expires_at,
        effective_email: effectiveEmail,
        login_email: loginEmail,
        is_using_login_email: !membership.alert_email || !membership.alert_email_verified_at,
      }, 200);
    }

    // ═══ ACTION: set — Set or change alert email ═══
    if (action === "set") {
      const user = await getAuthUser(req, supabaseUrl, anonKey);
      if (!user) return json({ ok: false, error: "Authentication required" }, 401);

      const { organization_id, alert_email } = body;
      if (!organization_id) return json({ ok: false, error: "organization_id required" }, 400);
      if (!alert_email || !isValidEmail(alert_email)) return json({ ok: false, error: "Valid alert_email required" }, 400);

      // Get membership
      const { data: membership, error: mErr } = await admin
        .from("organization_memberships")
        .select("id")
        .eq("organization_id", organization_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (mErr || !membership) return json({ ok: false, error: "Membership not found" }, 404);

      const normalizedEmail = alert_email.trim().toLowerCase();
      const loginEmail = (user.email || "").toLowerCase();

      // If same as login email and login is verified by auth provider, auto-verify
      const isLoginEmail = normalizedEmail === loginEmail;
      const isOAuthVerified = !!user.email_confirmed_at;

      if (isLoginEmail && isOAuthVerified) {
        await admin.from("organization_memberships").update({
          alert_email: normalizedEmail,
          alert_email_verified_at: new Date().toISOString(),
          pending_alert_email: null,
          pending_alert_email_token_hash: null,
          pending_alert_email_expires_at: null,
        }).eq("id", membership.id);

        // Audit
        await admin.from("audit_logs").insert({
          organization_id,
          actor_user_id: user.id,
          actor_type: "USER",
          action: "ALERT_EMAIL_SET",
          entity_type: "organization_membership",
          entity_id: membership.id,
          metadata: { alert_email: normalizedEmail, auto_verified: true },
        });

        return json({ ok: true, verified: true, auto_verified: true }, 200);
      }

      // Different email or unverified login → require verification
      const rawToken = generateRawToken();
      const tokenHash = await hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      // Set pending on membership
      await admin.from("organization_memberships").update({
        pending_alert_email: normalizedEmail,
        pending_alert_email_token_hash: tokenHash,
        pending_alert_email_expires_at: expiresAt,
      }).eq("id", membership.id);

      // Also store in email_verification_tokens for lookup
      await admin.from("email_verification_tokens").insert({
        user_id: user.id,
        email: normalizedEmail,
        token_hash: tokenHash,
        expires_at: expiresAt,
        subject_type: "membership",
        subject_id: membership.id,
        purpose: "alert_email_verification",
      });

      // Get org name and user name for email template
      const { data: org } = await admin.from("organizations").select("name").eq("id", organization_id).maybeSingle();
      const { data: profile } = await admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle();

      const baseUrl = Deno.env.get("APP_BASE_URL") || "https://andromeda.legal";
      const verifyUrl = `${baseUrl}/verify-alert-email?token=${rawToken}`;

      // Enqueue verification email via email_outbox (provider-agnostic)
      const dedupeKey = `alert-email-verify-${membership.id}-${Date.now()}`;
      await admin.from("email_outbox").insert({
        organization_id,
        to_email: normalizedEmail,
        subject: "Confirma tu email de alertas — Andromeda Legal",
        html: generateVerificationHtml(verifyUrl, profile?.full_name, org?.name),
        status: "PENDING",
        trigger_event: "ALERT_EMAIL_VERIFICATION",
        dedupe_key: dedupeKey,
        next_attempt_at: new Date().toISOString(),
        metadata: { user_id: user.id, membership_id: membership.id },
      });

      // Audit
      await admin.from("audit_logs").insert({
        organization_id,
        actor_user_id: user.id,
        actor_type: "USER",
        action: "ALERT_EMAIL_CHANGE_REQUESTED",
        entity_type: "organization_membership",
        entity_id: membership.id,
        metadata: { pending_email: normalizedEmail },
      });

      return json({ ok: true, verification_sent: true, pending_email: normalizedEmail }, 200);
    }

    // ═══ ACTION: verify — Confirm verification token (public) ═══
    if (action === "verify") {
      const { token } = body;
      if (!token || typeof token !== "string" || token.length < 32) {
        return json({ ok: false, error: "Invalid token" }, 400);
      }

      const tokenHash = await hashToken(token);

      // Find token
      const { data: tokenRow } = await admin
        .from("email_verification_tokens")
        .select("*")
        .eq("token_hash", tokenHash)
        .eq("purpose", "alert_email_verification")
        .maybeSingle();

      if (!tokenRow) return json({ ok: false, error: "Token no válido o expirado" }, 400);
      if (tokenRow.used_at || tokenRow.verified_at) return json({ ok: true, already_verified: true }, 200);
      if (new Date(tokenRow.expires_at) < new Date()) {
        return json({ ok: false, error: "El enlace ha expirado. Solicita uno nuevo desde Configuración." }, 400);
      }

      const membershipId = tokenRow.subject_id;
      if (!membershipId || tokenRow.subject_type !== "membership") {
        return json({ ok: false, error: "Invalid verification context" }, 400);
      }

      // Get the membership to verify the pending email matches
      const { data: membership } = await admin
        .from("organization_memberships")
        .select("pending_alert_email, pending_alert_email_token_hash, organization_id, user_id")
        .eq("id", membershipId)
        .maybeSingle();

      if (!membership || membership.pending_alert_email_token_hash !== tokenHash) {
        return json({ ok: false, error: "Token no corresponde a un cambio pendiente" }, 400);
      }

      // Apply verification
      await admin.from("organization_memberships").update({
        alert_email: membership.pending_alert_email,
        alert_email_verified_at: new Date().toISOString(),
        pending_alert_email: null,
        pending_alert_email_token_hash: null,
        pending_alert_email_expires_at: null,
      }).eq("id", membershipId);

      // Mark token as used
      await admin.from("email_verification_tokens").update({
        used_at: new Date().toISOString(),
        verified_at: new Date().toISOString(),
      }).eq("id", tokenRow.id);

      // Audit
      await admin.from("audit_logs").insert({
        organization_id: membership.organization_id,
        actor_user_id: membership.user_id,
        actor_type: "USER",
        action: "ALERT_EMAIL_VERIFIED",
        entity_type: "organization_membership",
        entity_id: membershipId,
        metadata: { verified_email: membership.pending_alert_email },
      });

      return json({ ok: true, verified: true, email: membership.pending_alert_email }, 200);
    }

    // ═══ ACTION: resend — Resend verification for pending change ═══
    if (action === "resend") {
      const user = await getAuthUser(req, supabaseUrl, anonKey);
      if (!user) return json({ ok: false, error: "Authentication required" }, 401);

      const { organization_id } = body;
      if (!organization_id) return json({ ok: false, error: "organization_id required" }, 400);

      const { data: membership } = await admin
        .from("organization_memberships")
        .select("id, pending_alert_email, pending_alert_email_expires_at, organization_id")
        .eq("organization_id", organization_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!membership?.pending_alert_email) {
        return json({ ok: false, error: "No hay cambio pendiente" }, 400);
      }

      // Generate new token
      const rawToken = generateRawToken();
      const tokenHash = await hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await admin.from("organization_memberships").update({
        pending_alert_email_token_hash: tokenHash,
        pending_alert_email_expires_at: expiresAt,
      }).eq("id", membership.id);

      // Insert new token record
      await admin.from("email_verification_tokens").insert({
        user_id: user.id,
        email: membership.pending_alert_email,
        token_hash: tokenHash,
        expires_at: expiresAt,
        subject_type: "membership",
        subject_id: membership.id,
        purpose: "alert_email_verification",
      });

      const { data: org } = await admin.from("organizations").select("name").eq("id", organization_id).maybeSingle();
      const { data: profile } = await admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle();

      const baseUrl = Deno.env.get("APP_BASE_URL") || "https://andromeda.legal";
      const verifyUrl = `${baseUrl}/verify-alert-email?token=${rawToken}`;

      await admin.from("email_outbox").insert({
        organization_id,
        to_email: membership.pending_alert_email,
        subject: "Confirma tu email de alertas — Andromeda Legal",
        html: generateVerificationHtml(verifyUrl, profile?.full_name, org?.name),
        status: "PENDING",
        trigger_event: "ALERT_EMAIL_VERIFICATION",
        dedupe_key: `alert-email-resend-${membership.id}-${Date.now()}`,
        next_attempt_at: new Date().toISOString(),
        metadata: { user_id: user.id, membership_id: membership.id, is_resend: true },
      });

      // Audit
      await admin.from("audit_logs").insert({
        organization_id,
        actor_user_id: user.id,
        actor_type: "USER",
        action: "ALERT_EMAIL_RESEND_VERIFICATION",
        entity_type: "organization_membership",
        entity_id: membership.id,
        metadata: { pending_email: membership.pending_alert_email },
      });

      return json({ ok: true, resent: true }, 200);
    }

    // ═══ ACTION: cancel — Cancel pending alert email change ═══
    if (action === "cancel") {
      const user = await getAuthUser(req, supabaseUrl, anonKey);
      if (!user) return json({ ok: false, error: "Authentication required" }, 401);

      const { organization_id } = body;
      if (!organization_id) return json({ ok: false, error: "organization_id required" }, 400);

      const { data: membership } = await admin
        .from("organization_memberships")
        .select("id, organization_id")
        .eq("organization_id", organization_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!membership) return json({ ok: false, error: "Membership not found" }, 404);

      await admin.from("organization_memberships").update({
        pending_alert_email: null,
        pending_alert_email_token_hash: null,
        pending_alert_email_expires_at: null,
      }).eq("id", membership.id);

      return json({ ok: true, cancelled: true }, 200);
    }

    // ═══ ACTION: test — Send test alert email ═══
    if (action === "test") {
      const user = await getAuthUser(req, supabaseUrl, anonKey);
      if (!user) return json({ ok: false, error: "Authentication required" }, 401);

      const { organization_id } = body;
      if (!organization_id) return json({ ok: false, error: "organization_id required" }, 400);

      const { data: membership } = await admin
        .from("organization_memberships")
        .select("id, alert_email, alert_email_verified_at")
        .eq("organization_id", organization_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!membership) return json({ ok: false, error: "Membership not found" }, 404);

      // Resolve effective email
      const { data: effectiveEmail } = await admin.rpc("get_effective_alert_email", {
        p_membership_id: membership.id,
      });

      if (!effectiveEmail) return json({ ok: false, error: "No alert email configured" }, 400);

      const { data: profile } = await admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle();

      await admin.from("email_outbox").insert({
        organization_id,
        to_email: effectiveEmail,
        subject: "Correo de prueba de alertas — Andromeda Legal",
        html: generateTestAlertHtml(profile?.full_name),
        status: "PENDING",
        trigger_event: "ALERT_EMAIL_TEST",
        dedupe_key: `alert-test-${membership.id}-${Date.now()}`,
        next_attempt_at: new Date().toISOString(),
        metadata: { user_id: user.id, membership_id: membership.id },
      });

      return json({ ok: true, test_sent_to: effectiveEmail }, 200);
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[manage-alert-email] Error:", err);
    return json({ ok: false, error: "Internal error" }, 500);
  }
});
