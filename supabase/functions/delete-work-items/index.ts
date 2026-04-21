import { createClient } from "npm:@supabase/supabase-js@2";

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

// ─── Authorization helper ───────────────────────────────────
// Replicates is_business_org_admin() for edge-function context
// where service_role bypasses RLS.
interface AuthContext {
  userId: string;
  organizationId: string | null;
  membershipRole: string | null; // OWNER | ADMIN | MEMBER
  isBusinessTier: boolean;
}

async function resolveAuthContext(
  serviceClient: ReturnType<typeof createClient>,
  userId: string
): Promise<AuthContext> {
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("organization_id")
    .eq("id", userId)
    .maybeSingle();

  const orgId = profile?.organization_id ?? null;

  let membershipRole: string | null = null;
  let isBusinessTier = false;

  if (orgId) {
    const { data: membership } = await serviceClient
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();

    membershipRole = membership?.role ?? null;

    const { data: billing } = await serviceClient
      .from("billing_subscription_state")
      .select("plan_code")
      .eq("organization_id", orgId)
      .maybeSingle();

    const plan = billing?.plan_code ?? "";
    isBusinessTier = ["BUSINESS", "ENTERPRISE"].includes(plan);
  }

  return { userId, organizationId: orgId, membershipRole, isBusinessTier };
}

function canDeleteWorkItem(
  auth: AuthContext,
  workItem: { owner_id: string; organization_id: string | null }
): boolean {
  // Rule 1: Owner can always delete their own items
  if (workItem.owner_id === auth.userId) return true;

  // Rule 2: BUSINESS-tier org admin (ADMIN/OWNER role) can delete any item in their org
  if (
    auth.isBusinessTier &&
    auth.organizationId &&
    workItem.organization_id === auth.organizationId &&
    (auth.membershipRole === "OWNER" || auth.membershipRole === "ADMIN")
  ) {
    return true;
  }

  // Rule 3: Super admin via support_access_grants — not implemented here;
  // super admins must use the existing support-grant flow, not this endpoint.

  return false;
}

// ─── Dependent-entity deletion ──────────────────────────────
async function deleteWorkItemDependents(
  serviceClient: ReturnType<typeof createClient>,
  workItemId: string
): Promise<{ storageFilesDeleted: number }> {
  let storageFilesDeleted = 0;

  // Delete in FK-safe order (most dependent first)
  await serviceClient.from("work_item_acts").delete().eq("work_item_id", workItemId);
  await serviceClient.from("work_item_deadlines").delete().eq("work_item_id", workItemId);
  await serviceClient.from("process_events").delete().eq("work_item_id", workItemId);
  await serviceClient.from("alert_instances").delete().eq("entity_id", workItemId);
  await serviceClient.from("alert_rules").delete().eq("entity_id", workItemId);
  await serviceClient.from("tasks").delete().eq("filing_id", workItemId);
  await serviceClient.from("cgp_deadlines").delete().eq("work_item_id", workItemId);
  await serviceClient.from("cgp_term_instances").delete().eq("filing_id", workItemId);
  await serviceClient.from("cgp_term_instances").delete().eq("process_id", workItemId);
  await serviceClient.from("cgp_milestones").delete().eq("filing_id", workItemId);
  await serviceClient.from("cgp_milestones").delete().eq("process_id", workItemId);
  await serviceClient.from("cgp_inactivity_tracker").delete().eq("filing_id", workItemId);
  await serviceClient.from("cgp_inactivity_tracker").delete().eq("process_id", workItemId);
  await serviceClient.from("desacato_incidents").delete().eq("tutela_id", workItemId);
  await serviceClient.from("desacato_incidents").delete().eq("linked_work_item_id", workItemId);
  await serviceClient.from("peticion_alerts").delete().eq("peticion_id", workItemId);
  await serviceClient.from("message_links").delete().eq("filing_id", workItemId);

  // Documents + storage
  const { data: documents } = await serviceClient
    .from("documents")
    .select("id, storage_path")
    .eq("filing_id", workItemId);

  if (documents && documents.length > 0) {
    for (const doc of documents) {
      if (doc.storage_path) {
        try {
          await serviceClient.storage.from("lexdocket").remove([doc.storage_path]);
          storageFilesDeleted++;
        } catch (e) {
          console.log(`[delete-work-items] Storage delete failed for ${doc.storage_path}:`, e);
        }
      }
    }
    await serviceClient.from("documents").delete().eq("filing_id", workItemId);
  }

  // Evidence snapshots + storage
  const { data: snapshots } = await serviceClient
    .from("evidence_snapshots")
    .select("id, storage_path")
    .eq("monitored_process_id", workItemId);

  if (snapshots && snapshots.length > 0) {
    for (const snap of snapshots) {
      if (snap.storage_path) {
        try {
          await serviceClient.storage.from("lexdocket").remove([snap.storage_path]);
          storageFilesDeleted++;
        } catch (e) {
          console.log(`[delete-work-items] Storage delete failed for ${snap.storage_path}:`, e);
        }
      }
    }
    await serviceClient.from("evidence_snapshots").delete().eq("monitored_process_id", workItemId);
  }

  // Remaining dependents
  await serviceClient.from("actuaciones").delete().eq("filing_id", workItemId);
  await serviceClient.from("actuaciones").delete().eq("monitored_process_id", workItemId);
  await serviceClient.from("alerts").delete().eq("filing_id", workItemId);
  await serviceClient.from("hearings").delete().eq("filing_id", workItemId);
  await serviceClient.from("hearings").delete().eq("process_id", workItemId);
  await serviceClient.from("work_item_mappings").delete().eq("work_item_id", workItemId);
  await serviceClient.from("work_item_mappings").delete().eq("legacy_filing_id", workItemId);
  await serviceClient.from("work_item_mappings").delete().eq("legacy_process_id", workItemId);

  return { storageFilesDeleted };
}

