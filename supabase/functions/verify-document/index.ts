/**
 * verify-document — Public endpoint for verifying document integrity via SHA-256 hash.
 * No authentication required.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { document_hash } = body;

    if (!document_hash || typeof document_hash !== "string") {
      return json({ error: "document_hash is required" }, 400);
    }

    // Validate hash format (64 hex characters for SHA-256)
    if (!/^[a-fA-F0-9]{64}$/.test(document_hash)) {
      return json({ error: "Invalid hash format. Expected 64 hexadecimal characters (SHA-256)." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: sig, error } = await adminClient
      .from("document_signatures")
      .select(`
        id,
        signed_at,
        signer_name,
        signature_method,
        document_id,
        generated_documents!inner(title, document_type, created_at)
      `)
      .eq("signed_document_hash", document_hash.toLowerCase())
      .eq("status", "signed")
      .maybeSingle();

    if (error) {
      console.error("Verify query error:", error);
      return json({ error: "Internal error during verification" }, 500);
    }

    if (!sig) {
      // Log verification attempt
      await adminClient.from("document_signature_events").insert({
        organization_id: "00000000-0000-0000-0000-000000000000", // system-level
        event_type: "document.verified",
        event_data: {
          hash: document_hash.toLowerCase(),
          result: "not_found",
          timestamp: new Date().toISOString(),
        },
        actor_type: "system",
        actor_id: "public_verifier",
        actor_ip: req.headers.get("x-forwarded-for") || null,
        actor_user_agent: req.headers.get("user-agent") || null,
      }).then(() => {}).catch(() => {}); // best-effort logging

      return json({
        verified: false,
        message: "El documento no fue encontrado o ha sido modificado. El hash proporcionado no coincide con ningún documento firmado en ATENIA.",
      });
    }

    const doc = (sig as any).generated_documents;

    return json({
      verified: true,
      message: "✅ Documento verificado — integridad confirmada",
      document: {
        title: doc?.title || "Documento",
        document_type: doc?.document_type || "unknown",
        signed_at: sig.signed_at,
        signer_name: sig.signer_name,
        signature_method: sig.signature_method,
        created_at: doc?.created_at || null,
      },
      hash: document_hash.toLowerCase(),
      algorithm: "SHA-256",
      legal_notice: "Firma electrónica válida conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012 de la República de Colombia.",
    });
  } catch (err) {
    console.error("verify-document error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
