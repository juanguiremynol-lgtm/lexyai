/**
 * Purge Old Audit Logs Edge Function
 * 
 * Scheduled function to remove audit logs older than the organization's
 * retention policy. Critical actions are retained for double the retention period.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Critical actions that require extended retention (double the normal period)
const EXTENDED_RETENTION_ACTIONS = [
  "DB_MEMBERSHIP_DELETED",
  "OWNERSHIP_TRANSFERRED",
  "SUBSCRIPTION_SUSPENDED",
  "SUBSCRIPTION_EXPIRED",
  "RECYCLE_BIN_PURGED",
  "DATA_PURGED",
  "SECURITY_SETTINGS_UPDATED",
  "WORK_ITEM_HARD_DELETED",
  "CLIENT_HARD_DELETED",
];

interface Organization {
  id: string;
  name: string;
  audit_retention_days: number;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[purge-old-audit-logs] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return new Response(
      JSON.stringify({ ok: false, code: "MISSING_SECRET", message: "Server configuration error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Start time for duration tracking
  const startTime = Date.now();

  // Parse optional parameters
  let organizationId: string | null = null;
  let dryRun = false;

  try {
    const body = await req.json().catch(() => ({}));
    organizationId = body.organization_id || null;
    dryRun = body.dry_run === true;
  } catch {
    // No body is fine
  }

  console.log(`[purge-old-audit-logs] Starting purge. Org: ${organizationId || "ALL"}, DryRun: ${dryRun}`);

  // Create job run record
  const { data: jobRun, error: jobError } = await supabase
    .from("job_runs")
    .insert({
      job_name: "purge_old_audit_logs",
      status: "RUNNING",
      organization_id: organizationId,
    })
    .select()
    .single();

  if (jobError) {
    console.error("[purge-old-audit-logs] Failed to create job run:", jobError.message);
  }

  try {
    // Fetch organizations with retention settings
    let orgQuery = supabase
      .from("organizations")
      .select("id, name, audit_retention_days")
      .eq("is_active", true);

    if (organizationId) {
      orgQuery = orgQuery.eq("id", organizationId);
    }

    const { data: organizations, error: orgError } = await orgQuery;

    if (orgError) {
      throw new Error(`Failed to fetch organizations: ${orgError.message}`);
    }

    if (!organizations || organizations.length === 0) {
      console.log("[purge-old-audit-logs] No organizations found");
      
      // Update job run
      if (jobRun?.id) {
        await supabase
          .from("job_runs")
          .update({
            status: "OK",
            finished_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            processed_count: 0,
          })
          .eq("id", jobRun.id);
      }

      return new Response(
        JSON.stringify({ ok: true, message: "No organizations to process", deleted: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let totalDeleted = 0;
    const results: Array<{ org_id: string; org_name: string; deleted: number; extended_deleted: number }> = [];

    for (const org of organizations as Organization[]) {
      const retentionDays = org.audit_retention_days || 365;
      const normalCutoff = new Date();
      normalCutoff.setDate(normalCutoff.getDate() - retentionDays);

      // Extended retention: double the normal period for critical actions
      const extendedCutoff = new Date();
      extendedCutoff.setDate(extendedCutoff.getDate() - (retentionDays * 2));

      console.log(`[purge-old-audit-logs] Processing org ${org.id} (${org.name}): retention=${retentionDays}d, cutoff=${normalCutoff.toISOString()}`);

      if (dryRun) {
        // Count what would be deleted
        const { count: normalCount } = await supabase
          .from("audit_logs")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .lt("created_at", normalCutoff.toISOString())
          .not("action", "in", `(${EXTENDED_RETENTION_ACTIONS.join(",")})`);

        const { count: extendedCount } = await supabase
          .from("audit_logs")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .lt("created_at", extendedCutoff.toISOString())
          .in("action", EXTENDED_RETENTION_ACTIONS);

        results.push({
          org_id: org.id,
          org_name: org.name,
          deleted: normalCount || 0,
          extended_deleted: extendedCount || 0,
        });

        totalDeleted += (normalCount || 0) + (extendedCount || 0);
      } else {
        // Delete normal retention logs (non-critical actions older than retention)
        const { count: normalCount, error: normalError } = await supabase
          .from("audit_logs")
          .delete({ count: "exact" })
          .eq("organization_id", org.id)
          .lt("created_at", normalCutoff.toISOString())
          .not("action", "in", `(${EXTENDED_RETENTION_ACTIONS.join(",")})`);

        if (normalError) {
          console.error(`[purge-old-audit-logs] Error deleting normal logs for ${org.id}:`, normalError.message);
        }

        // Delete extended retention logs (critical actions older than 2x retention)
        const { count: extendedCount, error: extendedError } = await supabase
          .from("audit_logs")
          .delete({ count: "exact" })
          .eq("organization_id", org.id)
          .lt("created_at", extendedCutoff.toISOString())
          .in("action", EXTENDED_RETENTION_ACTIONS);

        if (extendedError) {
          console.error(`[purge-old-audit-logs] Error deleting extended logs for ${org.id}:`, extendedError.message);
        }

        const deleted = (normalCount || 0) + (extendedCount || 0);
        totalDeleted += deleted;

        results.push({
          org_id: org.id,
          org_name: org.name,
          deleted: normalCount || 0,
          extended_deleted: extendedCount || 0,
        });

        console.log(`[purge-old-audit-logs] Org ${org.id}: deleted ${normalCount || 0} normal + ${extendedCount || 0} extended = ${deleted} total`);
      }
    }

    const durationMs = Date.now() - startTime;

    // Update job run with success
    if (jobRun?.id) {
      await supabase
        .from("job_runs")
        .update({
          status: "OK",
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          processed_count: totalDeleted,
        })
        .eq("id", jobRun.id);
    }

    // Log health event
    await supabase.from("system_health_events").insert({
      service: "purge_old_audit_logs",
      status: "OK",
      message: `Purged ${totalDeleted} audit log entries${dryRun ? " (dry run)" : ""}`,
      metadata: { results, dryRun, durationMs },
    });

    console.log(`[purge-old-audit-logs] Completed. Total deleted: ${totalDeleted}, Duration: ${durationMs}ms`);

    return new Response(
      JSON.stringify({
        ok: true,
        message: dryRun ? "Dry run completed" : "Purge completed",
        deleted: totalDeleted,
        results,
        durationMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[purge-old-audit-logs] Error:", errorMessage);

    // Update job run with error
    if (jobRun?.id) {
      await supabase
        .from("job_runs")
        .update({
          status: "ERROR",
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          error: errorMessage,
        })
        .eq("id", jobRun.id);
    }

    // Log health event
    await supabase.from("system_health_events").insert({
      service: "purge_old_audit_logs",
      status: "ERROR",
      message: `Purge failed: ${errorMessage}`,
      metadata: { error: errorMessage },
    });

    return new Response(
      JSON.stringify({ ok: false, code: "PURGE_FAILED", message: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
