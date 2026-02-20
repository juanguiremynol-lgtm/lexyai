/**
 * complete-signature — Finalizes the digital signature process.
 * Public endpoint. Captures signature, computes SHA-256, stores signed doc,
 * sends notifications.
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

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      signature_id,
      signing_token,
      signature_method,
      signature_data, // typed name or base64 drawn signature
      consent_given,
      geolocation,
    } = body;

    if (!signing_token || !signature_method || !signature_data || !consent_given) {
      return json({ error: "signing_token, signature_method, signature_data, and consent_given are required" }, 400);
    }

    if (!["typed", "drawn"].includes(signature_method)) {
      return json({ error: "signature_method must be 'typed' or 'drawn'" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Fetch signature
    const { data: sig, error: sigErr } = await adminClient
      .from("document_signatures")
      .select("*")
      .eq("signing_token", signing_token)
      .single();

    if (sigErr || !sig) return json({ error: "Signature request not found" }, 404);

    if (sig.status === "signed") return json({ error: "Already signed" }, 409);
    if (sig.status !== "otp_verified") {
      return json({ error: "OTP verification required before signing" }, 403);
    }

    // Check expiration
    if (new Date(sig.expires_at) < new Date()) {
      await adminClient.from("document_signatures").update({ status: "expired" }).eq("id", sig.id);
      return json({ error: "Signing link has expired" }, 410);
    }

    const signerIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const signerUA = req.headers.get("user-agent") || "unknown";
    const signedAt = new Date().toISOString();

    // Log consent event
    await adminClient.from("document_signature_events").insert({
      organization_id: sig.organization_id,
      document_id: sig.document_id,
      signature_id: sig.id,
      event_type: "signature.consent_given",
      event_data: { consent_text: "Acepto firmar electrónicamente conforme a Ley 527/1999", timestamp: signedAt },
      actor_type: "signer",
      actor_id: sig.signer_email,
      actor_ip: signerIp,
      actor_user_agent: signerUA,
    });

    // Fetch the document content for the signed HTML
    const { data: doc } = await adminClient
      .from("generated_documents")
      .select("id, title, content_html, organization_id")
      .eq("id", sig.document_id)
      .single();

    if (!doc) return json({ error: "Document not found" }, 404);

    // Build the signed document HTML with signature block
    const signatureBlock = signature_method === "typed"
      ? `<div style="margin-top:40px;border-top:2px solid #333;padding-top:20px;">
           <p style="font-family:'Dancing Script',cursive;font-size:28px;color:#1a1a2e;">${signature_data}</p>
           <p><strong>${sig.signer_name}</strong></p>
           <p>C.C. ${sig.signer_cedula || "N/A"}</p>
           <p style="font-size:12px;color:#666;">Firmado electrónicamente el ${new Date(signedAt).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })} a las ${new Date(signedAt).toLocaleTimeString("es-CO", { timeZone: "America/Bogota" })}</p>
           <p style="font-size:11px;color:#999;">Firma electrónica válida conforme a Ley 527 de 1999 y Decreto 2364 de 2012</p>
         </div>`
      : `<div style="margin-top:40px;border-top:2px solid #333;padding-top:20px;">
           <img src="${signature_data}" alt="Firma" style="max-width:300px;max-height:100px;" />
           <p><strong>${sig.signer_name}</strong></p>
           <p>C.C. ${sig.signer_cedula || "N/A"}</p>
           <p style="font-size:12px;color:#666;">Firmado electrónicamente el ${new Date(signedAt).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })} a las ${new Date(signedAt).toLocaleTimeString("es-CO", { timeZone: "America/Bogota" })}</p>
           <p style="font-size:11px;color:#999;">Firma electrónica válida conforme a Ley 527 de 1999 y Decreto 2364 de 2012</p>
         </div>`;

    const signedHtml = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>${doc.title}</title>
<style>
  body { font-family: 'Georgia', serif; max-width: 800px; margin: 0 auto; padding: 40px; }
  @import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap');
</style>
</head>
<body>
${doc.content_html}
${signatureBlock}
<footer style="margin-top:40px;padding-top:16px;border-top:1px solid #eee;font-size:10px;color:#999;text-align:center;">
  ID: ${sig.id} · Firmado electrónicamente via ATENIA · ${signedAt}
</footer>
</body>
</html>`;

    // Compute SHA-256 of signed HTML
    const signedBytes = new TextEncoder().encode(signedHtml);
    const documentHash = await sha256Hex(signedBytes);

    // Store signed document in Supabase Storage
    const storagePath = `${sig.organization_id}/${sig.document_id}/signed.html`;
    const { error: uploadErr } = await adminClient.storage
      .from("signed-documents")
      .upload(storagePath, signedBytes, {
        contentType: "text/html",
        upsert: true,
      });

    if (uploadErr) {
      console.error("Storage upload error:", uploadErr);
    }

    // Store drawn signature image if applicable
    let signatureImagePath: string | null = null;
    if (signature_method === "drawn" && signature_data.startsWith("data:image")) {
      const base64Data = signature_data.split(",")[1];
      const binaryStr = atob(base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

      signatureImagePath = `${sig.organization_id}/${sig.document_id}/signature-${sig.id}.png`;
      await adminClient.storage
        .from("signed-documents")
        .upload(signatureImagePath, bytes, {
          contentType: "image/png",
          upsert: true,
        });
    }

    // Update signature record
    await adminClient
      .from("document_signatures")
      .update({
        status: "signed",
        signature_method,
        signature_data: signature_method === "typed" ? signature_data : null,
        signature_image_path: signatureImagePath,
        signed_at: signedAt,
        signer_ip: signerIp,
        signer_user_agent: signerUA,
        signer_geolocation: geolocation || null,
        signed_document_path: storagePath,
        signed_document_hash: documentHash,
      })
      .eq("id", sig.id);

    // Update document status
    await adminClient
      .from("generated_documents")
      .update({ status: "signed" })
      .eq("id", sig.document_id);

    // Log signature event
    await adminClient.from("document_signature_events").insert({
      organization_id: sig.organization_id,
      document_id: sig.document_id,
      signature_id: sig.id,
      event_type: "signature.signed",
      event_data: {
        signature_method,
        document_hash: documentHash,
        timestamp: signedAt,
        geolocation: geolocation || null,
      },
      actor_type: "signer",
      actor_id: sig.signer_email,
      actor_ip: signerIp,
      actor_user_agent: signerUA,
    });

    // Log hash generated
    await adminClient.from("document_signature_events").insert({
      organization_id: sig.organization_id,
      document_id: sig.document_id,
      signature_id: sig.id,
      event_type: "document.hash_generated",
      event_data: { hash: documentHash, algorithm: "SHA-256" },
      actor_type: "system",
      actor_id: "system",
    });

    // Log storage
    await adminClient.from("document_signature_events").insert({
      organization_id: sig.organization_id,
      document_id: sig.document_id,
      signature_id: sig.id,
      event_type: "document.stored",
      event_data: { storage_path: storagePath },
      actor_type: "system",
      actor_id: "system",
    });

    // Send notification emails
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const confirmHtml = `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#1a1a2e;">✅ Documento Firmado Exitosamente</h2>
          <p>El documento <strong>${doc.title}</strong> ha sido firmado electrónicamente.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Firmante</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">${sig.signer_name}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Fecha</td><td style="padding:8px;border-bottom:1px solid #eee;">${new Date(signedAt).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Hash SHA-256</td><td style="padding:8px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;word-break:break-all;">${documentHash}</td></tr>
          </table>
          <p style="color:#999;font-size:12px;">Firma electrónica válida conforme a Ley 527 de 1999 y Decreto 2364 de 2012.</p>
        </div>
      `;

      // Send to signer
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "ATENIA <info@andromeda.legal>",
            to: [sig.signer_email],
            subject: `Documento firmado: ${doc.title}`,
            html: confirmHtml,
          }),
        });
      } catch (e) {
        console.error("Signer notification email error:", e);
      }

      // Notify the lawyer who created the signing request
      try {
        const { data: creator } = await adminClient
          .from("profiles")
          .select("email")
          .eq("id", sig.created_by)
          .single();

        if (creator?.email) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "ATENIA <info@andromeda.legal>",
              to: [creator.email],
              subject: `✅ ${sig.signer_name} firmó: ${doc.title}`,
              html: confirmHtml,
            }),
          });
        }
      } catch (e) {
        console.error("Lawyer notification email error:", e);
      }

      // Log notifications
      await adminClient.from("document_signature_events").insert({
        organization_id: sig.organization_id,
        document_id: sig.document_id,
        signature_id: sig.id,
        event_type: "notification.sent",
        event_data: { recipients: [sig.signer_email], type: "signature_confirmation" },
        actor_type: "system",
        actor_id: "system",
      });
    }

    return json({
      ok: true,
      signature_id: sig.id,
      document_hash: documentHash,
      signed_at: signedAt,
      message: "Documento firmado exitosamente",
    });
  } catch (err) {
    console.error("complete-signature error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
