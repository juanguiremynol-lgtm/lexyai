/**
 * Purge Old Audit Logs Edge Function
 * 
 * Scheduled function to remove audit logs older than the organization's
 * retention policy. Critical actions are retained for double the retention period.
 * 
 * Supports two modes:
 * - preview: Returns count of logs that would be deleted without deleting
 * - execute: Performs the actual deletion
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

// Strict response interfaces - exactly 4 top-level fields each
interface PreviewResult {
  mode: "preview";
  would_delete_count: number;
  cutoff: string;
  retention_days: number;
}

interface ExecuteResult {
  mode: "execute";
  deleted_count: number;
  cutoff: string;
  retention_days: number;
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

  // Parse parameters
  let organizationId: string | null = null;
  let mode: "preview" | "execute" = "execute";
  let manual = false;

  try {
    const body = await req.json().catch(() => ({}));
    organizationId = body.organization_id || null;
    mode = body.mode === "preview" ? "preview" : "execute";
    manual = body.manual === true;
  } catch {
    // No body is fine
  }

  console.log(`[purge-old-audit-logs] Mode: ${mode}, Org: ${organizationId || "ALL"}, Manual: ${manual}`);

  // Create job run record (for both preview and execute modes)
  let jobRunId: string | null = null;
  const { data: jobRun, error: jobError } = await supabase
    .from("job_runs")
    .insert({
      job_name: "purge_old_audit_logs",
      status: "RUNNING",
      organization_id: organizationId,
    })
    .select("id")
    .single();

  if (jobError) {
    console.error("[purge-old-audit-logs] Failed to create job run:", jobError.message);
  } else {
    jobRunId = jobRun?.id || null;
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
      if (jobRunId) {
        await supabase
          .from("job_runs")
          .update({
            status: "OK",
            finished_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            processed_count: 0,
          })
          .eq("id", jobRunId);
      }

      return new Response(
        JSON.stringify({ ok: true, mode, message: "No organizations to process", deleted: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For preview mode with single org
    if (mode === "preview" && organizations.length === 1) {
      const org = organizations[0] as Organization;
      const retentionDays = org.audit_retention_days || 365;
      const normalCutoff = new Date();
      normalCutoff.setDate(normalCutoff.getDate() - retentionDays);

      const extendedCutoff = new Date();
      extendedCutoff.setDate(extendedCutoff.getDate() - (retentionDays * 2));

      // Count normal logs that would be deleted
      const { count: normalCount } = await supabase
        .from("audit_logs")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", org.id)
        .lt("created_at", normalCutoff.toISOString())
        .not("action", "in", `(${EXTENDED_RETENTION_ACTIONS.join(",")})`);

      // Count extended logs that would be deleted
      const { count: extendedCount } = await supabase
        .from("audit_logs")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", org.id)
        .lt("created_at", extendedCutoff.toISOString())
        .in("action", EXTENDED_RETENTION_ACTIONS);

      const durationMs = Date.now() - startTime;
      const wouldDeleteCount = (normalCount || 0) + (extendedCount || 0);

      // Update job run with preview result
      if (jobRunId) {
        await supabase
          .from("job_runs")
          .update({
            status: "OK",
            finished_at: new Date().toISOString(),
            duration_ms: durationMs,
            processed_count: 0, // Preview doesn't delete anything
          })
          .eq("id", jobRunId);
      }

      // Log health event for preview
      await supabase.from("system_health_events").insert({
        service: "purge_old_audit_logs",
        status: "OK",
        message: `Preview: ${wouldDeleteCount} audit logs would be deleted (retention: ${retentionDays} days)${manual ? " [manual]" : ""}`,
        metadata: {
          mode: "preview",
          would_delete_count: wouldDeleteCount,
          retention_days: retentionDays,
          cutoff: normalCutoff.toISOString(),
          organization_id: org.id,
          breakdown: { normal: normalCount || 0, extended: extendedCount || 0 },
          durationMs,
        },
      });

      // Strict JSON response - exactly 4 top-level fields
      const previewResult = {
        mode: "preview" as const,
        would_delete_count: wouldDeleteCount,
        cutoff: normalCutoff.toISOString(),
        retention_days: retentionDays,
      };

      return new Response(
        JSON.stringify(previewResult),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Execute mode
    let totalDeleted = 0;
    const results: Array<{ org_id: string; org_name: string; deleted: number; extended_deleted: number }> = [];
    let lastRetentionDays = 365;
    let lastCutoff = "";

    for (const org of organizations as Organization[]) {
      const retentionDays = org.audit_retention_days || 365;
      lastRetentionDays = retentionDays;
      const normalCutoff = new Date();
      normalCutoff.setDate(normalCutoff.getDate() - retentionDays);
      lastCutoff = normalCutoff.toISOString();

      // Extended retention: double the normal period for critical actions
      const extendedCutoff = new Date();
      extendedCutoff.setDate(extendedCutoff.getDate() - (retentionDays * 2));

      console.log(`[purge-old-audit-logs] Processing org ${org.id} (${org.name}): retention=${retentionDays}d, cutoff=${normalCutoff.toISOString()}`);

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

    const durationMs = Date.now() - startTime;

    // Update job run with success
    if (jobRunId) {
      await supabase
        .from("job_runs")
        .update({
          status: "OK",
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          processed_count: totalDeleted,
        })
        .eq("id", jobRunId);
    }

    // Log health event
    await supabase.from("system_health_events").insert({
      service: "purge_old_audit_logs",
      status: "OK",
      message: `Purged ${totalDeleted} audit log entries (retention: ${lastRetentionDays} days)${manual ? " [manual]" : ""}`,
      metadata: { results, manual, durationMs, retention_days: lastRetentionDays },
    });

    console.log(`[purge-old-audit-logs] Completed. Total deleted: ${totalDeleted}, Duration: ${durationMs}ms`);

    // Strict JSON response - exactly 4 top-level fields
    const executeResult = {
      mode: "execute" as const,
      deleted_count: totalDeleted,
      cutoff: lastCutoff,
      retention_days: lastRetentionDays,
    };

    return new Response(
      JSON.stringify(executeResult),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[purge-old-audit-logs] Error:", errorMessage);

    // Update job run with error
    if (jobRunId) {
      await supabase
        .from("job_runs")
        .update({
          status: "ERROR",
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          error: errorMessage,
        })
        .eq("id", jobRunId);
    }

    // Log health event
    await supabase.from("system_health_events").insert({
      service: "purge_old_audit_logs",
      status: "ERROR",
      message: `Purge failed: ${errorMessage}`,
      metadata: { error: errorMessage, manual },
    });

    return new Response(
      JSON.stringify({ ok: false, code: "PURGE_FAILED", message: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});