/**
 * provider-create-wizard-session — Create or validate a wizard session.
 *
 * Actions:
 *   create: Creates a new ACTIVE wizard session
 *   validate: Checks if a session is valid (ACTIVE + not expired)
 *   complete: Marks a session as COMPLETED
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session",
};

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
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { action, mode, organization_id, session_id } = body;

    if (action === "create") {
      if (!mode || !["PLATFORM", "ORG"].includes(mode)) {
        return new Response(
          JSON.stringify({ error: "mode must be PLATFORM or ORG" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Permission check
      if (mode === "PLATFORM") {
        const { data: admin } = await db
          .from("platform_admins")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!admin) {
          return new Response(
            JSON.stringify({ error: "Platform admin required" }),
            {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      } else {
        if (!organization_id) {
          return new Response(
            JSON.stringify({
              error: "organization_id required for ORG mode",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
        const { data: membership } = await db
          .from("organization_memberships")
          .select("role")
          .eq("user_id", user.id)
          .eq("organization_id", organization_id)
          .maybeSingle();
        if (
          !membership ||
          !["OWNER", "ADMIN"].includes(membership.role)
        ) {
          return new Response(
            JSON.stringify({ error: "Org admin required" }),
            {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }

      // Expire any existing ACTIVE sessions for this user
      await db
        .from("provider_wizard_sessions")
        .update({ status: "EXPIRED" })
        .eq("created_by", user.id)
        .eq("status", "ACTIVE");

      const { data: session, error: insertErr } = await db
        .from("provider_wizard_sessions")
        .insert({
          mode,
          organization_id: mode === "ORG" ? organization_id : null,
          created_by: user.id,
          status: "ACTIVE",
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single();

      if (insertErr) {
        return new Response(
          JSON.stringify({ error: insertErr.message }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({ ok: true, session }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (action === "validate") {
      if (!session_id) {
        return new Response(
          JSON.stringify({ error: "session_id required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { data: session } = await db
        .from("provider_wizard_sessions")
        .select("*")
        .eq("id", session_id)
        .single();

      if (!session) {
        return new Response(
          JSON.stringify({ valid: false, code: "NOT_FOUND" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const expired = new Date(session.expires_at) < new Date();
      const valid =
        session.status === "ACTIVE" &&
        !expired &&
        session.created_by === user.id;

      return new Response(
        JSON.stringify({ valid, session, code: !valid ? (expired ? "EXPIRED" : "INVALID") : undefined }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (action === "complete") {
      if (!session_id) {
        return new Response(
          JSON.stringify({ error: "session_id required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      await db
        .from("provider_wizard_sessions")
        .update({ status: "COMPLETED" })
        .eq("id", session_id)
        .eq("created_by", user.id);

      return new Response(
        JSON.stringify({ ok: true }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use: create, validate, complete" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
