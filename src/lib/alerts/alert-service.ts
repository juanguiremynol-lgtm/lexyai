/**
 * Alert Service - Idempotent alert creation with deduplication
 * 
 * This service ensures alerts are created only once per unique event,
 * preventing duplicate alerts from repeated ingestion/scrape runs.
 */

import { supabase } from '@/integrations/supabase/client';
import crypto from 'crypto';

export type AlertEntityType = 
  | 'CGP_FILING' 
  | 'CGP_CASE' 
  | 'PETICION' 
  | 'TUTELA' 
  | 'CPACA' 
  | 'ADMIN_PROCESS'
  | 'GOV_PROCEDURE'
  | 'PENAL_906'
  | 'LABORAL';

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertStatus = 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'RESOLVED' | 'CANCELLED' | 'DISMISSED';

export interface CreateAlertParams {
  ownerId: string;
  organizationId?: string;
  entityType: AlertEntityType;
  entityId: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
  actions?: Array<{
    label: string;
    action: string;
    params?: Record<string, unknown>;
  }>;
  // Deduplication keys (optional - will be computed if not provided)
  /**
   * Explicit opt-in to reopen an alert the lawyer already closed
   * (DISMISSED/RESOLVED). Default false: re-reading the same evidence must
   * never resurrect a user decision.
   */
  reopen?: boolean;
  fingerprintKeys?: {
    radicado?: string;
    eventType?: string;
    eventDate?: string;
  };
}

/**
 * Compute a stable fingerprint for deduplication
 * Fingerprint is based on: org/owner + entity + event characteristics
 */
function computeFingerprint(params: CreateAlertParams): string {
  const parts = [
    params.organizationId || params.ownerId,
    params.entityType,
    params.entityId,
    params.fingerprintKeys?.radicado || (params.payload?.radicado as string) || '',
    params.fingerprintKeys?.eventType || (params.payload?.event_type as string) || params.title,
    params.fingerprintKeys?.eventDate || (params.payload?.event_date as string) || new Date().toISOString().split('T')[0],
  ];
  
  const raw = parts.join(':');
  
  // Use browser-compatible hashing if crypto is not available
  if (typeof window !== 'undefined') {
    // Simple hash for browser environment
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0') + '_' + raw.length.toString(16);
  }
  
  // Node environment
  return crypto.createHash('md5').update(raw).digest('hex');
}

/** Statuses a lawyer sets by hand. Durable: never auto-reopened. */
export const USER_CLOSED_STATUSES = ['DISMISSED', 'RESOLVED'] as const;
/** Active statuses shown in every alert list. */
export const ACTIVE_ALERT_STATUSES = ['PENDING', 'SENT', 'ACKNOWLEDGED'] as const;

/**
 * Reopen policy for an existing fingerprint.
 * - DISMISSED/RESOLVED (user decision): keep closed unless `explicitReopen`.
 * - CANCELLED (retired by the system because the condition disappeared):
 *   reopen, since the same condition being detected again is new information
 *   and no user decision is overridden.
 * - Active: no-op.
 */
export function decideReopen(
  status: string,
  explicitReopen: boolean,
): 'noop' | 'keep_closed' | 'reopen' {
  if ((USER_CLOSED_STATUSES as readonly string[]).includes(status)) {
    return explicitReopen ? 'reopen' : 'keep_closed';
  }
  if (status === 'CANCELLED') return 'reopen';
  return 'noop';
}

/**
 * Create an alert idempotently - will not create duplicates
 * Uses fingerprint to detect existing alerts for the same event
 */
export async function createAlertIdempotent(params: CreateAlertParams): Promise<{
  success: boolean;
  alertId?: string;
  isDuplicate?: boolean;
  reopened?: boolean;
  closedByUser?: boolean;
  error?: string;
}> {
  const fingerprint = computeFingerprint(params);
  
  try {
    // Check if alert with same fingerprint already exists and is active
    const { data: existing } = await supabase
      .from('alert_instances')
      .select('id, status')
      .eq('fingerprint', fingerprint)
      .maybeSingle();
    
    if (existing) {
      const decision = decideReopen(existing.status, params.reopen === true);
      if (decision === 'reopen') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updatePayload: any = {
          status: 'PENDING',
          fired_at: new Date().toISOString(),
          acknowledged_at: null,
          resolved_at: null,
          dismissed_at: null,
          read_at: null,
          seen_at: null,
          message: params.message,
          payload: params.payload || null,
        };
        const { error: updateError } = await supabase
          .from('alert_instances')
          .update(updatePayload)
          .eq('id', existing.id);
        if (updateError) {
          return { success: false, error: updateError.message };
        }
        return { success: true, alertId: existing.id, isDuplicate: true, reopened: true };
      }
      // Active, or closed by the lawyer: never duplicate, never resurrect.
      return {
        success: true,
        alertId: existing.id,
        isDuplicate: true,
        closedByUser: decision === 'keep_closed',
      };
    }

    // Create new alert with fingerprint
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertData: any = {
      owner_id: params.ownerId,
      organization_id: params.organizationId || null,
      entity_type: params.entityType,
      entity_id: params.entityId,
      severity: params.severity,
      status: 'PENDING',
      title: params.title,
      message: params.message,
      payload: params.payload || null,
      actions: params.actions || null,
      fingerprint,
    };
    
    const { data: newAlert, error: insertError } = await supabase
      .from('alert_instances')
      .insert([insertData])
      .select('id')
      .single();
    
    if (insertError) {
      // Handle unique constraint violation gracefully (race condition)
      if (insertError.code === '23505') {
        return { success: true, isDuplicate: true };
      }
      return { success: false, error: insertError.message };
    }
    
    return { success: true, alertId: newAlert.id, isDuplicate: false };
    
  } catch (err) {
    console.error('Error creating alert:', err);
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Unknown error' 
    };
  }
}

