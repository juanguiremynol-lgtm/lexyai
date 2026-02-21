/**
 * generate-signing-link — Creates a secure HMAC-signed URL for document signing.
 * Requires authenticated lawyer. Creates document_signatures record + audit event.
 * Phase 3.6: Custom branding in signing invitation emails.
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

async function computeHMAC(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function resolveBranding(
  supabaseUrl: string,
  org: any | null,
  profile: any | null
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
    const { document_id, signer_name, signer_email, signer_cedula, signer_phone, signer_role, expires_hours, send_email = false, signing_order = 1, depends_on = null, create_as_waiting = false } = body;

    if (!document_id || !signer_name || !signer_email) {
      return json({ error: "document_id, signer_name, and signer_email are required" }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Verify document exists and is finalized
    const { data: doc, error: docErr } = await adminClient
      .from("generated_documents")
      .select("id, organization_id, status, title, document_type, created_by")
      .eq("id", document_id)
      .single();

    if (docErr || !doc) return json({ error: "Document not found" }, 404);
    // Allow finalized, draft, ready_for_signature, and sent_for_signature (bilateral docs need multiple signing links)
    const allowedStatuses = ["finalized", "draft", "ready_for_signature", "sent_for_signature"];
    if (!allowedStatuses.includes(doc.status)) {
      return json({ error: `Document status is '${doc.status}', must be one of: ${allowedStatuses.join(", ")}` }, 400);
    }

    // BILATERAL INVARIANT: For bilateral docs, client signing link requires lawyer signature completion
    const bilateralTypes = ["contrato_servicios"];
    if (bilateralTypes.includes(doc.document_type) && (signer_role === "client" || signing_order > 1)) {
      // Check if signer with signing_order=1 (lawyer) has completed signing
      const { data: lawyerSigs } = await adminClient
        .from("document_signatures")
        .select("id, status, signing_order")
        .eq("document_id", document_id)
        .eq("signing_order", 1);

      const lawyerSigned = lawyerSigs?.some(s => s.status === "signed");
      if (!lawyerSigned) {
        return json({
          error: "El abogado (firmante 1) debe completar su firma antes de generar el enlace para el cliente.",
          code: "LAWYER_SIGNATURE_REQUIRED",
        }, 400);
      }
    }

    // Determine delivery method for audit trail
    const deliveryMethod = send_email ? "EMAIL" : "LINK";

    // Generate signing token and HMAC
    const signingToken = crypto.randomUUID();
    const hoursToExpire = expires_hours || 72;
    const expiresAt = new Date(Date.now() + hoursToExpire * 60 * 60 * 1000);
    const expiresTimestamp = Math.floor(expiresAt.getTime() / 1000);
    const hmacSignature = await computeHMAC(signingSecret, signingToken + expiresTimestamp);

    // Create signature record
    const initialStatus = create_as_waiting ? "waiting" : "pending";
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
        status: initialStatus,
        created_by: user.id,
        signing_order: signing_order,
        depends_on: depends_on || null,
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
        delivery_method: deliveryMethod,
        sender: "info@andromeda.legal",
        generated_for: { user_id: user.id },
      },
      actor_type: "lawyer",
      actor_id: user.id,
      actor_ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      actor_user_agent: req.headers.get("user-agent") || null,
    });

    // Build signing URL
    const appUrl = "https://andromeda.legal";
    const signingUrl = `${appUrl}/sign/${signingToken}?expires=${expiresTimestamp}&signature=${hmacSignature}`;

    // Optionally send email
    let emailSent = false;
    if (send_email) {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        try {
          const { data: lawyerProfile } = await adminClient
            .from("profiles")
            .select("full_name, email, litigation_email, custom_branding_enabled, custom_logo_path, custom_firm_name")
            .eq("id", user.id)
            .single();

          const { data: orgData } = await adminClient
            .from("organizations")
            .select("name, custom_branding_enabled, custom_logo_path, custom_firm_name")
            .eq("id", doc.organization_id)
            .single();

          const lawyerName = lawyerProfile?.full_name || lawyerProfile?.email || "Su abogado";
          const branding = resolveBranding(supabaseUrl, orgData, lawyerProfile);

          const emailHtml = `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
              ${buildEmailHeader(branding)}
              <div style="padding:24px 0;">
                <h2 style="color:#1a1a2e;">Documento pendiente de firma</h2>
                <p>Hola <strong>${signer_name}</strong>,</p>
                <p>${lawyerName}${branding.firm_name !== "Andromeda Legal" ? ` de ${branding.firm_name}` : (orgData?.name ? ` de ${orgData.name}` : "")} le ha enviado un documento para su firma electrónica.</p>
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
              to: [signer_email],
              ...(lawyerProfile?.litigation_email ? { reply_to: lawyerProfile.litigation_email } : {}),
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
      delivery_method: deliveryMethod,
    });
  } catch (err) {
    console.error("generate-signing-link error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
