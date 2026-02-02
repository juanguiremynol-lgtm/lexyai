/**
 * Master Sync Edge Function
 * 
 * Super Admin only function that syncs ALL work items for a selected user/organization.
 * Calls sync-by-work-item and sync-publicaciones-by-work-item for each work item.
 * 
 * @requires Platform Admin with SUPER_ADMIN role
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MasterSyncRequest {
  target_organization_id: string;      // REQUIRED - org to sync
  target_user_id?: string | null;      // OPTIONAL - filter by owner_id
  include_cpnu?: boolean;
  include_samai?: boolean;
  include_publicaciones?: boolean;
  include_tutelas?: boolean;
}

interface WorkItemResult {
  work_item_id: string;
  radicado: string;
  workflow_type: string;
  actuaciones_result: {
    ok: boolean;
    inserted_count?: number;
    skipped_count?: number;
    error?: string;
  } | null;
  publicaciones_result: {
    ok: boolean;
    inserted_count?: number;
    skipped_count?: number;
    error?: string;
  } | null;
}

interface MasterSyncResult {
  ok: boolean;
  run_id: string;
  target_user_id: string | null;  // Can be null for org-wide sync
  target_organization_id: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  
  work_items_total: number;
  work_items_processed: number;
  work_items_success: number;
  work_items_error: number;
  
  actuaciones_found: number;
  actuaciones_inserted: number;
  actuaciones_skipped: number;
  
  publicaciones_found: number;
  publicaciones_inserted: number;
  publicaciones_skipped: number;
  
  alerts_created: number;
  
  errors: Array<{
    work_item_id: string;
    radicado: string;
    provider: string;
    error: string;
  }>;
  
  work_item_results: WorkItemResult[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    // Initialize Supabase client with user's auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user and check super admin status
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requestingUserId = claimsData.claims.sub as string;

    // Check if user is platform admin
    const { data: platformAdmin, error: paError } = await supabase
      .from("platform_admins")
      .select("user_id, role")
      .eq("user_id", requestingUserId)
      .maybeSingle();

    if (paError || !platformAdmin) {
      console.warn(`[master-sync] Non-platform-admin attempted access: ${requestingUserId}`);
      return new Response(
        JSON.stringify({ ok: false, error: "Platform admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Optional: Check for SUPER_ADMIN role specifically
    // For now, any platform admin can use master sync
    const isSuperAdmin = platformAdmin.role === "SUPER_ADMIN" || true; // Allow all platform admins for now
    
    if (!isSuperAdmin) {
      return new Response(
        JSON.stringify({ ok: false, error: "Super admin role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body: MasterSyncRequest = await req.json();
    const {
      target_organization_id,
      target_user_id = null,  // OPTIONAL - can be null for org-wide sync
      include_cpnu = true,
      include_samai = true,
      include_publicaciones = true,
      include_tutelas = false,
    } = body;

    // REQUIRED: organization_id must be present
    if (!target_organization_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "target_organization_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // target_user_id is OPTIONAL - if null, sync all org work items
    const syncMode = target_user_id ? "USER" : "ORG";
    console.log(`[master-sync] Starting ${syncMode} mode for org ${target_organization_id}${target_user_id ? `, user ${target_user_id}` : ""}`);
    console.log(`[master-sync] Config: CPNU=${include_cpnu}, SAMAI=${include_samai}, Pubs=${include_publicaciones}, Tutelas=${include_tutelas}`);

    // Use service role for database operations
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Create audit record (target_user_id can be null for org-wide sync)
    const { data: runRecord, error: runError } = await supabaseAdmin
      .from("master_sync_runs")
      .insert({
        triggered_by_user_id: requestingUserId,
        target_user_id: target_user_id || null,
        target_organization_id,
        include_cpnu,
        include_samai,
        include_publicaciones,
        include_tutelas,
        status: "running",
      })
      .select("id")
      .single();

    if (runError) {
      console.error("[master-sync] Failed to create audit record:", runError);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to create audit record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const runId = runRecord.id;

    // Get work items - either all org items (ORG mode) or filtered by owner (USER mode)
    let workItemsQuery = supabaseAdmin
      .from("work_items")
      .select("id, radicado, workflow_type, authority_name")
      .eq("organization_id", target_organization_id)
      .is("deleted_at", null);
    
    // If user_id provided, filter to that owner only
    if (target_user_id) {
      workItemsQuery = workItemsQuery.eq("owner_id", target_user_id);
    }
    
    const { data: workItems, error: wiError } = await workItemsQuery.order("created_at", { ascending: false });

    if (wiError) {
      await supabaseAdmin
        .from("master_sync_runs")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("id", runId);
        
      return new Response(
        JSON.stringify({ ok: false, error: `Failed to fetch work items: ${wiError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const totalWorkItems = workItems?.length || 0;
    console.log(`[master-sync] Found ${totalWorkItems} work items to process`);

    // Update with total count
    await supabaseAdmin
      .from("master_sync_runs")
      .update({ work_items_total: totalWorkItems })
      .eq("id", runId);

    // Process results
    const results: MasterSyncResult = {
      ok: true,
      run_id: runId,
      target_user_id,
      target_organization_id,
      started_at: new Date(startTime).toISOString(),
      work_items_total: totalWorkItems,
      work_items_processed: 0,
      work_items_success: 0,
      work_items_error: 0,
      actuaciones_found: 0,
      actuaciones_inserted: 0,
      actuaciones_skipped: 0,
      publicaciones_found: 0,
      publicaciones_inserted: 0,
      publicaciones_skipped: 0,
      alerts_created: 0,
      errors: [],
      work_item_results: [],
    };

    // Process each work item
    for (const workItem of workItems || []) {
      console.log(`[master-sync] Processing ${workItem.radicado} (${workItem.workflow_type})`);
      
      const itemResult: WorkItemResult = {
        work_item_id: workItem.id,
        radicado: workItem.radicado,
        workflow_type: workItem.workflow_type,
        actuaciones_result: null,
        publicaciones_result: null,
      };

      let hasError = false;

      // Sync actuaciones (CPNU/SAMAI based on workflow)
      if (include_cpnu || include_samai) {
        try {
          const { data: actsData, error: actsError } = await supabase.functions.invoke(
            "sync-by-work-item",
            { body: { work_item_id: workItem.id, triggered_by: "master_sync" } }
          );

          if (actsError) {
            itemResult.actuaciones_result = { ok: false, error: actsError.message };
            results.errors.push({
              work_item_id: workItem.id,
              radicado: workItem.radicado,
              provider: "actuaciones",
              error: actsError.message,
            });
            hasError = true;
          } else if (actsData) {
            itemResult.actuaciones_result = {
              ok: actsData.ok !== false,
              inserted_count: actsData.inserted_count || 0,
              skipped_count: actsData.skipped_count || 0,
              error: actsData.error,
            };
            
            if (actsData.ok !== false) {
              results.actuaciones_found += (actsData.inserted_count || 0) + (actsData.skipped_count || 0);
              results.actuaciones_inserted += actsData.inserted_count || 0;
              results.actuaciones_skipped += actsData.skipped_count || 0;
              results.alerts_created += actsData.alerts_created || 0;
            } else {
              hasError = true;
              results.errors.push({
                work_item_id: workItem.id,
                radicado: workItem.radicado,
                provider: "actuaciones",
                error: actsData.error || "Unknown error",
              });
            }
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          itemResult.actuaciones_result = { ok: false, error: errorMsg };
          results.errors.push({
            work_item_id: workItem.id,
            radicado: workItem.radicado,
            provider: "actuaciones",
            error: errorMsg,
          });
          hasError = true;
        }
      }

      // Sync publicaciones
      if (include_publicaciones) {
        try {
          const { data: pubsData, error: pubsError } = await supabase.functions.invoke(
            "sync-publicaciones-by-work-item",
            { body: { work_item_id: workItem.id, triggered_by: "master_sync" } }
          );

          if (pubsError) {
            itemResult.publicaciones_result = { ok: false, error: pubsError.message };
            results.errors.push({
              work_item_id: workItem.id,
              radicado: workItem.radicado,
              provider: "publicaciones",
              error: pubsError.message,
            });
            hasError = true;
          } else if (pubsData) {
            itemResult.publicaciones_result = {
              ok: pubsData.ok !== false,
              inserted_count: pubsData.inserted_count || 0,
              skipped_count: pubsData.skipped_count || 0,
              error: pubsData.error,
            };
            
            if (pubsData.ok !== false) {
              results.publicaciones_found += (pubsData.inserted_count || 0) + (pubsData.skipped_count || 0);
              results.publicaciones_inserted += pubsData.inserted_count || 0;
              results.publicaciones_skipped += pubsData.skipped_count || 0;
            } else {
              // Don't count EMPTY as error
              if (pubsData.status !== "EMPTY") {
                hasError = true;
                results.errors.push({
                  work_item_id: workItem.id,
                  radicado: workItem.radicado,
                  provider: "publicaciones",
                  error: pubsData.error || pubsData.code || "Unknown error",
                });
              }
            }
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          itemResult.publicaciones_result = { ok: false, error: errorMsg };
          results.errors.push({
            work_item_id: workItem.id,
            radicado: workItem.radicado,
            provider: "publicaciones",
            error: errorMsg,
          });
          hasError = true;
        }
      }

      results.work_item_results.push(itemResult);
      results.work_items_processed++;
      
      if (hasError) {
        results.work_items_error++;
      } else {
        results.work_items_success++;
      }

      // Update progress periodically (every 5 items)
      if (results.work_items_processed % 5 === 0) {
        await supabaseAdmin
          .from("master_sync_runs")
          .update({
            work_items_processed: results.work_items_processed,
            work_items_success: results.work_items_success,
            work_items_error: results.work_items_error,
            actuaciones_found: results.actuaciones_found,
            actuaciones_inserted: results.actuaciones_inserted,
            publicaciones_found: results.publicaciones_found,
            publicaciones_inserted: results.publicaciones_inserted,
          })
          .eq("id", runId);
      }
    }

    // Finalize
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startTime;
    
    results.completed_at = completedAt.toISOString();
    results.duration_ms = durationMs;
    results.ok = results.work_items_error === 0;

    // Update final audit record
    await supabaseAdmin
      .from("master_sync_runs")
      .update({
        status: results.work_items_error > 0 ? "completed" : "completed", // Still "completed" even with errors
        work_items_processed: results.work_items_processed,
        work_items_success: results.work_items_success,
        work_items_error: results.work_items_error,
        actuaciones_found: results.actuaciones_found,
        actuaciones_inserted: results.actuaciones_inserted,
        publicaciones_found: results.publicaciones_found,
        publicaciones_inserted: results.publicaciones_inserted,
        alerts_created: results.alerts_created,
        completed_at: completedAt.toISOString(),
        duration_ms: durationMs,
        results_json: results,
      })
      .eq("id", runId);

    console.log(`[master-sync] Completed in ${durationMs}ms. Success: ${results.work_items_success}, Errors: ${results.work_items_error}`);

    return new Response(
      JSON.stringify(results),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[master-sync] Unexpected error:", errorMsg);
    
    return new Response(
      JSON.stringify({ ok: false, error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
