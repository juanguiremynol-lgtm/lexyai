/**
 * verify-signing-otp — Verifies the 6-digit OTP code for document signing.
 * Public endpoint. Max 3 attempts per signature.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

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
    const { signature_id, signing_token, otp_code } = body;

    if ((!signature_id && !signing_token) || !otp_code) {
      return json({ error: "signature_id/signing_token and otp_code are required" }, 400);
    }

    if (!/^\d{6}$/.test(otp_code)) {
      return json({ error: "OTP must be 6 digits" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Fetch signature
    const query = signing_token
      ? adminClient.from("document_signatures").select("*").eq("signing_token", signing_token)
      : adminClient.from("document_signatures").select("*").eq("id", signature_id);

    const { data: sig, error: sigErr } = await query.single();
    if (sigErr || !sig) return json({ error: "Signature request not found" }, 404);

    if (sig.status === "signed") return json({ error: "Already signed" }, 409);
    if (sig.otp_attempts >= 3) {
      return json({ error: "Max OTP attempts exceeded. Request a new signing link.", locked: true }, 429);
    }

    // Check OTP expiry (10 minutes)
    if (sig.otp_sent_at) {
      const sentAt = new Date(sig.otp_sent_at).getTime();
      if (Date.now() - sentAt > 10 * 60 * 1000) {
        return json({ error: "OTP expired. Request a new code.", expired: true }, 410);
      }
    }

    // Verify OTP hash
    const inputHash = await hashOTP(otp_code);
    const isValid = inputHash === sig.otp_code_hash;

    // Increment attempts
    const newAttempts = (sig.otp_attempts || 0) + 1;

    if (isValid) {
      await adminClient
        .from("document_signatures")
        .update({
          status: "otp_verified",
          otp_verified_at: new Date().toISOString(),
          otp_attempts: newAttempts,
        })
        .eq("id", sig.id);

      await adminClient.from("document_signature_events").insert({
        organization_id: sig.organization_id,
        document_id: sig.document_id,
        signature_id: sig.id,
        event_type: "signature.otp_verified",
        event_data: { attempt_number: newAttempts, timestamp: new Date().toISOString() },
        actor_type: "signer",
        actor_id: sig.signer_email,
        actor_ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        actor_user_agent: req.headers.get("user-agent") || null,
      });

      // Now fetch the document content to return
      const { data: doc } = await adminClient
        .from("generated_documents")
        .select("id, title, content_html, document_type")
        .eq("id", sig.document_id)
        .single();

      return json({
        ok: true,
        verified: true,
        document: doc ? {
          id: doc.id,
          title: doc.title,
          content_html: doc.content_html,
          document_type: doc.document_type,
        } : null,
      });
    } else {
      await adminClient
        .from("document_signatures")
        .update({ otp_attempts: newAttempts })
        .eq("id", sig.id);

      await adminClient.from("document_signature_events").insert({
        organization_id: sig.organization_id,
        document_id: sig.document_id,
        signature_id: sig.id,
        event_type: "signature.otp_failed",
        event_data: { attempt_number: newAttempts, remaining: 3 - newAttempts },
        actor_type: "signer",
        actor_id: sig.signer_email,
        actor_ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        actor_user_agent: req.headers.get("user-agent") || null,
      });

      return json({
        ok: false,
        verified: false,
        attempts_remaining: 3 - newAttempts,
        message: newAttempts >= 3
          ? "Código incorrecto. Ha excedido el número máximo de intentos."
          : `Código incorrecto. Le quedan ${3 - newAttempts} intento(s).`,
      });
    }
  } catch (err) {
    console.error("verify-signing-otp error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
