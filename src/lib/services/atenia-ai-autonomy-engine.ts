/**
 * atenia-ai-autonomy-engine.ts — Client-side orchestrator for Atenia AI Control Plane
 *
 * Called by the heartbeat (every 30 min) and manually from the Supervisor Panel.
 * Evaluates 7 sub-systems and returns an array of ActionPlans (executed or proposed).
 *
 * Safety: ALL actions check the autonomy policy before execution.
 * This module NEVER modifies code, schema, RLS, or config. Only operational control plane.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  evaluateFreshnessClassification,
  evaluateFreshnessViolations,
  evaluateUserDataAlerts,
  evaluateAutoProviderDemotion,
  evaluatePostRecoveryCatchup,
  evaluateEscalation,
} from './atenia-freshness-policies';
import { evaluateDeepDiveTriggers } from './atenia-deep-dive';
import { refreshE2ERegistry, runScheduledE2EBatch } from './atenia-e2e-registry';
import { enforceDeepDiveTTL } from './atenia-deep-dive-ttl';
import { evaluateIncidentPolicy } from './atenia-incident-policy';
import { remediateGhostItems } from './atenia-ghost-remediation';
import { guaranteeContinuation } from './atenia-continuation-guarantee';

// ============= TYPES =============

export interface ActionPlan {
  action_type: string;
  status: 'EXECUTED' | 'PLANNED' | 'SKIPPED';
  reason: string;
  work_item_id?: string;
  provider?: string;
  evidence?: Record<string, unknown>;
}

export interface AutonomyPolicy {
  id: string;
  is_enabled: boolean;
  allowed_actions: string[];
  require_confirmation_actions: string[];
  budgets: Record<string, { max_per_hour: number; max_per_day: number }>;
  cooldowns: Record<string, number>;
}

export interface AutonomyCycleResult {
  plans: ActionPlan[];
  policy_enabled: boolean;
  duration_ms: number;
}

// ============= POLICY LOADER =============

export async function loadAutonomyPolicy(): Promise<AutonomyPolicy> {
  const { data } = await (supabase
    .from('atenia_ai_autonomy_policy') as any)
    .select('*')
    .limit(1)
    .maybeSingle();

  if (!data) {
    return {
      id: '',
      is_enabled: false,
      allowed_actions: [],
      require_confirmation_actions: [],
      budgets: {},
      cooldowns: {},
    };
  }

  return {
    id: data.id,
    is_enabled: data.is_enabled ?? false,
    allowed_actions: data.allowed_actions ?? [],
    require_confirmation_actions: data.require_confirmation_actions ?? [],
    budgets: data.budgets ?? {},
    cooldowns: data.cooldowns ?? {},
  };
}

export async function saveAutonomyPolicy(
  updates: Partial<AutonomyPolicy> & { id: string },
): Promise<void> {
  const { id, ...rest } = updates;
  await (supabase
    .from('atenia_ai_autonomy_policy') as any)
    .update({ ...rest, updated_at: new Date().toISOString() })
    .eq('id', id);
}

// ============= BUDGET CHECK (client-side) =============

async function checkBudget(
  actionType: string,
  policy: AutonomyPolicy,
  targetId?: string,
): Promise<{ allowed: boolean; reason?: string; requiresConfirmation?: boolean }> {
  if (!policy.is_enabled) return { allowed: false, reason: 'AUTONOMY_DISABLED' };
  if (!policy.allowed_actions.includes(actionType)) {
    if (policy.require_confirmation_actions.includes(actionType)) {
      return { allowed: true, requiresConfirmation: true };
    }
    return { allowed: false, reason: 'ACTION_NOT_ALLOWED' };
  }
  if (policy.require_confirmation_actions.includes(actionType)) {
    return { allowed: true, requiresConfirmation: true };
  }

  const budget = policy.budgets[actionType];
  if (budget) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: hourCount } = await (supabase
      .from('atenia_ai_actions') as any)
      .select('*', { count: 'exact', head: true })
      .eq('action_type', actionType)
      .gte('created_at', hourAgo)
      .in('action_result', ['applied', 'triggered', 'SUCCESS']);

    if ((hourCount ?? 0) >= budget.max_per_hour) {
      return { allowed: false, reason: 'HOURLY_BUDGET_EXHAUSTED' };
    }

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: dayCount } = await (supabase
      .from('atenia_ai_actions') as any)
      .select('*', { count: 'exact', head: true })
      .eq('action_type', actionType)
      .gte('created_at', dayAgo)
      .in('action_result', ['applied', 'triggered', 'SUCCESS']);

    if ((dayCount ?? 0) >= budget.max_per_day) {
      return { allowed: false, reason: 'DAILY_BUDGET_EXHAUSTED' };
    }
  }

  if (targetId) {
    const cooldownMin = policy.cooldowns[actionType] ?? 0;
    if (cooldownMin > 0) {
      const cutoff = new Date(Date.now() - cooldownMin * 60 * 1000).toISOString();
      const { count } = await (supabase
        .from('atenia_ai_actions') as any)
        .select('*', { count: 'exact', head: true })
        .eq('action_type', actionType)
        .eq('work_item_id', targetId)
        .gte('created_at', cutoff)
        .in('action_result', ['applied', 'triggered', 'SUCCESS']);

      if ((count ?? 0) > 0) {
        return { allowed: false, reason: 'COOLDOWN_ACTIVE' };
      }
    }
  }

  return { allowed: true };
}

// ============= SUB-EVALUATORS =============

/** §3A: Daily Sync Continuation */
async function evaluateDailySyncContinuation(
  orgId: string,
  policy: AutonomyPolicy,
): Promise<ActionPlan[]> {
  const plans: ActionPlan[] = [];

  const today = new Date().toISOString().slice(0, 10);
  const { data: partial } = await supabase
    .from('auto_sync_daily_ledger')
    .select('id, cursor_last_work_item_id, items_succeeded, expected_total_items, failure_reason')
    .eq('organization_id', orgId)
    .eq('run_date', today)
    .eq('status', 'PARTIAL' as any)
    .eq('failure_reason', 'BUDGET_EXHAUSTED')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!partial?.cursor_last_work_item_id) return plans;

  // Check continuation count
  const { count: contCount } = await supabase
    .from('auto_sync_daily_ledger')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('run_date', today)
    .eq('is_continuation', true);

  if ((contCount ?? 0) >= 3) {
    plans.push({
      action_type: 'DAILY_CONTINUATION',
      status: 'SKIPPED',
      reason: 'Máximo de continuaciones diarias alcanzado (3/3).',
    });
    return plans;
  }

  // *** Problem 1 FIX: Convergence detection — stop if cursor hasn't advanced ***
  const { data: recentContinuations } = await supabase
    .from('auto_sync_daily_ledger')
    .select('items_succeeded, items_failed, cursor_last_work_item_id')
    .eq('organization_id', orgId)
    .eq('run_date', today)
    .eq('is_continuation', true)
    .order('created_at', { ascending: false })
    .limit(2);

  if (recentContinuations && recentContinuations.length >= 2) {
    const [latest, previous] = recentContinuations;
    if (
      latest.cursor_last_work_item_id === previous.cursor_last_work_item_id &&
      (latest.items_succeeded ?? 0) === 0
    ) {
      await logAutonomyAction(orgId, {
        action_type: 'DAILY_CONTINUATION',
        reasoning: 'Cursor no avanzó en las últimas 2 continuaciones — posible bloqueo. Se detiene la continuación para hoy.',
        action_result: 'skipped',
        status: 'SKIPPED',
        evidence: {
          stuck_cursor: latest.cursor_last_work_item_id,
          continuations_today: contCount ?? 0,
        },
      });

      plans.push({
        action_type: 'DAILY_CONTINUATION',
        status: 'SKIPPED',
        reason: 'CONVERGENCE_FAILED: cursor no avanzó en 2 continuaciones consecutivas.',
      });
      return plans;
    }
  }

  const check = await checkBudget('DAILY_CONTINUATION', policy);
  if (!check.allowed) {
    plans.push({
      action_type: 'DAILY_CONTINUATION',
      status: 'SKIPPED',
      reason: `No permitido: ${check.reason}`,
    });
    return plans;
  }

  // Trigger continuation via edge function
  try {
    await supabase.functions.invoke('scheduled-daily-sync', {
      body: {
        org_id: orgId,
        resume_after_id: partial.cursor_last_work_item_id,
        is_continuation: true,
        continuation_of: partial.id,
      },
    });

    await logAutonomyAction(orgId, {
      action_type: 'DAILY_CONTINUATION',
      reasoning: `Sync diario procesó ${partial.items_succeeded}/${partial.expected_total_items} asuntos antes de agotar presupuesto. Continuando desde cursor.`,
      action_result: 'triggered',
      evidence: {
        partial_ledger_id: partial.id,
        cursor: partial.cursor_last_work_item_id,
        continuations_today: (contCount ?? 0) + 1,
      },
    });

    plans.push({
      action_type: 'DAILY_CONTINUATION',
      status: 'EXECUTED',
      reason: `Continuación #{(contCount ?? 0) + 1} programada.`,
    });
  } catch (err: any) {
    plans.push({
      action_type: 'DAILY_CONTINUATION',
      status: 'SKIPPED',
      reason: `Error al invocar continuación: ${err.message?.substring(0, 100)}`,
    });
  }

  return plans;
}

