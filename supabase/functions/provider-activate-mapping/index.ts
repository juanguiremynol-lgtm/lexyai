/**
 * provider-activate-mapping — Promotes a DRAFT mapping spec to ACTIVE.
 *
 * Authorization:
 *   GLOBAL specs: platform admin only
 *   ORG_PRIVATE specs: org admin of that org only
 *
 * Behavior:
 *   1. Validates the spec exists and is DRAFT
 *   2. Archives any currently ACTIVE spec for same connector+scope+visibility(+org)
 *   3. Sets target spec to ACTIVE with approved_by/approved_at
 *   4. Writes audit log
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireWizardSession, isWizardError } from "../_shared/requireWizardSession.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Wizard session gate
    const wizardResult = await requireWizardSession(req, user.id, corsHeaders, {
      allowPlatformAdminOverride: true,
    });
    if (isWizardError(wizardResult)) return wizardResult;

    const body = await req.json();
    const { mapping_spec_id, mode } = body;

    if (!mapping_spec_id) {
      return new Response(JSON.stringify({ error: "mapping_spec_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(supabaseUrl, serviceKey);

    // Load the spec
    const { data: spec, error: specErr } = await db
      .from("provider_mapping_specs")
      .select("*")
      .eq("id", mapping_spec_id)
      .single();

    if (specErr || !spec) {
      return new Response(JSON.stringify({ error: "Mapping spec not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (spec.status !== "DRAFT") {
      return new Response(JSON.stringify({ error: `Cannot activate spec with status '${spec.status}'. Only DRAFT specs can be activated.` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization check
    if (spec.visibility === "GLOBAL") {
      // Platform admin required
      const { data: adminRow } = await db
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!adminRow) {
        return new Response(JSON.stringify({ error: "Platform admin required for GLOBAL specs" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (spec.visibility === "ORG_PRIVATE") {
      if (!spec.organization_id) {
        return new Response(JSON.stringify({ error: "ORG_PRIVATE spec missing organization_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Org admin required
      const { data: membership } = await db
        .from("organization_memberships")
        .select("role")
        .eq("organization_id", spec.organization_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
        return new Response(JSON.stringify({ error: "Org admin required for ORG_PRIVATE specs" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Archive any currently ACTIVE spec for same connector+scope+visibility(+org)
    const archiveQuery = db
      .from("provider_mapping_specs")
      .update({ status: "ARCHIVED", updated_at: new Date().toISOString() })
      .eq("provider_connector_id", spec.provider_connector_id)
      .eq("scope", spec.scope)
      .eq("visibility", spec.visibility)
      .eq("status", "ACTIVE");

    if (spec.visibility === "ORG_PRIVATE" && spec.organization_id) {
      archiveQuery.eq("organization_id", spec.organization_id);
    }
    await archiveQuery;

    // Activate the target spec
    const { error: activateErr } = await db
      .from("provider_mapping_specs")
      .update({
        status: "ACTIVE",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", mapping_spec_id);

    if (activateErr) {
      return new Response(JSON.stringify({ error: `Activation failed: ${activateErr.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Audit log
    if (spec.organization_id) {
      await db.from("audit_logs").insert({
        organization_id: spec.organization_id,
        actor_user_id: user.id,
        actor_type: "USER",
        action: "MAPPING_SPEC_ACTIVATED",
        entity_type: "provider_mapping_specs",
        entity_id: mapping_spec_id,
        metadata: {
          visibility: spec.visibility,
          connector_id: spec.provider_connector_id,
          scope: spec.scope,
          schema_version: spec.schema_version,
        },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      mapping_spec_id,
      status: "ACTIVE",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
