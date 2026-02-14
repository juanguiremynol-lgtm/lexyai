/**
 * Security Audit Alerts — High-signal event detection (v2)
 *
 * v2 Enhancements:
 * - Per-tenant baseline thresholds (relative to org size)
 * - Payload-free incident observations (links to audit entries, no raw data)
 * - SECURITY_SETTINGS_UPDATED tracking for egress/CSP changes
 * - Egress violation correlation
 *
 * Called by pg_cron or server-heartbeat.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Per-Tenant Baseline Multipliers ──────────────────────────────────
// Thresholds are multiplied by tenant size category
function getTenantMultiplier(memberCount: number): number {
  if (memberCount <= 3) return 1;      // Small firm
  if (memberCount <= 10) return 2;     // Medium firm
  if (memberCount <= 30) return 4;     // Large firm
  return 8;                             // Enterprise
}

// ── Alert Rule Definitions ───────────────────────────────────────────
interface AlertRule {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "warning" | "info";
  baseThreshold: number;       // Base threshold (multiplied by tenant size)
  windowMinutes: number;
  scaleByTenant: boolean;      // Whether to apply tenant multiplier
}

const ALERT_RULES: AlertRule[] = [
  {
    id: "BULK_EXPORT_SPIKE",
    name: "Pico de Exportación Masiva",
    description: "Número inusualmente alto de exportaciones por un usuario",
    severity: "critical",
    baseThreshold: 10,
    windowMinutes: 15,
    scaleByTenant: true,
  },
  {
    id: "PERMISSION_ESCALATION",
    name: "Escalamiento de Permisos",
    description: "Cambio de rol a admin/owner detectado",
    severity: "critical",
    baseThreshold: 1,
    windowMinutes: 60,
    scaleByTenant: false, // Always 1 — any escalation is notable
  },
  {
    id: "FAILED_AUTH_SPIKE",
    name: "Pico de Auth Fallido",
    description: "Múltiples intentos de login fallidos",
    severity: "warning",
    baseThreshold: 20,
    windowMinutes: 10,
    scaleByTenant: true,
  },
  {
    id: "ADMIN_SETTINGS_MUTATION",
    name: "Cambio de Configuración Admin",
    description: "Configuración de plataforma u organización modificada",
    severity: "info",
    baseThreshold: 1,
    windowMinutes: 60,
    scaleByTenant: false,
  },
  {
    id: "UNUSUAL_DATA_READ_VOLUME",
    name: "Volumen de Lectura Anómalo",
    description: "Usuario accediendo a volumen anormal de registros",
    severity: "warning",
    baseThreshold: 200,
    windowMinutes: 30,
    scaleByTenant: true,
  },
  {
    id: "EGRESS_VIOLATION_DETECTED",
    name: "Violación de Egreso",
    description: "Solicitud externa bloqueada por proxy de egreso",
    severity: "critical",
    baseThreshold: 1,
    windowMinutes: 30,
    scaleByTenant: false,
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
      return new Response(JSON.stringify({ status: "ok", service: "security-audit-alerts", version: "2.0" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch { /* continue */ }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Fetch tenant sizes for baseline scaling
  const { data: orgSizes } = await supabaseAdmin
    .from("organization_memberships")
    .select("organization_id")
    .then(({ data }) => {
      if (!data) return { data: new Map<string, number>() };
      const counts = new Map<string, number>();
      for (const row of data) {
        counts.set(row.organization_id, (counts.get(row.organization_id) || 0) + 1);
      }
      return { data: counts };
    });

  const getThreshold = (rule: AlertRule, orgId?: string): number => {
    if (!rule.scaleByTenant || !orgId) return rule.baseThreshold;
    const memberCount = orgSizes?.get(orgId) || 1;
    return rule.baseThreshold * getTenantMultiplier(memberCount);
  };

  const results: {
    rule_id: string;
    triggered: boolean;
    severity: string;
    detail?: unknown;
  }[] = [];

  for (const rule of ALERT_RULES) {
    try {
      let triggered = false;
      // PAYLOAD-FREE detail: only IDs, counts, timestamps — never raw content
      let detail: Record<string, unknown> = {};

      if (rule.id === "BULK_EXPORT_SPIKE") {
        const { data: exports } = await supabaseAdmin
          .from("audit_logs")
          .select("actor_user_id, organization_id")
          .in("action", ["EXPORT_GENERATED", "DOCUMENT_DOWNLOADED", "EVIDENCE_BUNDLE_GENERATED", "DATA_EXPORTED"])
          .gte("created_at", new Date(Date.now() - rule.windowMinutes * 60_000).toISOString());

        if (exports) {
          const countByUserOrg = new Map<string, { count: number; orgId: string }>();
          for (const row of exports) {
            const key = `${row.actor_user_id}:${row.organization_id}`;
            const existing = countByUserOrg.get(key);
            if (existing) existing.count++;
            else countByUserOrg.set(key, { count: 1, orgId: row.organization_id });
          }
          for (const [key, { count, orgId }] of countByUserOrg) {
            const threshold = getThreshold(rule, orgId);
            if (count >= threshold) {
              triggered = true;
              detail = { org_id: orgId, event_count: count, threshold, window_minutes: rule.windowMinutes };
              break;
            }
          }
        }
      } else if (rule.id === "PERMISSION_ESCALATION") {
        const { data: roleMutations } = await supabaseAdmin
          .from("audit_logs")
          .select("actor_user_id, organization_id, metadata, created_at, id")
          .in("action", ["DB_MEMBERSHIP_UPDATED", "ROLE_CHANGED", "MEMBER_ROLE_UPDATED"])
          .gte("created_at", new Date(Date.now() - rule.windowMinutes * 60_000).toISOString());

        if (roleMutations) {
          for (const mutation of roleMutations) {
            const after = (mutation.metadata as any)?.after;
            if (after?.role && ["OWNER", "ADMIN", "owner", "admin"].includes(after.role)) {
              triggered = true;
              // Link to audit entry ID, not raw metadata
              detail = {
                audit_log_id: mutation.id,
                org_id: mutation.organization_id,
                new_role: after.role,
                detected_at: mutation.created_at,
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

        if (count && count >= rule.baseThreshold) {
          triggered = true;
          detail = { event_count: count, threshold: rule.baseThreshold, window_minutes: rule.windowMinutes };
        }
      } else if (rule.id === "ADMIN_SETTINGS_MUTATION") {
        const { data: mutations } = await supabaseAdmin
          .from("audit_logs")
          .select("id, actor_user_id, organization_id, action, created_at")
          .in("action", [
            "ANALYTICS_SETTINGS_UPDATED", "ORG_SETTINGS_UPDATED",
            "PLATFORM_SETTINGS_UPDATED", "SUBSCRIPTION_CHANGED",
            "DB_SUBSCRIPTION_UPDATED", "SUPPORT_GRANT_CREATED",
            "SECURITY_SETTINGS_UPDATED",
          ])
          .gte("created_at", new Date(Date.now() - rule.windowMinutes * 60_000).toISOString());

        if (mutations && mutations.length >= rule.baseThreshold) {
          triggered = true;
          // Only actions and IDs, no metadata content
          detail = {
            event_count: mutations.length,
            actions: mutations.map(m => m.action),
            audit_log_ids: mutations.map(m => m.id),
          };
        }
      } else if (rule.id === "UNUSUAL_DATA_READ_VOLUME") {
        const { data: reads } = await supabaseAdmin
          .from("data_access_log")
          .select("user_id, table_name")
          .gte("accessed_at", new Date(Date.now() - rule.windowMinutes * 60_000).toISOString());

        if (reads) {
          const countByUserTable = new Map<string, number>();
          for (const row of reads) {
            const key = `${row.user_id}:${row.table_name}`;
            countByUserTable.set(key, (countByUserTable.get(key) || 0) + 1);
          }
          for (const [key, count] of countByUserTable) {
            if (count >= rule.baseThreshold) {
              triggered = true;
              const [, tableName] = key.split(":");
              detail = { table: tableName, access_count: count, threshold: rule.baseThreshold };
              break;
            }
          }
        }
      } else if (rule.id === "EGRESS_VIOLATION_DETECTED") {
        const { data: violations } = await supabaseAdmin
          .from("atenia_ai_observations")
          .select("id, title, severity, created_at")
          .eq("kind", "EGRESS_VIOLATION")
          .gte("created_at", new Date(Date.now() - rule.windowMinutes * 60_000).toISOString());

        if (violations && violations.length >= rule.baseThreshold) {
          triggered = true;
          // Only observation IDs and count
          detail = {
            violation_count: violations.length,
            observation_ids: violations.slice(0, 5).map(v => v.id),
          };
        }
      }

      if (triggered) {
        // Create incident observation — PAYLOAD-FREE
        const { error: insertErr } = await supabaseAdmin.from("atenia_ai_observations").insert({
          kind: "SECURITY_ALERT",
          severity: rule.severity.toUpperCase(),
          title: `🚨 ${rule.name}`,
          payload: {
            rule_id: rule.id,
            description: rule.description,
            // Only safe metadata, no raw content
            ...detail,
            detected_at: new Date().toISOString(),
          },
        });
        if (insertErr) {
          console.error(`[observation_insert_failure] kind=SECURITY_ALERT fn=security-audit-alerts rule=${rule.id} reason=${insertErr.message}`);
        }
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

  const triggeredCount = results.filter(r => r.triggered).length;

  return new Response(
    JSON.stringify({
      ok: true,
      scanned_at: new Date().toISOString(),
      rules_evaluated: results.length,
      alerts_triggered: triggeredCount,
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