/** §4.B: Orphaned source retries */
async function evaluateOrphanedRetries(
  orgId: string,
  policy: AutonomyPolicy,
): Promise<ActionPlan[]> {
  const plans: ActionPlan[] = [];
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: orphans } = await (supabase
    .from('work_items') as any)
    .select('id, radicado, workflow_type, consecutive_failures, last_error_code, last_attempted_sync_at')
    .eq('organization_id', orgId)
    .eq('monitoring_enabled', true)
    .gte('consecutive_failures', 3)
    .in('last_error_code', ['SCRAPING_TIMEOUT', 'PROVIDER_TIMEOUT', 'PROVIDER_5XX', 'NETWORK_ERROR'])
    .lt('last_attempted_sync_at', twoHoursAgo)
    .limit(10);

  if (!orphans || orphans.length === 0) return plans;

  for (const item of orphans) {
    const check = await checkBudget('RETRY_ENQUEUE', policy, item.id);
    if (!check.allowed) continue;

    try {
      await supabase.functions.invoke('sync-by-work-item', {
        body: { work_item_id: item.id, _scheduled: true },
      });

      await logAutonomyAction(orgId, {
        action_type: 'RETRY_ENQUEUE',
        work_item_id: item.id,
        reasoning: `Reintento correctivo para radicado ${item.radicado} — ${item.consecutive_failures} fallos consecutivos (${item.last_error_code}).`,
        action_result: 'triggered',
        evidence: {
          radicado: item.radicado,
          consecutive_failures: item.consecutive_failures,
          last_error_code: item.last_error_code,
        },
      });

      plans.push({
        action_type: 'RETRY_ENQUEUE',
        status: 'EXECUTED',
        reason: `Reintento para ${item.radicado}`,
        work_item_id: item.id,
      });
    } catch {
      // Non-blocking
    }
  }

  return plans;
}

