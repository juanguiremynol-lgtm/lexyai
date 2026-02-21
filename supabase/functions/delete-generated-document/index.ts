/**
 * delete-generated-document — Deletes a generated document with nuanced policy:
 *
 * DELETABLE (always):
 *   - Notificaciones (personal/aviso), Paz y Salvo → unilateral, lawyer-only
 *   - Any document NOT yet fully signed by the counterparty
 *
 * NOT DELETABLE:
 *   - Documents where ALL signers have completed signing (status = "signed")
 *
 * On deletion of pending-signature documents:
 *   - Active signatures are revoked
 *   - Revocation audit events are logged
 *   - All related signature_events and signatures are cleaned up
 *   - The document record is removed
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
      .select("id, organization_id, created_by, status, document_type")
      .eq("id", document_id)
      .single();

    if (docErr || !doc) return json({ error: "Document not found" }, 404);
    if (doc.created_by !== user.id) return json({ error: "No tiene permiso para eliminar este documento" }, 403);

    // ── Deletion policy ──
    // If the document is fully signed, block deletion
    if (doc.status === "signed") {
      // Check if it's an always-deletable type (unilateral docs)
      if (!ALWAYS_DELETABLE_TYPES.includes(doc.document_type)) {
        return json({
          error: "Este documento ya fue firmado por todas las partes y no puede eliminarse. Los documentos firmados son inmutables por integridad legal.",
          code: "DOCUMENT_SIGNED",
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

    // Revoke active signatures and log events
    for (const sig of activeSigs) {
      await admin
        .from("document_signatures")
        .update({ status: "revoked" })
        .eq("id", sig.id);

      await admin.from("document_signature_events").insert({
        organization_id: doc.organization_id,
        document_id,
        signature_id: sig.id,
        event_type: "signature.revoked",
        event_data: { reason: "Documento eliminado por el abogado creador", signer_email: sig.signer_email },
        actor_type: "lawyer",
        actor_id: user.id,
      });
    }

    // Log deletion audit event
    await admin.from("document_signature_events").insert({
      organization_id: doc.organization_id,
      document_id,
      event_type: "document.deleted" as any,
      event_data: {
        previous_status: doc.status,
        document_type: doc.document_type,
        deleted_by: user.id,
        revoked_signatures: activeSigs.length,
      },
      actor_type: "lawyer",
      actor_id: user.id,
    });

    // ── Cascade delete in correct FK order ──
    // 1. Delete signature events (FK → document_signatures & generated_documents)
    await admin.from("document_signature_events").delete().eq("document_id", document_id);

    // 2. Delete signatures (FK → generated_documents)
    await admin.from("document_signatures").delete().eq("document_id", document_id);

    // 3. Delete the document itself
    const { error: delErr } = await admin
      .from("generated_documents")
      .delete()
      .eq("id", document_id);

    if (delErr) {
      console.error("[delete-doc] Final delete failed:", delErr.message);
      return json({ error: "Error al eliminar: " + delErr.message }, 500);
    }

    return json({
      ok: true,
      revoked_signatures: activeSigs.length,
      signers_to_notify: activeSigs.map((s) => ({ email: s.signer_email, name: s.signer_name })),
    });
  } catch (err) {
    console.error("[delete-doc] Unhandled error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
