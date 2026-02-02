/**
 * debug-tenant-snapshot
 * 
 * Platform Admin-only edge function that bypasses RLS to provide accurate
 * diagnostics about users, organizations, and work_items counts.
 * 
 * This is critical for debugging "0 work items" issues caused by:
 * - NULL organization_id on work_items
 * - RLS filtering hiding data
 * - Mismatched identity (wrong user_id)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TenantSnapshotRequest {
  org_id?: string;
  user_id?: string;
  email?: string;
}

interface WorkItemSample {
  id: string;
  title: string | null;
  radicado: string | null;
  workflow_type: string | null;
  status: string | null;
  owner_id: string;
  organization_id: string | null;
  created_at: string;
}

interface TenantSnapshot {
  resolved_user: {
    id: string;
    full_name: string | null;
    email: string | null;
    organization_id: string | null;
  } | null;
  user_memberships: Array<{
    organization_id: string;
    role: string;
    organization_name: string | null;
  }>;
  resolved_organization: {
    id: string;
    name: string;
    metadata: Record<string, unknown> | null;
  } | null;
  counts: {
    work_items_by_owner: number;
    work_items_by_org: number;
    orphaned_work_items: number;
    work_items_distinct_orgs: string[];
  };
  work_items_sample: WorkItemSample[];
  system_hints: string[];
  debug_info: {
    query_user_id: string | null;
    query_org_id: string | null;
    timestamp: string;
  };
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

    // Create user-scoped client for auth check
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verify JWT and get user
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const callerUserId = claimsData.claims.sub;

    // Create service role client for admin operations (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check if caller is platform admin
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

    // Parse request body
    const body: TenantSnapshotRequest = await req.json().catch(() => ({}));

    let targetUserId = body.user_id || null;
    let targetOrgId = body.org_id || null;

    // If email provided, resolve to user_id
    if (body.email && !targetUserId) {
      const { data: authUser } = await adminClient.auth.admin.listUsers();
      const foundUser = authUser?.users?.find(u => u.email?.toLowerCase() === body.email?.toLowerCase());
      if (foundUser) {
        targetUserId = foundUser.id;
      }
    }

    // Initialize response
    const snapshot: TenantSnapshot = {
      resolved_user: null,
      user_memberships: [],
      resolved_organization: null,
      counts: {
        work_items_by_owner: 0,
        work_items_by_org: 0,
        orphaned_work_items: 0,
        work_items_distinct_orgs: [],
      },
      work_items_sample: [],
      system_hints: [],
      debug_info: {
        query_user_id: targetUserId,
        query_org_id: targetOrgId,
        timestamp: new Date().toISOString(),
      },
    };

    // Resolve user profile if user_id provided
    if (targetUserId) {
      const { data: profile } = await adminClient
        .from('profiles')
        .select('id, full_name, organization_id')
        .eq('id', targetUserId)
        .maybeSingle();

      if (profile) {
        // Get email from auth.users
        const { data: authUsers } = await adminClient.auth.admin.listUsers();
        const authUser = authUsers?.users?.find(u => u.id === targetUserId);

        snapshot.resolved_user = {
          id: profile.id,
          full_name: profile.full_name,
          email: authUser?.email || null,
          organization_id: profile.organization_id,
        };

        // If no org_id specified, use profile's organization
        if (!targetOrgId && profile.organization_id) {
          targetOrgId = profile.organization_id;
        }
      }

      // Get user memberships
      const { data: memberships } = await adminClient
        .from('organization_memberships')
        .select(`
          organization_id,
          role,
          organizations!inner(name)
        `)
        .eq('user_id', targetUserId);

      if (memberships) {
        snapshot.user_memberships = memberships.map((m: any) => ({
          organization_id: m.organization_id,
          role: m.role,
          organization_name: m.organizations?.name || null,
        }));
      }

      // Count work_items by owner (bypassing RLS)
      const { count: ownerCount } = await adminClient
        .from('work_items')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', targetUserId)
        .is('deleted_at', null);

      snapshot.counts.work_items_by_owner = ownerCount || 0;

      // Count orphaned work_items (owner but no org)
      const { count: orphanedCount } = await adminClient
        .from('work_items')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', targetUserId)
        .is('organization_id', null)
        .is('deleted_at', null);

      snapshot.counts.orphaned_work_items = orphanedCount || 0;

      // Get distinct org_ids from user's work_items
      const { data: distinctOrgs } = await adminClient
        .from('work_items')
        .select('organization_id')
        .eq('owner_id', targetUserId)
        .is('deleted_at', null);

      if (distinctOrgs) {
        const uniqueOrgs = [...new Set(distinctOrgs.map(r => r.organization_id).filter(Boolean))];
        snapshot.counts.work_items_distinct_orgs = uniqueOrgs as string[];
      }

      // Get sample work_items for user
      const { data: sampleItems } = await adminClient
        .from('work_items')
        .select('id, title, radicado, workflow_type, status, owner_id, organization_id, created_at')
        .eq('owner_id', targetUserId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(20);

      if (sampleItems) {
        snapshot.work_items_sample = sampleItems;
      }
    }

    // Resolve organization
    if (targetOrgId) {
      const { data: org } = await adminClient
        .from('organizations')
        .select('id, name, metadata')
        .eq('id', targetOrgId)
        .maybeSingle();

      if (org) {
        snapshot.resolved_organization = {
          id: org.id,
          name: org.name,
          metadata: org.metadata as Record<string, unknown> | null,
        };
      }

      // Count work_items by organization
      const { count: orgCount } = await adminClient
        .from('work_items')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', targetOrgId)
        .is('deleted_at', null);

      snapshot.counts.work_items_by_org = orgCount || 0;

      // If no user specified, get sample by org
      if (!targetUserId) {
        const { data: orgSampleItems } = await adminClient
          .from('work_items')
          .select('id, title, radicado, workflow_type, status, owner_id, organization_id, created_at')
          .eq('organization_id', targetOrgId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(20);

        if (orgSampleItems) {
          snapshot.work_items_sample = orgSampleItems;
        }
      }
    }

    // Generate system hints
    const { counts } = snapshot;
    
    if (counts.work_items_by_owner > 0 && counts.work_items_by_org === 0 && counts.orphaned_work_items > 0) {
      snapshot.system_hints.push(
        `⚠️ Owner has ${counts.work_items_by_owner} work items but org-filter shows 0. ` +
        `${counts.orphaned_work_items} items have NULL organization_id. ` +
        `Run "Backfill organization_id" to fix.`
      );
    }

    if (counts.work_items_by_owner === 0 && targetUserId) {
      snapshot.system_hints.push(
        `⚠️ No work items found for this user_id. Verify correct identity selected.`
      );
    }

    if (snapshot.resolved_user?.organization_id && snapshot.user_memberships.length === 0) {
      snapshot.system_hints.push(
        `⚠️ Profile has organization_id but no organization_memberships record. Potential inconsistency.`
      );
    }

    if (counts.work_items_by_owner > 0 && counts.orphaned_work_items === counts.work_items_by_owner) {
      snapshot.system_hints.push(
        `🔴 ALL work items for this owner have NULL organization_id. Backfill is required.`
      );
    }

    if (snapshot.counts.work_items_distinct_orgs.length > 1) {
      snapshot.system_hints.push(
        `ℹ️ User's work items span ${snapshot.counts.work_items_distinct_orgs.length} different organizations.`
      );
    }

    return new Response(
      JSON.stringify(snapshot),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[debug-tenant-snapshot] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
