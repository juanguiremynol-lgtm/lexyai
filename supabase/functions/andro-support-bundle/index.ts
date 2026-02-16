/**
 * andro-support-bundle — Read-only diagnostic bundle generator for Andro IA.
 *
 * Collects scoped evidence (user context, sync health, provider traces, data counts)
 * WITHOUT triggering any sync. Output: TXT + JSON stored in support_bundles table.
 *
 * Authorization: user-scoped (members=own data, BUSINESS org admin=org-wide).
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SECRET_SUBSTRINGS = [
  "secret", "api_key", "apikey", "token", "password",
  "authorization", "bearer", "credential", "private_key",
  "service_role", "anon_key",
];

function redactValue(key: string, val: unknown): unknown {
  if (typeof val === "string" && SECRET_SUBSTRINGS.some(s => key.toLowerCase().includes(s))) {
    return "[REDACTED]";
  }
  if (typeof val === "string" && val.length > 20 && /^(sk_|pk_|Bearer |ey[A-Za-z0-9])/.test(val)) {
    return "[REDACTED_TOKEN]";
  }
  return val;
}

function redactObj(obj: unknown): unknown {
  if (obj == null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redactObj);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = typeof v === "object" && v !== null ? redactObj(v) : redactValue(k, v);
  }
  return result;
}

function formatTxt(json: Record<string, unknown>): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════",
    "  ANDRO IA — SUPPORT DIAGNOSTIC BUNDLE",
    `  Generated: ${new Date().toISOString()}`,
    "═══════════════════════════════════════════════",
    "",
  ];

  const section = (title: string, data: unknown) => {
    lines.push(`── ${title} ──`);
    if (data == null) {
      lines.push("  (no data)");
    } else if (typeof data === "object") {
      lines.push(JSON.stringify(data, null, 2).split("\n").map(l => "  " + l).join("\n"));
    } else {
      lines.push(`  ${data}`);
    }
    lines.push("");
  };

  section("User Context", json.user_context);
  section("Session Context", json.session_context);
  section("Work Item Context", json.work_item_context);
  section("Daily Sync Health", json.daily_sync_health);
  section("Provider Traces (recent)", json.provider_traces);
  section("Data Presence (counts only)", json.data_counts);
  section("Dead Letter Status", json.dead_letter_status);
  section("Entitlement Limits", json.entitlements);

  lines.push("── Redaction Manifest ──");
  const manifest = json.redaction_manifest as Record<string, unknown> | null;
  if (manifest) {
    lines.push(`  Version: ${manifest.redaction_version}`);
    lines.push(`  Fields removed: ${(manifest.fields_removed as string[])?.join(", ")}`);
    lines.push(`  Fields included (for correlation): ${(manifest.fields_included_for_correlation as string[])?.join(", ")}`);
    lines.push(`  PII policy: ${manifest.pii_policy}`);
    lines.push(`  Storage: ${manifest.storage_policy}`);
    lines.push(`  TTL: ${manifest.ttl_days} days`);
  } else {
    lines.push("  All secrets, tokens, API keys: REDACTED");
    lines.push("  User IDs: included (needed for support correlation)");
    lines.push("  Radicados: included (needed for case identification)");
  }
  lines.push("");
  lines.push("═══════════════════════════════════════════════");
  lines.push("  END OF BUNDLE");
  lines.push("═══════════════════════════════════════════════");

  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const workItemId = body.work_item_id as string | undefined;
    const routeContext = body.route_context as string | undefined;

    // Get user profile + org
    const { data: profile } = await userClient
      .from("profiles")
      .select("id, full_name, organization_id")
      .eq("id", user.id)
      .maybeSingle();

    const orgId = profile?.organization_id;

    // Check org admin status
    let isOrgAdmin = false;
    let membershipRole = "MEMBER";
    if (orgId) {
      const { data: membership } = await adminClient
        .from("organization_memberships")
        .select("role")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .maybeSingle();
      membershipRole = membership?.role || "MEMBER";
      isOrgAdmin = membershipRole === "OWNER" || membershipRole === "ADMIN";
    }

    // Check tier
    let tier = "TRIAL";
    if (orgId) {
      const { data: sub } = await adminClient
        .from("billing_subscription_state")
        .select("plan_code")
        .eq("organization_id", orgId)
        .maybeSingle();
      tier = sub?.plan_code || "TRIAL";
    }

    // Check effective limits
    let limits: unknown = null;
    if (orgId) {
      const { data: limData } = await adminClient.rpc("get_effective_limits", { p_org_id: orgId });
      limits = limData;
    }

    const isBusiness = ["BUSINESS", "PRO", "ENTERPRISE"].includes(tier.toUpperCase());

    const bundle: Record<string, unknown> = {};

    // 1. User context
    bundle.user_context = {
      user_id: user.id,
      org_id: orgId,
      role: membershipRole,
      tier,
      is_org_admin: isOrgAdmin,
      app_version: body.app_version || "unknown",
      user_agent: body.user_agent || "unknown",
    };

    // 2. Session context
    bundle.session_context = {
      route: routeContext || "unknown",
      generated_at: new Date().toISOString(),
    };

    // 3. Entitlements
    bundle.entitlements = limits;

    // 4. Work item context (if applicable)
    if (workItemId) {
      // RLS-enforced: userClient only sees what user owns (or org-wide if BUSINESS admin)
      const { data: wi } = await userClient
        .from("work_items")
        .select("id, radicado, workflow_type, status, stage, monitoring_enabled, monitoring_disabled_reason, last_synced_at, last_error_code, consecutive_404_count, consecutive_failures, total_actuaciones, provider_sources, created_at, updated_at")
        .eq("id", workItemId)
        .maybeSingle();

      bundle.work_item_context = wi ? redactObj(wi) : { error: "NOT_FOUND_OR_NOT_AUTHORIZED" };

      if (wi) {
        // Data counts (via userClient for RLS)
        const { count: actsCount } = await userClient
          .from("work_item_acts")
          .select("id", { count: "exact", head: true })
          .eq("work_item_id", workItemId);

        const { count: pubsCount } = await userClient
          .from("work_item_publicaciones")
          .select("id", { count: "exact", head: true })
          .eq("work_item_id", workItemId);

        bundle.data_counts = {
          actuaciones: actsCount ?? 0,
          publicaciones: pubsCount ?? 0,
        };

        // Provider traces (last 48h, RLS-scoped)
        const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { data: traces } = await userClient
          .from("sync_traces")
          .select("id, step, success, error_code, normalized_error_code, http_status, latency_ms, created_at")
          .eq("work_item_id", workItemId)
          .gte("created_at", since48h)
          .order("created_at", { ascending: false })
          .limit(20);
        bundle.provider_traces = (traces ?? []).map((t: any) => redactObj(t));

        // Dead letter status
        const { data: aiState } = await adminClient
          .from("atenia_ai_work_item_state")
          .select("consecutive_not_found, consecutive_timeouts, consecutive_other_errors, last_error_code, last_observed_at, last_success_at")
          .eq("work_item_id", workItemId)
          .maybeSingle();
        bundle.dead_letter_status = aiState || { status: "NO_DEAD_LETTER_RECORD" };
      }
    }

    // 5. Daily sync health (scoped)
    if (orgId) {
      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      
      // For members: only their own org's ledger (read-only, no PII)
      const { data: ledgers } = await adminClient
        .from("auto_sync_daily_ledger")
        .select("id, run_date, status, chain_id, items_targeted, items_succeeded, items_failed, items_skipped, timeout_count, dead_letter_count, started_at, completed_at, failure_reason, metadata")
        .eq("organization_id", orgId)
        .gte("run_date", since7d.slice(0, 10))
        .order("run_date", { ascending: false })
        .limit(10);

      // Calculate chain metrics
      const chains = (ledgers ?? []).reduce((acc: Record<string, any[]>, l: any) => {
        const key = l.chain_id || l.id;
        if (!acc[key]) acc[key] = [];
        acc[key].push(l);
        return acc;
      }, {});

      bundle.daily_sync_health = {
        recent_ledger_entries: (ledgers ?? []).map((l: any) => ({
          run_date: l.run_date,
          status: l.status,
          items_targeted: l.items_targeted,
          items_succeeded: l.items_succeeded,
          items_failed: l.items_failed,
          items_skipped: l.items_skipped,
          timeout_count: l.timeout_count,
          dead_letter_count: l.dead_letter_count,
          failure_reason: l.failure_reason,
        })),
        chain_count: Object.keys(chains).length,
      };
    }

    // Redaction manifest (first-class artifact)
    bundle.redaction_manifest = {
      redaction_version: "1.0",
      fields_removed: ["auth_headers", "secrets", "tokens", "api_keys", "service_role_key", "anon_key"],
      fields_included_for_correlation: ["user_id", "org_id", "work_item_id", "radicado"],
      pii_policy: "No raw emails except current user. No IP addresses. No cross-user PII.",
      secret_detection: "Strings matching sk_/pk_/Bearer/ey* patterns redacted. Keys containing secret/token/password/credential redacted.",
      storage_policy: "Private to requesting user. Sharing requires explicit consent via support_access_grants.",
      ttl_days: 30,
    };

    // Generate TXT
    const txt = formatTxt(bundle);

    // Store bundle
    const { data: stored, error: storeErr } = await userClient
      .from("support_bundles")
      .insert({
        user_id: user.id,
        organization_id: orgId,
        work_item_id: workItemId || null,
        bundle_type: "DIAGNOSTIC",
        txt_content: txt,
        json_content: bundle,
        route_context: routeContext,
      })
      .select("id, created_at")
      .single();

    if (storeErr) {
      console.error("[andro-support-bundle] Store error:", storeErr.message);
    }

    // Log action
    await adminClient.from("atenia_assistant_actions").insert({
      organization_id: orgId,
      user_id: user.id,
      action_type: "GENERATE_SUPPORT_BUNDLE",
      work_item_id: workItemId || null,
      input: { route_context: routeContext, work_item_id: workItemId },
      status: "EXECUTED",
    }).catch(() => {});

    return new Response(JSON.stringify({
      ok: true,
      bundle_id: stored?.id,
      txt: txt,
      json: bundle,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    console.error("[andro-support-bundle] Error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
