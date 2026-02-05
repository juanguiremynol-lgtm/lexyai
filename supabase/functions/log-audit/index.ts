/**
 * Edge Function: log-audit
 * 
 * Handles secure audit logging via service role.
 * This ensures audit logs can only be written through authenticated edge functions,
 * preventing direct client-side manipulation of the audit trail.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface AuditLogRequest {
  organizationId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  actorType?: "USER" | "SYSTEM";
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Auth client to verify user
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Service role client for audit log insertion
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user is authenticated
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      console.error('[log-audit] Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Invalid authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: AuditLogRequest = await req.json();
    const {
      organizationId,
      action,
      entityType,
      entityId,
      metadata = {},
      actorType = "USER",
    } = body;

    // Validate required fields
    if (!organizationId || !action || !entityType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: organizationId, action, entityType' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user has access to the organization
    const { data: membership, error: memberError } = await authClient
      .from('organization_memberships')
      .select('id, role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle();

    // Also check if user is platform admin
    const { data: platformAdmin } = await authClient
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership && !platformAdmin) {
      console.warn('[log-audit] User not authorized for org:', { userId: user.id, organizationId });
      return new Response(
        JSON.stringify({ error: 'Not authorized for this organization' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert audit log using service role
    const { error: insertError } = await serviceClient.from('audit_logs').insert({
      organization_id: organizationId,
      actor_user_id: user.id,
      actor_type: actorType,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
        source: 'edge_function',
        membership_role: membership?.role || (platformAdmin ? 'platform_admin' : null),
      },
    });

    if (insertError) {
      console.error('[log-audit] Insert error:', insertError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to log audit event', details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[log-audit] Success:', { action, entityType, entityId, organizationId });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[log-audit] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
