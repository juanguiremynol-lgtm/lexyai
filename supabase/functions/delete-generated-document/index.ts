/**
 * delete-generated-document — Deletes a generated document, revokes active signatures,
 * and cleans up related records. Uses service_role for proper access.
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

    const { document_id } = await req.json();
    if (!document_id) return json({ error: "document_id is required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    // Verify document exists and user owns it
    const { data: doc, error: docErr } = await admin
      .from("generated_documents")
      .select("id, organization_id, created_by, status")
      .eq("id", document_id)
      .single();

    if (docErr || !doc) return json({ error: "Document not found" }, 404);
    if (doc.created_by !== user.id) return json({ error: "Not authorized to delete this document" }, 403);

    // Revoke all active signatures
    const { data: activeSigs } = await admin
      .from("document_signatures")
      .select("id, status")
      .eq("document_id", document_id)
      .in("status", ["pending", "waiting", "viewed", "otp_verified"]);

    if (activeSigs && activeSigs.length > 0) {
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
          event_data: { reason: "Document deleted by creator" },
          actor_type: "lawyer",
          actor_id: user.id,
        });
      }
    }

    // Log deletion audit event
    await admin.from("document_signature_events").insert({
      organization_id: doc.organization_id,
      document_id,
      event_type: "document.deleted" as any,
      event_data: { previous_status: doc.status, deleted_by: user.id },
      actor_type: "lawyer",
      actor_id: user.id,
    });

    // Delete signatures
    await admin.from("document_signatures").delete().eq("document_id", document_id);

    // Delete the document
    const { error: delErr } = await admin
      .from("generated_documents")
      .delete()
      .eq("id", document_id);

    if (delErr) return json({ error: "Failed to delete: " + delErr.message }, 500);

    return json({ ok: true, revoked_signatures: activeSigs?.length || 0 });
  } catch (err) {
    console.error("delete-generated-document error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
