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

/**
 * Create an alert idempotently - will not create duplicates
 * Uses fingerprint to detect existing alerts for the same event
 */
export async function createAlertIdempotent(params: CreateAlertParams): Promise<{
  success: boolean;
  alertId?: string;
  isDuplicate?: boolean;
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
      // Alert already exists
      if (['DISMISSED', 'RESOLVED', 'CANCELLED'].includes(existing.status)) {
        // Previous alert was dismissed/resolved - update it back to active if needed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updatePayload: any = {
          status: 'PENDING',
          fired_at: new Date().toISOString(),
          acknowledged_at: null,
          resolved_at: null,
          dismissed_at: null,
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
        return { success: true, alertId: existing.id, isDuplicate: true };
      }
      
      // Alert is still active - don't create duplicate
      return { success: true, alertId: existing.id, isDuplicate: true };
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

/**
 * Dismiss an alert - marks it as DISMISSED and removes from active view
 */
export async function dismissAlert(alertId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('alert_instances')
    .update({
      status: 'DISMISSED',
      dismissed_at: new Date().toISOString(),
    })
    .eq('id', alertId);
  
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/**
 * Dismiss multiple alerts
 */
export async function dismissAlerts(alertIds: string[]): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('alert_instances')
    .update({
      status: 'DISMISSED',
      dismissed_at: new Date().toISOString(),
    })
    .in('id', alertIds);
  
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/**
 * Dismiss all active alerts for the current user
 */
export async function dismissAllAlerts(ownerId: string): Promise<{ success: boolean; count?: number; error?: string }> {
  const { data, error } = await supabase
    .from('alert_instances')
    .update({
      status: 'DISMISSED',
      dismissed_at: new Date().toISOString(),
    })
    .eq('owner_id', ownerId)
    .in('status', ['PENDING', 'SENT', 'ACKNOWLEDGED'])
    .select('id');
  
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, count: data?.length || 0 };
}

/**
 * Acknowledge an alert (mark as seen but not dismissed)
 */
export async function acknowledgeAlert(alertId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('alert_instances')
    .update({
      status: 'ACKNOWLEDGED',
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', alertId);
  
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/**
 * Resolve an alert (action completed)
 */
export async function resolveAlert(alertId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('alert_instances')
    .update({
      status: 'RESOLVED',
      resolved_at: new Date().toISOString(),
    })
    .eq('id', alertId);
  
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}