/** §4.C: Auto-suspend monitoring — checks BOTH consecutive_not_found AND consecutive_other_errors */
async function evaluateAutoSuspend(
  orgId: string,
  policy: AutonomyPolicy,
): Promise<ActionPlan[]> {
  const plans: ActionPlan[] = [];

  // ── Bug 2 FIX: Also check consecutive_other_errors for "Radicado no encontrado" variants ──
  const { data: candidates } = await (supabase
    .from('atenia_ai_work_item_state') as any)
    .select('work_item_id, consecutive_not_found, consecutive_other_errors, consecutive_timeouts, last_error_code')
    .or('consecutive_not_found.gte.5,consecutive_other_errors.gte.5')
    .limit(30);

  if (!candidates || candidates.length === 0) return plans;

  // Filter to only items with not-found-like errors
  const NOT_FOUND_CODES = ['RECORD_NOT_FOUND', 'PROVIDER_NOT_FOUND', 'PROVIDER_EMPTY_RESULT', 'Radicado no encontrado', 'NOT_FOUND', '404'];
  const eligible = candidates.filter((c: any) => {
    const totalFailures = (c.consecutive_not_found ?? 0) + (c.consecutive_other_errors ?? 0);
    return totalFailures >= 5 && (!c.last_error_code || NOT_FOUND_CODES.some(code =>
      (c.last_error_code ?? '').includes(code)
    ));
  });

  // Fetch work item details for eligible items
  if (eligible.length === 0) return plans;
  const eligibleIds = eligible.map((c: any) => c.work_item_id);
  const { data: workItems } = await (supabase
    .from('work_items') as any)
    .select('id, radicado, monitoring_enabled')
    .in('id', eligibleIds)
    .eq('monitoring_enabled', true)
    .limit(15);

  if (!workItems || workItems.length === 0) return plans;

  // Build a map of state info
  const stateMap = new Map<string, Record<string, any>>(eligible.map((c: any) => [c.work_item_id, c]));
  const candidatesWithDetails = workItems.map((wi: any) => {
    const state = stateMap.get(wi.id) || {};
    return { ...wi, ...state };
  });

  for (const item of candidatesWithDetails) {
    const check = await checkBudget('SUSPEND_MONITORING', policy, item.id);
    if (!check.allowed) continue;

    const totalFailures = (item.consecutive_not_found ?? 0) + (item.consecutive_other_errors ?? 0);

    try {
      await (supabase
        .from('work_items') as any)
        .update({
          monitoring_enabled: false,
          monitoring_disabled_reason: 'AUTO_DEMONITOR_NOT_FOUND',
          monitoring_disabled_by: 'ATENIA',
          monitoring_disabled_at: new Date().toISOString(),
          monitoring_disabled_meta: {
            consecutive_not_found: item.consecutive_not_found ?? 0,
            consecutive_other_errors: item.consecutive_other_errors ?? 0,
            last_error_code: item.last_error_code,
          },
        })
        .eq('id', item.id);

      await logAutonomyAction(orgId, {
        action_type: 'SUSPEND_MONITORING',
        work_item_id: item.id,
        reasoning: `Radicado ${item.radicado} no encontrado en ${totalFailures} consultas consecutivas (${item.last_error_code}) — posiblemente no digitalizado. Monitoreo suspendido automáticamente.`,
        action_result: 'applied',
        evidence: {
          radicado: item.radicado,
          consecutive_not_found: item.consecutive_not_found ?? 0,
          consecutive_other_errors: item.consecutive_other_errors ?? 0,
          last_error_code: item.last_error_code,
        },
      });

      plans.push({
        action_type: 'SUSPEND_MONITORING',
        status: 'EXECUTED',
        reason: `Monitoreo suspendido para ${item.radicado}`,
        work_item_id: item.id,
      });
    } catch {
      // Non-blocking
    }
  }

  return plans;
}

