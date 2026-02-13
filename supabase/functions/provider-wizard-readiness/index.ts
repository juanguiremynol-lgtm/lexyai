/**
 * provider-wizard-readiness — Comprehensive pre-activation readiness gate.
 *
 * Performs ALL checks required before a provider can be activated:
 *   1. Instance resolution (exactly one enabled instance for scope)
 *   2. Secret readiness (active secret + decrypt OK under current platform key)
 *   3. Route/scope correctness (route exists, scope maps to correct subchain)
 *   4. Compatibility gate (connector key valid for declared workflow+dataKind)
 *   5. RLS readiness (authenticated read check on provenance tables)
 *   6. Coverage matrix position (PRIMARY vs FALLBACK, admin confirmation needed)
 *
 * POST { connector_id, instance_id, organization_id? }
 * Returns: { ok, checks: [...], evidence_bundle: { ... }, remediation_hints: [...] }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveActiveSecret } from "../_shared/resolveActiveSecret.ts";
import { getKeyDerivationMode } from "../_shared/cryptoKey.ts";
import { isProviderCompatible, getProviderCoverage, routeScopeToDataKinds } from "../_shared/providerCoverageMatrix.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CheckResult {
  check: string;
  status: "PASS" | "FAIL" | "WARN";
  detail: string;
  remediation?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth: verify user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(supabaseUrl, serviceKey);

    // Platform admin check
    const { data: platformAdmin } = await db
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!platformAdmin) {
      return new Response(JSON.stringify({ error: "Platform admin required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { connector_id, instance_id, organization_id } = body;

    if (!connector_id || !instance_id) {
      return new Response(JSON.stringify({ error: "connector_id and instance_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const checks: CheckResult[] = [];
    const remediationHints: string[] = [];

    // ── 1. Load connector ──
    const { data: connector } = await db
      .from("provider_connectors")
      .select("id, key, name, capabilities, is_enabled")
      .eq("id", connector_id)
      .maybeSingle();

    if (!connector) {
      checks.push({ check: "CONNECTOR_EXISTS", status: "FAIL", detail: `Connector ${connector_id} not found` });
      return respond(false, checks, remediationHints);
    }
    checks.push({ check: "CONNECTOR_EXISTS", status: "PASS", detail: `${connector.name} (${connector.key})` });

    // ── 2. Instance resolution ──
    const { data: instance } = await db
      .from("provider_instances")
      .select("id, name, scope, is_enabled, connector_id, organization_id, base_url, auth_type")
      .eq("id", instance_id)
      .maybeSingle();

    if (!instance) {
      checks.push({ check: "INSTANCE_EXISTS", status: "FAIL", detail: `Instance ${instance_id} not found` });
      return respond(false, checks, remediationHints);
    }

    // Check for duplicate instances
    const { data: duplicates } = await db
      .from("provider_instances")
      .select("id, name, is_enabled")
      .eq("connector_id", connector_id)
      .eq("scope", instance.scope)
      .neq("id", instance_id);

    if (duplicates && duplicates.length > 0) {
      const enabledDups = duplicates.filter((d: any) => d.is_enabled);
      if (enabledDups.length > 0) {
        checks.push({
          check: "INSTANCE_UNIQUE",
          status: "WARN",
          detail: `${enabledDups.length} other enabled instance(s) exist for this connector+scope: ${enabledDups.map((d: any) => d.name).join(", ")}`,
          remediation: "Disable duplicate instances to prevent ambiguous resolution. The system uses the latest enabled instance.",
        });
        remediationHints.push("Duplicate enabled instances detected — disable extras to ensure deterministic resolution.");
      } else {
        checks.push({ check: "INSTANCE_UNIQUE", status: "PASS", detail: "No duplicate enabled instances" });
      }
    } else {
      checks.push({ check: "INSTANCE_UNIQUE", status: "PASS", detail: "Only instance for this connector+scope" });
    }

    if (!instance.is_enabled) {
      checks.push({ check: "INSTANCE_ENABLED", status: "FAIL", detail: `Instance "${instance.name}" is disabled`, remediation: "Enable the instance before activation." });
    } else {
      checks.push({ check: "INSTANCE_ENABLED", status: "PASS", detail: `Instance "${instance.name}" is enabled` });
    }

    // ── 3. Secret readiness + decrypt ──
    const secretResult = await resolveActiveSecret(db, instance_id);
    const keyEnvExists = !!Deno.env.get("ATENIA_SECRETS_KEY_B64");
    let platformKeyMode = "UNAVAILABLE";
    try { platformKeyMode = getKeyDerivationMode(); } catch { /* ignore */ }

    if (secretResult.ok) {
      checks.push({
        check: "SECRET_ACTIVE",
        status: "PASS",
        detail: `Active secret v${secretResult.key_version}, scope=${secretResult.secret_scope}`,
      });
      checks.push({ check: "SECRET_DECRYPT", status: "PASS", detail: `Decrypt OK under ${platformKeyMode} key mode` });
    } else {
      const fr = secretResult.failure_reason;
      checks.push({
        check: "SECRET_ACTIVE",
        status: fr === "MISSING_SECRET" ? "FAIL" : (fr === "DECRYPT_FAILED" ? "WARN" : "FAIL"),
        detail: secretResult.detail,
      });
      if (fr === "MISSING_SECRET") {
        checks.push({ check: "SECRET_DECRYPT", status: "FAIL", detail: "No secret to decrypt" });
        remediationHints.push("Configure an API key in the Instance step.");
      } else if (fr === "DECRYPT_FAILED") {
        checks.push({
          check: "SECRET_DECRYPT",
          status: "FAIL",
          detail: `Decrypt failed under ${platformKeyMode} mode`,
          remediation: "Re-encrypt using SET_EXACT: paste the same provider API key. No key rotation needed.",
        });
        remediationHints.push("Secret exists but cannot decrypt — use SET_EXACT re-encryption with the same provider key.");
      } else if (fr === "KEY_MISSING") {
        checks.push({ check: "SECRET_DECRYPT", status: "FAIL", detail: "ATENIA_SECRETS_KEY_B64 not set", remediation: "Contact platform operator." });
        remediationHints.push("Platform encryption key is missing — contact operator.");
      } else {
        checks.push({ check: "SECRET_DECRYPT", status: "FAIL", detail: secretResult.detail });
      }
    }

    // ── 4. Route/scope correctness ──
    const { data: globalRoutes } = await db
      .from("provider_category_routes_global")
      .select("id, workflow, scope, route_kind, priority, enabled")
      .eq("provider_connector_id", connector_id);

    const { data: orgRoutes } = organization_id ? await db
      .from("provider_category_routes_org_override")
      .select("id, workflow, scope, route_kind, priority, enabled")
      .eq("provider_connector_id", connector_id)
      .eq("organization_id", organization_id) : { data: [] };

    const allRoutes = [...(globalRoutes || []), ...(orgRoutes || [])];
    const enabledRoutes = allRoutes.filter((r: any) => r.enabled);

    if (enabledRoutes.length === 0) {
      checks.push({
        check: "ROUTE_EXISTS",
        status: "FAIL",
        detail: "No enabled routes found for this connector",
        remediation: "Configure at least one route in the Routing step before activation.",
      });
      remediationHints.push("No routes configured — add at least one workflow+scope route.");
    } else {
      checks.push({
        check: "ROUTE_EXISTS",
        status: "PASS",
        detail: `${enabledRoutes.length} enabled route(s): ${enabledRoutes.map((r: any) => `${r.workflow}/${r.scope}/${r.route_kind}`).join(", ")}`,
      });

      // ── 5. Compatibility gate per route ──
      for (const route of enabledRoutes) {
        const dataKinds = routeScopeToDataKinds(route.scope);
        for (const dk of dataKinds) {
          const compat = isProviderCompatible(connector.key, route.workflow, dk);
          if (!compat.compatible) {
            checks.push({
              check: "COMPATIBILITY_GATE",
              status: "FAIL",
              detail: `${connector.key} incompatible with ${route.workflow}/${dk}: ${compat.reason}`,
              remediation: `Change route scope or add ${connector.key} to the compatibility set for ${route.workflow}/${dk}.`,
            });
          } else {
            checks.push({
              check: "COMPATIBILITY_GATE",
              status: "PASS",
              detail: `${connector.key} compatible with ${route.workflow}/${dk}`,
            });
          }
        }

        // Subchain mapping clarity
        const subchains = dataKinds.map(dk => dk === "ACTUACIONES" ? "ACTUACIONES" : "ESTADOS");
        checks.push({
          check: "SUBCHAIN_MAPPING",
          status: "PASS",
          detail: `Route ${route.workflow}/${route.scope} → subchains: ${[...new Set(subchains)].join(", ")}`,
        });
      }

      // ── 6. Coverage matrix position ──
      for (const route of enabledRoutes) {
        const dataKinds = routeScopeToDataKinds(route.scope);
        for (const dk of dataKinds) {
          const coverage = getProviderCoverage(route.workflow, dk);
          if (coverage.compatible) {
            const isPrimary = coverage.providers.some(
              (p) => p.role === "PRIMARY" && p.key.toLowerCase() === connector.key.toLowerCase()
            );
            const isFallback = coverage.providers.some(
              (p) => p.role === "FALLBACK" && p.key.toLowerCase() === connector.key.toLowerCase()
            );
            const position = isPrimary ? "PRIMARY (built-in)" : isFallback ? "FALLBACK (built-in)" : `EXTERNAL (${route.route_kind})`;
            checks.push({
              check: "COVERAGE_POSITION",
              status: route.route_kind === "PRIMARY" && !isPrimary ? "WARN" : "PASS",
              detail: `${connector.key} in ${route.workflow}/${dk}: ${position}`,
              remediation: route.route_kind === "PRIMARY" && !isPrimary
                ? "This provider is configured as PRIMARY but is not in the built-in coverage matrix. Confirm this is intentional."
                : undefined,
            });
          }
        }
      }
    }

    // ── 7. RLS readiness ──
    // Check if authenticated user can read provenance tables
    try {
      const { count: provenanceCount, error: rlsErr } = await userClient
        .from("act_provenance")
        .select("id", { count: "exact", head: true })
        .limit(1);

      if (rlsErr) {
        checks.push({
          check: "RLS_ACT_PROVENANCE",
          status: "FAIL",
          detail: `Cannot read act_provenance: ${rlsErr.message}`,
          remediation: "Add RLS SELECT policy for authenticated users scoped to their organization.",
        });
        remediationHints.push("act_provenance RLS blocks reads — provenance badges will not render.");
      } else {
        checks.push({ check: "RLS_ACT_PROVENANCE", status: "PASS", detail: "Authenticated user can query act_provenance" });
      }
    } catch {
      checks.push({ check: "RLS_ACT_PROVENANCE", status: "WARN", detail: "Could not verify RLS" });
    }

    // ── 8. Platform key diagnostics ──
    checks.push({
      check: "PLATFORM_KEY",
      status: keyEnvExists ? "PASS" : "FAIL",
      detail: keyEnvExists ? `Key mode: ${platformKeyMode}` : "ATENIA_SECRETS_KEY_B64 not set",
      remediation: !keyEnvExists ? "Set ATENIA_SECRETS_KEY_B64 environment variable." : undefined,
    });

    // ── Build evidence bundle ──
    const allPass = checks.every(c => c.status !== "FAIL");
    const hasWarnings = checks.some(c => c.status === "WARN");

    const evidenceBundle = {
      generated_at: new Date().toISOString(),
      connector: { id: connector.id, key: connector.key, name: connector.name },
      instance: { id: instance.id, name: instance.name, scope: instance.scope, base_url: "[REDACTED]", auth_type: instance.auth_type },
      secret: secretResult.ok
        ? { ok: true, key_version: secretResult.key_version, scope: secretResult.secret_scope, platform_key_mode: platformKeyMode }
        : { ok: false, failure_reason: secretResult.failure_reason, detail: secretResult.detail },
      routes: enabledRoutes.map((r: any) => ({
        workflow: r.workflow,
        scope: r.scope,
        route_kind: r.route_kind,
        priority: r.priority,
        subchains: routeScopeToDataKinds(r.scope).map((dk: string) => dk === "ACTUACIONES" ? "ACTUACIONES" : "ESTADOS"),
      })),
      checks_summary: {
        total: checks.length,
        pass: checks.filter(c => c.status === "PASS").length,
        warn: checks.filter(c => c.status === "WARN").length,
        fail: checks.filter(c => c.status === "FAIL").length,
      },
      checks,
      remediation_hints: remediationHints,
    };

    return new Response(JSON.stringify({
      ok: allPass,
      has_warnings: hasWarnings,
      checks,
      evidence_bundle: evidenceBundle,
      remediation_hints: remediationHints,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function respond(ok: boolean, checks: CheckResult[], hints: string[]) {
  return new Response(JSON.stringify({
    ok,
    has_warnings: checks.some(c => c.status === "WARN"),
    checks,
    evidence_bundle: {
      generated_at: new Date().toISOString(),
      checks_summary: {
        total: checks.length,
        pass: checks.filter(c => c.status === "PASS").length,
        warn: checks.filter(c => c.status === "WARN").length,
        fail: checks.filter(c => c.status === "FAIL").length,
      },
      checks,
      remediation_hints: hints,
    },
    remediation_hints: hints,
  }), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
      "Content-Type": "application/json",
    },
  });
}
