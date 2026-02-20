/**
 * generate-signing-link — Creates a secure HMAC-signed URL for document signing.
 * Requires authenticated lawyer. Creates document_signatures record + audit event.
 * 
 * Updated Phase 2.5: Accepts `send_email` param (default: false).
 * Link is generated first, email is sent only on demand via send-signing-email.
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const signingSecret = Deno.env.get("SIGNING_SECRET");
    if (!signingSecret) return json({ error: "SIGNING_SECRET not configured" }, 500);

    // Auth
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { document_id, signer_name, signer_email, signer_cedula, signer_phone, signer_role, expires_hours, send_email = false } = body;

    if (!document_id || !signer_name || !signer_email) {
      return json({ error: "document_id, signer_name, and signer_email are required" }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Verify document exists and is finalized
    const { data: doc, error: docErr } = await adminClient
      .from("generated_documents")
      .select("id, organization_id, status, title")
      .eq("id", document_id)
      .single();

    if (docErr || !doc) return json({ error: "Document not found" }, 404);
    if (doc.status !== "finalized" && doc.status !== "draft") {
      return json({ error: `Document status is '${doc.status}', must be 'finalized' or 'draft'` }, 400);
    }

    // Generate signing token and HMAC
    const signingToken = crypto.randomUUID();
    const hoursToExpire = expires_hours || 72;
    const expiresAt = new Date(Date.now() + hoursToExpire * 60 * 60 * 1000);
    const expiresTimestamp = Math.floor(expiresAt.getTime() / 1000);
    const hmacSignature = await computeHMAC(signingSecret, signingToken + expiresTimestamp);

    // Create signature record
    const { data: sig, error: sigErr } = await adminClient
      .from("document_signatures")
      .insert({
        organization_id: doc.organization_id,
        document_id,
        signer_name,
        signer_email,
        signer_cedula: signer_cedula || null,
        signer_phone: signer_phone || null,
        signer_role: signer_role || "client",
        signing_token: signingToken,
        hmac_signature: hmacSignature,
        expires_at: expiresAt.toISOString(),
        status: "pending",
        created_by: user.id,
      })
      .select("id")
      .single();

    if (sigErr) return json({ error: "Failed to create signature: " + sigErr.message }, 500);

    // Update document status
    if (doc.status === "finalized") {
      await adminClient
        .from("generated_documents")
        .update({ status: "sent_for_signature" })
        .eq("id", document_id);
    }

    // Log audit event
    await adminClient.from("document_signature_events").insert({
      organization_id: doc.organization_id,
      document_id,
      signature_id: sig.id,
      event_type: "signature.requested",
      event_data: {
        signer_email,
        signer_name,
        expires_at: expiresAt.toISOString(),
        expires_hours: hoursToExpire,
      },
      actor_type: "lawyer",
      actor_id: user.id,
      actor_ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      actor_user_agent: req.headers.get("user-agent") || null,
    });

    // Build signing URL
    const appUrl = "https://lexyai.lovable.app";
    const signingUrl = `${appUrl}/sign/${signingToken}?expires=${expiresTimestamp}&signature=${hmacSignature}`;

    // Optionally send email
    let emailSent = false;
    if (send_email) {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        try {
          // Fetch lawyer profile for name
          const { data: lawyerProfile } = await adminClient
            .from("profiles")
            .select("full_name, email")
            .eq("id", user.id)
            .single();

          // Fetch org name
          const { data: orgData } = await adminClient
            .from("organizations")
            .select("name")
            .eq("id", doc.organization_id)
            .single();

          const lawyerName = lawyerProfile?.full_name || lawyerProfile?.email || "Su abogado";
          const firmName = orgData?.name || "";

          const emailHtml = `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
              <div style="text-align:center;padding:24px 0;border-bottom:2px solid #1a1a2e;">
                <h1 style="color:#1a1a2e;font-size:24px;margin:0;">ANDROMEDA LEGAL</h1>
                <p style="color:#666;margin:4px 0 0;">Plataforma de Gestión Legal</p>
              </div>
              <div style="padding:24px 0;">
                <h2 style="color:#1a1a2e;">Documento pendiente de firma</h2>
                <p>Hola <strong>${signer_name}</strong>,</p>
                <p>${lawyerName}${firmName ? ` de ${firmName}` : ""} le ha enviado un documento para su firma electrónica.</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Documento</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">${doc.title}</td></tr>
                </table>
                <div style="text-align:center;margin:24px 0;">
                  <a href="${signingUrl}" style="background:#1a1a2e;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">
                    Firmar Documento
                  </a>
                </div>
                <p style="color:#666;font-size:14px;">Este enlace vence el ${expiresAt.toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long", year: "numeric" })}.</p>
                <p style="color:#666;font-size:14px;">Si tiene preguntas sobre este documento, comuníquese directamente con su abogado.</p>
              </div>
              <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
              <p style="color:#999;font-size:12px;text-align:center;">
                Andromeda Legal — andromeda.legal<br/>
                Firma electrónica conforme a la Ley 527 de 1999 y Decreto 2364 de 2012.
              </p>
            </div>
          `;

          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "Andromeda Legal <info@andromeda.legal>",
              to: [signer_email],
              subject: `Documento pendiente de firma — ${doc.title}`,
              html: emailHtml,
            }),
          });

          const emailData = await emailRes.json();
          emailSent = emailRes.ok;

          await adminClient.from("document_signature_events").insert({
            organization_id: doc.organization_id,
            document_id,
            signature_id: sig.id,
            event_type: "signature.email_sent",
            event_data: {
              recipient: signer_email,
              delivery_status: emailRes.ok ? "sent" : "failed",
              provider_id: emailData.id || null,
              error: emailRes.ok ? null : (emailData.message || "Unknown error"),
            },
            actor_type: "system",
            actor_id: "system",
          });
        } catch (emailErr) {
          console.error("Email send error:", emailErr);
        }
      }
    }

    return json({
      ok: true,
      signature_id: sig.id,
      signing_url: signingUrl,
      expires_at: expiresAt.toISOString(),
      email_sent: emailSent,
    });
  } catch (err) {
    console.error("generate-signing-link error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