/** §5: Provider health mitigations */
async function evaluateProviderHealth(
  orgId: string,
  policy: AutonomyPolicy,
): Promise<ActionPlan[]> {
  const plans: ActionPlan[] = [];
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: traces } = await (supabase
    .from('sync_traces') as any)
    .select('provider, success, error_code, latency_ms')
    .eq('organization_id', orgId)
    .gte('created_at', twoHoursAgo);

  if (!traces || traces.length === 0) return plans;

  // Group by provider
  const byProvider = new Map<string, typeof traces>();
  for (const t of traces) {
    const p = t.provider || 'unknown';
    if (!byProvider.has(p)) byProvider.set(p, []);
    byProvider.get(p)!.push(t);
  }

  // Expire stale mitigations
  try {
    await (supabase
      .from('provider_route_mitigations') as any)
      .update({ expired: true })
      .eq('expired', false)
      .lte('expires_at', new Date().toISOString());
  } catch { /* non-blocking */ }

  for (const [provider, provTraces] of byProvider) {
    const total = provTraces.length;
    if (total < 5) continue; // Not enough data

    const errors = provTraces.filter((t: any) => !t.success).length;
    const errorRate = errors / total;
    const avgLatency = provTraces.reduce((s: number, t: any) => s + (t.latency_ms || 0), 0) / total;

    if (errorRate < 0.5) continue; // Below CRITICAL threshold

    // Check if active mitigation already exists
    const { data: existing } = await (supabase
      .from('provider_route_mitigations') as any)
      .select('id')
      .eq('provider', provider)
      .eq('expired', false)
      .limit(1);

    if (existing && existing.length > 0) continue; // Already mitigated

    const check = await checkBudget('DEMOTE_PROVIDER_ROUTE', policy);
    if (check.requiresConfirmation) {
      // *** Problem 2 FIX: Check for existing PLANNED action before creating duplicate ***
      const { data: existingProposal } = await (supabase
        .from('atenia_ai_actions') as any)
        .select('id, created_at')
        .eq('action_type', 'DEMOTE_PROVIDER_ROUTE')
        .eq('status', 'PLANNED')
        .eq('provider', provider)
        .maybeSingle();

      if (existingProposal) {
        // Update existing proposal with latest metrics instead of creating duplicate
        await (supabase.from('atenia_ai_actions') as any)
          .update({
            reasoning: `Proveedor ${provider} degradado: tasa de error ${Math.round(errorRate * 100)}%, latencia promedio ${Math.round(avgLatency)}ms en últimas 2 horas. Se recomienda reducir prioridad temporalmente. (Actualizado: ${new Date().toLocaleTimeString('es-CO')})`,
            evidence: { errorRate, avgLatency, sampleSize: total, updated_at: new Date().toISOString() },
          })
          .eq('id', existingProposal.id);

        plans.push({
          action_type: 'DEMOTE_PROVIDER_ROUTE',
          status: 'PLANNED',
          reason: `Propuesta existente actualizada: ${provider} (error ${Math.round(errorRate * 100)}%)`,
          provider,
        });
        continue;
      }

      // Create PLANNED action for admin review
      await logAutonomyAction(orgId, {
        action_type: 'DEMOTE_PROVIDER_ROUTE',
        provider,
        reasoning: `Proveedor ${provider} degradado: tasa de error ${Math.round(errorRate * 100)}%, latencia promedio ${Math.round(avgLatency)}ms en últimas 2 horas. Se recomienda reducir prioridad temporalmente.`,
        action_result: 'pending_approval',
        status: 'PLANNED',
        evidence: { errorRate, avgLatency, sampleSize: total },
      });

      plans.push({
        action_type: 'DEMOTE_PROVIDER_ROUTE',
        status: 'PLANNED',
        reason: `Propuesta: degradar ${provider} (error ${Math.round(errorRate * 100)}%)`,
        provider,
      });
    }
  }

  return plans;
}

