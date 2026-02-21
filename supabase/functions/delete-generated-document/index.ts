/**
 * delete-generated-document — Soft-deletes a generated document.
 *
 * STRATEGY: Soft-delete (NOT hard delete) because document_signature_events
 * is append-only with immutability triggers (ENABLE ALWAYS). Hard-deleting
 * signatures is impossible when events reference them via FK.
 *
 * On "deletion":
 *   1. Validates deletion policy (blocks fully-signed bilateral docs)
 *   2. Revokes active signatures (status → "revoked")
 *   3. Logs a "document.soft_deleted" audit event
 *   4. Sets generated_documents.deleted_at + status = "deleted"
 *   5. Returns success with count of revoked signatures
 *
 * DELETABLE (always): Notificaciones, Paz y Salvo (unilateral, lawyer-only)
 * DELETABLE if unsigned: Poderes, Contratos where counterparty hasn't signed
 * BLOCKED: Fully signed bilateral documents (status = "signed" / "signed_finalized")
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

// Document types that are always deletable (unilateral, lawyer-only docs)
const ALWAYS_DELETABLE_TYPES = [
  "notificacion_personal",
  "notificacion_por_aviso",
  "paz_y_salvo",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Authenticate user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const document_id = body?.document_id;
    if (!document_id) return json({ error: "document_id is required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    // Fetch document
    const { data: doc, error: docErr } = await admin
      .from("generated_documents")
      .select("id, organization_id, created_by, status, document_type, deleted_at, finalized_at")
      .eq("id", document_id)
      .single();

    if (docErr || !doc) return json({ error: "Document not found" }, 404);
    if (doc.created_by !== user.id) return json({ error: "No tiene permiso para eliminar este documento" }, 403);
    if (doc.deleted_at) return json({ error: "Este documento ya fue eliminado" }, 409);

    // ── Deletion policy ──
    const isAlwaysDeletable = ALWAYS_DELETABLE_TYPES.includes(doc.document_type);

    if (!isAlwaysDeletable) {
      // Block deletion of fully signed/executed bilateral documents
      if (["signed", "signed_finalized"].includes(doc.status)) {
        return json({
          error: "Este documento ya fue firmado por todas las partes y no puede eliminarse. Los documentos firmados son inmutables por integridad legal.",
          code: "DOCUMENT_SIGNED",
        }, 409);
      }

      // Block if finalized_at is set (fully executed)
      if (doc.finalized_at) {
        return json({
          error: "Este documento fue ejecutado y está protegido por la política de retención legal (10 años).",
          code: "DOCUMENT_EXECUTED",
        }, 409);
      }
    }

    // Fetch all signatures for this document
    const { data: allSigs } = await admin
      .from("document_signatures")
      .select("id, status, signer_email, signer_name, signer_role")
      .eq("document_id", document_id);

    const activeSigs = (allSigs || []).filter((s) =>
      ["pending", "waiting", "viewed", "otp_verified"].includes(s.status)
    );

    // Revoke active signatures (update status, don't delete)
    for (const sig of activeSigs) {
      await admin
        .from("document_signatures")
        .update({ status: "revoked" })
        .eq("id", sig.id);
    }

    // Log a soft-delete audit event (append-only, never deleted)
    await admin.from("document_signature_events").insert({
      organization_id: doc.organization_id,
      document_id,
      event_type: "document.soft_deleted" as any,
      event_data: {
        previous_status: doc.status,
        document_type: doc.document_type,
        deleted_by: user.id,
        revoked_signatures: activeSigs.length,
        revoked_signers: activeSigs.map((s) => ({
          email: s.signer_email,
          name: s.signer_name,
          role: s.signer_role,
        })),
      },
      actor_type: "lawyer",
      actor_id: user.id,
    });

    // Soft-delete: set deleted_at and status
    const { error: updateErr } = await admin
      .from("generated_documents")
      .update({
        deleted_at: new Date().toISOString(),
        status: "deleted",
      })
      .eq("id", document_id);

    if (updateErr) {
      console.error("[delete-doc] Soft-delete update failed:", updateErr.message);
      return json({ error: "Error al archivar el documento: " + updateErr.message }, 500);
    }

    return json({
      ok: true,
      soft_deleted: true,
      revoked_signatures: activeSigs.length,
      signers_to_notify: activeSigs.map((s) => ({ email: s.signer_email, name: s.signer_name })),
    });
  } catch (err) {
    console.error("[delete-doc] Unhandled error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