// ─── Main handler ───────────────────────────────────────────
Deno.serve(async (req) => {
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
        JSON.stringify({ ok: false, code: "UNAUTHORIZED", message: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Resolve authorization context (org, role, tier)
    const auth = await resolveAuthContext(serviceClient, user.id);

    // 4. Parse request body
    const body: DeleteRequest = await req.json();
    const { work_item_ids } = body;

    if (!work_item_ids || !Array.isArray(work_item_ids) || work_item_ids.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, code: "INVALID_REQUEST", message: "work_item_ids array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[delete-work-items] User ${user.id} (role: ${auth.membershipRole}, business: ${auth.isBusinessTier}) requesting deletion of ${work_item_ids.length} items`);

    const result: DeleteResult = {
      ok: true,
      deleted_count: 0,
      deleted_ids: [],
      errors: [],
      storage_files_deleted: 0,
    };

    // 5. Process each work item
    for (const workItemId of work_item_ids) {
      try {
        // Fetch work item to check ownership
        const { data: workItem } = await serviceClient
          .from("work_items")
          .select("id, owner_id, organization_id")
          .eq("id", workItemId)
          .maybeSingle();

        if (!workItem) {
          result.errors.push({ id: workItemId, error: "Item not found" });
          continue;
        }

        // ── AUTHORIZATION CHECK ──
        if (!canDeleteWorkItem(auth, workItem)) {
          result.errors.push({ id: workItemId, error: "Access denied" });
          continue;
        }

        // 6. Delete dependents
        const { storageFilesDeleted } = await deleteWorkItemDependents(serviceClient, workItemId);
        result.storage_files_deleted += storageFilesDeleted;

        // 7. Delete the work item itself
        const { error: deleteError } = await serviceClient
          .from("work_items")
          .delete()
          .eq("id", workItemId);

        if (deleteError) {
          console.error(`[delete-work-items] Delete error for ${workItemId}:`, deleteError);
          result.errors.push({ id: workItemId, error: deleteError.message });
        } else {
          result.deleted_count++;
          result.deleted_ids.push(workItemId);
          console.log(`[delete-work-items] Successfully deleted ${workItemId}`);

          // Audit log
          if (auth.organizationId) {
            await serviceClient.from("audit_logs").insert({
              organization_id: auth.organizationId,
              actor_user_id: user.id,
              actor_type: "USER",
              action: "WORK_ITEM_HARD_DELETED",
              entity_type: "WORK_ITEM",
              entity_id: workItemId,
              metadata: {
                deleted_at: new Date().toISOString(),
                storage_files_deleted: storageFilesDeleted,
                authorization: {
                  is_owner: workItem.owner_id === user.id,
                  is_org_admin: auth.membershipRole === "OWNER" || auth.membershipRole === "ADMIN",
                  is_business_tier: auth.isBusinessTier,
                },
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
        status: result.ok ? 200 : 207,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