/** §6: Heavy work item split detection */
async function evaluateHeavyItems(
  orgId: string,
  policy: AutonomyPolicy,
): Promise<ActionPlan[]> {
  const plans: ActionPlan[] = [];

  const { data: heavyItems } = await (supabase
    .from('work_items') as any)
    .select('id, radicado, workflow_type, total_actuaciones, last_error_code')
    .eq('organization_id', orgId)
    .eq('monitoring_enabled', true)
    .or('total_actuaciones.gte.150,workflow_type.eq.PENAL_906')
    .in('last_error_code', ['EDGE_TIMEOUT', 'PROVIDER_TIMEOUT'])
    .limit(5);

  if (!heavyItems || heavyItems.length === 0) return plans;

  for (const item of heavyItems) {
    const check = await checkBudget('SPLIT_HEAVY_SYNC', policy, item.id);
    if (!check.allowed) continue;

    try {
      // Split: sync acts first
      await supabase.functions.invoke('sync-by-work-item', {
        body: { work_item_id: item.id, _scheduled: true },
      });

      // Wait 5s then sync pubs separately
      await new Promise(r => setTimeout(r, 5000));

      await supabase.functions.invoke('sync-publicaciones-by-work-item', {
        body: { work_item_id: item.id, _scheduled: true },
      });

      await logAutonomyAction(orgId, {
        action_type: 'SPLIT_HEAVY_SYNC',
        work_item_id: item.id,
        reasoning: `Asunto ${item.radicado} (${item.workflow_type}) tiene ${item.total_actuaciones || '?'} actuaciones. Sincronización dividida en invocaciones separadas para evitar timeout.`,
        action_result: 'applied',
        evidence: {
          radicado: item.radicado,
          workflow_type: item.workflow_type,
          total_actuaciones: item.total_actuaciones,
          last_error: item.last_error_code,
        },
      });

      plans.push({
        action_type: 'SPLIT_HEAVY_SYNC',
        status: 'EXECUTED',
        reason: `Split sync para ${item.radicado} (${item.total_actuaciones} acts)`,
        work_item_id: item.id,
      });
    } catch {
      // Non-blocking
    }
  }

  return plans;
}

