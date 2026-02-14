/**
 * Security Audit Alerts — High-signal event detection
 *
 * Monitors audit_logs and system events for suspicious patterns:
 * - Bulk exports
 * - Permission changes
 * - Unusual access patterns
 * - Settings mutations
 *
 * Wires alerts into Atenia AI's incident system (atenia_ai_observations).
 * Called by pg_cron or server-heartbeat.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Alert Definitions ────────────────────────────────────────────────
interface AlertRule {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "warning" | "info";
  query: string; // SQL to detect the condition
  threshold: number; // Minimum count to trigger
  windowMinutes: number; // Lookback window
}

const ALERT_RULES: AlertRule[] = [
  {
    id: "BULK_EXPORT_SPIKE",
    name: "Bulk Export Spike",
    description: "Unusually high number of exports by a single user in short window",
    severity: "critical",
    query: `
      SELECT actor_user_id, organization_id, COUNT(*) as event_count
      FROM audit_logs
      WHERE action IN ('EXPORT_GENERATED', 'DOCUMENT_DOWNLOADED', 'EVIDENCE_BUNDLE_GENERATED')
        AND created_at > now() - interval '$1 minutes'
      GROUP BY actor_user_id, organization_id
      HAVING COUNT(*) >= $2
    `,
    threshold: 10,
    windowMinutes: 15,
  },
  {
    id: "PERMISSION_ESCALATION",
    name: "Permission Escalation Detected",
    description: "Role change to admin/owner detected — verify legitimacy",
    severity: "critical",
    query: `
      SELECT actor_user_id, organization_id, metadata, created_at
      FROM audit_logs
      WHERE action IN ('DB_MEMBERSHIP_UPDATED', 'ROLE_CHANGED', 'MEMBER_ROLE_UPDATED')
        AND created_at > now() - interval '$1 minutes'
        AND (metadata->>'after')::jsonb->>'role' IN ('OWNER', 'ADMIN', 'owner', 'admin')
    `,
    threshold: 1,
    windowMinutes: 60,
  },
  {
    id: "FAILED_AUTH_SPIKE",
    name: "Failed Authentication Spike",
    description: "Multiple failed login attempts — potential credential stuffing",
    severity: "warning",
    query: `
      SELECT COUNT(*) as event_count
      FROM audit_logs
      WHERE action IN ('AUTH_LOGIN_FAILURE', 'AUTH_FAILED')
        AND created_at > now() - interval '$1 minutes'
      HAVING COUNT(*) >= $2
    `,
    threshold: 20,
    windowMinutes: 10,
  },
  {
    id: "ADMIN_SETTINGS_MUTATION",
    name: "Admin Settings Changed",
    description: "Platform or organization settings were modified",
    severity: "info",
    query: `
      SELECT actor_user_id, organization_id, action, metadata, created_at
      FROM audit_logs
      WHERE action IN (
        'ANALYTICS_SETTINGS_UPDATED', 'ORG_SETTINGS_UPDATED',
        'PLATFORM_SETTINGS_UPDATED', 'SUBSCRIPTION_CHANGED',
        'DB_SUBSCRIPTION_UPDATED', 'SUPPORT_GRANT_CREATED'
      )
        AND created_at > now() - interval '$1 minutes'
    `,
    threshold: 1,
    windowMinutes: 60,
  },
  {
    id: "UNUSUAL_DATA_READ_VOLUME",
    name: "Unusual Data Read Volume",
    description: "Single user accessing abnormally high number of records",
    severity: "warning",
    query: `
      SELECT user_id, table_name, COUNT(*) as access_count
      FROM data_access_log
      WHERE accessed_at > now() - interval '$1 minutes'
      GROUP BY user_id, table_name
      HAVING COUNT(*) >= $2
    `,
    threshold: 200,
    windowMinutes: 30,
  },
  {
    id: "EGRESS_VIOLATION_DETECTED",
    name: "Egress Proxy Violation",
    description: "Outbound request blocked by egress proxy — potential exfiltration attempt",
    severity: "critical",
    query: `
      SELECT title, severity, payload, created_at
      FROM atenia_ai_observations
      WHERE kind = 'EGRESS_VIOLATION'
        AND created_at > now() - interval '$1 minutes'
    `,
    threshold: 1,
    windowMinutes: 30,
  },
];

// ── Main Handler ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check
  try {
    const body = await req.clone().json().catch(() => null);
    if (body?.health_check === true) {
      return new Response(JSON.stringify({ status: "ok", service: "security-audit-alerts" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch { /* continue */ }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const results: {
    rule_id: string;
    triggered: boolean;
    severity: string;
    detail?: unknown;
  }[] = [];

  for (const rule of ALERT_RULES) {
    try {
      // Replace placeholders with actual values
      const query = rule.query
        .replace(/\$1/g, String(rule.windowMinutes))
        .replace(/\$2/g, String(rule.threshold));

      const { data, error } = await supabaseAdmin.rpc("", {}).maybeSingle();
      
      // Use raw SQL via supabase-js isn't directly available,
      // so we query the relevant tables directly
      let triggered = false;
      let detail: unknown = null;

      if (rule.id === "BULK_EXPORT_SPIKE") {
        const { data: exports } = await supabaseAdmin
          .from("audit_logs")
          .select("actor_user_id, organization_id")
          .in("action", ["EXPORT_GENERATED", "DOCUMENT_DOWNLOADED", "EVIDENCE_BUNDLE_GENERATED"])
          .gte("created_at", new Date(Date.now() - rule.windowMinutes * 60_000).toISOString());
        
        if (exports) {
          const countByUser = new Map<string, number>();
          for (const row of exports) {
            const key = `${row.actor_user_id}:${row.organization_id}`;
            countByUser.set(key, (countByUser.get(key) || 0) + 1);
          }
          for (const [key, count] of countByUser) {
            if (count >= rule.threshold) {
              triggered = true;
              detail = { user_org: key.split(":")[1], count, threshold: rule.threshold };
              break;
            }
          }
        }
      } else if (rule.id === "PERMISSION_ESCALATION") {
        const { data: roleMutations } = await supabaseAdmin
          .from("audit_logs")
          .select("actor_user_id, organization_id, metadata, created_at")
          .in("action", ["DB_MEMBERSHIP_UPDATED", "ROLE_CHANGED", "MEMBER_ROLE_UPDATED"])
          .gte("created_at", new Date(Date.now() - rule.windowMinutes * 60_000).toISOString());

        if (roleMutations && roleMutations.length >= rule.threshold) {
          // Check if any resulted in admin/owner
          for (const mutation of roleMutations) {
            const after = (mutation.metadata as any)?.after;
            if (after?.role && ["OWNER", "ADMIN", "owner", "admin"].includes(after.role)) {
              triggered = true;
              detail = {
                actor: mutation.actor_user_id,
                org: mutation.organization_id,
                new_role: after.role,
                at: mutation.created_at,
              };
              break;
            }
          }
        }
      } else if (rule.id === "FAILED_AUTH_SPIKE") {
        const { count } = await supabaseAdmin
          .from("audit_logs")
          .select("*", { count: "exact", head: true })
          .in("action", ["AUTH_LOGIN_FAILURE", "AUTH_FAILED"])
          .gte("created_at", new Date(Date.now() - rule.windowMinutes * 60_000).toISOString());

        if (count && count >= rule.threshold) {
          triggered = true;
          detail = { count, threshold: rule.threshold, window_minutes: rule.windowMinutes };
        }
      } else if (rule.id === "ADMIN_SETTINGS_MUTATION") {
        const { data: mutations } = await supabaseAdmin
          .from("audit_logs")
          .select("actor_user_id, organization_id, action, created_at")
          .in("action", [
            "ANALYTICS_SETTINGS_UPDATED", "ORG_SETTINGS_UPDATED",
            "PLATFORM_SETTINGS_UPDATED", "SUBSCRIPTION_CHANGED",
            "DB_SUBSCRIPTION_UPDATED", "SUPPORT_GRANT_CREATED",
          ])
          .gte("created_at", new Date(Date.now() - rule.windowMinutes * 60_000).toISOString());

        if (mutations && mutations.length >= rule.threshold) {
          triggered = true;
          detail = { count: mutations.length, actions: mutations.map((m) => m.action) };
        }
      } else if (rule.id === "UNUSUAL_DATA_READ_VOLUME") {
        const { data: reads } = await supabaseAdmin
          .from("data_access_log")
          .select("user_id, table_name")
          .gte("accessed_at", new Date(Date.now() - rule.windowMinutes * 60_000).toISOString());

        if (reads) {
          const countByUser = new Map<string, number>();
          for (const row of reads) {
            const key = `${row.user_id}:${row.table_name}`;
            countByUser.set(key, (countByUser.get(key) || 0) + 1);
          }
          for (const [key, count] of countByUser) {
            if (count >= rule.threshold) {
              triggered = true;
              detail = { user_table: key, count, threshold: rule.threshold };
              break;
            }
          }
        }
      } else if (rule.id === "EGRESS_VIOLATION_DETECTED") {
        const { data: violations } = await supabaseAdmin
          .from("atenia_ai_observations")
          .select("title, severity, created_at")
          .eq("kind", "EGRESS_VIOLATION")
          .gte("created_at", new Date(Date.now() - rule.windowMinutes * 60_000).toISOString());

        if (violations && violations.length >= rule.threshold) {
          triggered = true;
          detail = { count: violations.length, latest: violations[0] };
        }
      }

      if (triggered) {
        // Create incident observation
        await supabaseAdmin.from("atenia_ai_observations").insert({
          kind: "SECURITY_ALERT",
          severity: rule.severity,
          title: `🚨 ${rule.name}`,
          payload: {
            rule_id: rule.id,
            description: rule.description,
            detail,
            detected_at: new Date().toISOString(),
          },
        });
      }

      results.push({
        rule_id: rule.id,
        triggered,
        severity: rule.severity,
        detail: triggered ? detail : undefined,
      });
    } catch (err) {
      console.error(`[security-audit-alerts] Rule ${rule.id} failed:`, err);
      results.push({
        rule_id: rule.id,
        triggered: false,
        severity: rule.severity,
        detail: { error: err instanceof Error ? err.message : "Unknown error" },
      });
    }
  }

  const triggeredCount = results.filter((r) => r.triggered).length;

  return new Response(
    JSON.stringify({
      ok: true,
      scanned_at: new Date().toISOString(),
      rules_evaluated: results.length,
      alerts_triggered: triggeredCount,
      results,
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
