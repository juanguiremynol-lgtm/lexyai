import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PurgeRequest {
  confirm_text: string;
  purge_type?: "ALL" | "LEGACY_ONLY";
}

interface PurgeResult {
  ok: boolean;
  message: string;
  deleted_counts: {
    work_items: number;
    process_events: number;
    actuaciones: number;
    documents: number;
    tasks: number;
    alerts: number;
    hearings: number;
    storage_files: number;
  };
  errors: string[];
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
        JSON.stringify({ ok: false, message: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Get authenticated user
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ ok: false, message: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Parse and validate request
    const body: PurgeRequest = await req.json();
    if (body.confirm_text !== "PURGE MY ORG") {
      return new Response(
        JSON.stringify({ ok: false, message: "Confirmation text must be exactly 'PURGE MY ORG'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Get user's organization
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    const organizationId = profile?.organization_id;

    // 5. Check if user is owner/admin
    const { data: userRoles } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["owner", "admin"]);

    // For now, allow any authenticated user to purge their own data
    const isAdmin = userRoles && userRoles.length > 0;

    console.log(`[purge-org] User ${user.id} (org: ${organizationId}, admin: ${isAdmin}) initiated purge`);

    const result: PurgeResult = {
      ok: true,
      message: "",
      deleted_counts: {
        work_items: 0,
        process_events: 0,
        actuaciones: 0,
        documents: 0,
        tasks: 0,
        alerts: 0,
        hearings: 0,
        storage_files: 0,
      },
      errors: [],
    };

    // 6. Collect all IDs to delete from work_items table only
    const [
      workItemsRes,
    ] = await Promise.all([
      serviceClient.from("work_items").select("id").eq("owner_id", user.id),
    ]);

    const workItemIds = (workItemsRes.data || []).map(r => r.id);

    console.log(`[purge-org] Found ${workItemIds.length} work items to delete`);

    // 7. Delete all dependent data first (work_items is canonical, so FK order matters)
    
    // Delete work_item_acts
    if (workItemIds.length > 0) {
      await serviceClient.from("work_item_acts").delete().in("work_item_id", workItemIds);
    }

    // Delete work_item_deadlines
    if (workItemIds.length > 0) {
      await serviceClient.from("work_item_deadlines").delete().in("work_item_id", workItemIds);
    }

    // Delete process_events
    if (workItemIds.length > 0) {
      const res1 = await serviceClient.from("process_events").select("id").in("work_item_id", workItemIds);
      result.deleted_counts.process_events += (res1.data?.length || 0);
      await serviceClient.from("process_events").delete().in("work_item_id", workItemIds);
    }

    // Delete alert_instances and alert_rules
    if (workItemIds.length > 0) {
      await serviceClient.from("alert_instances").delete().in("entity_id", workItemIds);
      await serviceClient.from("alert_rules").delete().in("entity_id", workItemIds);
    }

    // Delete tasks
    if (workItemIds.length > 0) {
      const tasksRes = await serviceClient.from("tasks").select("id").in("filing_id", workItemIds);
      result.deleted_counts.tasks += (tasksRes.data?.length || 0);
      await serviceClient.from("tasks").delete().in("filing_id", workItemIds);
    }

    // Delete cgp_deadlines, cgp_term_instances, cgp_milestones, cgp_inactivity_tracker
    if (workItemIds.length > 0) {
      await serviceClient.from("cgp_deadlines").delete().in("work_item_id", workItemIds);
      await serviceClient.from("cgp_term_instances").delete().in("filing_id", workItemIds);
      await serviceClient.from("cgp_milestones").delete().in("filing_id", workItemIds);
      await serviceClient.from("cgp_inactivity_tracker").delete().in("filing_id", workItemIds);
    }

    // Delete desacato_incidents
    if (workItemIds.length > 0) {
      await serviceClient.from("desacato_incidents").delete().in("tutela_id", workItemIds);
      await serviceClient.from("desacato_incidents").delete().in("linked_work_item_id", workItemIds);
    }

    // Delete message_links
    if (workItemIds.length > 0) {
      await serviceClient.from("message_links").delete().in("filing_id", workItemIds);
    }

    // Delete documents and storage files
    if (workItemIds.length > 0) {
      const { data: docs } = await serviceClient
        .from("documents")
        .select("id, storage_path")
        .in("filing_id", workItemIds);

      if (docs && docs.length > 0) {
        for (const doc of docs) {
          if (doc.storage_path) {
            try {
              await serviceClient.storage.from("lexdocket").remove([doc.storage_path]);
              result.deleted_counts.storage_files++;
            } catch (e) {
              console.log(`[purge-org] Storage delete failed: ${doc.storage_path}`);
            }
          }
        }
        await serviceClient.from("documents").delete().in("filing_id", workItemIds);
        result.deleted_counts.documents = docs.length;
      }
    }

    // Delete evidence_snapshots
    if (workItemIds.length > 0) {
      const { data: snapshots } = await serviceClient
        .from("evidence_snapshots")
        .select("id, storage_path")
        .in("monitored_process_id", workItemIds);

      if (snapshots && snapshots.length > 0) {
        for (const snap of snapshots) {
          if (snap.storage_path) {
            try {
              await serviceClient.storage.from("lexdocket").remove([snap.storage_path]);
              result.deleted_counts.storage_files++;
            } catch (e) {
              console.log(`[purge-org] Storage delete failed: ${snap.storage_path}`);
            }
          }
        }
        await serviceClient.from("evidence_snapshots").delete().in("monitored_process_id", workItemIds);
      }
    }

    // Delete actuaciones
    if (workItemIds.length > 0) {
      const actRes1 = await serviceClient.from("actuaciones").select("id").in("filing_id", workItemIds);
      result.deleted_counts.actuaciones += (actRes1.data?.length || 0);
      await serviceClient.from("actuaciones").delete().in("filing_id", workItemIds);
    }
    if (workItemIds.length > 0) {
      const actRes2 = await serviceClient.from("actuaciones").select("id").in("monitored_process_id", workItemIds);
      result.deleted_counts.actuaciones += (actRes2.data?.length || 0);
      await serviceClient.from("actuaciones").delete().in("monitored_process_id", workItemIds);
    }

    // Delete alerts
    if (workItemIds.length > 0) {
      const alertsRes = await serviceClient.from("alerts").select("id").in("filing_id", workItemIds);
      result.deleted_counts.alerts += (alertsRes.data?.length || 0);
      await serviceClient.from("alerts").delete().in("filing_id", workItemIds);
    }

    // Delete hearings
    if (workItemIds.length > 0) {
      const hearingsRes = await serviceClient.from("hearings").select("id").in("filing_id", workItemIds);
      result.deleted_counts.hearings += (hearingsRes.data?.length || 0);
      await serviceClient.from("hearings").delete().in("filing_id", workItemIds);
    }
    if (workItemIds.length > 0) {
      await serviceClient.from("hearings").delete().in("process_id", workItemIds);
    }

    // Delete work_item_mappings
    if (workItemIds.length > 0) {
      await serviceClient.from("work_item_mappings").delete().in("work_item_id", workItemIds);
      await serviceClient.from("work_item_mappings").delete().in("legacy_filing_id", workItemIds);
      await serviceClient.from("work_item_mappings").delete().in("legacy_process_id", workItemIds);
    }

    // 8. Delete main entity (work_items only)
    
    if (workItemIds.length > 0) {
      const { error } = await serviceClient.from("work_items").delete().in("id", workItemIds);
      if (error) {
        result.errors.push(`work_items: ${error.message}`);
      } else {
        result.deleted_counts.work_items = workItemIds.length;
      }
    }

    // 9. Summary
    const totalDeleted = Object.values(result.deleted_counts).reduce((a, b) => a + b, 0);
    result.ok = result.errors.length === 0;
    result.message = `Purge complete. Deleted ${totalDeleted} records across all tables.`;

    console.log(`[purge-org] Complete:`, result.deleted_counts);

    return new Response(
      JSON.stringify(result),
      { 
        status: result.ok ? 200 : 207,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (err) {
    console.error("[purge-org] Unhandled error:", err);
    return new Response(
      JSON.stringify({ ok: false, message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
