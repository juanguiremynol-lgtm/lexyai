/**
 * Atenia AI Autonomous Engine (B1)
 * 
 * Decision engine with OBSERVE → SUGGEST → ACT tiers.
 * Includes:
 * - COT window guard (no actions 6:50–7:30 AM COT)
 * - Circuit breaker using sync_traces
 * - Auto-sync for stale items (respects autonomy_paused)
 * - User report auto-diagnosis
 * - All actions logged to atenia_ai_actions
 * 
 * DOES NOT modify edge functions. Only invokes them.
 */

import { supabase } from '@/integrations/supabase/client';
import { loadConfig, type AteniaConfig } from './atenia-ai-engine';
import {
  evaluateExternalProviderHealth,
  evaluateExternalProviderRetries,
  gatherExternalProviderDiagnostics,
  type ExternalProviderHealthResult,
  type ExternalProviderDiagnostics,
} from './atenia-ai-external-providers';
import { runAteniaE2ETest, type AteniaE2ETestResult } from './atenia-ai-e2e-test';

// ============= TYPES =============

export interface HeartbeatResult {
  skipped: boolean;
  reason?: string;
  observations: ObservationResult[];
  actionsTriggered: number;
  externalProviderHealth?: ExternalProviderHealthResult;
  e2eSpotCheck?: AteniaE2ETestResult | null;
}

export interface ObservationResult {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  data?: any;
}

export interface CircuitBreakerState {
  provider: string;
  isOpen: boolean;
  errorRate: number;
  avgLatencyMs: number;
  sampleSize: number;
}

export interface AutoDiagnosis {
  work_item_id: string;
  radicado: string | null;
  workflow_type: string;
  last_synced_at: string | null;
  sync_traces_recent: Array<{
    provider: string;
    success: boolean;
    error_code: string | null;
    latency_ms: number | null;
    created_at: string;
  }>;
  publicaciones_count: number;
  actuaciones_count: number;
  provider_health: CircuitBreakerState[];
  diagnosis_summary: string;
  external_providers?: ExternalProviderDiagnostics | null;
}

// ============= COT WINDOW GUARD =============

/**
 * Check if current time is within the cron guard window (6:50–7:30 AM COT).
 * During this window, the heartbeat should NOT trigger sync actions to avoid
 * conflicting with the daily scheduled sync.
 */
export function isInCronGuardWindow(): boolean {
  const now = new Date();
  // Convert to COT (UTC-5)
  const cotMs = now.getTime() - 5 * 60 * 60 * 1000;
  const cot = new Date(cotMs);
  const hours = cot.getUTCHours();
  const minutes = cot.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;
  
  // 6:50 AM = 410 min, 7:30 AM = 450 min
  return totalMinutes >= 410 && totalMinutes <= 450;
}

// ============= CIRCUIT BREAKER =============

/**
 * Evaluate provider health from recent sync_traces.
 * If error rate exceeds threshold or latency is extreme, the circuit is "open" (unhealthy).
 */
export async function evaluateProviderHealth(
  organizationId: string,
  windowMinutes: number = 30,
  config?: AteniaConfig
): Promise<CircuitBreakerState[]> {
  const cfg = config || await loadConfig(organizationId);
  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const { data: traces } = await (supabase
    .from('sync_traces') as any)
    .select('provider, success, error_code, latency_ms')
    .eq('organization_id', organizationId)
    .gte('created_at', since);

  if (!traces || traces.length === 0) return [];

  // Group by provider
  const byProvider = new Map<string, typeof traces>();
  for (const t of traces) {
    const p = t.provider || 'unknown';
    if (!byProvider.has(p)) byProvider.set(p, []);
    byProvider.get(p)!.push(t);
  }

  const results: CircuitBreakerState[] = [];
  for (const [provider, provTraces] of byProvider) {
    const total = provTraces.length;
    const errors = provTraces.filter((t: any) => !t.success).length;
    const errorRate = total > 0 ? errors / total : 0;
    const avgLatency = total > 0
      ? provTraces.reduce((s: number, t: any) => s + (t.latency_ms || 0), 0) / total
      : 0;

    results.push({
      provider,
      isOpen: errorRate >= cfg.provider_error_rate_threshold || avgLatency > cfg.provider_slow_threshold_ms * 3,
      errorRate,
      avgLatencyMs: Math.round(avgLatency),
      sampleSize: total,
    });
  }

  return results;
}

// ============= OBSERVE =============

