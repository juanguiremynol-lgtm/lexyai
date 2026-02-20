/**
 * verify-document — Public endpoint for verifying document integrity via SHA-256 hash.
 * Phase 3: Accepts both signed_document_hash and combined_pdf_hash for verification.
 * Rate limited. No authentication required.
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

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || req.headers.get("cf-connecting-ip")
    || "unknown";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { document_hash } = body;

    if (!document_hash || typeof document_hash !== "string") {
      return json({ error: "Se requiere el hash del documento." }, 400);
    }

    if (!/^[a-fA-F0-9]{64}$/.test(document_hash)) {
      return json({ error: "Formato de hash inválido. Se esperan 64 caracteres hexadecimales (SHA-256)." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);
    const clientIp = getClientIp(req);

    // Rate limiting: 30 req/min per IP
    const oneMinAgo = new Date(Date.now() - 60000).toISOString();
    const { count } = await adminClient
      .from("rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("key", clientIp)
      .eq("endpoint", "verify-document")
      .gte("window_start", oneMinAgo);

    if ((count || 0) >= 30) {
      return json({ error: "Demasiadas solicitudes. Intente nuevamente en unos minutos." }, 429);
    }

    await adminClient.from("rate_limits").insert({
      key: clientIp,
      endpoint: "verify-document",
      window_start: new Date().toISOString(),
    });

    const hashLower = document_hash.toLowerCase();

    // Try signed_document_hash first, then combined_pdf_hash
    let sig = null;
    const { data: sig1 } = await adminClient
      .from("document_signatures")
      .select(`
        id, signed_at, signer_name, signature_method, document_id,
        generated_documents!inner(title, document_type, created_at)
      `)
      .eq("signed_document_hash", hashLower)
      .eq("status", "signed")
      .maybeSingle();

    if (sig1) {
      sig = sig1;
    } else {
      const { data: sig2 } = await adminClient
        .from("document_signatures")
        .select(`
          id, signed_at, signer_name, signature_method, document_id,
          generated_documents!inner(title, document_type, created_at)
        `)
        .eq("combined_pdf_hash", hashLower)
        .eq("status", "signed")
        .maybeSingle();
      sig = sig2;
    }

    if (!sig) {
      return json({
        verified: false,
        message: "El documento no fue encontrado o ha sido modificado. El hash proporcionado no coincide con ningún documento firmado.",
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
      hash: hashLower,
      algorithm: "SHA-256",
      legal_notice: "Firma electrónica válida conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012 de la República de Colombia.",
    });
  } catch (err) {
    console.error("verify-document error:", err);
    return json({ error: "Error interno. Intente nuevamente." }, 500);
  }
});
