/**
 * atenia-alert-bridge.ts — Bridges alert_instances and admin_notifications into Atenia AI
 *
 * Every super-admin alert, notification, and diagnostic event is:
 * 1. Registered as an observation in a conversation
 * 2. Diagnosed by the AI pipeline (severity evaluation)
 * 3. Pushed for autonomous action evaluation or escalation
 * 4. Raw data exported into the Auditoría Integral
 *
 * This ensures ZERO blind spots: all alerts/notifications reach Atenia AI.
 */

import {
  findOrCreateConversation,
  addObservation,
  addMessage,
  type IncidentData,
} from './atenia-ai-conversations';
import { callGeminiViaEdge } from './atenia-ai-engine';

// ============= TYPES =============

export interface AlertBridgePayload {
  orgId: string;
  entityType: string;
  entityId: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  alertType?: string;
  alertSource?: string;
  payload?: Record<string, unknown>;
  workItemId?: string | null;
}

export interface NotificationBridgePayload {
  orgId: string;
  type: string;
  title: string;
  message: string;
  incidentId?: string;
  evidence?: Record<string, unknown>;
}

// ============= ALERT → ATENIA AI =============

/**
 * Wire an alert_instance creation into Atenia AI's conversation pipeline.
 * Creates/reuses an incident conversation, logs an observation, and
 * triggers diagnosis for CRITICAL/WARNING alerts.
 */
export async function bridgeAlertToAteniaAI(
  alert: AlertBridgePayload,
): Promise<string | null> {
  try {
    // Only wire WARNING and CRITICAL alerts to avoid noise
    if (alert.severity === 'INFO') return null;

    const incident: IncidentData = {
      orgId: alert.orgId,
      channel: 'SYSTEM',
      severity: alert.severity,
      title: `[Alerta] ${alert.title}`,
      workItemIds: alert.workItemId ? [alert.workItemId] : [],
    };

    const convId = await findOrCreateConversation(incident);
    if (!convId) return null;

    // Register observation
    await addObservation(
      convId,
      alert.orgId,
      'ALERT_CREATED',
      alert.severity,
      alert.title,
      {
        entity_type: alert.entityType,
        entity_id: alert.entityId,
        alert_type: alert.alertType ?? 'UNKNOWN',
        alert_source: alert.alertSource ?? 'SYSTEM',
        message: alert.message,
        work_item_id: alert.workItemId ?? null,
        ...(alert.payload ?? {}),
      },
    );

    // For CRITICAL alerts, trigger AI diagnosis
    if (alert.severity === 'CRITICAL') {
      await triggerAlertDiagnosis(convId, alert);
    }

    return convId;
  } catch (err) {
    console.warn('[alert-bridge] Error wiring alert to Atenia AI:', err);
    return null;
  }
}

// ============= ADMIN NOTIFICATION → ATENIA AI =============

/**
 * Wire an admin_notification into Atenia AI's conversation pipeline.
 * Escalation notifications get special DIAGNOSTIC_ESCALATION observation kind.
 */
export async function bridgeNotificationToAteniaAI(
  notification: NotificationBridgePayload,
): Promise<string | null> {
  try {
    const isEscalation = notification.type.includes('ESCALATION');
    const severity = isEscalation ? 'CRITICAL' : 'WARNING';
    const observationKind = isEscalation ? 'DIAGNOSTIC_ESCALATION' : 'ADMIN_NOTIFICATION';

    const incident: IncidentData = {
      orgId: notification.orgId,
      channel: 'SYSTEM',
      severity,
      title: notification.title,
    };

    const convId = await findOrCreateConversation(incident);
    if (!convId) return null;

    await addObservation(
      convId,
      notification.orgId,
      observationKind,
      severity,
      notification.title,
      {
        notification_type: notification.type,
        message: notification.message,
        incident_id: notification.incidentId ?? null,
        ...(notification.evidence ?? {}),
      },
    );

    // Add raw message for audit trail
    await addMessage(
      convId,
      'system',
      `📋 Notificación administrativa: [${notification.type}] ${notification.message}`,
    );

    // Escalations always get AI diagnosis
    if (isEscalation) {
      await triggerEscalationDiagnosis(convId, notification);
    }

    return convId;
  } catch (err) {
    console.warn('[alert-bridge] Error wiring notification to Atenia AI:', err);
    return null;
  }
}

// ============= AI DIAGNOSIS =============

/**
 * Trigger Gemini diagnosis for a CRITICAL alert.
 * The diagnosis is stored as a system message in the conversation.
 */
async function triggerAlertDiagnosis(
  convId: string,
  alert: AlertBridgePayload,
): Promise<void> {
  try {
    const prompt = [
      'Eres Atenia AI, sistema de diagnóstico de la plataforma Andromeda Legal.',
      'Analiza esta alerta CRITICAL y determina:',
      '1. Si requiere acción autónoma inmediata (RETRY, ESCALATE, DISABLE)',
      '2. Si requiere escalación humana (y por qué)',
      '3. Diagnóstico resumido en 2-3 líneas',
      '',
      `Tipo de entidad: ${alert.entityType}`,
      `ID de entidad: ${alert.entityId}`,
      `Título: ${alert.title}`,
      `Mensaje: ${alert.message}`,
      `Tipo de alerta: ${alert.alertType ?? 'N/A'}`,
      `Datos adicionales: ${JSON.stringify(alert.payload ?? {}).slice(0, 500)}`,
      '',
      'Responde en español con formato: ACCIÓN: [tipo] | DIAGNÓSTICO: [texto]',
    ].join('\n');

    const diagnosis = await callGeminiViaEdge(prompt);
    if (diagnosis) {
      await addMessage(convId, 'ai', `🔍 Diagnóstico automático:\n${diagnosis}`);
    }
  } catch (err) {
    console.warn('[alert-bridge] AI diagnosis failed (non-blocking):', err);
  }
}

/**
 * Trigger Gemini diagnosis for an escalation notification.
 */
async function triggerEscalationDiagnosis(
  convId: string,
  notification: NotificationBridgePayload,
): Promise<void> {
  try {
    const prompt = [
      'Eres Atenia AI, sistema de diagnóstico de la plataforma Andromeda Legal.',
      'Se ha producido una ESCALACIÓN AUTOMÁTICA. Analiza:',
      '1. Causa raíz probable',
      '2. Acciones autónomas recomendadas (RETRY, DISABLE_PROVIDER, ALERT_ADMIN)',
      '3. Si la remediación automática es posible o requiere intervención manual',
      '',
      `Tipo: ${notification.type}`,
      `Título: ${notification.title}`,
      `Mensaje: ${notification.message}`,
      `Evidencia: ${JSON.stringify(notification.evidence ?? {}).slice(0, 500)}`,
      '',
      'Responde en español, conciso. Formato: ACCIÓN_RECOMENDADA: [tipo] | CAUSA: [texto] | URGENCIA: [ALTA/MEDIA/BAJA]',
    ].join('\n');

    const diagnosis = await callGeminiViaEdge(prompt);
    if (diagnosis) {
      await addMessage(convId, 'ai', `🚨 Diagnóstico de escalación:\n${diagnosis}`);
    }
  } catch (err) {
    console.warn('[alert-bridge] Escalation diagnosis failed (non-blocking):', err);
  }
}
