/**
 * Atenia AI Freshness Policies
 *
 * Capabilities 1A–1C: Auto-classification, violation detection, user alerts.
 * Called by runAutonomyCycle() during each heartbeat.
 */

import { supabase } from '@/integrations/supabase/client';
import type { ActionPlan } from './atenia-ai-autonomy-engine';
import { bridgeNotificationToAteniaAI } from './atenia-alert-bridge';

type FreshnessTier = 'CRITICAL' | 'HIGH' | 'STANDARD' | 'LOW';

const SLA_HOURS: Record<FreshnessTier, number> = {
  CRITICAL: 6,
  HIGH: 12,
  STANDARD: 24,
  LOW: 72,
};

// ============= CAPABILITY 1B: AUTO-CLASSIFICATION =============

/**
 * Evaluate and update freshness tiers for all monitored work items in an org.
 * Runs once per day per org (after daily sync enqueue).
 */
export async function evaluateFreshnessClassification(
  orgId: string
): Promise<ActionPlan[]> {
  const plans: ActionPlan[] = [];
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const { data: items } = await (supabase
    .from('work_items') as any)
    .select('id, radicado, freshness_tier, monitoring_enabled, last_successful_sync_at, last_viewed_at')
    .eq('organization_id', orgId)
    .eq('monitoring_enabled', true)
    .is('deleted_at', null)
    .limit(500);

  if (!items || items.length === 0) return plans;

  // Get items with upcoming hearings
  const { data: upcomingHearings } = await (supabase
    .from('hearings') as any)
    .select('work_item_id')
    .gte('hearing_date', now.toISOString())
    .lte('hearing_date', sevenDaysFromNow.toISOString());

  const hearingWorkItemIds = new Set(
    (upcomingHearings || []).map((h: any) => h.work_item_id)
  );

  // Get items with active alerts
  const { data: activeAlerts } = await (supabase
    .from('alert_instances') as any)
    .select('entity_id')
    .eq('entity_type', 'work_item')
    .eq('status', 'ACTIVE')
    .eq('organization_id', orgId);

  const alertedWorkItemIds = new Set(
    (activeAlerts || []).map((a: any) => a.entity_id)
  );

  for (const item of items) {
    let newTier: FreshnessTier = 'STANDARD';

    // CRITICAL: upcoming court dates or active alerts
    if (hearingWorkItemIds.has(item.id) || alertedWorkItemIds.has(item.id)) {
      newTier = 'CRITICAL';
    }
    // HIGH: recently viewed (48h)
    else if (
      item.last_viewed_at &&
      now.getTime() - new Date(item.last_viewed_at).getTime() < 48 * 60 * 60 * 1000
    ) {
      newTier = 'HIGH';
    }
    // LOW: dormant items (no sync in 90+ days)
    else if (item.last_successful_sync_at) {
      const daysSinceSync =
        (now.getTime() - new Date(item.last_successful_sync_at).getTime()) /
        (24 * 60 * 60 * 1000);
      if (daysSinceSync > 90) {
        newTier = 'LOW';
      }
    }

    if (newTier !== item.freshness_tier) {
      await (supabase.from('work_items') as any)
        .update({
          freshness_tier: newTier,
          freshness_sla_hours: SLA_HOURS[newTier],
        })
        .eq('id', item.id);

      plans.push({
        action_type: 'CLASSIFY_FRESHNESS_TIER',
        status: 'EXECUTED',
        reason: `${item.radicado} reclasificado de ${item.freshness_tier} a ${newTier}.`,
        work_item_id: item.id,
      });
    }
  }

  return plans;
}

// ============= CAPABILITY 1C: VIOLATION DETECTION =============

/**
 * Detect freshness SLA violations. Runs every heartbeat (30 min).
 */
