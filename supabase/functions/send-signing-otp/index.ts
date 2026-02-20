/**
 * send-signing-otp — Generates and sends a 6-digit OTP to the signer's email.
 * Public endpoint. Validates signing token before sending.
 * Phase 2.5: Andromeda Legal branding.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hashOTP(otp: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(otp));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { signature_id, signing_token } = body;

    if (!signature_id && !signing_token) {
      return json({ error: "signature_id or signing_token required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const query = signing_token
      ? adminClient.from("document_signatures").select("*").eq("signing_token", signing_token)
      : adminClient.from("document_signatures").select("*").eq("id", signature_id);

    const { data: sig, error: sigErr } = await query.single();
    if (sigErr || !sig) return json({ error: "Signature request not found" }, 404);

    if (sig.status === "signed") return json({ error: "Already signed" }, 409);
    if (sig.otp_attempts >= 3) return json({ error: "Max OTP attempts exceeded. Request a new signing link." }, 429);

    if (sig.otp_sent_at) {
      const lastSent = new Date(sig.otp_sent_at).getTime();
      if (Date.now() - lastSent < 60000) {
        return json({ error: "Please wait before requesting another code", retry_after: 60 }, 429);
      }
    }

    const otpArray = new Uint32Array(1);
    crypto.getRandomValues(otpArray);
    const otp = String(otpArray[0] % 1000000).padStart(6, "0");
    const otpHash = await hashOTP(otp);

    await adminClient
      .from("document_signatures")
      .update({
        otp_code_hash: otpHash,
        otp_sent_at: new Date().toISOString(),
      })
      .eq("id", sig.id);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    let emailSent = false;

    if (resendKey) {
      const emailHtml = `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;text-align:center;">
          <div style="padding:16px 0;border-bottom:2px solid #1a1a2e;margin-bottom:24px;">
            <h1 style="color:#1a1a2e;font-size:20px;margin:0;">ANDROMEDA LEGAL</h1>
          </div>
          <h2 style="color:#1a1a2e;">Código de Verificación</h2>
          <p>Su código de verificación para firmar el documento es:</p>
          <div style="background:#f0f0f0;padding:20px;border-radius:12px;margin:20px 0;">
            <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1a1a2e;">${otp}</span>
          </div>
          <p style="color:#666;font-size:14px;">Este código expira en 10 minutos.</p>
          <p style="color:#999;font-size:12px;">No comparta este código con nadie.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
          <p style="color:#999;font-size:11px;">Andromeda Legal</p>
        </div>
      `;

      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Andromeda Legal <info@andromeda.legal>",
            to: [sig.signer_email],
            subject: `Código de verificación — ${otp}`,
            html: emailHtml,
          }),
        });
        await res.json();
        emailSent = res.ok;
      } catch (e) {
        console.error("OTP email error:", e);
      }
    }

    await adminClient.from("document_signature_events").insert({
      organization_id: sig.organization_id,
      document_id: sig.document_id,
      signature_id: sig.id,
      event_type: "signature.otp_sent",
      event_data: {
        delivery_method: "email",
        email_sent: emailSent,
        timestamp: new Date().toISOString(),
      },
      actor_type: "system",
      actor_id: "system",
    });

    return json({
      ok: true,
      message: "Código enviado",
      email_masked: sig.signer_email.replace(/^(.{2})(.*)(@.*)$/, (_, s, m, e) => s + "*".repeat(m.length) + e),
    });
  } catch (err) {
    console.error("send-signing-otp error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