/**
 * Run observation phase: detect stale items, ghost items, and provider health issues.
 */
export async function runObservations(organizationId: string): Promise<ObservationResult[]> {
  const observations: ObservationResult[] = [];
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Stale items (monitored but not synced in 3+ days)
  const { data: staleItems } = await (supabase
    .from('work_items') as any)
    .select('id, radicado, last_synced_at')
    .eq('organization_id', organizationId)
    .eq('monitoring_enabled', true)
    .lt('last_synced_at', threeDaysAgo)
    .limit(20);

  if (staleItems && staleItems.length > 0) {
    observations.push({
      type: 'stale_items',
      severity: staleItems.length > 5 ? 'warning' : 'info',
      message: `${staleItems.length} asuntos con datos desactualizados (>3 días sin sync)`,
      data: { count: staleItems.length, items: staleItems.slice(0, 5).map((i: any) => i.radicado) },
    });
  }

  // 2. Provider health
  const providerHealth = await evaluateProviderHealth(organizationId);
  const degradedProviders = providerHealth.filter(p => p.isOpen);
  if (degradedProviders.length > 0) {
    observations.push({
      type: 'provider_degraded',
      severity: 'warning',
      message: `Proveedores degradados: ${degradedProviders.map(p => p.provider).join(', ')}`,
      data: degradedProviders,
    });
  }

  // 3. Ghost items (monitoring enabled but never synced)
  const { data: ghostItems } = await (supabase
    .from('work_items') as any)
    .select('id, radicado')
    .eq('organization_id', organizationId)
    .eq('monitoring_enabled', true)
    .is('last_synced_at', null)
    .limit(10);

  if (ghostItems && ghostItems.length > 0) {
    observations.push({
      type: 'ghost_items',
      severity: 'warning',
      message: `${ghostItems.length} asuntos monitoreados sin sincronización inicial`,
      data: { count: ghostItems.length },
    });
  }

  return observations;
}

// ============= ACT: AUTO-SYNC STALE =============

/**
 * Trigger corrective sync for the N most stale items.
 * Respects circuit breaker and cron guard window.
 */
export async function autoSyncStaleItems(
  organizationId: string,
  maxItems: number = 3
): Promise<{ synced: number; skipped: string[] }> {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const { data: staleItems } = await (supabase
    .from('work_items') as any)
    .select('id, radicado, workflow_type, last_synced_at')
    .eq('organization_id', organizationId)
    .eq('monitoring_enabled', true)
    .lt('last_synced_at', twoDaysAgo)
    .order('last_synced_at', { ascending: true })
    .limit(maxItems);

  if (!staleItems || staleItems.length === 0) {
    return { synced: 0, skipped: [] };
  }

  let synced = 0;
  const skipped: string[] = [];

  for (const item of staleItems) {
    try {
      const { error } = await supabase.functions.invoke('sync-by-work-item', {
        body: {
          work_item_id: item.id,
          _scheduled: true,
        },
      });

      if (error) {
        skipped.push(item.radicado || item.id);
        continue;
      }

      synced++;

      // Log the action
      await logAteniaAction({
        organization_id: organizationId,
        action_type: 'auto_sync_stale',
        autonomy_tier: 'ACT',
        target_entity_type: 'work_item',
        target_entity_id: item.id,
        reasoning: `Sincronización correctiva para radicado ${item.radicado} — último sync: ${item.last_synced_at}`,
        evidence: { radicado: item.radicado, last_synced_at: item.last_synced_at },
        action_taken: 'INVOKE sync-by-work-item',
        action_result: 'triggered',
      });
    } catch {
      skipped.push(item.radicado || item.id);
    }
  }

  return { synced, skipped };
}

// ============= OBSERVATION FINGERPRINTING (Problem 3) =============

function computeObservationFingerprint(observations: ObservationResult[]): string {
  return observations
    .map(o => `${o.type}:${o.severity}:${o.data?.count ?? o.data?.length ?? ''}`)
    .sort()
    .join('|');
}

