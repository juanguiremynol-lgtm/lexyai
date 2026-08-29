/**
 * atenia-ai-conversation-wiring.ts — Connects heartbeat observations to conversations
 *
 * Problem 4 fix: Automatically creates/updates incident conversations from
 * heartbeat observations and autonomy cycle plans so the Operations Log
 * shows actual incidents instead of "No hay incidentes".
 */

import {
  findOrCreateConversation,
  addObservation,
  addMessage,
  type IncidentData,
} from './atenia-ai-conversations';

interface ObservationResult {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  data?: any;
}

interface ActionPlan {
  action_type: string;
  status: string;
  reason: string;
  work_item_id?: string;
  provider?: string;
  evidence?: Record<string, unknown>;
}

/**
 * Persist heartbeat observations and autonomy plans into conversations.
 * Uses fingerprinting to reuse OPEN conversations within 24h.
 */
export async function persistHeartbeatToConversations(
  orgId: string,
  observations: ObservationResult[],
  plans: ActionPlan[],
): Promise<void> {
  // Group observations by type for incident creation
  const providerDegraded = observations.filter(o => o.type === 'provider_degraded');
  const extFailures = observations.filter(o => o.type === 'ext_sync_failures' || o.type === 'ext_provider_degraded');
  const staleItems = observations.filter(o => o.type === 'stale_items');

  // 1. Provider degradation → conversation
  if (providerDegraded.length > 0) {
    const providers = providerDegraded.flatMap(o => {
      const data = o.data;
      if (Array.isArray(data)) return data.map((d: any) => d.provider).filter((p: any) => p && p !== 'none' && p !== 'null' && p !== 'undefined');
      return [];
    });
    
    // Only fire degradation alert if actual provider names exist
    if (providers.length === 0) {
      console.warn('[conv-wiring] Provider degradation detected but no valid provider names found — suppressing alert');
    } else {
      const severity = providerDegraded.some(o => o.severity === 'critical') ? 'CRITICAL' : 'WARNING';

      const incident: IncidentData = {
        orgId,
        channel: 'HEARTBEAT',
        severity: severity as any,
        title: `Proveedor(es) degradado(s): ${providers.join(', ')}`,
        providers,
      };

      try {
        const convId = await findOrCreateConversation(incident);
        if (convId) {
          await addObservation(convId, orgId, 'PROVIDER_DEGRADED_WIRING', severity, incident.title, {
            providers,
            observations: providerDegraded.map(o => o.message),
          });
        }
      } catch (err) {
        console.warn('[conv-wiring] Provider degradation conv error:', err);
      }
    }
  }

  // 2. External provider failures → conversation
  if (extFailures.length > 0) {
    const severity = extFailures.some(o => o.severity === 'critical') ? 'CRITICAL' : 'WARNING';
    const detail = extFailures.map(o => o.message).join('; ');

    const incident: IncidentData = {
      orgId,
      channel: 'HEARTBEAT',
      severity: severity as any,
      title: `Fallos de proveedores externos (${extFailures.length} señales)`,
    };

    try {
      const convId = await findOrCreateConversation(incident);
      if (convId) {
        await addObservation(convId, orgId, 'EXT_FAILURES', severity, detail, {
          count: extFailures.length,
        });
      }
    } catch (err) {
      console.warn('[conv-wiring] Ext failures conv error:', err);
    }
  }

  // 3. RETIRED (IR1): the ghost-items conversation is gone. A matter with no
  // provider rows is not an incident.

  // 4. Daily sync partial plans → conversation
  const dailyCont = plans.filter(p => p.action_type === 'DAILY_CONTINUATION');
  for (const plan of dailyCont) {
    if (plan.status === 'SKIPPED' && plan.reason.includes('CONVERGENCE_FAILED')) {
      const incident: IncidentData = {
        orgId,
        channel: 'DAILY_SYNC',
        severity: 'WARNING',
        title: 'Sync diario: convergencia fallida — cursor no avanza',
      };

      try {
        const convId = await findOrCreateConversation(incident);
        if (convId) {
          await addMessage(convId, 'system', plan.reason);
        }
      } catch (err) {
        console.warn('[conv-wiring] Daily sync conv error:', err);
      }
    }
  }
}
