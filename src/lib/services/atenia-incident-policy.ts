/**
 * atenia-incident-policy.ts — Incident Policy Engine
 *
 * Ops Hardening C:
 * - Auto-enqueue remediation on CRITICAL incident creation.
 * - Auto-resolve incidents when signals clear.
 * - Auto-escalate after threshold (2h for CRITICAL).
 * - Enforce "action_count > 0" for CRITICAL incidents.
 */

import { supabase } from "@/integrations/supabase/client";
import { bridgeNotificationToAteniaAI } from "./atenia-alert-bridge";

const CRITICAL_ESCALATION_THRESHOLD_HOURS = 2;
const SIGNAL_CLEAR_CYCLES = 3; // 3 heartbeat cycles (90 min) without observations → auto-resolve

/**
 * Evaluate all open incidents and apply the incident policy.
 * Called every heartbeat cycle.
 */
export async function evaluateIncidentPolicy(orgId: string): Promise<{
  remediated: number;
  auto_resolved: number;
  escalated: number;
}> {
  let remediated = 0;
  let auto_resolved = 0;
  let escalated = 0;

  const { data: openIncidents } = await (supabase.from("atenia_ai_conversations") as any)
    .select("id, title, severity, created_at, status, action_count, observation_count, remediation_disabled, first_remediation_at, auto_escalated_at, last_activity_at")
    .eq("organization_id", orgId)
    .eq("status", "OPEN")
    .limit(50);

  if (!openIncidents || openIncidents.length === 0) return { remediated, auto_resolved, escalated };

  for (const incident of openIncidents) {
    const ageMs = Date.now() - new Date(incident.created_at).getTime();
    const ageHours = ageMs / (60 * 60 * 1000);
    const isCritical = incident.severity === "CRITICAL";

    // ── 1. Enforce at least one remediation for CRITICAL ──
    if (isCritical && (incident.action_count ?? 0) === 0 && !incident.first_remediation_at) {
      if (incident.remediation_disabled) {
        // Mark incident with explicit "remediation disabled" note
        await (supabase.from("atenia_ai_op_messages") as any).insert({
          conversation_id: incident.id,
          role: "system",
          content_text: `⚠️ Incidente CRITICAL sin acciones de remediación. Remediation está deshabilitado para este incidente. Se requiere intervención manual.`,
        });
        await (supabase.from("atenia_ai_conversations") as any)
          .update({ message_count: (incident.message_count ?? 0) + 1 })
          .eq("id", incident.id);
      } else {
        // Auto-enqueue a remediation action
        try {
          await autoRemediateIncident(orgId, incident);
          remediated++;
        } catch { /* best-effort */ }
      }
    }

    // ── 2. Auto-resolve if signal has cleared ──
    const lastActivityAt = incident.last_activity_at ? new Date(incident.last_activity_at).getTime() : new Date(incident.created_at).getTime();
    const silenceHours = (Date.now() - lastActivityAt) / (60 * 60 * 1000);
    const silenceThreshold = SIGNAL_CLEAR_CYCLES * 0.5; // 1.5 hours of silence

    if (silenceHours > silenceThreshold && (incident.observation_count ?? 0) > 0) {
      // Check for recent observations (last 2h)
      const { count: recentObs } = await (supabase.from("atenia_ai_observations") as any)
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", incident.id)
        .gte("created_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

      if ((recentObs ?? 0) === 0) {
        await (supabase.from("atenia_ai_conversations") as any)
          .update({
            status: "RESOLVED",
            resolved_at: new Date().toISOString(),
            summary: `Auto-resuelto: sin observaciones repetidas en ${Math.round(silenceHours * 10) / 10}h.`,
          })
          .eq("id", incident.id);

        await (supabase.from("atenia_ai_op_messages") as any).insert({
          conversation_id: incident.id,
          role: "system",
          content_text: `✅ Incidente auto-resuelto: señal no se repitió en ${Math.round(silenceHours * 10) / 10}h. Resolución: AUTO_RESOLVED_SIGNAL_CLEARED.`,
        });

        auto_resolved++;
        continue;
      }
    }

    // ── 3. Auto-escalate CRITICAL after threshold ──
    if (isCritical && ageHours >= CRITICAL_ESCALATION_THRESHOLD_HOURS && !incident.auto_escalated_at) {
      // Get last remediation attempt
      const { data: lastAction } = await (supabase.from("atenia_ai_actions") as any)
        .select("id, action_type, created_at, action_result")
        .eq("organization_id", orgId)
        .ilike("reasoning", `%${incident.id.slice(0, 8)}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Get last observation
      const { data: lastObs } = await (supabase.from("atenia_ai_observations") as any)
        .select("title, severity, created_at")
        .eq("conversation_id", incident.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Create structured escalation payload
      const escalationPayload = {
        incident_id: incident.id,
        age_hours: Math.round(ageHours * 10) / 10,
        last_observation: lastObs ? { title: lastObs.title, severity: lastObs.severity, at: lastObs.created_at } : null,
        last_remediation: lastAction ? { type: lastAction.action_type, result: lastAction.action_result, at: lastAction.created_at } : null,
        recommended_next: incident.remediation_disabled
          ? "Habilitar remediación automática o intervenir manualmente."
          : "Revisar diagnóstico y aplicar corrección manual si la remediación automática no fue suficiente.",
      };

      await (supabase.from("admin_notifications") as any).insert({
        organization_id: orgId,
        type: "INCIDENT_AUTO_ESCALATION",
        title: `🚨 Escalación automática: ${incident.title}`,
        message: `Incidente CRITICAL abierto hace ${Math.round(ageHours)}h con ${incident.action_count ?? 0} acciones. Requiere atención.`,
      });

      // Bridge escalation to Atenia AI pipeline (non-blocking)
      bridgeNotificationToAteniaAI({
        orgId,
        type: 'INCIDENT_AUTO_ESCALATION',
        title: `🚨 Escalación automática: ${incident.title}`,
        message: `Incidente CRITICAL abierto hace ${Math.round(ageHours)}h con ${incident.action_count ?? 0} acciones. Requiere atención.`,
        incidentId: incident.id,
        evidence: escalationPayload,
      }).catch(() => {});

      await (supabase.from("atenia_ai_conversations") as any)
        .update({ auto_escalated_at: new Date().toISOString() })
        .eq("id", incident.id);

      await (supabase.from("atenia_ai_op_messages") as any).insert({
        conversation_id: incident.id,
        role: "system",
        content_text: `🚨 Auto-escalado tras ${Math.round(ageHours)}h sin resolución. Payload: ${JSON.stringify(escalationPayload)}`,
      });

      escalated++;
    }
  }

  // Log policy execution
  if (remediated + auto_resolved + escalated > 0) {
    try {
      await (supabase.from("atenia_ai_actions") as any).insert({
        organization_id: orgId,
        action_type: "INCIDENT_POLICY_EVAL",
        actor: "AI_AUTOPILOT",
        autonomy_tier: "ACT",
        reasoning: `Política de incidentes: ${remediated} remediados, ${auto_resolved} auto-resueltos, ${escalated} escalados.`,
        action_result: "applied",
        status: "EXECUTED",
        evidence: { remediated, auto_resolved, escalated },
      });
    } catch { /* best-effort */ }
  }

  return { remediated, auto_resolved, escalated };
}

/**
 * Auto-remediate: enqueue a sync retry for work items related to the incident.
 */
async function autoRemediateIncident(orgId: string, incident: any): Promise<void> {
  // Find related work items from observations
  const { data: observations } = await (supabase.from("atenia_ai_observations") as any)
    .select("payload")
    .eq("conversation_id", incident.id)
    .limit(5);

  // Try to extract work_item_ids from observation payloads
  const workItemIds = new Set<string>();
  for (const obs of observations ?? []) {
    const payload = obs.payload as any;
    if (payload?.work_item_id) workItemIds.add(payload.work_item_id);
    if (payload?.work_item_ids) {
      for (const id of payload.work_item_ids) workItemIds.add(id);
    }
  }

  // If no specific work items, enqueue a general remediation action
  if (workItemIds.size === 0) {
    await (supabase.from("atenia_ai_remediation_queue") as any).insert({
      organization_id: orgId,
      action_type: "INCIDENT_AUTO_REMEDIATION",
      payload: { incident_id: incident.id, incident_title: incident.title },
      priority: 1,
      status: "PENDING",
      dedupe_key: `incident_remediation_${incident.id}`,
    });
  } else {
    // Enqueue sync for each related work item
    for (const wiId of Array.from(workItemIds).slice(0, 3)) {
      try {
        await supabase.functions.invoke("sync-by-work-item", {
          body: { work_item_id: wiId, trigger: "INCIDENT_AUTO_REMEDIATION" },
        });
      } catch { /* best-effort */ }
    }
  }

  // Update incident with first remediation timestamp
  await (supabase.from("atenia_ai_conversations") as any)
    .update({
      first_remediation_at: new Date().toISOString(),
      action_count: (incident.action_count ?? 0) + 1,
    })
    .eq("id", incident.id);

  await (supabase.from("atenia_ai_op_messages") as any).insert({
    conversation_id: incident.id,
    role: "system",
    content_text: `🔧 Remediación automática encolada: ${workItemIds.size > 0 ? `sync para ${workItemIds.size} work item(s)` : "acción general de remediación"}.`,
  });
}
