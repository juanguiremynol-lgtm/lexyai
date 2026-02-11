/**
 * provider-set-category-routes — Upsert category routing rules for a provider instance.
 * Super admin / org admin only.
 *
 * Input: { organization_id, routes: Array<{ workflow, scope, route_kind, priority, provider_instance_id, enabled }> }
 * Returns: effective route list for the org.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { validateUrl, validateAllowlistPolicy, type ProviderSecurityWarning } from "../_shared/externalProviderClient.ts";
import { requireWizardSession, isWizardError } from "../_shared/requireWizardSession.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session",
};

interface RouteInput {
  id?: string; // for update
  workflow: string;
  scope: string; // ACTS | PUBS | BOTH
  route_kind: string; // PRIMARY | FALLBACK
  priority: number;
  provider_instance_id: string;
  enabled: boolean;
  is_authoritative?: boolean;
}

const VALID_WORKFLOWS = ["CGP", "CPACA", "TUTELA", "PENAL_906", "LABORAL", "PETICION", "GOV_PROCEDURE", "ADMIN"];
const VALID_SCOPES = ["ACTS", "PUBS", "BOTH"];
const VALID_ROUTE_KINDS = ["PRIMARY", "FALLBACK"];

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
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Wizard session gate
    const wizardResult = await requireWizardSession(req, user.id, corsHeaders, {
      allowPlatformAdminOverride: true,
    });
    if (isWizardError(wizardResult)) return wizardResult;

    const body = await req.json();
    const { organization_id, routes } = body as { organization_id: string; routes: RouteInput[] };

    if (!organization_id || !routes || !Array.isArray(routes)) {
      return new Response(
        JSON.stringify({ error: "organization_id and routes[] required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify membership (admin/owner)
    const { data: membership } = await adminClient
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    // Allow platform admins or org admins
    const { data: platformAdmin } = await adminClient
      .from("platform_admins")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!platformAdmin && (!membership || !["OWNER", "ADMIN"].includes(membership.role))) {
      return new Response(JSON.stringify({ error: "Must be org admin or platform admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const warnings: ProviderSecurityWarning[] = [];
    const errors: string[] = [];

    // Validate each route
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      if (!VALID_WORKFLOWS.includes(r.workflow)) {
        errors.push(`Route ${i}: invalid workflow "${r.workflow}"`);
      }
      if (!VALID_SCOPES.includes(r.scope)) {
        errors.push(`Route ${i}: invalid scope "${r.scope}"`);
      }
      if (!VALID_ROUTE_KINDS.includes(r.route_kind)) {
        errors.push(`Route ${i}: invalid route_kind "${r.route_kind}"`);
      }

      // Validate provider instance exists and belongs to org
      const { data: inst } = await adminClient
        .from("provider_instances")
        .select("id, base_url, connector_id, organization_id, provider_connectors(allowed_domains, is_enabled)")
        .eq("id", r.provider_instance_id)
        .single();

      if (!inst) {
        errors.push(`Route ${i}: provider_instance ${r.provider_instance_id} not found`);
        continue;
      }

      if (inst.organization_id !== organization_id) {
        errors.push(`Route ${i}: provider_instance does not belong to this organization`);
        continue;
      }

      // Validate base_url against allowlist
      const connector = inst.provider_connectors as any;
      const allowlist = connector?.allowed_domains || [];
      if (allowlist.length === 0) {
        errors.push(`Route ${i}: connector has empty allowed_domains`);
        continue;
      }

      try {
        validateUrl(inst.base_url, allowlist);
      } catch (e: unknown) {
        errors.push(`Route ${i}: SSRF validation failed: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Check wildcard warnings
      const w = validateAllowlistPolicy(allowlist);
      if (w) warnings.push(w);
    }

    if (errors.length > 0) {
      return new Response(
        JSON.stringify({ error: "Validation failed", details: errors, warnings }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // If any route is marked authoritative, clear existing authoritative for same org/workflow/scope
    for (const r of routes) {
      if (r.is_authoritative) {
        await adminClient
          .from("provider_category_routes")
          .update({ is_authoritative: false })
          .eq("organization_id", organization_id)
          .eq("workflow", r.workflow)
          .eq("scope", r.scope)
          .eq("is_authoritative", true);
      }
    }

    // Upsert routes
    for (const r of routes) {
      if (r.id) {
        // Update existing
        await adminClient
          .from("provider_category_routes")
          .update({
            workflow: r.workflow,
            scope: r.scope,
            route_kind: r.route_kind,
            priority: r.priority,
            provider_instance_id: r.provider_instance_id,
            enabled: r.enabled,
            is_authoritative: r.is_authoritative ?? false,
          })
          .eq("id", r.id)
          .eq("organization_id", organization_id);
      } else {
        // Insert new
        await adminClient
          .from("provider_category_routes")
          .insert({
            organization_id,
            workflow: r.workflow,
            scope: r.scope,
            route_kind: r.route_kind,
            priority: r.priority,
            provider_instance_id: r.provider_instance_id,
            enabled: r.enabled,
            is_authoritative: r.is_authoritative ?? false,
          });
      }
    }

    // Return effective routes for the org
    const { data: effectiveRoutes } = await adminClient
      .from("provider_category_routes")
      .select("*, provider_instances(id, name, base_url, auth_type, is_enabled)")
      .eq("organization_id", organization_id)
      .order("workflow")
      .order("scope")
      .order("route_kind")
      .order("priority");

    // Audit
    await adminClient.from("atenia_ai_actions").insert({
      organization_id,
      action_type: "PROVIDER_ROUTES_UPDATED",
      autonomy_tier: "USER",
      reasoning: `Updated ${routes.length} category route(s)`,
      target_entity_type: "provider_category_routes",
      evidence: {
        routes_count: routes.length,
        workflows: [...new Set(routes.map((r) => r.workflow))],
        warnings_count: warnings.length,
      },
    });

    return new Response(
      JSON.stringify({ ok: true, routes: effectiveRoutes, warnings }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
