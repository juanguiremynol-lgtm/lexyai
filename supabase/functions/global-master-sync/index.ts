/**
 * global-master-sync — "Enqueue + Kick" layer for Super Admin Global Sync.
 *
 * This function does NOT iterate work items. Instead it:
 * 1. Creates a master_chain_id UUID for the global run.
 * 2. Enumerates all orgs with monitored work items.
 * 3. For each org, invokes scheduled-daily-sync with trigger_source=MANUAL + chain_id.
 * 4. Returns quickly (<5s) with the master_chain_id for UI polling.
 *
 * scheduled-daily-sync handles: cursor pagination, continuation, dead-letter
 * exclusion, per-org locking, budget guard, heartbeat writes.
 *
 * Telemetry: writes one short heartbeat for the kickoff itself (not the full run).
 * The global run is represented by chain_id + many scheduled-daily-sync heartbeats.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  startHeartbeat,
  finishHeartbeat,
  type HeartbeatHandle,
} from "../_shared/platformJobHeartbeat.ts";

const JOB_NAME = "global-master-sync";

/** Max orgs to kick concurrently (prevents thundering herd) */
const KICK_CONCURRENCY = 2;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Helpers ─────────────────────────────────────────────────────────

/** Kick scheduled-daily-sync for one org. Returns result metadata. */
async function kickOrgSync(
  supabaseUrl: string,
  serviceRoleKey: string,
  orgId: string,
  masterChainId: string,
  initiatorUserId: string | null,
): Promise<{ org_id: string; status: string; error?: string }> {
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/scheduled-daily-sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        org_id: orgId,
        chain_id: masterChainId,
        trigger_source: "MANUAL",
        manual_initiator_user_id: initiatorUserId,
      }),
    });

    // Consume body to prevent resource leak
    const body = await resp.text();

    if (!resp.ok) {
      return { org_id: orgId, status: "KICK_FAILED", error: `HTTP ${resp.status}: ${body.substring(0, 200)}` };
    }

    // Check if the lock was already held (cron running)
    try {
      const parsed = JSON.parse(body);
      if (parsed.orgs?.[0]?.status === "ALREADY_RUNNING" || parsed.orgs?.[0]?.status === "SKIPPED_LOCK") {
        return { org_id: orgId, status: "SKIPPED_LOCKED" };
      }
    } catch { /* not JSON, treat as success */ }

    return { org_id: orgId, status: "KICKED" };
  } catch (err: any) {
    return { org_id: orgId, status: "KICK_FAILED", error: err.message };
  }
}

/** Process array in batches of `size` with concurrency limit */
async function batchProcess<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const batchResults = await Promise.allSettled(batch.map(fn));
    for (const r of batchResults) {
      results.push(r.status === "fulfilled" ? r.value : ({ status: "KICK_FAILED", error: String(r.reason) } as unknown as R));
    }
  }
  return results;
}

// ─── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (body.health_check) {
    return new Response(JSON.stringify({ ok: true, job: JOB_NAME }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const masterChainId = crypto.randomUUID();
  let hb: HeartbeatHandle | null = null;
  let topLevelError: Error | null = null;

  // Extract initiator user id from auth header if available
  let initiatorUserId: string | null = null;
  try {
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      initiatorUserId = user?.id ?? null;
    }
  } catch { /* no auth context */ }

  // Result accumulators
  const kickedOrgs: Array<{ org_id: string; status: string; error?: string }> = [];
  const skippedOrgs: Array<{ org_id: string; reason: string }> = [];

  try {
    hb = await startHeartbeat(admin, JOB_NAME, "manual_ui", {
      trigger: "GlobalMasterSyncButton",
      master_chain_id: masterChainId,
      initiator_user_id: initiatorUserId,
    });

    // Enumerate all orgs with monitored work items
    const { data: orgRows, error: orgErr } = await admin
      .from("work_items")
      .select("organization_id")
      .eq("monitoring_enabled", true)
      .not("radicado", "is", null)
      .not("organization_id", "is", null);

    if (orgErr) throw orgErr;

    const orgIds = [...new Set((orgRows || []).map((r: any) => r.organization_id).filter(Boolean))];

    if (orgIds.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        master_chain_id: masterChainId,
        heartbeat_id: hb?.id ?? null,
        kicked_orgs: [],
        skipped_orgs: [],
        total_orgs: 0,
        started_at: new Date(startedAt).toISOString(),
        duration_ms: Date.now() - startedAt,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[${JOB_NAME}] Kicking ${orgIds.length} org(s) with master_chain_id=${masterChainId}`);

    // Kick each org with concurrency limit
    const results = await batchProcess(orgIds, KICK_CONCURRENCY, (orgId) =>
      kickOrgSync(supabaseUrl, serviceRoleKey, orgId, masterChainId, initiatorUserId)
    );

    for (const r of results) {
      if (r.status === "SKIPPED_LOCKED") {
        skippedOrgs.push({ org_id: r.org_id, reason: "Lock held (cron or other run active)" });
      } else {
        kickedOrgs.push(r);
      }
    }

    console.log(`[${JOB_NAME}] Kicked ${kickedOrgs.length} orgs, skipped ${skippedOrgs.length}`);

  } catch (err: any) {
    topLevelError = err;
    console.error(`[${JOB_NAME}] Fatal:`, err);
  } finally {
    const durationMs = Date.now() - startedAt;
    const failedKicks = kickedOrgs.filter(r => r.status === "KICK_FAILED");
    const hbStatus: "OK" | "ERROR" = topLevelError ? "ERROR" : failedKicks.length > 0 ? "ERROR" : "OK";
    const errorCode = topLevelError ? "UNHANDLED_EXCEPTION"
      : failedKicks.length > 0 ? "PARTIAL_KICK_FAILURES"
      : null;

    if (hb) {
      try {
        await finishHeartbeat(admin, hb, hbStatus, {
          errorCode: errorCode ?? undefined,
          errorMessage: topLevelError?.message ?? (failedKicks.length > 0 ? `${failedKicks.length} org kicks failed` : undefined),
          metadata: {
            master_chain_id: masterChainId,
            total_orgs: kickedOrgs.length + skippedOrgs.length,
            kicked: kickedOrgs.length,
            skipped: skippedOrgs.length,
            kick_failed: failedKicks.length,
            initiator_user_id: initiatorUserId,
          },
        });
      } catch (hbErr) {
        console.error(`[${JOB_NAME}] CRITICAL: finishHeartbeat failed:`, hbErr);
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  const responseBody = {
    ok: !topLevelError,
    master_chain_id: masterChainId,
    heartbeat_id: hb?.id ?? null,
    total_orgs: kickedOrgs.length + skippedOrgs.length,
    kicked_orgs: kickedOrgs,
    skipped_orgs: skippedOrgs,
    started_at: new Date(startedAt).toISOString(),
    duration_ms: durationMs,
    ...(topLevelError ? { error: topLevelError.message } : {}),
  };

  return new Response(JSON.stringify(responseBody), {
    status: topLevelError ? 500 : 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
