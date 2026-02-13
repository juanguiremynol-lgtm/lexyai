/**
 * Atenia AI Autonomous Sync Decision Engine (Hardened)
 *
 * Adds:
 * - COT date/window helpers via Intl.DateTimeFormat (proper timezone)
 * - Provider health circuit breaker (based on sync_traces)
 * - Autonomy pause/config gating (atenia_ai_config)
 * - Still only calls existing edge functions; does not modify them
 */

import { supabase } from '@/integrations/supabase/client';
import { callGeminiViaEdge } from './atenia-ai-engine';

const COT_TZ = 'America/Bogota';

// ---------- Time helpers (COT) ----------
export const getCotDateKey = (d = new Date()): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: COT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
};

const getCotMinutes = (d = new Date()): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: COT_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const hh = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  const mm = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  return hh * 60 + mm;
};

export const isWithinDailyCronWindowCOT = (d = new Date()): boolean => {
  const mins = getCotMinutes(d);
  return mins >= (6 * 60 + 50) && mins <= (7 * 60 + 30);
};

// ---------- Config gating ----------
interface AteniaAiConfig {
  autonomy_enabled: boolean;
  paused_until: string | null;
  auto_sync_cooldown_minutes: number;
  last_auto_sync_at: string | null;
}

const getAteniaAiConfig = async (organizationId: string): Promise<AteniaAiConfig> => {
  const { data } = await (supabase
    .from('atenia_ai_config') as any)
    .select('autonomy_paused, paused_until, auto_sync_cooldown_minutes, last_auto_sync_at')
    .eq('organization_id', organizationId)
    .maybeSingle();

  return {
    // Map autonomy_paused (boolean) to autonomy_enabled (inverted)
    autonomy_enabled: data ? !data.autonomy_paused : true,
    paused_until: data?.paused_until ?? null,
    auto_sync_cooldown_minutes: data?.auto_sync_cooldown_minutes ?? 30,
    last_auto_sync_at: data?.last_auto_sync_at ?? null,
  };
};

export const isAutonomyPaused = (cfg: AteniaAiConfig, now = new Date()): boolean => {
  if (!cfg.autonomy_enabled) return true;
  if (!cfg.paused_until) return false;
  return new Date(cfg.paused_until) > now;
};

const isInCooldown = (cfg: AteniaAiConfig, now = new Date()): boolean => {
  if (!cfg.last_auto_sync_at) return false;
  const last = new Date(cfg.last_auto_sync_at).getTime();
  const mins = cfg.auto_sync_cooldown_minutes ?? 30;
  return (now.getTime() - last) < mins * 60 * 1000;
};

// ---------- Provider health (light circuit breaker) ----------
type Provider = 'CPNU' | 'SAMAI' | 'UNKNOWN';

export interface ProviderHealth {
  provider: Provider;
  sample_size: number;
  error_rate: number;
  avg_latency_ms: number;
  severe: boolean;
  summary: string;
}

export const getRecentProviderHealth = async (
  organizationId: string,
  lookbackMinutes = 45,
  maxRows = 400,
): Promise<ProviderHealth[]> => {
  const since = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();

  const { data: traces } = await (supabase
    .from('sync_traces') as any)
    .select('provider, success, latency_ms, created_at')
    .eq('organization_id', organizationId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(maxRows);

  const rows = traces || [];
  const buckets: Record<string, Array<{ success: boolean; latency_ms: number | null }>> = {};

  for (const t of rows) {
    const p = (t.provider || 'UNKNOWN').toUpperCase();
    const provider: Provider = (p === 'CPNU' || p === 'SAMAI') ? (p as Provider) : 'UNKNOWN';
    buckets[provider] = buckets[provider] || [];
    buckets[provider].push({ success: !!t.success, latency_ms: t.latency_ms ?? null });
  }

  const out: ProviderHealth[] = [];
  for (const provider of Object.keys(buckets) as Provider[]) {
    const b = buckets[provider];
    const sample = b.length;
    const errors = b.filter(x => !x.success).length;
    const errorRate = sample > 0 ? errors / sample : 0;

    const latencies = b.map(x => x.latency_ms).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, c) => a + c, 0) / latencies.length) : 0;

    const severe = (sample >= 20 && errorRate >= 0.5) || (sample >= 20 && avgLatency >= 8000);

    out.push({
      provider,
      sample_size: sample,
      error_rate: Number(errorRate.toFixed(2)),
      avg_latency_ms: avgLatency,
      severe,
      summary: `${provider}: n=${sample}, err=${Math.round(errorRate * 100)}%, avg=${avgLatency}ms`,
    });
  }

  return out;
};