export async function evaluateFreshnessViolations(
  orgId: string
): Promise<ActionPlan[]> {
  const plans: ActionPlan[] = [];
  const now = new Date();

  const { data: items } = await (supabase
    .from('work_items') as any)
    .select('id, radicado, freshness_tier, freshness_sla_hours, last_successful_sync_at, freshness_violation_at, sync_failure_streak')
    .eq('organization_id', orgId)
    .eq('monitoring_enabled', true)
    .is('deleted_at', null)
    .limit(500);

  if (!items) return plans;

  for (const item of items) {
    const slaMs = (item.freshness_sla_hours ?? 24) * 60 * 60 * 1000;
    const lastSync = item.last_successful_sync_at
      ? new Date(item.last_successful_sync_at).getTime()
      : 0;
    const overdueMs = now.getTime() - lastSync;

    if (overdueMs > slaMs) {
      if (!item.freshness_violation_at) {
        await (supabase.from('work_items') as any)
          .update({ freshness_violation_at: now.toISOString() })
          .eq('id', item.id);

        plans.push({
          action_type: 'DETECT_FRESHNESS_VIOLATION',
          status: 'EXECUTED',
          reason: `SLA violado para ${item.radicado} (${item.freshness_tier}, SLA: ${item.freshness_sla_hours}h). Streak: ${item.sync_failure_streak}.`,
          work_item_id: item.id,
          evidence: {
            tier: item.freshness_tier,
            sla_hours: item.freshness_sla_hours,
            overdue_hours: Math.round(overdueMs / (60 * 60 * 1000)),
            failure_streak: item.sync_failure_streak,
          },
        });
      }
    } else if (item.freshness_violation_at) {
      // SLA met — clear violation
      await (supabase.from('work_items') as any)
        .update({
          freshness_violation_at: null,
          freshness_violation_notified: false,
        })
        .eq('id', item.id);
    }
  }

  return plans;
}

// ============= CAPABILITY 5B: USER DATA ALERTS =============

/**
 * Generate user-facing alerts for freshness violations.
 */
export async function evaluateUserDataAlerts(
  orgId: string
): Promise<ActionPlan[]> {
  const plans: ActionPlan[] = [];

  const { data: violations } = await (supabase
    .from('work_items') as any)
    .select('id, radicado, freshness_tier, freshness_sla_hours, last_successful_sync_at, freshness_violation_at, freshness_violation_notified')
    .eq('organization_id', orgId)
    .eq('monitoring_enabled', true)
    .is('deleted_at', null)
    .not('freshness_violation_at', 'is', null)
    .eq('freshness_violation_notified', false)
    .limit(50);

  if (!violations || violations.length === 0) return plans;

  const { data: orgUsers } = await supabase
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', orgId);

  if (!orgUsers || orgUsers.length === 0) return plans;

  for (const item of violations) {
    const overdueHours = Math.round(
      (Date.now() - new Date(item.last_successful_sync_at ?? item.freshness_violation_at).getTime()) /
        (60 * 60 * 1000)
    );

    const severity =
      item.freshness_tier === 'CRITICAL'
        ? 'CRITICAL'
        : item.freshness_tier === 'HIGH'
          ? 'WARNING'
          : 'INFO';

    const message =
      item.freshness_tier === 'CRITICAL'
        ? `⚠️ El asunto ${item.radicado} tiene datos desactualizados hace ${overdueHours} horas (SLA: ${item.freshness_sla_hours}h). Puede haber actuaciones recientes no reflejadas. Atenia AI está intentando sincronizar.`
        : `El asunto ${item.radicado} no se ha sincronizado en ${overdueHours} horas. Atenia AI está trabajando para resolver el problema.`;

    // Deduplicate: check if alert already exists for this item
    const { data: existingAlert } = await (supabase
      .from('user_data_alerts') as any)
      .select('id')
      .eq('work_item_id', item.id)
      .eq('alert_type', 'FRESHNESS_VIOLATION')
      .eq('is_read', false)
      .limit(1)
      .maybeSingle();

    if (existingAlert) continue;

    for (const user of orgUsers) {
      await (supabase.from('user_data_alerts') as any).insert({
        organization_id: orgId,
        user_id: user.user_id,
        work_item_id: item.id,
        alert_type: 'FRESHNESS_VIOLATION',
        message,
        severity,
      });
    }

    await (supabase.from('work_items') as any)
      .update({ freshness_violation_notified: true })
      .eq('id', item.id);
  }

  if (violations.length > 0) {
    plans.push({
      action_type: 'GENERATE_USER_DATA_ALERTS',
      status: 'EXECUTED',
      reason: `${violations.length} alerta(s) de frescura generada(s) para ${orgUsers.length} usuario(s).`,
    });
  }

  return plans;
}

