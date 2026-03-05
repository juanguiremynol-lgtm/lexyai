/**
 * cpnu-job-poller Edge Function
 *
 * Corre cada 3 minutos via pg_cron.
 * Busca work_items con scrape_status = 'IN_PROGRESS' y scrape_job_id no nulo,
 * llama /resultado/{jobId} en el Cloud Run, y si el job terminó guarda las actuaciones.
 *
 * Este patrón reemplaza el polling inline de sync-by-work-item que causaba
 * timeouts en la Edge Function (60s límite vs 90s polling).
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_ITEMS_PER_RUN = 10;
const JOB_TIMEOUT_MINUTES = 15; // Si un job lleva más de 15 min, lo marcamos FAILED

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log(`[cpnu-job-poller] Starting at ${new Date().toISOString()}`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const cpnuBaseUrl = Deno.env.get('CPNU_BASE_URL')!;
    const cpnuApiKey = Deno.env.get('CPNU_X_API_KEY') || Deno.env.get('EXTERNAL_X_API_KEY') || '';

    if (!cpnuBaseUrl) {
      throw new Error('CPNU_BASE_URL not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (cpnuApiKey) headers['x-api-key'] = cpnuApiKey;

    // ── Limpiar jobs expirados (más de 15 minutos en IN_PROGRESS) ──
    const timeoutCutoff = new Date(Date.now() - JOB_TIMEOUT_MINUTES * 60 * 1000).toISOString();
    const { data: expiredItems } = await supabase
      .from('work_items')
      .select('id, radicado, scrape_job_id')
      .eq('scrape_status', 'IN_PROGRESS')
      .eq('scrape_provider', 'cpnu')
      .not('scrape_job_id', 'is', null)
      .lt('last_scrape_initiated_at', timeoutCutoff);

    if (expiredItems && expiredItems.length > 0) {
      console.log(`[cpnu-job-poller] Found ${expiredItems.length} expired jobs, marking FAILED`);
      for (const item of expiredItems) {
        await supabase
          .from('work_items')
          .update({
            scrape_status: 'FAILED',
            last_error_code: 'JOB_TIMEOUT',
            last_error_at: new Date().toISOString(),
            last_checked_at: new Date().toISOString(),
          })
          .eq('id', item.id);
        console.log(`[cpnu-job-poller] Marked expired: ${item.radicado} (${item.scrape_job_id})`);
      }
    }

    // ── Buscar jobs IN_PROGRESS pendientes ──
    const { data: pendingItems, error: fetchError } = await supabase
      .from('work_items')
      .select('id, radicado, scrape_job_id, scrape_poll_url, owner_id, organization_id, workflow_type')
      .eq('scrape_status', 'IN_PROGRESS')
      .eq('scrape_provider', 'cpnu')
      .not('scrape_job_id', 'is', null)
      .gte('last_scrape_initiated_at', timeoutCutoff)
      .order('last_scrape_initiated_at', { ascending: true })
      .limit(MAX_ITEMS_PER_RUN);

    if (fetchError) throw fetchError;

    if (!pendingItems || pendingItems.length === 0) {
      console.log(`[cpnu-job-poller] No pending jobs. Done.`);
      return new Response(JSON.stringify({ ok: true, polled: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[cpnu-job-poller] Found ${pendingItems.length} pending jobs`);

    let polled = 0;
    let completed = 0;
    let stillPending = 0;
    let failed = 0;

    for (const item of pendingItems) {
      // Guard de tiempo: no exceder 50 segundos
      if (Date.now() - startTime > 50_000) {
        console.warn(`[cpnu-job-poller] Approaching timeout, stopping`);
        break;
      }

      const jobId = item.scrape_job_id;
      const pollUrl = item.scrape_poll_url
        ? (item.scrape_poll_url.startsWith('http')
            ? item.scrape_poll_url
            : `${cpnuBaseUrl}${item.scrape_poll_url}`)
        : `${cpnuBaseUrl}/resultado/${jobId}`;

      console.log(`[cpnu-job-poller] Polling job ${jobId} for radicado ${item.radicado}`);
      polled++;

      try {
        const response = await fetch(pollUrl, { method: 'GET', headers });

        if (!response.ok) {
          console.warn(`[cpnu-job-poller] HTTP ${response.status} for job ${jobId}`);
          stillPending++;
          continue;
        }

        const data = await response.json();
        const status = String(data.status || '').toLowerCase();

        console.log(`[cpnu-job-poller] Job ${jobId} status: ${status}`);

        // ── Job todavía procesando ──
        if (['queued', 'processing', 'running', 'pending', 'started'].includes(status)) {
          stillPending++;
          await supabase
            .from('work_items')
            .update({ last_checked_at: new Date().toISOString() })
            .eq('id', item.id);
          continue;
        }

        // ── Job fallido ──
        if (['failed', 'error', 'cancelled'].includes(status)) {
          console.warn(`[cpnu-job-poller] Job ${jobId} failed: ${data.error || 'unknown'}`);
          await supabase
            .from('work_items')
            .update({
              scrape_status: 'FAILED',
              last_error_code: 'SCRAPING_FAILED',
              last_error_at: new Date().toISOString(),
              last_checked_at: new Date().toISOString(),
            })
            .eq('id', item.id);
          failed++;
          continue;
        }

        // ── Job completado ──
        if (['done', 'completed', 'success', 'finished'].includes(status)) {
          console.log(`[cpnu-job-poller] Job ${jobId} completed! Processing actuaciones...`);

          // Extraer actuaciones del resultado
          const resultData = (data.result || data) as Record<string, unknown>;
          const nestedData = (resultData.data || {}) as Record<string, unknown>;
          const actuaciones = (
            resultData.actuaciones || nestedData.actuaciones || []
          ) as Record<string, unknown>[];

          const sujetos = (
            resultData.sujetos || nestedData.sujetos || []
          ) as Record<string, unknown>[];

          const resumenBusqueda = nestedData.resumenBusqueda as Record<string, unknown> | undefined;
          const despacho = String(
            resumenBusqueda?.despacho || nestedData.despacho || resultData.despacho || ''
          );

          console.log(`[cpnu-job-poller] Found ${actuaciones.length} actuaciones, ${sujetos.length} sujetos`);

          if (actuaciones.length === 0) {
            // Job completó pero sin datos — marcamos como vacío
            await supabase
              .from('work_items')
              .update({
                scrape_status: 'NOT_ATTEMPTED',
                last_error_code: 'PROVIDER_EMPTY_RESULT',
                last_checked_at: new Date().toISOString(),
                scrape_job_id: null,
                scrape_poll_url: null,
              })
              .eq('id', item.id);
            completed++;
            continue;
          }

          // ── Insertar actuaciones via sync-by-work-item ──
          // En lugar de duplicar la lógica de inserción, llamamos sync-by-work-item
          // con force_refresh=false y allow_buscar=false para que use el snapshot
          // que ya fue actualizado por el /buscar completado.
          try {
            const syncResp = await fetch(
              `${supabaseUrl}/functions/v1/sync-by-work-item`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${supabaseServiceKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  work_item_id: item.id,
                  force_refresh: false,
                  allow_buscar: false, // No volver a disparar buscar
                  _scheduled: true,
                }),
              }
            );

            const syncResult = await syncResp.json();
            console.log(`[cpnu-job-poller] sync-by-work-item result: ok=${syncResult.ok}, inserted=${syncResult.inserted_count}`);

            if (syncResult.ok || syncResult.inserted_count > 0) {
              // Limpiar el job_id ya procesado
              await supabase
                .from('work_items')
                .update({
                  scrape_job_id: null,
                  scrape_poll_url: null,
                })
                .eq('id', item.id);
              completed++;
            } else if (syncResult.scraping_initiated) {
              // El snapshot aún no está listo — dejar IN_PROGRESS para el próximo ciclo
              console.log(`[cpnu-job-poller] Snapshot not ready yet for ${item.radicado}, will retry`);
              stillPending++;
            } else {
              // Error en sync
              await supabase
                .from('work_items')
                .update({
                  scrape_status: 'FAILED',
                  last_error_code: syncResult.code || 'SYNC_FAILED',
                  last_error_at: new Date().toISOString(),
                  scrape_job_id: null,
                  scrape_poll_url: null,
                })
                .eq('id', item.id);
              failed++;
            }
          } catch (syncErr: any) {
            console.error(`[cpnu-job-poller] sync-by-work-item error:`, syncErr?.message);
            failed++;
          }
        }

      } catch (pollErr: any) {
        console.error(`[cpnu-job-poller] Poll error for job ${jobId}:`, pollErr?.message);
        stillPending++;
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`[cpnu-job-poller] Done in ${durationMs}ms: polled=${polled}, completed=${completed}, pending=${stillPending}, failed=${failed}`);

    return new Response(JSON.stringify({
      ok: true,
      polled,
      completed,
      still_pending: stillPending,
      failed,
      duration_ms: durationMs,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[cpnu-job-poller] Fatal error:', error);
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