// ============================================================
// DECISION: Should Atenia AI trigger a sync?
// ============================================================

export interface SyncDecision {
  should_sync: boolean;
  reason: string;
  target_items: string[];
  trigger: 'post_cron_check' | 'error_recovery' | 'user_report' | 'health_check' | 'scheduled_audit';
  urgency: 'low' | 'medium' | 'high' | 'critical';
  evidence?: Record<string, any>;
}

/**
 * TIER: OBSERVE → SUGGEST → ACT
 * Runs after the daily cron to check what it missed.
 */
export const evaluatePostCronHealth = async (organizationId: string): Promise<SyncDecision> => {
  const cfg = await getAteniaAiConfig(organizationId);
  const today = getCotDateKey(new Date());

  const { data: ledger } = await supabase
    .from('auto_sync_daily_ledger')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('run_date', today)
    .maybeSingle();

  if (!ledger) {
    return {
      should_sync: true,
      reason: 'El cron diario no se ejecutó hoy. Se necesita sincronización correctiva.',
      target_items: [],
      trigger: 'post_cron_check',
      urgency: 'high',
      evidence: { ledger_found: false, run_date: today, autonomy_paused: isAutonomyPaused(cfg) },
    };
  }

  if (ledger.status === 'FAILED') {
    return {
      should_sync: true,
      reason: `El cron diario falló: ${ledger.last_error || 'sin detalle'}. Se necesita re-intento.`,
      target_items: [],
      trigger: 'post_cron_check',
      urgency: 'high',
      evidence: { ledger_status: ledger.status, last_error: ledger.last_error, run_date: today, autonomy_paused: isAutonomyPaused(cfg) },
    };
  }

  if (ledger.status === 'PARTIAL') {
    const { data: allEligible } = await (supabase
      .from('work_items') as any)
      .select('id, radicado, last_synced_at')
      .eq('organization_id', organizationId)
      .eq('monitoring_enabled', true)
      .is('deleted_at', null)
      .not('radicado', 'is', null);

    const missedItems = (allEligible || []).filter((item: any) => {
      if (!item.last_synced_at) return true;
      const lastKey = getCotDateKey(new Date(item.last_synced_at));
      return lastKey !== today;
    });

    if (missedItems.length > 0) {
      return {
        should_sync: true,
        reason: `El cron fue parcial (${ledger.items_succeeded}/${ledger.items_targeted}). ${missedItems.length} asuntos no fueron sincronizados.`,
        target_items: missedItems.map((i: any) => i.id),
        trigger: 'post_cron_check',
        urgency: 'medium',
        evidence: { ledger_status: ledger.status, missed: missedItems.length, run_date: today, autonomy_paused: isAutonomyPaused(cfg) },
      };
    }
  }

  return {
    should_sync: false,
    reason: 'El cron diario se ejecutó correctamente.',
    target_items: [],
    trigger: 'post_cron_check',
    urgency: 'low',
    evidence: { ledger_status: ledger.status, run_date: today },
  };
};

/**
 * TIER: OBSERVE → ACT
 * Checks for items that have been failing repeatedly.
 */
