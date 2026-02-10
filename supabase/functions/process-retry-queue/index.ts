/**
 * process-retry-queue Edge Function
 * 
 * Runs every 2 minutes via pg_cron. Picks up due retry tasks from sync_retry_queue
 * and re-invokes the appropriate sync function.
 * 
 * Handles:
 * - ACT_SCRAPE_RETRY: Re-calls sync-by-work-item with force_refresh=true
 * - PUB_RETRY: Re-calls sync-publicaciones-by-work-item
 * 
 * On success: deletes the retry row.
 * On retryable failure: increments attempt, reschedules 30-60s out.
 * On max attempts exceeded: deletes row, creates critical alert.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_TASKS_PER_RUN = 5;

function jitterMs(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs + 1));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log(`[process-retry-queue] Starting at ${new Date().toISOString()}`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch due retry tasks
    const { data: tasks, error: fetchError } = await (supabase.from('sync_retry_queue') as any)
      .select('*')
      .lte('next_run_at', new Date().toISOString())
      .order('next_run_at', { ascending: true })
      .limit(MAX_TASKS_PER_RUN);

    if (fetchError) {
      console.error('[process-retry-queue] Fetch error:', fetchError);
      throw fetchError;
    }

    if (!tasks || tasks.length === 0) {
      console.log('[process-retry-queue] No due tasks. Done.');
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[process-retry-queue] Found ${tasks.length} due tasks`);

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let rescheduled = 0;
    let exhausted = 0;

    for (const task of tasks) {
      // Time guard: stop if we've been running >50s
      if (Date.now() - startTime > 50_000) {
        console.warn('[process-retry-queue] Approaching timeout, stopping');
        break;
      }

      console.log(`[process-retry-queue] Processing task ${task.id}: kind=${task.kind}, work_item=${task.work_item_id}, attempt=${task.attempt}/${task.max_attempts}`);
      processed++;

      try {
        let syncOk = false;

        if (task.kind === 'ACT_SCRAPE_RETRY') {
          // Re-invoke sync-by-work-item with force_refresh
          const { data: syncResult, error: syncError } = await supabase.functions.invoke(
            'sync-by-work-item',
            { body: { work_item_id: task.work_item_id, force_refresh: true, _scheduled: true } }
          );

          if (syncError) {
            console.error(`[process-retry-queue] sync-by-work-item invoke error:`, syncError);
          } else {
            syncOk = syncResult?.ok === true;
            const stillScraping = syncResult?.scraping_initiated === true;

            if (syncOk) {
              console.log(`[process-retry-queue] ✅ ACT retry succeeded for ${task.radicado}: inserted=${syncResult?.inserted_count}`);
            } else if (stillScraping) {
              console.log(`[process-retry-queue] ⏳ Scraping still in progress for ${task.radicado}`);
              // Treat as retryable
            } else {
              console.log(`[process-retry-queue] ❌ ACT retry failed for ${task.radicado}: ${syncResult?.code || syncResult?.message || 'unknown'}`);
            }
          }
        } else if (task.kind === 'PUB_RETRY') {
          // Re-invoke sync-publicaciones-by-work-item
          const { data: pubResult, error: pubError } = await supabase.functions.invoke(
            'sync-publicaciones-by-work-item',
            { body: { work_item_id: task.work_item_id, _scheduled: true } }
          );

          if (pubError) {
            console.error(`[process-retry-queue] sync-pub invoke error:`, pubError);
          } else {
            syncOk = pubResult?.ok === true;
            if (syncOk) {
              console.log(`[process-retry-queue] ✅ PUB retry succeeded for ${task.radicado}: inserted=${pubResult?.inserted_count}`);
            } else {
              console.log(`[process-retry-queue] ❌ PUB retry failed for ${task.radicado}: ${pubResult?.status || 'unknown'}`);
            }
          }
        }

        if (syncOk) {
          // Success — delete retry row and clear scrape status
          await (supabase.from('sync_retry_queue') as any)
            .delete()
            .eq('id', task.id);

          // Clear any PENDING_RETRY scrape status
          await supabase
            .from('work_items')
            .update({
              scrape_status: 'SUCCESS',
              last_synced_at: new Date().toISOString(),
            })
            .eq('id', task.work_item_id);

          succeeded++;
        } else if (task.attempt >= task.max_attempts) {
          // Exhausted — delete retry row, escalate alert
          console.warn(`[process-retry-queue] Max attempts (${task.max_attempts}) reached for ${task.radicado}`);

          await (supabase.from('sync_retry_queue') as any)
            .delete()
            .eq('id', task.id);

          // Mark work item as permanently failed
          await supabase
            .from('work_items')
            .update({
              scrape_status: 'FAILED',
              last_checked_at: new Date().toISOString(),
            })
            .eq('id', task.work_item_id);

          // Create critical alert if we have an org
          if (task.organization_id) {
            try {
              const { data: membership } = await supabase
                .from('organization_memberships')
                .select('user_id')
                .eq('organization_id', task.organization_id)
                .eq('role', 'admin')
                .limit(1)
                .maybeSingle();

              if (membership?.user_id) {
                await supabase.from('alert_instances').insert({
                  owner_id: membership.user_id,
                  organization_id: task.organization_id,
                  entity_type: 'WORK_ITEM',
                  entity_id: task.work_item_id,
                  severity: 'WARNING',
                  status: 'PENDING',
                  title: `Sincronización fallida tras ${task.max_attempts} reintentos`,
                  message: `El radicado ${task.radicado} no pudo sincronizarse después de ${task.max_attempts} intentos. Último error: ${task.last_error_code || 'SCRAPING_TIMEOUT'}. Revise el estado del expediente.`,
                  fingerprint: `retry_exhausted_${task.work_item_id}_${new Date().toISOString().slice(0, 10)}`,
                  payload: {
                    kind: task.kind,
                    provider: task.provider,
                    last_error_code: task.last_error_code,
                    last_error_message: task.last_error_message,
                    attempts: task.attempt,
                  },
                });
              }
            } catch (alertErr) {
              console.warn('[process-retry-queue] Alert creation failed:', alertErr);
            }
          }

          exhausted++;
        } else {
          // Reschedule with jitter
          const nextDelay = jitterMs(30_000, 60_000);
          const nextRunAt = new Date(Date.now() + nextDelay).toISOString();

          await (supabase.from('sync_retry_queue') as any)
            .update({
              attempt: task.attempt + 1,
              next_run_at: nextRunAt,
              last_error_code: 'SCRAPING_TIMEOUT',
              last_error_message: `Attempt ${task.attempt} failed, rescheduled`,
            })
            .eq('id', task.id);

          rescheduled++;
        }
      } catch (taskErr: any) {
        console.error(`[process-retry-queue] Task ${task.id} processing error:`, taskErr);
        failed++;

        // Reschedule on unexpected error (if attempts remain)
        if (task.attempt < task.max_attempts) {
          try {
            await (supabase.from('sync_retry_queue') as any)
              .update({
                attempt: task.attempt + 1,
                next_run_at: new Date(Date.now() + jitterMs(30_000, 60_000)).toISOString(),
                last_error_code: 'INVOCATION_FAILED',
                last_error_message: taskErr?.message || 'Unknown error',
              })
              .eq('id', task.id);
          } catch {
            // Best effort
          }
        }
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`[process-retry-queue] Done in ${durationMs}ms: processed=${processed}, succeeded=${succeeded}, rescheduled=${rescheduled}, exhausted=${exhausted}, failed=${failed}`);

    return new Response(JSON.stringify({
      ok: true,
      processed,
      succeeded,
      rescheduled,
      exhausted,
      failed,
      duration_ms: durationMs,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[process-retry-queue] Fatal error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error.message || String(error),
      duration_ms: Date.now() - startTime,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
