/**
 * provider-set-global-routes — Upsert global category routing rules.
 * Platform admin only.
 *
 * Input: { routes: Array<{ workflow, scope, route_kind, priority, provider_connector_id, is_authoritative, enabled }> }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireWizardSession, isWizardError } from "../_shared/requireWizardSession.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session",
};

interface GlobalRouteInput {
  id?: string;
  workflow: string;
  scope: string;
  route_kind: string;
  priority: number;
  provider_connector_id: string;
  is_authoritative?: boolean;
  enabled: boolean;
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
      mode: "PLATFORM",
    });
    if (isWizardError(wizardResult)) return wizardResult;

    // Verify platform admin
    const { data: platformAdmin } = await adminClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!platformAdmin) {
      return new Response(JSON.stringify({ error: "Platform admin required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { routes } = body as { routes: GlobalRouteInput[] };

    if (!routes || !Array.isArray(routes)) {
      return new Response(JSON.stringify({ error: "routes[] required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const errors: string[] = [];

    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      if (!VALID_WORKFLOWS.includes(r.workflow)) errors.push(`Route ${i}: invalid workflow "${r.workflow}"`);
      if (!VALID_SCOPES.includes(r.scope)) errors.push(`Route ${i}: invalid scope "${r.scope}"`);
      if (!VALID_ROUTE_KINDS.includes(r.route_kind)) errors.push(`Route ${i}: invalid route_kind "${r.route_kind}"`);

      // Validate connector exists
      const { data: connector } = await adminClient
        .from("provider_connectors")
        .select("id, name, is_enabled")
        .eq("id", r.provider_connector_id)
        .single();

      if (!connector) {
        errors.push(`Route ${i}: connector ${r.provider_connector_id} not found`);
      } else if (!connector.is_enabled) {
        errors.push(`Route ${i}: connector "${connector.name}" is disabled`);
      }
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
          .from("provider_category_routes_global")
          .update({ is_authoritative: false })
          .eq("workflow", r.workflow)
          .eq("scope", r.scope)
          .eq("is_authoritative", true);
      }
    }

    // Upsert routes
    for (const r of routes) {
      if (r.id) {
        await adminClient
          .from("provider_category_routes_global")
          .update({
            workflow: r.workflow,
            scope: r.scope,
            route_kind: r.route_kind,
            priority: r.priority,
            provider_connector_id: r.provider_connector_id,
            is_authoritative: r.is_authoritative ?? false,
            enabled: r.enabled,
          })
          .eq("id", r.id);
      } else {
        await adminClient
          .from("provider_category_routes_global")
          .insert({
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

    // Return effective routes
    const { data: effectiveRoutes } = await adminClient
      .from("provider_category_routes_global")
      .select("*, provider_connectors(id, name, key, is_enabled)")
      .order("workflow")
      .order("scope")
      .order("route_kind")
      .order("priority");

    // Audit
    await adminClient.from("atenia_ai_actions").insert({
      organization_id: "00000000-0000-0000-0000-000000000000",
      action_type: "GLOBAL_ROUTES_UPDATED",
      autonomy_tier: "USER",
      reasoning: `Platform admin updated ${routes.length} global route(s)`,
      target_entity_type: "provider_category_routes_global",
      evidence: {
        routes_count: routes.length,
        workflows: [...new Set(routes.map((r) => r.workflow))],
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