// ============= MAIN ORCHESTRATOR =============

export async function runAutonomyCycle(orgId: string): Promise<AutonomyCycleResult> {
  const start = Date.now();
  const policy = await loadAutonomyPolicy();

  if (!policy.is_enabled) {
    return { plans: [], policy_enabled: false, duration_ms: Date.now() - start };
  }

  const allPlans: ActionPlan[] = [];

  try {
    // Run all evaluators (existing + new capabilities)
    const [cont, retries, suspend, provHealth, heavy, freshClass, freshViol, userAlerts, autoDemote, postRecovery, escalation] = await Promise.all([
      evaluateDailySyncContinuation(orgId, policy).catch(() => [] as ActionPlan[]),
      evaluateOrphanedRetries(orgId, policy).catch(() => [] as ActionPlan[]),
      evaluateAutoSuspend(orgId, policy).catch(() => [] as ActionPlan[]),
      evaluateProviderHealth(orgId, policy).catch(() => [] as ActionPlan[]),
      evaluateHeavyItems(orgId, policy).catch(() => [] as ActionPlan[]),
      // NEW: Freshness SLAs
      evaluateFreshnessClassification(orgId).catch(() => [] as ActionPlan[]),
      evaluateFreshnessViolations(orgId).catch(() => [] as ActionPlan[]),
      evaluateUserDataAlerts(orgId).catch(() => [] as ActionPlan[]),
      // NEW: Provider failover
      evaluateAutoProviderDemotion(orgId).catch(() => [] as ActionPlan[]),
      evaluatePostRecoveryCatchup(orgId).catch(() => [] as ActionPlan[]),
      // NEW: Escalation
      evaluateEscalation(orgId).catch(() => [] as ActionPlan[]),
    ]);

    allPlans.push(...cont, ...retries, ...suspend, ...provHealth, ...heavy, ...freshClass, ...freshViol, ...userAlerts, ...autoDemote, ...postRecovery, ...escalation);

    // B: Deep dive TTL enforcement
    try {
      const timedOut = await enforceDeepDiveTTL();
      if (timedOut > 0) {
        allPlans.push({ action_type: 'DEEP_DIVE_TTL_ENFORCEMENT', status: 'EXECUTED', reason: `${timedOut} deep dive(s) excedieron TTL y fueron marcados TIMED_OUT.` });
      }
    } catch { /* non-blocking */ }

    // Deep dive triggers (max 2 per cycle)
    try {
      const divesTriggered = await evaluateDeepDiveTriggers(orgId);
      if (divesTriggered > 0) {
        allPlans.push({ action_type: 'DEEP_DIVE_TRIGGERS', status: 'EXECUTED', reason: `${divesTriggered} deep dive(s) activados.` });
      }
    } catch { /* non-blocking */ }

    // C: Incident policy engine
    try {
      const incidentResult = await evaluateIncidentPolicy(orgId);
      if (incidentResult.remediated + incidentResult.auto_resolved + incidentResult.escalated > 0) {
        allPlans.push({
          action_type: 'INCIDENT_POLICY',
          status: 'EXECUTED',
          reason: `Incidentes: ${incidentResult.remediated} remediados, ${incidentResult.auto_resolved} auto-resueltos, ${incidentResult.escalated} escalados.`,
        });
      }
    } catch { /* non-blocking */ }

    // D: Ghost item remediation
    try {
      const ghostResult = await remediateGhostItems(orgId);
      if (ghostResult.ghost_items.length > 0) {
        allPlans.push({
          action_type: 'GHOST_REMEDIATION',
          status: 'EXECUTED',
          reason: `${ghostResult.ghost_items.length} fantasma(s): ${ghostResult.bootstrapped} bootstrap, ${ghostResult.quarantined} cuarentena.`,
          evidence: {
            ghost_radicados: ghostResult.ghost_items.map(g => g.radicado),
            bootstrapped: ghostResult.bootstrapped,
            quarantined: ghostResult.quarantined,
          },
        });
      }
    } catch { /* non-blocking */ }

    // E: Continuation guarantee
    try {
      const contResults = await guaranteeContinuation(orgId);
      for (const cr of contResults) {
        if (!cr.continuation_enqueued && cr.block_reason) {
          allPlans.push({
            action_type: 'CONTINUATION_BLOCKED',
            status: 'EXECUTED',
            reason: `Chain PARTIAL sin continuación: ${cr.block_reason}.`,
            evidence: { ledger_id: cr.ledger_id, block_reason: cr.block_reason },
          });
        } else if (cr.continuation_enqueued) {
          allPlans.push({
            action_type: 'CONTINUATION_GUARANTEED',
            status: 'EXECUTED',
            reason: `Continuación encolada para ledger ${cr.ledger_id.slice(0, 8)}.`,
          });
        }
      }
    } catch { /* non-blocking */ }

    // E2E registry refresh (once per day guard)
    try {
      const { data: recentRefresh } = await (supabase.from('atenia_ai_actions') as any)
        .select('id')
        .eq('action_type', 'REFRESH_E2E_REGISTRY')
        .gte('created_at', new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();
      if (!recentRefresh) {
        const added = await refreshE2ERegistry(orgId);
        if (added > 0) allPlans.push({ action_type: 'REFRESH_E2E_REGISTRY', status: 'EXECUTED', reason: `${added} centinelas añadidos.` });
      }
    } catch { /* non-blocking */ }

    // Scheduled E2E (every 6 hours guard)
    try {
      const { data: recentE2E } = await (supabase.from('atenia_ai_actions') as any)
        .select('id')
        .eq('action_type', 'SCHEDULED_E2E_BATCH')
        .gte('created_at', new Date(Date.now() - 5.5 * 60 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();
      if (!recentE2E) {
        const e2eResult = await runScheduledE2EBatch(orgId, 'SCHEDULED');
        allPlans.push({ action_type: 'SCHEDULED_E2E_BATCH', status: 'EXECUTED', reason: `E2E: ${e2eResult.passed}✅ ${e2eResult.failed}❌ ${e2eResult.skipped}⏭ / ${e2eResult.total}` });
      }
    } catch { /* non-blocking */ }
  } catch (err) {
    console.warn('[autonomy-engine] Cycle error:', err);
  }

  return {
    plans: allPlans,
    policy_enabled: true,
    duration_ms: Date.now() - start,
  };
}

// ============= HELPERS =============

async function logAutonomyAction(
  orgId: string,
  action: {
    action_type: string;
    work_item_id?: string;
    provider?: string;
    reasoning: string;
    action_result?: string;
    status?: string;
    evidence?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await (supabase.from('atenia_ai_actions') as any).insert({
      organization_id: orgId,
      action_type: action.action_type,
      actor: 'AI_AUTOPILOT',
      autonomy_tier: 'ACT',
      work_item_id: action.work_item_id ?? null,
      provider: action.provider ?? null,
      reasoning: action.reasoning,
      action_result: action.action_result ?? 'applied',
      status: action.status ?? 'EXECUTED',
      evidence: action.evidence ?? {},
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[autonomy-engine] Failed to log action:', err);
  }
}
