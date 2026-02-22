/**
 * get-source-pdf-view-url — Returns a short-lived signed URL for the source PDF.
 * Used by the public signing page so counterparties can view the document before signing.
 * Validates signing_token to ensure the requester has legitimate access.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { signing_token, document_id } = body;

    if (!signing_token && !document_id) {
      return json({ error: "signing_token or document_id required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    let docId: string;
    let orgId: string;

    if (signing_token) {
      // Token-based access (public counterparty flow)
      const { data: sig, error: sigErr } = await adminClient
        .from("document_signatures")
        .select("id, document_id, organization_id, status, expires_at")
        .eq("signing_token", signing_token)
        .single();

      if (sigErr || !sig) return json({ error: "Token inválido" }, 403);

      // Allow viewing for active signing flows (pending, viewed, otp_verified, waiting)
      const blockedStatuses = ["revoked", "declined", "expired"];
      if (blockedStatuses.includes(sig.status)) {
        return json({ error: "Este enlace ya no es válido" }, 410);
      }

      if (sig.expires_at && new Date(sig.expires_at) < new Date()) {
        return json({ error: "El enlace ha expirado" }, 410);
      }

      docId = sig.document_id;
      orgId = sig.organization_id;
    } else {
      // Authenticated access (lawyer flow) — check auth header
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await userClient.auth.getUser();
      if (authErr || !user) return json({ error: "Unauthorized" }, 401);

      const { data: doc, error: docErr } = await adminClient
        .from("generated_documents")
        .select("id, organization_id, source_pdf_path, created_by")
        .eq("id", document_id)
        .single();

      if (docErr || !doc) return json({ error: "Documento no encontrado" }, 404);
      if (doc.created_by !== user.id) return json({ error: "No autorizado" }, 403);

      docId = doc.id;
      orgId = doc.organization_id;
    }

    // Fetch document source_pdf_path
    const { data: doc, error: docErr } = await adminClient
      .from("generated_documents")
      .select("source_type, source_pdf_path")
      .eq("id", docId)
      .single();

    if (docErr || !doc) return json({ error: "Documento no encontrado" }, 404);
    if (doc.source_type !== "UPLOADED_PDF" || !doc.source_pdf_path) {
      return json({ error: "Este documento no tiene un PDF de origen" }, 400);
    }

    // Generate short-lived signed URL (1 hour)
    const { data: urlData, error: urlErr } = await adminClient.storage
      .from("unsigned-documents")
      .createSignedUrl(doc.source_pdf_path, 3600);

    if (urlErr || !urlData?.signedUrl) {
      console.error("[get-source-pdf-view-url] Storage error:", urlErr);
      return json({ error: "El PDF no pudo ser encontrado" }, 404);
    }

    return json({ url: urlData.signedUrl });
  } catch (err) {
    console.error("[get-source-pdf-view-url] Error:", err);
    return json({ error: "Error al generar enlace del PDF" }, 500);
  }
});