export const evaluateFailedItems = async (organizationId: string): Promise<SyncDecision> => {
  const { data: failedItems } = await (supabase
    .from('work_items') as any)
    .select('id, radicado, workflow_type, consecutive_404_count, scrape_status, last_synced_at, last_crawled_at')
    .eq('organization_id', organizationId)
    .eq('monitoring_enabled', true)
    .is('deleted_at', null)
    .eq('scrape_status', 'FAILED')
    .lt('consecutive_404_count', 5)
    .not('radicado', 'is', null);

  if (!failedItems || failedItems.length === 0) {
    return {
      should_sync: false,
      reason: 'No hay asuntos fallidos elegibles para re-intento.',
      target_items: [],
      trigger: 'error_recovery',
      urgency: 'low',
    };
  }

  const retryable = failedItems.filter((item: any) => (item.consecutive_404_count || 0) <= 2);

  if (retryable.length === 0) {
    return {
      should_sync: false,
      reason: `${failedItems.length} asuntos fallidos, pero todos tienen múltiples 404s. No se reintenta.`,
      target_items: [],
      trigger: 'error_recovery',
      urgency: 'low',
      evidence: { failed_total: failedItems.length },
    };
  }

  return {
    should_sync: true,
    reason: `${retryable.length} asuntos fallidos son elegibles para re-intento (errores transitorios, no 404 permanente).`,
    target_items: retryable.map((i: any) => i.id),
    trigger: 'error_recovery',
    urgency: 'medium',
    evidence: { retryable: retryable.length, failed_total: failedItems.length },
  };
};

// ============================================================
// EXECUTION: Trigger targeted sync via Master Sync infrastructure
// ============================================================