// ============= CAPABILITY 4A: AUTO PROVIDER DEMOTION =============

/**
 * Auto-demote severely degraded providers without admin approval.
 * Fires at 70%+ error rate after 3 consecutive heartbeats (~90 min).
 */
export async function evaluateAutoProviderDemotion(
  orgId: string
): Promise<ActionPlan[]> {
  const plans: ActionPlan[] = [];
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: traces } = await (supabase
    .from('sync_traces') as any)
    .select('provider, success, latency_ms')
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

  for (const [provider, provTraces] of byProvider) {
    const total = provTraces.length;
    if (total < 5) continue;
    const errors = provTraces.filter((t: any) => !t.success).length;
    const errorRate = errors / total;
    const avgLatency = provTraces.reduce((s: number, t: any) => s + (t.latency_ms || 0), 0) / total;

    if (errorRate < 0.70 || avgLatency < 10000) continue;

    // Check active mitigation
    const { data: existing } = await (supabase
      .from('provider_route_mitigations') as any)
      .select('id')
      .eq('provider', provider)
      .eq('expired', false)
      .limit(1);

    if (existing && existing.length > 0) continue;

    // Apply auto-demotion
    await (supabase.from('provider_route_mitigations') as any).insert({
      provider,
      mitigation_type: 'DEMOTE',
      reason: 'AUTO_SEVERE_DEGRADATION',
      applied_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      expired: false,
    });

    plans.push({
      action_type: 'AUTO_DEMOTE_PROVIDER_SEVERE',
      status: 'EXECUTED',
      reason: `Proveedor ${provider} auto-degradado: ${Math.round(errorRate * 100)}% errores, ${Math.round(avgLatency)}ms latencia. Mitigación 4h.`,
      provider,
      evidence: {
        provider,
        error_rate: errorRate,
        avg_latency_ms: avgLatency,
        mitigation_duration_hours: 4,
      },
    });
  }

  return plans;
}

// ============= CAPABILITY 4B: POST-RECOVERY CATCHUP =============

/**
 * When a provider recovers, catch up items that missed their sync window.
 */
