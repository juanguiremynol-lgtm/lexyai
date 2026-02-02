/**
 * admin-backfill-work-items-org
 * 
 * Platform Admin-only edge function that backfills NULL organization_id
 * on work_items using the owner's profile.organization_id.
 * 
 * This fixes the common issue where legacy/migrated work_items have
 * organization_id = NULL, causing them to be invisible to org-scoped queries.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BackfillRequest {
  user_id?: string;
  org_id?: string;
  dry_run?: boolean;
}

interface BackfillResult {
  ok: boolean;
  dry_run: boolean;
  target_user_id: string | null;
  target_org_id: string | null;
  rows_matched: number;
  rows_updated: number;
  sample_updated_ids: string[];
  error?: string;
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Validate authorization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verify JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const callerUserId = claimsData.claims.sub;

    // Create service role client
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check platform admin
    const { data: platformAdmin, error: adminError } = await adminClient
      .from('platform_admins')
      .select('user_id, role')
      .eq('user_id', callerUserId)
      .maybeSingle();

    if (adminError || !platformAdmin) {
      return new Response(
        JSON.stringify({ error: 'Platform admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request
    const body: BackfillRequest = await req.json().catch(() => ({}));
    const dryRun = body.dry_run ?? true; // Default to dry run for safety

    const result: BackfillResult = {
      ok: false,
      dry_run: dryRun,
      target_user_id: body.user_id || null,
      target_org_id: body.org_id || null,
      rows_matched: 0,
      rows_updated: 0,
      sample_updated_ids: [],
    };

    // Determine target org_id
    let targetOrgId = body.org_id;

    if (body.user_id && !targetOrgId) {
      // Get org_id from user's profile
      const { data: profile } = await adminClient
        .from('profiles')
        .select('organization_id')
        .eq('id', body.user_id)
        .maybeSingle();

      if (!profile?.organization_id) {
        result.error = 'User profile has no organization_id set. Cannot backfill.';
        return new Response(
          JSON.stringify(result),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      targetOrgId = profile.organization_id;
      result.target_org_id = targetOrgId ?? null;
    }

    if (!body.user_id && !targetOrgId) {
      result.error = 'Must provide either user_id or org_id';
      return new Response(
        JSON.stringify(result),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Count matching rows first
    let countQuery = adminClient
      .from('work_items')
      .select('*', { count: 'exact', head: true })
      .is('organization_id', null)
      .is('deleted_at', null);

    if (body.user_id) {
      countQuery = countQuery.eq('owner_id', body.user_id);
    }

    const { count: matchedCount, error: countError } = await countQuery;

    if (countError) {
      result.error = `Count query failed: ${countError.message}`;
      return new Response(
        JSON.stringify(result),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    result.rows_matched = matchedCount || 0;

    if (result.rows_matched === 0) {
      result.ok = true;
      result.error = 'No rows to backfill (no work_items with NULL organization_id found)';
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (dryRun) {
      // Just return what would be updated
      let sampleQuery = adminClient
        .from('work_items')
        .select('id')
        .is('organization_id', null)
        .is('deleted_at', null)
        .limit(10);

      if (body.user_id) {
        sampleQuery = sampleQuery.eq('owner_id', body.user_id);
      }

      const { data: sampleRows } = await sampleQuery;
      result.sample_updated_ids = sampleRows?.map(r => r.id) || [];
      result.ok = true;
      
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Perform the actual update
    let updateQuery = adminClient
      .from('work_items')
      .update({ organization_id: targetOrgId })
      .is('organization_id', null)
      .is('deleted_at', null);

    if (body.user_id) {
      updateQuery = updateQuery.eq('owner_id', body.user_id);
    }

    const { data: updatedRows, error: updateError } = await updateQuery.select('id');

    if (updateError) {
      result.error = `Update failed: ${updateError.message}`;
      return new Response(
        JSON.stringify(result),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    result.rows_updated = updatedRows?.length || 0;
    result.sample_updated_ids = updatedRows?.slice(0, 10).map(r => r.id) || [];
    result.ok = true;

    // Log audit event
    await adminClient.from('audit_logs').insert({
      organization_id: targetOrgId,
      actor_user_id: callerUserId,
      actor_type: 'USER',
      action: 'ADMIN_BACKFILL_WORK_ITEMS_ORG',
      entity_type: 'work_items',
      entity_id: body.user_id || targetOrgId,
      metadata: {
        target_user_id: body.user_id,
        target_org_id: targetOrgId,
        rows_updated: result.rows_updated,
      },
    });

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[admin-backfill-work-items-org] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