export const executeTargetedSync = async (
  organizationId: string,
  decision: SyncDecision,
  onProgress?: (completed: number, total: number) => void,
): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{ work_item_id: string; radicado: string; ok: boolean; error?: string }>;
}> => {
  const cfg = await getAteniaAiConfig(organizationId);

  // Safety guardrails
  if (isWithinDailyCronWindowCOT(new Date())) {
    await (supabase.from('atenia_ai_actions') as any).insert({
      organization_id: organizationId,
      action_type: 'auto_sync_skipped',
      autonomy_tier: 'OBSERVE',
      target_entity_type: 'organization',
      target_entity_id: null,
      reasoning: 'Se omite auto-sync: ventana del cron diario activa (6:50–7:30 AM COT).',
      evidence: { trigger: decision.trigger, urgency: decision.urgency },
      action_taken: null,
      action_result: 'skipped',
    });
    return { total: 0, succeeded: 0, failed: 0, results: [] };
  }

  if (isAutonomyPaused(cfg)) {
    await (supabase.from('atenia_ai_actions') as any).insert({
      organization_id: organizationId,
      action_type: 'auto_sync_skipped',
      autonomy_tier: 'OBSERVE',
      target_entity_type: 'organization',
      target_entity_id: null,
      reasoning: 'Se omite auto-sync: autonomía pausada por configuración.',
      evidence: { trigger: decision.trigger, urgency: decision.urgency, paused_until: cfg.paused_until },
      action_result: 'skipped',
    });
    return { total: 0, succeeded: 0, failed: 0, results: [] };
  }

  if (isInCooldown(cfg)) {
    await (supabase.from('atenia_ai_actions') as any).insert({
      organization_id: organizationId,
      action_type: 'auto_sync_skipped',
      autonomy_tier: 'OBSERVE',
      target_entity_type: 'organization',
      target_entity_id: null,
      reasoning: 'Se omite auto-sync: cooldown activo para evitar reintentos excesivos.',
      evidence: { trigger: decision.trigger, cooldown_minutes: cfg.auto_sync_cooldown_minutes, last_auto_sync_at: cfg.last_auto_sync_at },
      action_result: 'skipped',
    });
    return { total: 0, succeeded: 0, failed: 0, results: [] };
  }

  // Circuit breaker (provider health)
  const providerHealth = await getRecentProviderHealth(organizationId, 45, 400);
  const severe = providerHealth.some(p => p.severe);

  if (severe) {
    await (supabase.from('atenia_ai_actions') as any).insert({
      organization_id: organizationId,
      action_type: 'auto_sync_skipped',
      autonomy_tier: 'OBSERVE',
      target_entity_type: 'organization',
      target_entity_id: null,
      reasoning: 'Se omite auto-sync: degradación severa de proveedor detectada (circuit breaker).',
      evidence: { trigger: decision.trigger, provider_health: providerHealth.map(p => ({ ...p })) },
      action_result: 'skipped',
    });
    return { total: 0, succeeded: 0, failed: 0, results: [] };
  }

  // Load target items
  let query = (supabase
    .from('work_items') as any)
    .select('id, radicado, workflow_type, total_actuaciones, last_synced_at')
    .eq('organization_id', organizationId)
    .eq('monitoring_enabled', true)
    .is('deleted_at', null)
    .not('radicado', 'is', null);

  if (decision.target_items.length > 0) {
    query = query.in('id', decision.target_items);
  }

  const { data: items } = await query.order('last_synced_at', { ascending: true, nullsFirst: true });

  if (!items || items.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, results: [] };
  }

  // Log the action BEFORE executing
  await (supabase.from('atenia_ai_actions') as any).insert({
    organization_id: organizationId,
    action_type: 'auto_sync_triggered',
    autonomy_tier: 'ACT',
    target_entity_type: 'organization',
    target_entity_id: null,
    reasoning: decision.reason,
    evidence: {
      trigger: decision.trigger,
      urgency: decision.urgency,
      target_count: items.length,
      target_ids: decision.target_items.slice(0, 20),
      provider_health: providerHealth.map(p => ({ provider: p.provider, sample_size: p.sample_size, error_rate: p.error_rate, avg_latency_ms: p.avg_latency_ms })),
      extra: decision.evidence || null,
    },
    action_taken: `Sincronización correctiva de ${items.length} asuntos`,
    action_result: 'applied',
  });

  // Persist last_auto_sync_at (cooldown anchor)
  await (supabase
    .from('atenia_ai_config') as any)
    .upsert({ organization_id: organizationId, last_auto_sync_at: new Date().toISOString() }, { onConflict: 'organization_id' });

  const BATCH_SIZE = 3;
  const results: Array<{ work_item_id: string; radicado: string; ok: boolean; error?: string }> = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      batch.map(async (item: any) => {
        try {
          const actResult = await supabase.functions.invoke('sync-by-work-item', {
            body: { work_item_id: item.id },
          });

          const actOk = actResult.data?.ok === true;

          if ((item.total_actuaciones || 0) >= 100) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }

          const pubResult = await supabase.functions.invoke('sync-publicaciones-by-work-item', {
            body: { work_item_id: item.id },
          });

          const ok = actOk;
          if (ok) succeeded++; else failed++;

          results.push({
            work_item_id: item.id,
            radicado: item.radicado,
            ok,
            error: ok ? undefined : (actResult.data?.message || actResult.error?.message),
          });

          if (pubResult.error) {
            await (supabase.from('atenia_ai_actions') as any).insert({
              organization_id: organizationId,
              action_type: 'auto_sync_note',
              autonomy_tier: 'OBSERVE',
              target_entity_type: 'work_item',
              target_entity_id: item.id,
              reasoning: `Publicaciones fallaron (no fatal) para ${item.radicado}: ${pubResult.error.message}`,
              evidence: { radicado: item.radicado },
              action_result: 'noted',
            });
          }
        } catch (err: any) {
          failed++;
          results.push({
            work_item_id: item.id,
            radicado: item.radicado,
            ok: false,
            error: err?.message || 'Invocation failed',
          });
        }
      })
    );

    onProgress?.(Math.min(i + BATCH_SIZE, items.length), items.length);

    if (i + BATCH_SIZE < items.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  await (supabase.from('atenia_ai_actions') as any).insert({
    organization_id: organizationId,
    action_type: 'auto_sync_completed',
    autonomy_tier: 'OBSERVE',
    target_entity_type: 'organization',
    reasoning: `Sincronización correctiva completada: ${succeeded}/${items.length} exitosos, ${failed} fallidos.`,
    evidence: { results, succeeded, failed, total: items.length, trigger: decision.trigger },
    action_result: succeeded > 0 ? 'applied' : 'failed',
  });

  return { total: items.length, succeeded, failed, results };
};

