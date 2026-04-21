/**
 * scheduled-publicaciones-monitor Edge Function
 * 
 * Daily automated check for new Publicaciones Procesales (Estados) across 
 * all monitored judicial work items.
 * 
 * Schedule: Daily at 06:00 America/Bogota (11:00 UTC)
 * 
 * Features:
 * - Scans CGP, LABORAL, CPACA, PENAL_906 workflows
 * - Only processes work items with monitoring_enabled=true and valid 23-digit radicado
 * - Calls sync-publicaciones-by-work-item for each item
 * - Creates aggregated PUBLICACIONES_NUEVAS alerts when new estados are detected
 * - Multi-tenant safe: processes by organization
 * - Idempotent: relies on sync-publicaciones fingerprint deduplication
 * - Non-fatal failures: one item failure doesn't stop the batch
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { createTraceContext, writeTraceRecord } from "../_shared/traceContext.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Workflows that support publicaciones monitoring
const PUBLICACIONES_WORKFLOWS = ['CGP', 'LABORAL', 'CPACA', 'PENAL_906'];

// Terminal stages that don't need monitoring
const TERMINAL_STAGES = [
  'ARCHIVADO',
  'FINALIZADO',
  'EJECUTORIADO',
  'PRECLUIDO_ARCHIVADO',
  'FINALIZADO_ABSUELTO',
  'FINALIZADO_CONDENADO'
];

// Rate limiting
const BATCH_SIZE = 10;
const DELAY_BETWEEN_ITEMS_MS = 2000; // 2 seconds between items to avoid API throttling
const MAX_CONCURRENT = 3;

interface WorkItemForSync {
  id: string;
  owner_id: string;
  organization_id: string;
  workflow_type: string;
  radicado: string;
  title: string | null;
}

interface SyncPublicacionesResult {
  ok: boolean;
  work_item_id: string;
  inserted_count: number;
  skipped_count: number;
  alerts_created: number;
  inserted?: Array<{
    id: string;
    title: string;
    pdf_url: string | null;
    entry_url: string | null;
    fecha_fijacion: string | null;
    fecha_desfijacion: string | null;
    tipo_publicacion: string | null;
    terminos_inician: string | null;
  }>;
  errors?: string[];
}

interface ItemResult {
  work_item_id: string;
  radicado: string;
  workflow_type: string;
  status: 'success' | 'failed' | 'skipped';
  inserted_count: number;
  error?: string;
  alert_created?: boolean;
}

function isValidRadicado(radicado: string | null): boolean {
  if (!radicado) return false;
  const normalized = radicado.replace(/\D/g, '');
  return normalized.length === 23;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const runId = crypto.randomUUID();
  console.log(`[scheduled-publicaciones-monitor] Starting run (run_id: ${runId})`);
  console.log(`[scheduled-publicaciones-monitor] Time: ${new Date().toISOString()}`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ============= QUERY MONITORED WORK ITEMS =============
    const { data: workItems, error: queryError } = await supabase
      .from('work_items')
      .select('id, owner_id, organization_id, workflow_type, radicado, title')
      .eq('monitoring_enabled', true)
      .in('workflow_type', PUBLICACIONES_WORKFLOWS)
      .not('stage', 'in', `(${TERMINAL_STAGES.join(',')})`)
      .not('radicado', 'is', null)
      .not('organization_id', 'is', null)
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .limit(100);

    if (queryError) {
      console.error('[scheduled-publicaciones-monitor] Query error:', queryError);
      throw queryError;
    }

    // Filter to valid radicados
    const eligibleItems = (workItems || []).filter((item): item is WorkItemForSync => 
      isValidRadicado(item.radicado)
    );

    console.log(`[scheduled-publicaciones-monitor] Found ${eligibleItems.length} eligible work items`);

    if (eligibleItems.length === 0) {
      console.log('[scheduled-publicaciones-monitor] No items to process');
      return new Response(
        JSON.stringify({
          ok: true,
          run_id: runId,
          message: 'No eligible work items found',
          items_processed: 0,
          items_with_new_estados: 0,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============= PROCESS ITEMS IN BATCHES =============
    const results: ItemResult[] = [];
    let itemsWithNewEstados = 0;
    let totalInserted = 0;
    let totalErrors = 0;

    // Process in batches with concurrency control
    for (let batchStart = 0; batchStart < eligibleItems.length; batchStart += BATCH_SIZE) {
      const batch = eligibleItems.slice(batchStart, batchStart + BATCH_SIZE);
      
      console.log(`[scheduled-publicaciones-monitor] Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}, items ${batchStart + 1}-${batchStart + batch.length}`);

      // Process batch with limited concurrency
      const batchPromises = batch.map(async (workItem, idx) => {
        // Stagger requests to avoid API throttling
        await new Promise(resolve => setTimeout(resolve, idx * (DELAY_BETWEEN_ITEMS_MS / MAX_CONCURRENT)));
        
        const itemResult: ItemResult = {
          work_item_id: workItem.id,
          radicado: workItem.radicado,
          workflow_type: workItem.workflow_type,
          status: 'skipped',
          inserted_count: 0,
        };

        try {
          console.log(`[scheduled-publicaciones-monitor] Syncing ${workItem.radicado} (${workItem.workflow_type})`);

          // Call sync-publicaciones-by-work-item
          // Note: We use service role auth, but the function requires user auth
          // We need to invoke it with a service role token approach
          const response = await fetch(`${supabaseUrl}/functions/v1/sync-publicaciones-by-work-item`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'apikey': supabaseAnonKey || '',
            },
            body: JSON.stringify({
              work_item_id: workItem.id,
              _scheduled: true, // Flag for scheduled job
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
          }

          const syncResult: SyncPublicacionesResult = await response.json();

          if (syncResult.ok && syncResult.inserted_count > 0) {
            itemResult.status = 'success';
            itemResult.inserted_count = syncResult.inserted_count;
            itemsWithNewEstados++;
            totalInserted += syncResult.inserted_count;

            // ============= CREATE AGGREGATED ALERT =============
            // Note: The sync function already creates per-item alerts, but we also
            // create an aggregated alert for the scheduled job for visibility
            try {
              const insertedTitles = (syncResult.inserted || [])
                .slice(0, 5)
                .map(p => `• ${p.title?.slice(0, 80) || 'Sin título'}`)
                .join('\n');
              
              const moreCount = (syncResult.inserted_count || 0) > 5 
                ? `\n+ ${syncResult.inserted_count - 5} más...` 
                : '';

              await supabase.from('alert_instances').insert({
                owner_id: workItem.owner_id,
                organization_id: workItem.organization_id,
                entity_id: workItem.id,
                entity_type: 'WORK_ITEM',
                severity: 'info',
                title: `${syncResult.inserted_count} Nuevas Publicaciones Procesales`,
                message: `Se detectaron ${syncResult.inserted_count} nuevas publicaciones para el radicado ${workItem.radicado}:\n${insertedTitles}${moreCount}`,
                status: 'PENDING',
                // NULL-GUARD FIX: explicit alert_type so dispatcher recognises it.
                // 'PUBLICACIONES_NUEVAS' is an aggregated, in-app-only signal
                // (no email dispatch) — per-item ESTADO_NUEVO alerts are
                // produced by the publicacion trigger.
                alert_type: 'PUBLICACIONES_NUEVAS',
                alert_source: 'scheduled-publicaciones-monitor',
                payload: {
                  alert_type: 'PUBLICACIONES_NUEVAS',
                  run_id: runId,
                  workflow_type: workItem.workflow_type,
                  radicado: workItem.radicado,
                  title: workItem.title,
                  inserted_count: syncResult.inserted_count,
                  inserted: syncResult.inserted || [],
                  source: 'scheduled-publicaciones-monitor',
                },
              });
              
              itemResult.alert_created = true;
              console.log(`[scheduled-publicaciones-monitor] Created aggregated alert for ${workItem.radicado}: ${syncResult.inserted_count} new`);
            } catch (alertErr) {
              console.warn(`[scheduled-publicaciones-monitor] Failed to create aggregated alert:`, alertErr);
              // Don't fail the item if alert creation fails
            }
          } else if (syncResult.ok) {
            itemResult.status = 'success';
            // No new items found, no alert needed
          } else {
            itemResult.status = 'failed';
            itemResult.error = syncResult.errors?.join(', ') || 'Unknown sync error';
            totalErrors++;
          }

        } catch (err) {
          console.error(`[scheduled-publicaciones-monitor] Error syncing ${workItem.radicado}:`, err);
          itemResult.status = 'failed';
          itemResult.error = err instanceof Error ? err.message : 'Unknown error';
          totalErrors++;
        }

        return itemResult;
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Check for timeout (50 seconds to allow cleanup)
      if (Date.now() - startTime > 50000) {
        console.log('[scheduled-publicaciones-monitor] Approaching timeout, stopping batch iteration');
        break;
      }
    }

    const durationMs = Date.now() - startTime;
    const successCount = results.filter(r => r.status === 'success').length;

    console.log(`[scheduled-publicaciones-monitor] Completed in ${durationMs}ms: ${successCount}/${results.length} successful, ${itemsWithNewEstados} with new estados, ${totalInserted} total inserted, ${totalErrors} errors`);

    // ============= LOG JOB RUN =============
    try {
      await supabase.from('job_runs').insert({
        job_name: 'scheduled-publicaciones-monitor',
        status: totalErrors === 0 ? 'OK' : 'PARTIAL',
        started_at: new Date(startTime).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        processed_count: results.length,
        metadata: {
          run_id: runId,
          items_processed: results.length,
          items_successful: successCount,
          items_with_new_estados: itemsWithNewEstados,
          total_inserted: totalInserted,
          total_errors: totalErrors,
          results_sample: results.slice(0, 20),
        },
      });
    } catch (logErr) {
      console.warn('[scheduled-publicaciones-monitor] Failed to log job run:', logErr);
    }

    // ============= TRACE RECORD =============
    try {
      const trace = createTraceContext("scheduled-publicaciones-monitor", "CRON", { cron_run_id: runId });
      const traceStatus = totalErrors === 0 ? "OK" as const : totalErrors < results.length ? "PARTIAL" as const : "ERROR" as const;
      await writeTraceRecord(supabase, trace, traceStatus, {
        work_items_scanned: results.length,
        provider_calls: {
          publicaciones: {
            count: results.length,
            inserted: totalInserted,
            skipped: successCount - itemsWithNewEstados,
            errors: totalErrors,
          },
        },
        errors: totalErrors > 0
          ? [{ code: "PUB_MONITOR_ERR", message: results.filter(r => r.error).slice(0, 3).map(r => r.error).join("; "), count: totalErrors }]
          : undefined,
      }, new Date(startTime));
    } catch (_traceErr) {
      console.warn('[scheduled-publicaciones-monitor] Trace write failed (non-blocking)');
    }

    return new Response(
      JSON.stringify({
        ok: true,
        run_id: runId,
        items_processed: results.length,
        items_successful: successCount,
        items_with_new_estados: itemsWithNewEstados,
        total_inserted: totalInserted,
        total_errors: totalErrors,
        duration_ms: durationMs,
        results: results.slice(0, 20),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[scheduled-publicaciones-monitor] Fatal error:', err);
    
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        run_id: runId,
        duration_ms: Date.now() - startTime,
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