function formatObservationSummary(observations: ObservationResult[]): string {
  const groups: Record<string, number> = {};
  for (const obs of observations) {
    groups[obs.type] = (groups[obs.type] ?? 0) + 1;
  }

  const parts: string[] = [];
  if (groups['provider_degraded']) parts.push(`${groups['provider_degraded']} proveedor(es) degradado(s)`);
  if (groups['ghost_items']) parts.push(`${groups['ghost_items']} asunto(s) fantasma`);
  if (groups['stale_items']) parts.push(`${groups['stale_items']} asunto(s) desactualizado(s)`);

  const extCount = (groups['ext_sync_failures'] ?? 0) + (groups['ext_provider_degraded'] ?? 0);
  if (extCount > 0) parts.push(`${extCount} señal(es) de proveedor(es) externo(s)`);

  if (parts.length === 0) parts.push(`${observations.length} observación(es)`);

  return `Heartbeat: ${parts.join(', ')}`;
}

// ============= HEARTBEAT ORCHESTRATOR =============

/**
 * Main heartbeat function. Called by the useAteniaHeartbeat hook.
 * Orchestrates OBSERVE → SUGGEST → ACT.
 */
export async function runHeartbeat(organizationId: string): Promise<HeartbeatResult> {
  // Guard: COT window
  if (isInCronGuardWindow()) {
    return { skipped: true, reason: 'cron_guard_window', observations: [], actionsTriggered: 0 };
  }

  // Load config
  const config = await loadConfig(organizationId);

  // OBSERVE: built-in + external providers
  const [observations, extHealth] = await Promise.all([
    runObservations(organizationId),
    evaluateExternalProviderHealth(organizationId),
  ]);

  // Merge external provider observations into the observation list
  for (const obs of extHealth.observations) {
    observations.push({
      type: obs.type,
      severity: obs.severity,
      message: obs.detail,
      data: obs,
    });
  }

  // *** Problem 3 FIX: Fingerprint-based observation dedup ***
  if (observations.length > 0) {
    const currentFingerprint = computeObservationFingerprint(observations);

    // Check last heartbeat_observe action
    const { data: lastHeartbeat } = await (supabase
      .from('atenia_ai_actions') as any)
      .select('id, evidence')
      .eq('action_type', 'heartbeat_observe')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastFingerprint = lastHeartbeat?.evidence?.fingerprint;

    if (currentFingerprint === lastFingerprint && lastHeartbeat) {
      // Same situation — bump existing, don't create new row
      const repeatCount = (lastHeartbeat.evidence?.repeat_count ?? 1) + 1;
      await (supabase.from('atenia_ai_actions') as any)
        .update({
          evidence: {
            ...lastHeartbeat.evidence,
            repeat_count: repeatCount,
            last_seen: new Date().toISOString(),
          },
        })
        .eq('id', lastHeartbeat.id);
    } else {
      // Different fingerprint — log new action with summary
      await logAteniaAction({
        organization_id: organizationId,
        action_type: 'heartbeat_observe',
        autonomy_tier: 'OBSERVE',
        reasoning: formatObservationSummary(observations),
        evidence: {
          fingerprint: currentFingerprint,
          observations,
          repeat_count: 1,
          external_provider_health: extHealth.issues_found > 0 ? extHealth : undefined,
        },
        action_taken: 'observation_logged',
        action_result: 'logged',
      });
    }
  }

  // If autonomy is paused, observe only
  if ((config as any).autonomy_paused) {
    return { skipped: true, reason: 'autonomy_paused', observations, actionsTriggered: 0, externalProviderHealth: extHealth };
  }

  // ACT: Check circuit breaker before syncing
  const providerHealth = await evaluateProviderHealth(organizationId, 30, config);
  const allProvidersDown = providerHealth.length > 0 && providerHealth.every(p => p.isOpen);

  let actionsTriggered = 0;
  let e2eSpotCheck: AteniaE2ETestResult | null = null;

  if (!allProvidersDown) {
    // Auto-sync stale items (built-in)
    const maxSyncs = (config as any).max_auto_syncs_per_heartbeat ?? 3;
    const staleResult = await autoSyncStaleItems(organizationId, maxSyncs);
    actionsTriggered += staleResult.synced;

    // ACT: External provider corrective retries
    const extRetries = await evaluateExternalProviderRetries(organizationId);
    if (extRetries.should_sync && extRetries.items.length > 0) {
      await logAteniaAction({
        organization_id: organizationId,
        action_type: 'ext_provider_retry',
        autonomy_tier: 'ACT',
        reasoning: `Reintentando ${extRetries.items.length} sync(s) de proveedores externos`,
        evidence: { items: extRetries.items },
        action_taken: 'ext_sync_triggered',
        action_result: 'triggered',
      });

      for (const item of extRetries.items) {
        try {
          await supabase.functions.invoke('provider-sync-external-provider', {
            body: {
              work_item_id: item.work_item_id,
              connector_id: item.connector_id,
              triggered_by: 'atenia_ai_corrective',
            },
          });
          actionsTriggered++;
        } catch (err) {
          console.error(`[atenia-ai] External retry failed for ${item.work_item_id}:`, err);
        }
      }
    }

    // *** Problem 6 FIX: Batch E2E tests into single summary action ***
    try {
      const { data: cpacaItems } = await (supabase
        .from('work_items') as any)
        .select('radicado')
        .eq('organization_id', organizationId)
        .eq('monitoring_enabled', true)
        .eq('workflow_type', 'CPACA')
        .not('radicado', 'is', null)
        .limit(5);

      if (cpacaItems && cpacaItems.length > 0) {
        const testResults: Array<{ radicado: string; result: string; latency_ms?: number }> = [];
        for (const item of cpacaItems) {
          try {
            const result = await runAteniaE2ETest({
              radicado: item.radicado,
              triggered_by: 'heartbeat',
            });
            testResults.push({
              radicado: item.radicado,
              result: result.ok ? 'PASSED' : 'FAILED',
              latency_ms: result.duration_ms,
            });
          } catch {
            testResults.push({ radicado: item.radicado, result: 'ERROR' });
          }
        }

        const passed = testResults.filter(t => t.result === 'PASSED');
        const failed = testResults.filter(t => t.result !== 'PASSED');

        // Log single batch action instead of per-radicado
        await logAteniaAction({
          organization_id: organizationId,
          action_type: 'PROVIDER_E2E_BATCH',
          autonomy_tier: 'OBSERVE',
          reasoning: `E2E heartbeat: ${passed.length} OK, ${failed.length} fallido(s) de ${testResults.length} pruebas.${
            failed.length > 0 ? ` Fallidos: ${failed.map(f => f.radicado.slice(-10)).join(', ')}` : ''
          }`,
          evidence: { tests: testResults },
          action_taken: 'e2e_batch_completed',
          action_result: failed.length > 0 ? 'partial' : 'logged',
        });

        if (testResults.length > 0) {
          // Use the last test result as spot check representative
          const lastResult = testResults[testResults.length - 1];
          e2eSpotCheck = null; // Batch replaces single spot check
        }
      }
    } catch (err) {
      console.warn('[atenia-ai] E2E spot-check failed:', err);
    }
  } else {
    await logAteniaAction({
      organization_id: organizationId,
      action_type: 'circuit_breaker_open',
      autonomy_tier: 'OBSERVE',
      reasoning: `Todos los proveedores están degradados. No se ejecutaron syncs correctivos.`,
      evidence: { providers: providerHealth },
      action_taken: 'sync_suppressed',
      action_result: 'circuit_open',
    });
  }

  return { skipped: false, observations, actionsTriggered, externalProviderHealth: extHealth, e2eSpotCheck };
}