// ============================================================
// GEMINI ESCALATION: When Atenia AI needs help reasoning
// ============================================================

export const escalateToGeminiForDiagnosis = async (
  organizationId: string,
  context: {
    failing_items: Array<{ radicado: string; workflow_type: string; error_code: string; message: string; consecutive_count: number }>;
    provider_stats: { cpnu_errors: number; samai_errors: number; cpnu_avg_latency: number; samai_avg_latency: number };
    recent_user_reports: Array<{ message: string; work_item_radicado: string; timestamp: string }>;
  },
): Promise<{ diagnosis: string; recommended_actions: string[]; should_auto_sync: boolean }> => {

  const prompt = `Eres Atenia AI, el administrador autónomo de la plataforma ATENIA de gestión de procesos judiciales colombianos.

Necesito tu análisis para decidir qué acciones tomar. Aquí está el contexto:

ASUNTOS FALLIDOS (${context.failing_items.length}):
${context.failing_items.map(i => `- ${i.radicado} (${i.workflow_type}): ${i.error_code} — "${i.message}" [${i.consecutive_count} fallos consecutivos]`).join('\n')}

RENDIMIENTO DE PROVEEDORES:
- CPNU: ${context.provider_stats.cpnu_errors} errores, latencia promedio ${context.provider_stats.cpnu_avg_latency}ms
- SAMAI: ${context.provider_stats.samai_errors} errores, latencia promedio ${context.provider_stats.samai_avg_latency}ms

REPORTES DE USUARIOS (${context.recent_user_reports.length}):
${context.recent_user_reports.map(r => `- [${r.timestamp}] Sobre ${r.work_item_radicado}: "${r.message}"`).join('\n') || 'Ninguno'}

Responde SOLO con JSON válido (sin markdown, sin backticks):
{
  "diagnosis": "Diagnóstico en español, máximo 3 oraciones",
  "recommended_actions": ["acción 1", "acción 2"],
  "should_auto_sync": true/false,
  "sync_reason": "Si should_auto_sync es true, explica por qué",
  "items_to_retry": ["radicados que vale la pena reintentar"],
  "items_to_demonitor": ["radicados que deberían suspenderse"]
}`;

  try {
    const response = await callGeminiViaEdge(prompt);
    const parsed = JSON.parse(response);

    await (supabase.from('atenia_ai_actions') as any).insert({
      organization_id: organizationId,
      action_type: 'gemini_consultation',
      autonomy_tier: 'OBSERVE',
      reasoning: `Consultó Gemini para diagnóstico de ${context.failing_items.length} asuntos fallidos.`,
      evidence: { context_summary: { failing_count: context.failing_items.length, user_reports: context.recent_user_reports.length }, gemini_response: parsed },
      action_result: null,
    });

    return {
      diagnosis: parsed.diagnosis,
      recommended_actions: parsed.recommended_actions || [],
      should_auto_sync: parsed.should_auto_sync || false,
    };
  } catch {
    return {
      diagnosis: 'No se pudo consultar Gemini. Se procede con reglas básicas.',
      recommended_actions: ['Revisar errores manualmente'],
      should_auto_sync: false,
    };
  }
};
