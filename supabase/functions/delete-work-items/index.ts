import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DeleteRequest {
  work_item_ids: string[];
  mode?: "HARD_DELETE";
}

interface DeleteResult {
  ok: boolean;
  deleted_count: number;
  deleted_ids: string[];
  errors: Array<{ id: string; error: string }>;
  storage_files_deleted: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Validate authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, code: "UNAUTHORIZED", message: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create authenticated Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // User client to get the authenticated user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service role client for deletions (bypasses RLS)
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Get authenticated user
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ ok: false, code: "UNAUTHORIZED", message: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Get user's organization from profile
    const { data: profile, error: profileError } = await serviceClient
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.organization_id) {
      console.log("Profile fetch error:", profileError);
      // Allow deletion if no org is set (backwards compat)
    }

    const organizationId = profile?.organization_id;

    // 4. Check if user has admin/owner role
    const { data: userRoles } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["owner", "admin"]);

    // For now, allow any authenticated user to delete their own items
    // In future, restrict to owner/admin roles
    const isAdmin = userRoles && userRoles.length > 0;

    // 5. Parse request body
    const body: DeleteRequest = await req.json();
    const { work_item_ids } = body;

    if (!work_item_ids || !Array.isArray(work_item_ids) || work_item_ids.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, code: "INVALID_REQUEST", message: "work_item_ids array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[delete-work-items] User ${user.id} requesting deletion of ${work_item_ids.length} items`);

    const result: DeleteResult = {
      ok: true,
      deleted_count: 0,
      deleted_ids: [],
      errors: [],
      storage_files_deleted: 0,
    };

    // 6. Process each work item
    for (const workItemId of work_item_ids) {
      try {
        // Verify ownership - work_items is canonical
        let ownerVerified = false;
        let ownerId = "";

        // Check work_items table only (canonical source)
        const { data: workItem } = await serviceClient
          .from("work_items")
          .select("id, owner_id, organization_id")
          .eq("id", workItemId)
          .maybeSingle();

        if (workItem) {
          ownerId = workItem.owner_id;
          ownerVerified = workItem.owner_id === user.id || 
            (organizationId && workItem.organization_id === organizationId);
        }

        if (!ownerVerified) {
          result.errors.push({ id: workItemId, error: "Item not found or access denied" });
          continue;
        }

        // 7. Delete dependent entities in correct FK order
        // Start with the most dependent tables first

        // Delete work_item_acts (if exists)
        await serviceClient.from("work_item_acts").delete().eq("work_item_id", workItemId);

        // Delete work_item_deadlines (if exists)
        await serviceClient.from("work_item_deadlines").delete().eq("work_item_id", workItemId);

        // Delete process_events linked to this item
        await serviceClient.from("process_events").delete().eq("work_item_id", workItemId);

        // Delete alert_instances linked to this item
        await serviceClient.from("alert_instances").delete().eq("entity_id", workItemId);

        // Delete alert_rules linked to this item
        await serviceClient.from("alert_rules").delete().eq("entity_id", workItemId);

        // Delete tasks linked to this item (legacy support for filing_id)
        await serviceClient.from("tasks").delete().eq("filing_id", workItemId);

        // Delete cgp_deadlines
        await serviceClient.from("cgp_deadlines").delete().eq("work_item_id", workItemId);

        // Delete cgp_term_instances
        await serviceClient.from("cgp_term_instances").delete().eq("filing_id", workItemId);
        await serviceClient.from("cgp_term_instances").delete().eq("process_id", workItemId);

        // Delete cgp_milestones
        await serviceClient.from("cgp_milestones").delete().eq("filing_id", workItemId);
        await serviceClient.from("cgp_milestones").delete().eq("process_id", workItemId);

        // Delete cgp_inactivity_tracker
        await serviceClient.from("cgp_inactivity_tracker").delete().eq("filing_id", workItemId);
        await serviceClient.from("cgp_inactivity_tracker").delete().eq("process_id", workItemId);

        // Delete desacato_incidents
        await serviceClient.from("desacato_incidents").delete().eq("tutela_id", workItemId);
        await serviceClient.from("desacato_incidents").delete().eq("linked_work_item_id", workItemId);

        // Delete peticion_alerts
        await serviceClient.from("peticion_alerts").delete().eq("peticion_id", workItemId);

        // Delete message_links
        await serviceClient.from("message_links").delete().eq("filing_id", workItemId);

        // Get documents to delete from storage
        const { data: documents } = await serviceClient
          .from("documents")
          .select("id, storage_path, file_url")
          .eq("filing_id", workItemId);

        if (documents && documents.length > 0) {
          // Delete files from storage
          for (const doc of documents) {
            if (doc.storage_path) {
              try {
                await serviceClient.storage.from("lexdocket").remove([doc.storage_path]);
                result.storage_files_deleted++;
              } catch (storageErr) {
                console.log(`[delete-work-items] Storage delete failed for ${doc.storage_path}:`, storageErr);
              }
            }
          }
          // Delete document records
          await serviceClient.from("documents").delete().eq("filing_id", workItemId);
        }

        // Delete evidence_snapshots
        const { data: snapshots } = await serviceClient
          .from("evidence_snapshots")
          .select("id, storage_path")
          .eq("monitored_process_id", workItemId);

        if (snapshots && snapshots.length > 0) {
          for (const snap of snapshots) {
            if (snap.storage_path) {
              try {
                await serviceClient.storage.from("lexdocket").remove([snap.storage_path]);
                result.storage_files_deleted++;
              } catch (storageErr) {
                console.log(`[delete-work-items] Storage delete failed for ${snap.storage_path}:`, storageErr);
              }
            }
          }
          await serviceClient.from("evidence_snapshots").delete().eq("monitored_process_id", workItemId);
        }

        // Delete actuaciones
        await serviceClient.from("actuaciones").delete().eq("filing_id", workItemId);
        await serviceClient.from("actuaciones").delete().eq("monitored_process_id", workItemId);

        // Delete alerts (legacy)
        await serviceClient.from("alerts").delete().eq("filing_id", workItemId);

        // Delete hearings
        await serviceClient.from("hearings").delete().eq("filing_id", workItemId);
        await serviceClient.from("hearings").delete().eq("process_id", workItemId);

        // Delete work_item_mappings
        await serviceClient.from("work_item_mappings").delete().eq("work_item_id", workItemId);
        await serviceClient.from("work_item_mappings").delete().eq("legacy_filing_id", workItemId);
        await serviceClient.from("work_item_mappings").delete().eq("legacy_process_id", workItemId);

        // 8. Delete the main entity (always work_items now)
        const { error: deleteError } = await serviceClient.from("work_items").delete().eq("id", workItemId);

        if (deleteError) {
          console.error(`[delete-work-items] Delete error for ${workItemId}:`, deleteError);
          result.errors.push({ id: workItemId, error: deleteError.message });
        } else {
          result.deleted_count++;
          result.deleted_ids.push(workItemId);
          console.log(`[delete-work-items] Successfully deleted ${workItemId}`);

          // Log hard delete to audit_logs
          if (organizationId) {
            await serviceClient.from("audit_logs").insert({
              organization_id: organizationId,
              actor_user_id: user.id,
              actor_type: "USER",
              action: "WORK_ITEM_HARD_DELETED",
              entity_type: "work_item",
              entity_id: workItemId,
              metadata: {
                deleted_at: new Date().toISOString(),
                storage_files_deleted: result.storage_files_deleted,
              },
            });
          }
        }
      } catch (itemErr) {
        console.error(`[delete-work-items] Error processing ${workItemId}:`, itemErr);
        result.errors.push({ id: workItemId, error: String(itemErr) });
      }
    }

    result.ok = result.errors.length === 0;

    console.log(`[delete-work-items] Complete: ${result.deleted_count} deleted, ${result.errors.length} errors`);

    return new Response(
      JSON.stringify(result),
      { 
        status: result.ok ? 200 : 207, // 207 = Multi-Status for partial success
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (err) {
    console.error("[delete-work-items] Unhandled error:", err);
    return new Response(
      JSON.stringify({ ok: false, code: "INTERNAL_ERROR", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
