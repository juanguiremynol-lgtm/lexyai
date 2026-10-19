/** Open a stored public-source document only after applying the publication's
 * normal user RLS. An object path supplied by the browser is not authority. */
import { createClient } from "npm:@supabase/supabase-js@2";
import { selectPublicationCopy } from "../_shared/publicationDocumentCopy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => null);
    if (typeof body?.publicacion_id !== "string" || !/^[a-f\d-]{36}$/i.test(body.publicacion_id) ||
        (body.storage_path != null && typeof body.storage_path !== "string")) {
      return json({ error: "invalid_document_request" }, 400);
    }
    // This RLS is the same owner / business administrator permission used by
    // the process screen. Organization membership alone does not grant access.
    const { data: pub, error: pubError } = await userClient.from("work_item_publicaciones")
      .select("id,work_item_id,organization_id,pdf_storage_path")
      .eq("id", body.publicacion_id).eq("is_archived", false).maybeSingle();
    if (pubError || !pub) return json({ error: "publicacion_not_found" }, 404);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: copies, error: copyError } = await admin.from("estado_attachment_queue")
      .select("publicacion_id,work_item_id,organization_id,status,storage_path,last_error,downloaded_at")
      .eq("publicacion_id", pub.id).eq("work_item_id", pub.work_item_id)
      .order("downloaded_at", { ascending: false, nullsFirst: false });
    if (copyError) return json({ error: "copy_lookup_failed" }, 503);
    const selected = selectPublicationCopy(pub, copies || [], body.storage_path ?? null);
    if (!selected.path) return json({ error: selected.error, pending: true }, selected.error === "document_not_associated" ? 403 : 409);
    const { data: signed, error: signError } = await admin.storage.from("estado-attachments")
      .createSignedUrl(selected.path, 600);
    if (signError || !signed?.signedUrl) return json({ error: "stored_copy_unavailable", pending: true }, 409);
    return json({ ok: true, url: signed.signedUrl, source: "storage" });
  } catch (error) {
    console.error("[get-estado-attachment-url]", error instanceof Error ? error.name : "unknown");
    return json({ error: "document_open_failed" }, 500);
  }
});
