/**
 * requireWizardSession.ts — Centralized wizard-session gate for provider mutators.
 *
 * Every provider configuration mutator (create connector, create instance,
 * set routes, set policy, rotate secret, infer mapping, activate mapping)
 * must call this guard before performing writes.
 *
 * Returns the validated session or throws a structured error response.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

export interface WizardSessionOptions {
  /** Required wizard mode for this operation */
  mode?: "PLATFORM" | "ORG" | null;
  /** Required org_id (for ORG operations) */
  orgId?: string | null;
  /** Allow platform admins to bypass mode checks */
  allowPlatformAdminOverride?: boolean;
}

export interface WizardSessionResult {
  sessionId: string;
  session: {
    id: string;
    mode: string;
    organization_id: string | null;
    created_by: string;
    status: string;
    expires_at: string;
  };
}

/**
 * Validate the x-atenia-wizard-session header from a request.
 * Returns the validated session or a Response to return immediately.
 */
export async function requireWizardSession(
  req: Request,
  userId: string,
  corsHeaders: Record<string, string>,
  options: WizardSessionOptions = {},
): Promise<WizardSessionResult | Response> {
  const sessionId = req.headers.get("x-atenia-wizard-session");

  if (!sessionId) {
    return new Response(
      JSON.stringify({
        error: "Wizard session required. Use the External Provider Wizard to configure providers.",
        code: "WIZARD_REQUIRED",
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceKey);

  const { data: session, error } = await db
    .from("provider_wizard_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (error || !session) {
    return new Response(
      JSON.stringify({ error: "Wizard session not found", code: "WIZARD_SESSION_INVALID" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Check status
  if (session.status !== "ACTIVE") {
    return new Response(
      JSON.stringify({
        error: `Wizard session is ${session.status}. Start a new wizard session.`,
        code: "WIZARD_SESSION_INVALID",
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Check expiry
  if (new Date(session.expires_at) < new Date()) {
    // Auto-expire
    await db.from("provider_wizard_sessions").update({ status: "EXPIRED" }).eq("id", sessionId);
    return new Response(
      JSON.stringify({ error: "Wizard session expired", code: "WIZARD_SESSION_INVALID" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Check ownership
  if (session.created_by !== userId) {
    // Allow platform admin override if configured
    if (options.allowPlatformAdminOverride) {
      const { data: admin } = await db
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!admin) {
        return new Response(
          JSON.stringify({ error: "Session belongs to another user", code: "WIZARD_SESSION_INVALID" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      return new Response(
        JSON.stringify({ error: "Session belongs to another user", code: "WIZARD_SESSION_INVALID" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // Check mode compatibility
  if (options.mode) {
    if (options.mode === "PLATFORM" && session.mode !== "PLATFORM") {
      return new Response(
        JSON.stringify({
          error: "This operation requires a PLATFORM wizard session",
          code: "WIZARD_SESSION_INVALID",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (options.mode === "ORG" && session.mode !== "ORG") {
      return new Response(
        JSON.stringify({
          error: "This operation requires an ORG wizard session",
          code: "WIZARD_SESSION_INVALID",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // Check org scope for ORG sessions
  if (session.mode === "ORG" && options.orgId && session.organization_id !== options.orgId) {
    return new Response(
      JSON.stringify({
        error: "Wizard session org_id does not match the target organization",
        code: "WIZARD_SESSION_INVALID",
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // PLATFORM session cannot mutate ORG_PRIVATE resources
  if (session.mode === "PLATFORM" && options.mode === "ORG") {
    return new Response(
      JSON.stringify({
        error: "PLATFORM session cannot mutate ORG_PRIVATE resources",
        code: "WIZARD_SESSION_INVALID",
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return { sessionId, session };
}

/**
 * Type guard to check if the result is a Response (error) or a valid session.
 */
export function isWizardError(result: WizardSessionResult | Response): result is Response {
  return result instanceof Response;
}