type BulkResult = { success: boolean; count?: number; error?: string };

/**
 * Close alerts (DISMISSED or RESOLVED) and mark them read in the same action.
 * read_at/seen_at are only filled when null so the first-read time is kept.
 * Only active rows are touched, which makes repeated calls idempotent.
 */
async function closeAlerts(ids: string[], status: 'DISMISSED' | 'RESOLVED'): Promise<BulkResult> {
  if (ids.length === 0) return { success: true, count: 0 };
  const now = new Date().toISOString();
  const closePayload =
    status === 'DISMISSED' ? { status, dismissed_at: now } : { status, resolved_at: now };
  const { data, error } = await supabase
    .from('alert_instances')
    .update(closePayload)
    .in('id', ids)
    .in('status', [...ACTIVE_ALERT_STATUSES])
    .select('id');
  if (error) return { success: false, error: error.message };
  const r1 = await supabase.from('alert_instances').update({ read_at: now }).in('id', ids).is('read_at', null);
  if (r1.error) return { success: false, error: r1.error.message };
  const r2 = await supabase.from('alert_instances').update({ seen_at: now }).in('id', ids).is('seen_at', null);
  if (r2.error) return { success: false, error: r2.error.message };
  return { success: true, count: data?.length || 0 };
}

/** Dismiss = not relevant / no attention needed. */
export async function dismissAlert(alertId: string): Promise<{ success: boolean; error?: string }> {
  const r = await closeAlerts([alertId], 'DISMISSED');
  return { success: r.success, error: r.error };
}

export async function dismissAlerts(alertIds: string[]): Promise<BulkResult> {
  return closeAlerts(alertIds, 'DISMISSED');
}

/** Resolve = handled / attended by the lawyer. */
export async function resolveAlert(alertId: string): Promise<{ success: boolean; error?: string }> {
  const r = await closeAlerts([alertId], 'RESOLVED');
  return { success: r.success, error: r.error };
}

export async function resolveAlerts(alertIds: string[]): Promise<BulkResult> {
  return closeAlerts(alertIds, 'RESOLVED');
}

/**
 * Mark alerts read. Single read semantic: read_at and seen_at together, so the
 * page counter ("Sin leer") and the global badge never disagree.
 */
export async function markAlertsAsRead(alertIds: string[]): Promise<BulkResult> {
  if (alertIds.length === 0) return { success: true, count: 0 };
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('alert_instances')
    .update({ read_at: now, seen_at: now })
    .in('id', alertIds)
    .is('read_at', null)
    .select('id');
  if (error) return { success: false, error: error.message };
  // Rows already read but never "seen" (legacy) get seen_at aligned too.
  await supabase.from('alert_instances').update({ seen_at: now }).in('id', alertIds).is('seen_at', null);
  return { success: true, count: data?.length || 0 };
}

/**
 * Snooze multiple alerts until a specified date
 */
export async function snoozeAlerts(alertIds: string[], snoozeUntil: Date): Promise<{ success: boolean; count?: number; error?: string }> {
  if (alertIds.length === 0) {
    return { success: true, count: 0 };
  }
  
  const { data, error } = await supabase
    .from('alert_instances')
    .update({
      snoozed_until: snoozeUntil.toISOString(),
    })
    .in('id', alertIds)
    .select('id');
  
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, count: data?.length || 0 };
}

/**
 * Dismiss all active alerts for the current user
 */
export async function dismissAllAlerts(ownerId: string): Promise<BulkResult> {
  const { data, error } = await supabase
    .from('alert_instances')
    .select('id')
    .eq('owner_id', ownerId)
    .in('status', [...ACTIVE_ALERT_STATUSES]);
  if (error) return { success: false, error: error.message };
  return closeAlerts((data ?? []).map((d) => d.id), 'DISMISSED');
}

/**
 * Legacy acknowledge (kept for old data/callers). Also marks read.
 */
export async function acknowledgeAlert(alertId: string): Promise<{ success: boolean; error?: string }> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('alert_instances')
    .update({ status: 'ACKNOWLEDGED', acknowledged_at: now })
    .eq('id', alertId);
  if (error) return { success: false, error: error.message };
  await markAlertsAsRead([alertId]);
  return { success: true };
}
