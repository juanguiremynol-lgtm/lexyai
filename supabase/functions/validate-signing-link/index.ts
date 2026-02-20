/**
 * validate-signing-link — Validates HMAC signature and expiration of a signing URL.
 * Public endpoint (no auth). Returns document data if valid.
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

async function computeHMAC(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { signing_token, expires, signature } = body;

    if (!signing_token || !expires || !signature) {
      return json({ error: "signing_token, expires, and signature are required" }, 400);
    }

    const signingSecret = Deno.env.get("SIGNING_SECRET");
    if (!signingSecret) return json({ error: "Server configuration error" }, 500);

    // Verify HMAC
    const expectedHmac = await computeHMAC(signingSecret, signing_token + expires);
    if (expectedHmac !== signature) {
      return json({ error: "invalid_link", message: "El enlace de firma no es válido." }, 403);
    }

    // Check expiration
    const expiresMs = parseInt(expires) * 1000;
    if (Date.now() > expiresMs) {
      return json({ error: "expired", message: "El enlace de firma ha expirado." }, 410);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Fetch signature record
    const { data: sig, error: sigErr } = await adminClient
      .from("document_signatures")
      .select("id, document_id, signer_name, signer_email, signer_cedula, status, otp_verified_at, organization_id")
      .eq("signing_token", signing_token)
      .single();

    if (sigErr || !sig) {
      return json({ error: "not_found", message: "Solicitud de firma no encontrada." }, 404);
    }

    if (sig.status === "signed") {
      return json({ error: "already_signed", message: "Este documento ya fue firmado." }, 409);
    }
    if (sig.status === "revoked") {
      return json({ error: "revoked", message: "Esta solicitud de firma fue revocada." }, 403);
    }
    if (sig.status === "declined") {
      return json({ error: "declined", message: "Esta solicitud de firma fue declinada." }, 403);
    }

    // Fetch document
    const { data: doc, error: docErr } = await adminClient
      .from("generated_documents")
      .select("id, title, content_html, document_type, status")
      .eq("id", sig.document_id)
      .single();

    if (docErr || !doc) {
      return json({ error: "document_not_found", message: "Documento no encontrado." }, 404);
    }

    // Update status to viewed if pending
    if (sig.status === "pending") {
      await adminClient
        .from("document_signatures")
        .update({ status: "viewed" })
        .eq("id", sig.id);
    }

    // Log link opened event
    await adminClient.from("document_signature_events").insert({
      organization_id: sig.organization_id,
      document_id: sig.document_id,
      signature_id: sig.id,
      event_type: "signature.link_opened",
      event_data: { timestamp: new Date().toISOString() },
      actor_type: "signer",
      actor_id: sig.signer_email,
      actor_ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      actor_user_agent: req.headers.get("user-agent") || null,
    });

    // Mask cedula for display
    const maskedCedula = sig.signer_cedula
      ? sig.signer_cedula.replace(/^(.{2})(.*)(.{3})$/, (_, start, mid, end) => start + "*".repeat(mid.length) + end)
      : null;

    return json({
      ok: true,
      signature_id: sig.id,
      signer_name: sig.signer_name,
      signer_email_masked: sig.signer_email.replace(/^(.{2})(.*)(@.*)$/, (_, s, m, e) => s + "*".repeat(m.length) + e),
      signer_cedula_masked: maskedCedula,
      otp_verified: !!sig.otp_verified_at,
      status: sig.status,
      document: {
        id: doc.id,
        title: doc.title,
        content_html: sig.otp_verified_at ? doc.content_html : null, // Only show content after OTP
        document_type: doc.document_type,
      },
    });
  } catch (err) {
    console.error("validate-signing-link error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