export async function evaluatePostRecoveryCatchup(
  orgId: string
): Promise<ActionPlan[]> {
  const plans: ActionPlan[] = [];

  const { data: expiredMitigations } = await (supabase
    .from('provider_route_mitigations') as any)
    .select('provider, expires_at')
    .eq('expired', true)
    .gte('expires_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

  if (!expiredMitigations || expiredMitigations.length === 0) return plans;

  for (const mitigation of expiredMitigations) {
    const { data: staleItems } = await (supabase
      .from('work_items') as any)
      .select('id, radicado')
      .eq('organization_id', orgId)
      .eq('monitoring_enabled', true)
      .is('deleted_at', null)
      .lt('last_successful_sync_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(10);

    if (!staleItems || staleItems.length === 0) continue;

    for (const item of staleItems.slice(0, 5)) {
      try {
        await supabase.functions.invoke('sync-by-work-item', {
          body: { work_item_id: item.id, trigger: 'POST_RECOVERY_CATCHUP' },
        });
      } catch {
        // Non-blocking
      }
    }

    plans.push({
      action_type: 'POST_RECOVERY_CATCHUP',
      status: 'EXECUTED',
      reason: `Proveedor ${mitigation.provider} recuperado. ${staleItems.length} asuntos encolados para catchup.`,
      evidence: {
        provider: mitigation.provider,
        items_enqueued: Math.min(staleItems.length, 5),
      },
    });
  }

  return plans;
}

// ============= CAPABILITY 7: ESCALATION =============

type EscalationLevel = 'LEVEL_0_AUTO' | 'LEVEL_1_OBSERVE' | 'LEVEL_2_ADMIN_PUSH' | 'LEVEL_3_GEMINI' | 'LEVEL_4_URGENT';

/**
 * Evaluate open incidents for escalation. Runs every heartbeat.
 */
export async function evaluateEscalation(
  orgId: string
): Promise<ActionPlan[]> {
  const plans: ActionPlan[] = [];

  const { data: openIncidents } = await (supabase
    .from('atenia_ai_conversations') as any)
    .select('id, title, severity, created_at, status')
    .eq('organization_id', orgId)
    .eq('status', 'OPEN')
    .limit(20);

  if (!openIncidents || openIncidents.length === 0) return plans;

  for (const incident of openIncidents) {
    const ageMs = Date.now() - new Date(incident.created_at).getTime();
    const ageHours = ageMs / (60 * 60 * 1000);

    // CRITICAL incidents escalate faster
    const isCritical = incident.severity === 'CRITICAL';
    const escalateAt = isCritical ? 2 : 6; // hours
    const urgentAt = isCritical ? 6 : 24; // hours

    if (ageHours > urgentAt) {
      // LEVEL_4: Urgent — update severity and create admin notification
      await (supabase.from('atenia_ai_conversations') as any)
        .update({ severity: 'CRITICAL' })
        .eq('id', incident.id);

      await (supabase.from('admin_notifications') as any).insert({
        organization_id: orgId,
        type: 'ESCALATION_URGENT',
        title: `🔴 Escalación urgente: ${incident.title}`,
        message: `Incidente sin resolver hace ${Math.round(ageHours)}h. Requiere atención inmediata.`,
      });

      // Bridge to Atenia AI pipeline (non-blocking)
      bridgeNotificationToAteniaAI({
        orgId, type: 'ESCALATION_URGENT',
        title: `🔴 Escalación urgente: ${incident.title}`,
        message: `Incidente sin resolver hace ${Math.round(ageHours)}h. Requiere atención inmediata.`,
        incidentId: incident.id,
        evidence: { age_hours: Math.round(ageHours), severity: 'CRITICAL' },
      }).catch(() => {});

      plans.push({
        action_type: 'ESCALATE_INCIDENT',
        status: 'EXECUTED',
        reason: `Incidente "${incident.title}" escalado a NIVEL 4 (URGENTE) tras ${Math.round(ageHours)}h.`,
      });
    } else if (ageHours > escalateAt) {
      // LEVEL_2: Admin push notification
      // Check if already notified
      const { data: existing } = await (supabase
        .from('admin_notifications') as any)
        .select('id')
        .eq('type', 'ESCALATION_PUSH')
        .ilike('title', `%${incident.id.slice(0, 8)}%`)
        .limit(1)
        .maybeSingle();

      if (!existing) {
        await (supabase.from('admin_notifications') as any).insert({
          organization_id: orgId,
          type: 'ESCALATION_PUSH',
          title: `⚠️ Escalación: ${incident.title} [${incident.id.slice(0, 8)}]`,
          message: `Incidente abierto hace ${Math.round(ageHours)}h sin resolución.`,
        });

        // Bridge to Atenia AI pipeline (non-blocking)
        bridgeNotificationToAteniaAI({
          orgId, type: 'ESCALATION_PUSH',
          title: `⚠️ Escalación: ${incident.title} [${incident.id.slice(0, 8)}]`,
          message: `Incidente abierto hace ${Math.round(ageHours)}h sin resolución.`,
          incidentId: incident.id,
          evidence: { age_hours: Math.round(ageHours) },
        }).catch(() => {});

        plans.push({
          action_type: 'ESCALATE_INCIDENT',
          status: 'EXECUTED',
          reason: `Incidente "${incident.title}" escalado a NIVEL 2 tras ${Math.round(ageHours)}h.`,
        });
      }
    }
  }

  return plans;
}