// ============= USER REPORT AUTO-DIAGNOSIS =============

/**
 * Generate automatic diagnosis for a user-reported issue on a work item.
 */
export async function generateAutoDiagnosis(workItemId: string): Promise<AutoDiagnosis> {
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const [wiResult, tracesResult, pubCountResult, actCountResult] = await Promise.all([
    (supabase.from('work_items') as any)
      .select('id, radicado, workflow_type, organization_id, last_synced_at, monitoring_enabled, consecutive_404_count, scrape_status')
      .eq('id', workItemId)
      .single(),
    (supabase.from('sync_traces') as any)
      .select('provider, success, error_code, latency_ms, created_at')
      .eq('work_item_id', workItemId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase.from('work_item_publicaciones')
      .select('id', { count: 'exact', head: true })
      .eq('work_item_id', workItemId)
      .eq('is_archived', false),
    (supabase.from('work_item_acts') as any)
      .select('id', { count: 'exact', head: true })
      .eq('work_item_id', workItemId)
      .eq('is_archived', false),
  ]);

  const wi = wiResult.data;
  const traces = tracesResult.data || [];
  const orgId = wi?.organization_id;
  const providerHealth = orgId ? await evaluateProviderHealth(orgId, 60) : [];

  // Build diagnosis summary
  const summaryParts: string[] = [];
  if (!wi) {
    summaryParts.push('⚠️ Asunto no encontrado en la base de datos.');
  } else {
    if (!wi.monitoring_enabled) summaryParts.push('🔴 Monitoreo desactivado para este asunto.');
    if (wi.consecutive_404_count > 0) summaryParts.push(`⚠️ ${wi.consecutive_404_count} consultas consecutivas sin resultado.`);
    if (!wi.last_synced_at) summaryParts.push('⚠️ Nunca ha sido sincronizado.');
    else {
      const hoursSince = (Date.now() - new Date(wi.last_synced_at).getTime()) / 3600000;
      if (hoursSince > 48) summaryParts.push(`⚠️ Última sincronización hace ${Math.round(hoursSince / 24)} días.`);
      else summaryParts.push(`✅ Sincronizado hace ${Math.round(hoursSince)} horas.`);
    }
    const recentErrors = traces.filter((t: any) => !t.success);
    if (recentErrors.length > 0) {
      const errorCodes = [...new Set(recentErrors.map((t: any) => t.error_code || 'UNKNOWN'))];
      summaryParts.push(`⚠️ Errores recientes: ${errorCodes.join(', ')}`);
    }
    const degraded = providerHealth.filter(p => p.isOpen);
    if (degraded.length > 0) {
      summaryParts.push(`🟡 Proveedores degradados: ${degraded.map(p => p.provider).join(', ')}`);
    }
    if (summaryParts.length === 1 && summaryParts[0].startsWith('✅')) {
      summaryParts.push('✅ No se detectaron problemas evidentes.');
    }
  }

  // External provider diagnostics
  const extDiag = await gatherExternalProviderDiagnostics(workItemId);
  if (extDiag?.external_provider_involved) {
    if (extDiag.recent_traces.some(t => !t.success)) {
      summaryParts.push(`🔌 Proveedor externo: ${extDiag.recent_traces.filter(t => !t.success).length} fallo(s) recientes.`);
    }
    if (extDiag.mapping_specs_active === 0 && extDiag.connectors && extDiag.connectors.length > 0) {
      summaryParts.push('⚠️ Proveedor externo sin mapping ACTIVE — datos crudos sin transformar.');
    }
    if (extDiag.has_unmapped_fields) {
      summaryParts.push(`ℹ️ ${extDiag.unmapped_extras_count} campo(s) no mapeados del proveedor externo.`);
    }
  }

  return {
    work_item_id: workItemId,
    radicado: wi?.radicado || null,
    workflow_type: wi?.workflow_type || 'UNKNOWN',
    last_synced_at: wi?.last_synced_at || null,
    sync_traces_recent: traces,
    publicaciones_count: pubCountResult.count || 0,
    actuaciones_count: actCountResult.count || 0,
    provider_health: providerHealth,
    diagnosis_summary: summaryParts.join('\n'),
    external_providers: extDiag,
  };
}

/**
 * Submit a user report to atenia_ai_user_reports
 */
export async function submitUserReport(params: {
  organizationId: string;
  reporterUserId: string;
  workItemId?: string;
  reportType: string;
  description: string;
  autoDiagnosis?: AutoDiagnosis;
}): Promise<string> {
  const { data, error } = await (supabase
    .from('atenia_ai_user_reports') as any)
    .insert({
      organization_id: params.organizationId,
      reporter_user_id: params.reporterUserId,
      work_item_id: params.workItemId || null,
      report_type: params.reportType,
      description: params.description,
      auto_diagnosis: params.autoDiagnosis || null,
      status: 'OPEN',
    })
    .select('id')
    .single();

  if (error) throw error;

  // Log the action
  await logAteniaAction({
    organization_id: params.organizationId,
    action_type: 'user_report_submitted',
    autonomy_tier: 'OBSERVE',
    target_entity_type: 'work_item',
    target_entity_id: params.workItemId,
    reasoning: `Usuario reportó: ${params.description.substring(0, 200)}`,
    evidence: {
      report_id: data.id,
      report_type: params.reportType,
      auto_diagnosis_summary: params.autoDiagnosis?.diagnosis_summary,
    },
    action_taken: 'report_created',
    action_result: 'logged',
  });

  return data.id;
}

// ============= HELPERS =============

async function logAteniaAction(action: {
  organization_id: string;
  action_type: string;
  autonomy_tier: 'OBSERVE' | 'SUGGEST' | 'ACT';
  target_entity_type?: string;
  target_entity_id?: string;
  reasoning: string;
  evidence?: any;
  action_taken?: string;
  action_result?: string;
}): Promise<void> {
  try {
    await (supabase.from('atenia_ai_actions') as any).insert({
      ...action,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[atenia-ai-autonomous] Failed to log action:', err);
  }
}
