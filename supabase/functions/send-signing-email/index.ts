/**
 * send-signing-email — Sends (or resends) the signing invitation email
 * for an existing signature record. Lightweight — does not generate a new link.
 * Requires authenticated lawyer.
 * Phase 3.6: Custom branding in signing invitation emails.
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

function resolveBranding(
  supabaseUrl: string,
  org: { custom_branding_enabled?: boolean; custom_logo_path?: string; custom_firm_name?: string; name?: string } | null,
  profile: { custom_branding_enabled?: boolean; custom_logo_path?: string; custom_firm_name?: string; full_name?: string } | null
): { logo_url: string | null; firm_name: string } {
  if (org?.custom_branding_enabled && org?.custom_logo_path) {
    return {
      logo_url: `${supabaseUrl}/storage/v1/object/public/branding/${org.custom_logo_path}`,
      firm_name: org.custom_firm_name || org.name || "Andromeda Legal",
    };
  }
  if (profile?.custom_branding_enabled && profile?.custom_logo_path) {
    return {
      logo_url: `${supabaseUrl}/storage/v1/object/public/branding/${profile.custom_logo_path}`,
      firm_name: profile.custom_firm_name || profile.full_name || "Andromeda Legal",
    };
  }
  return { logo_url: null, firm_name: "Andromeda Legal" };
}

function buildEmailHeader(branding: { logo_url: string | null; firm_name: string }): string {
  if (branding.logo_url) {
    return `<div style="text-align:center;padding:24px 0;border-bottom:2px solid #1a1a2e;">
      <img src="${branding.logo_url}" alt="${branding.firm_name}" style="max-height:50px;max-width:200px;" />
      <p style="color:#666;margin:8px 0 0;font-size:13px;">${branding.firm_name}</p>
    </div>`;
  }
  return `<div style="text-align:center;padding:24px 0;border-bottom:2px solid #1a1a2e;">
    <h1 style="color:#1a1a2e;font-size:24px;margin:0;">${branding.firm_name.toUpperCase()}</h1>
    <p style="color:#666;margin:4px 0 0;">Plataforma de Gestión Legal</p>
  </div>`;
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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { signature_id } = body;
    if (!signature_id) return json({ error: "signature_id is required" }, 400);

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Fetch signature
    const { data: sig, error: sigErr } = await adminClient
      .from("document_signatures")
      .select("*")
      .eq("id", signature_id)
      .single();

    if (sigErr || !sig) return json({ error: "Signature not found" }, 404);

    // Check status
    if (sig.status === "signed") return json({ error: "Already signed" }, 409);
    if (sig.status === "revoked") return json({ error: "Signature was revoked" }, 400);

    // Fetch document
    const { data: doc } = await adminClient
      .from("generated_documents")
      .select("id, title, organization_id, created_by")
      .eq("id", sig.document_id)
      .single();

    if (!doc) return json({ error: "Document not found" }, 404);

    // Rebuild signing URL from existing token
    const expiresTimestamp = Math.floor(new Date(sig.expires_at).getTime() / 1000);
    const appUrl = "https://lexyai.lovable.app";
    const signingUrl = `${appUrl}/sign/${sig.signing_token}?expires=${expiresTimestamp}&signature=${sig.hmac_signature}`;

    // Fetch lawyer info
    const { data: lawyerProfile } = await adminClient
      .from("profiles")
      .select("full_name, email, custom_branding_enabled, custom_logo_path, custom_firm_name")
      .eq("id", user.id)
      .single();

    const { data: orgData } = await adminClient
      .from("organizations")
      .select("name, custom_branding_enabled, custom_logo_path, custom_firm_name")
      .eq("id", doc.organization_id)
      .single();

    const lawyerName = lawyerProfile?.full_name || lawyerProfile?.email || "Su abogado";

    // Resolve branding
    const branding = resolveBranding(supabaseUrl, orgData, lawyerProfile);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ error: "Email provider not configured" }, 500);

    const expiresDate = new Date(sig.expires_at);
    const emailHtml = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        ${buildEmailHeader(branding)}
        <div style="padding:24px 0;">
          <h2 style="color:#1a1a2e;">Documento pendiente de firma</h2>
          <p>Hola <strong>${sig.signer_name}</strong>,</p>
          <p>${lawyerName}${branding.firm_name !== "Andromeda Legal" ? ` de ${branding.firm_name}` : (orgData?.name ? ` de ${orgData.name}` : "")} le ha enviado un documento para su firma electrónica.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Documento</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">${doc.title}</td></tr>
          </table>
          <div style="text-align:center;margin:24px 0;">
            <a href="${signingUrl}" style="background:#1a1a2e;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">
              Firmar Documento
            </a>
          </div>
          <p style="color:#666;font-size:14px;">Este enlace vence el ${expiresDate.toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long", year: "numeric" })}.</p>
          <p style="color:#666;font-size:14px;">Si tiene preguntas sobre este documento, comuníquese directamente con su abogado.</p>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
        <p style="color:#999;font-size:12px;text-align:center;">
          ${branding.firm_name}<br/>
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
        from: `${branding.firm_name} <info@andromeda.legal>`,
        to: [sig.signer_email],
        subject: `Documento pendiente de firma — ${doc.title}`,
        html: emailHtml,
      }),
    });

    const emailData = await emailRes.json();

    // Log event
    await adminClient.from("document_signature_events").insert({
      organization_id: doc.organization_id,
      document_id: doc.id,
      signature_id: sig.id,
      event_type: "signature.email_sent",
      event_data: {
        recipient: sig.signer_email,
        delivery_status: emailRes.ok ? "sent" : "failed",
        provider_id: emailData.id || null,
        is_resend: true,
      },
      actor_type: "lawyer",
      actor_id: user.id,
    });

    return json({
      ok: true,
      email_sent: emailRes.ok,
      recipient: sig.signer_email,
    });
  } catch (err) {
    console.error("send-signing-email error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
