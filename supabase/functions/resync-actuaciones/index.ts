/**
 * resync-actuaciones — Admin-only full CPNU resync for a work item.
 *
 * Re-fetches ALL actuaciones from CPNU (no date window, no pagination limits)
 * and upserts them using the strengthened dedupe key.
 * This repairs historical gaps without manual DB edits.
 *
 * Input: { work_item_id: string }
 * Requires: authenticated user must be member of the work item's org.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'No authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { work_item_id } = body;
    if (!work_item_id) {
      return new Response(JSON.stringify({ ok: false, error: 'work_item_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get work item
    const { data: workItem, error: wiError } = await supabase
      .from('work_items')
      .select('id, radicado, owner_id, organization_id, workflow_type, authority_name')
      .eq('id', work_item_id)
      .single();

    if (wiError || !workItem) {
      return new Response(JSON.stringify({ ok: false, error: 'Work item not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify membership
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', workItem.organization_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership && workItem.owner_id !== user.id) {
      return new Response(JSON.stringify({ ok: false, error: 'Not a member of this organization' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Call sync-by-work-item with force_refresh to bypass stale CPNU /snapshot cache
    const { data: syncResult, error: syncError } = await supabase.functions.invoke('sync-by-work-item', {
      body: { work_item_id, force_refresh: true },
      headers: {
        Authorization: authHeader,
        'X-Trace-Id': `resync-${work_item_id.slice(0, 8)}-${Date.now()}`,
      },
    });

    if (syncError) {
      console.error('[resync-actuaciones] sync error:', syncError);
      return new Response(JSON.stringify({
        ok: false,
        error: `Sync failed: ${syncError.message}`,
      }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Count current actuaciones after sync
    const { count } = await supabase
      .from('work_item_acts')
      .select('id', { count: 'exact', head: true })
      .eq('work_item_id', work_item_id)
      .eq('is_archived', false);

    const insertedCount = syncResult?.inserted_count || 0;
    // Backfill/resync should NOT trigger email notifications.
    // Historical items are not "new today" — only CRON-discovered fresh items should notify.
    const notificationResult = {
      dispatched: false,
      reason: insertedCount > 0
        ? 'backfill_no_notify: historical items inserted, no email sent'
        : 'no_new_items',
    };

    return new Response(JSON.stringify({
      ok: true,
      work_item_id,
      radicado: workItem.radicado,
      sync_result: syncResult,
      total_actuaciones_after: count,
      inserted_count: insertedCount,
      skipped_count: syncResult?.skipped_count || 0,
      notification: notificationResult,
      message: insertedCount > 0
        ? `Resync completado. ${insertedCount} nuevas actuaciones insertadas, ${syncResult?.skipped_count || 0} existentes. Total: ${count}. Notificaciones: ${notificationResult.dispatched ? 'enviadas' : 'no enviadas'}.`
        : `Resync completado. No se encontraron actuaciones nuevas. ${syncResult?.skipped_count || 0} existentes. Total: ${count}.`,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[resync-actuaciones] error:', err);
    return new Response(JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
