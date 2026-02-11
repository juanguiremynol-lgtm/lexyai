/**
 * provider-set-category-routes-org — Upsert org-specific routing overrides.
 * Org admin or platform admin only.
 *
 * Input: { organization_id, routes: Array<{ workflow, scope, route_kind, priority, provider_connector_id, is_authoritative, enabled }> }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireWizardSession, isWizardError } from "../_shared/requireWizardSession.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session",
};

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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Wizard session gate
    const wizardResult = await requireWizardSession(req, user.id, corsHeaders, {
      allowPlatformAdminOverride: true,
    });
    if (isWizardError(wizardResult)) return wizardResult;

    const body = await req.json();
    const { organization_id, routes } = body;

    if (!organization_id) {
      return new Response(JSON.stringify({ error: "organization_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify org admin or platform admin
    const { data: membership } = await adminClient
      .from("organization_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", organization_id)
      .maybeSingle();
    const { data: platformAdmin } = await adminClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!platformAdmin && (!membership || !["admin", "owner"].includes(membership.role))) {
      return new Response(JSON.stringify({ error: "Org admin or platform admin required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!routes || !Array.isArray(routes)) {
      return new Response(JSON.stringify({ error: "routes[] required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate
    const errors: string[] = [];
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      if (!VALID_WORKFLOWS.includes(r.workflow)) errors.push(`Route ${i}: invalid workflow`);
      if (!VALID_SCOPES.includes(r.scope)) errors.push(`Route ${i}: invalid scope`);
      if (!VALID_ROUTE_KINDS.includes(r.route_kind)) errors.push(`Route ${i}: invalid route_kind`);
    }

    if (errors.length > 0) {
      return new Response(JSON.stringify({ error: "Validation failed", details: errors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clear authoritative before setting new ones
    for (const r of routes) {
      if (r.is_authoritative) {
        await adminClient
          .from("provider_category_routes_org_override")
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
        await adminClient
          .from("provider_category_routes_org_override")
          .update({
            workflow: r.workflow,
            scope: r.scope,
            route_kind: r.route_kind,
            priority: r.priority,
            provider_connector_id: r.provider_connector_id,
            is_authoritative: r.is_authoritative ?? false,
            enabled: r.enabled,
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
      } else {
        await adminClient
          .from("provider_category_routes_org_override")
          .insert({
            organization_id,
            workflow: r.workflow,
            scope: r.scope,
            route_kind: r.route_kind,
            priority: r.priority,
            provider_connector_id: r.provider_connector_id,
            is_authoritative: r.is_authoritative ?? false,
            enabled: r.enabled,
          });
      }
    }

    const { data: effectiveRoutes } = await adminClient
      .from("provider_category_routes_org_override")
      .select("*, provider_connectors(id, name, key, is_enabled)")
      .eq("organization_id", organization_id)
      .order("workflow")
      .order("scope")
      .order("route_kind")
      .order("priority");

    // Audit
    await adminClient.from("atenia_ai_actions").insert({
      organization_id,
      action_type: "ORG_ROUTES_UPDATED",
      autonomy_tier: "USER",
      reasoning: `Org admin updated ${routes.length} org override route(s)`,
      target_entity_type: "provider_category_routes_org_override",
      evidence: {
        routes_count: routes.length,
        workflows: [...new Set(routes.map((r: any) => r.workflow))],
        actor: user.id,
      },
    });

    return new Response(
      JSON.stringify({ ok: true, routes: effectiveRoutes }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
