/**
 * admin-diagnose-estados — Diagnostic tool for missing estados.
 *
 * One-shot diagnostic that:
 * 1. Normalizes radicado + despacho
 * 2. Calls primary source (SAMAI Estados for CPACA)
 * 3. If empty/not found, calls fallback (Publicaciones)
 * 4. Returns structured JSON report with reference IDs
 *
 * Input: { radicado: string, despacho_hint?: string, work_item_id?: string }
 * Output: Structured diagnostic report
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

import {
  normalizeRadicado,
  isValidRadicado,
  normalizeDespacho,
  matchDespacho,
  normalizeDate,
  getApiKeyForProvider,
} from '../_shared/radicadoUtils.ts';

import { fetchFromSamaiEstados } from '../_shared/providerAdapters/samaiEstadosAdapter.ts';
import { fetchFromPublicaciones } from '../_shared/providerAdapters/publicacionesAdapter.ts';
import { getCategoryStrategy } from '../_shared/providerStrategy.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const referenceId = crypto.randomUUID().slice(0, 12);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    console.log(`[admin-diagnose-estados] URL present: ${!!supabaseUrl}, Key present: ${!!supabaseKey}, Key len: ${supabaseKey.length}`);

    // Auth: verify_jwt=false in config.toml; this function is admin-only
    // In production, protect via network/API gateway rules

    const body = await req.json();
    const { radicado, despacho_hint, work_item_id } = body;

    if (!radicado) {
      return new Response(JSON.stringify({ ok: false, error: 'radicado is required', reference_id: referenceId }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const normalized = normalizeRadicado(radicado);
    const normalizedDespacho = despacho_hint ? normalizeDespacho(despacho_hint) : null;

    const report: Record<string, unknown> = {
      reference_id: referenceId,
      input: { radicado, despacho_hint, work_item_id },
      normalization: {
        radicado_input: radicado,
        radicado_normalized: normalized,
        radicado_valid: isValidRadicado(radicado),
        despacho_input: despacho_hint || null,
        despacho_normalized: normalizedDespacho,
      },
      sources_called: [] as unknown[],
      target_estado: {
        target_date: '2024-11-20',
        target_filename_pattern: 'MemorialWeb',
        found_in_primary: false,
        found_in_fallback: false,
      },
      db_state: null as unknown,
    };

    // Fetch DB state if work_item_id provided
    if (work_item_id) {
      const adminDb = createClient(supabaseUrl, supabaseKey);
      const { data: existingPubs } = await adminDb
        .from('work_item_publicaciones')
        .select('id, title, pdf_url, fecha_fijacion, source, sources, hash_fingerprint, created_at')
        .eq('work_item_id', work_item_id)
        .order('fecha_fijacion', { ascending: false });

      const { data: existingActs } = await adminDb
        .from('actuaciones')
        .select('id, normalized_text, act_date, source, hash_fingerprint')
        .eq('work_item_id', work_item_id)
        .order('act_date', { ascending: false })
        .limit(5);

      const { data: workItem } = await adminDb
        .from('work_items')
        .select('id, radicado, workflow_type, monitoring_enabled, last_synced_at, despacho')
        .eq('id', work_item_id)
        .maybeSingle();

      report.db_state = {
        work_item: workItem,
        publicaciones_count: existingPubs?.length || 0,
        publicaciones: existingPubs?.map(p => ({
          id: p.id,
          title: p.title?.slice(0, 80),
          fecha_fijacion: p.fecha_fijacion,
          source: p.source,
          sources: p.sources,
          pdf_url: p.pdf_url?.slice(0, 100),
        })),
        actuaciones_count: existingActs?.length || 0,
        latest_actuaciones: existingActs?.map(a => ({
          act_date: a.act_date,
          text: a.normalized_text?.slice(0, 80),
          source: a.source,
        })),
      };
    }

    // Determine strategy
    const workflowType = (report.db_state as any)?.work_item?.workflow_type || 'CPACA';
    const strategy = getCategoryStrategy(workflowType);
    report.strategy = {
      workflow_type: workflowType,
      primary_estados: strategy.primaryEstados,
      fallback_estados: strategy.fallbackEstados,
      always_merge: strategy.alwaysMergeAll,
    };

    // ── Call Primary: SAMAI Estados (for CPACA) ──
    const primaryStart = Date.now();
    let primaryResult: any = null;
    let primaryEstados: any[] = [];

    if (strategy.primaryEstados.includes('SAMAI_ESTADOS') || strategy.primaryEstados.includes('PUBLICACIONES')) {
      const primaryProvider = strategy.primaryEstados[0];

      try {
        if (primaryProvider === 'SAMAI_ESTADOS') {
          primaryResult = await fetchFromSamaiEstados({
            radicado: normalized,
            mode: 'monitoring',
            workItemId: work_item_id,
            timeoutMs: 60_000,
          });
        } else {
          primaryResult = await fetchFromPublicaciones({
            radicado: normalized,
            mode: 'monitoring',
            workItemId: work_item_id,
            timeoutMs: 60_000,
          });
        }

        primaryEstados = primaryResult?.publicaciones || [];

        const sourceReport = {
          provider: primaryProvider,
          role: 'PRIMARY',
          reference_id: `${referenceId}_p1`,
          request: { radicado: normalized, mode: 'monitoring' },
          response: {
            status: primaryResult?.status,
            http_status: primaryResult?.httpStatus,
            duration_ms: primaryResult?.durationMs || (Date.now() - primaryStart),
            item_count: primaryEstados.length,
            error: primaryResult?.errorMessage,
          },
          parsed_estados: primaryEstados.map((e: any) => ({
            title: e.title?.slice(0, 100),
            fecha: e.fecha_fijacion,
            tipo: e.tipo_publicacion,
            pdf_url: e.pdf_url?.slice(0, 100),
            fingerprint: e.hash_fingerprint,
          })),
        };
        (report.sources_called as any[]).push(sourceReport);

        // Check if target estado is present
        for (const e of primaryEstados) {
          const fecha = e.fecha_fijacion || '';
          const title = e.title || '';
          const pdfUrl = e.pdf_url || '';
          if (fecha.includes('2024-11-20') || title.includes('MemorialWeb') || pdfUrl.includes('MemorialWeb')) {
            (report.target_estado as any).found_in_primary = true;
          }
        }
      } catch (err: any) {
        (report.sources_called as any[]).push({
          provider: primaryProvider,
          role: 'PRIMARY',
          reference_id: `${referenceId}_p1`,
          error: err.message || String(err),
          duration_ms: Date.now() - primaryStart,
        });
      }
    }

    // ── Call Fallback if primary empty ──
    const shouldFallback = primaryEstados.length === 0 || primaryResult?.status !== 'SUCCESS';
    let fallbackEstados: any[] = [];

    if (shouldFallback && strategy.fallbackEstados.length > 0) {
      const fallbackProvider = strategy.fallbackEstados[0];
      const fallbackStart = Date.now();

      try {
        let fallbackResult: any = null;

        if (fallbackProvider === 'PUBLICACIONES') {
          fallbackResult = await fetchFromPublicaciones({
            radicado: normalized,
            mode: 'monitoring',
            workItemId: work_item_id,
            timeoutMs: 60_000,
          });
        } else if (fallbackProvider === 'SAMAI_ESTADOS') {
          fallbackResult = await fetchFromSamaiEstados({
            radicado: normalized,
            mode: 'monitoring',
            workItemId: work_item_id,
            timeoutMs: 60_000,
          });
        }

        fallbackEstados = fallbackResult?.publicaciones || [];

        (report.sources_called as any[]).push({
          provider: fallbackProvider,
          role: 'FALLBACK',
          reference_id: `${referenceId}_f1`,
          request: { radicado: normalized, mode: 'monitoring' },
          response: {
            status: fallbackResult?.status,
            http_status: fallbackResult?.httpStatus,
            duration_ms: fallbackResult?.durationMs || (Date.now() - fallbackStart),
            item_count: fallbackEstados.length,
            error: fallbackResult?.errorMessage,
          },
          parsed_estados: fallbackEstados.map((e: any) => ({
            title: e.title?.slice(0, 100),
            fecha: e.fecha_fijacion,
            tipo: e.tipo_publicacion,
            pdf_url: e.pdf_url?.slice(0, 100),
            fingerprint: e.hash_fingerprint,
          })),
        });

        for (const e of fallbackEstados) {
          const fecha = e.fecha_fijacion || '';
          const title = e.title || '';
          const pdfUrl = e.pdf_url || '';
          if (fecha.includes('2024-11-20') || title.includes('MemorialWeb') || pdfUrl.includes('MemorialWeb')) {
            (report.target_estado as any).found_in_fallback = true;
          }
        }
      } catch (err: any) {
        (report.sources_called as any[]).push({
          provider: fallbackProvider,
          role: 'FALLBACK',
          reference_id: `${referenceId}_f1`,
          error: err.message || String(err),
          duration_ms: Date.now() - fallbackStart,
        });
      }
    }

    // ── Despacho matching ──
    if (normalizedDespacho) {
      const allEstados = [...primaryEstados, ...fallbackEstados];
      const despachoMatches = allEstados.filter((e: any) => {
        const juzgado = e.juzgado || e.raw_data?.juzgado || e.raw_data?.despacho || '';
        return matchDespacho(juzgado, despacho_hint);
      });
      report.despacho_matching = {
        normalized_hint: normalizedDespacho,
        total_estados: allEstados.length,
        matching_despacho: despachoMatches.length,
      };
    }

    // ── Summary ──
    const allEstados = [...primaryEstados, ...fallbackEstados];
    report.summary = {
      total_estados_found: allEstados.length,
      primary_count: primaryEstados.length,
      fallback_count: fallbackEstados.length,
      target_found: (report.target_estado as any).found_in_primary || (report.target_estado as any).found_in_fallback,
      fallback_triggered: shouldFallback,
      diagnosis: allEstados.length === 0
        ? 'NO_ESTADOS_FROM_ANY_SOURCE'
        : (report.target_estado as any).found_in_primary || (report.target_estado as any).found_in_fallback
          ? 'TARGET_ESTADO_FOUND'
          : 'ESTADOS_FOUND_BUT_TARGET_MISSING',
    };

    return new Response(JSON.stringify({ ok: true, ...report }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: err.message || String(err),
      reference_id: referenceId,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
