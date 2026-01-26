/**
 * Notification Rules Service
 * Handles CRUD operations for notification rules and recipient directory
 */

import { supabase } from '@/integrations/supabase/client';
import type { 
  NotificationRule, 
  NotificationRuleFormData,
  NotificationRecipient,
  NotificationRecipientFormData,
  Severity,
  TriggerEvent 
} from './types';

// ============================================
// NOTIFICATION RULES
// ============================================

export async function fetchNotificationRules(organizationId: string): Promise<NotificationRule[]> {
  const { data, error } = await supabase
    .from('notification_rules')
    .select('*')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as NotificationRule[];
}

export async function createNotificationRule(
  organizationId: string,
  formData: NotificationRuleFormData
): Promise<NotificationRule> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No autenticado');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertData: any = {
    organization_id: organizationId,
    name: formData.name,
    description: formData.description || null,
    enabled: formData.enabled,
    workflow_types: formData.workflow_types,
    alert_categories: formData.alert_categories,
    severity_min: formData.severity_min,
    trigger_event: formData.trigger_event,
    trigger_params: formData.trigger_params || {},
    dedupe_window_minutes: formData.dedupe_window_minutes,
    max_per_10min: formData.max_per_10min,
    recipient_mode: formData.recipient_mode,
    recipient_emails: formData.recipient_emails,
    recipient_role: formData.recipient_role || null,
    use_recipient_directory: formData.use_recipient_directory,
    subject_template: formData.subject_template || null,
    body_template: formData.body_template || null,
    created_by: user.id,
  };

  const { data, error } = await supabase
    .from('notification_rules')
    .insert([insertData])
    .select()
    .single();

  if (error) throw error;
  return data as unknown as NotificationRule;
}

export async function updateNotificationRule(
  ruleId: string,
  formData: Partial<NotificationRuleFormData>
): Promise<NotificationRule> {
  const updateData: Record<string, unknown> = {};
  
  if (formData.name !== undefined) updateData.name = formData.name;
  if (formData.description !== undefined) updateData.description = formData.description;
  if (formData.enabled !== undefined) updateData.enabled = formData.enabled;
  if (formData.workflow_types !== undefined) updateData.workflow_types = formData.workflow_types;
  if (formData.alert_categories !== undefined) updateData.alert_categories = formData.alert_categories;
  if (formData.severity_min !== undefined) updateData.severity_min = formData.severity_min;
  if (formData.trigger_event !== undefined) updateData.trigger_event = formData.trigger_event;
  if (formData.trigger_params !== undefined) updateData.trigger_params = formData.trigger_params;
  if (formData.dedupe_window_minutes !== undefined) updateData.dedupe_window_minutes = formData.dedupe_window_minutes;
  if (formData.max_per_10min !== undefined) updateData.max_per_10min = formData.max_per_10min;
  if (formData.recipient_mode !== undefined) updateData.recipient_mode = formData.recipient_mode;
  if (formData.recipient_emails !== undefined) updateData.recipient_emails = formData.recipient_emails;
  if (formData.recipient_role !== undefined) updateData.recipient_role = formData.recipient_role;
  if (formData.use_recipient_directory !== undefined) updateData.use_recipient_directory = formData.use_recipient_directory;
  if (formData.subject_template !== undefined) updateData.subject_template = formData.subject_template;
  if (formData.body_template !== undefined) updateData.body_template = formData.body_template;

  const { data, error } = await supabase
    .from('notification_rules')
    .update(updateData)
    .eq('id', ruleId)
    .select()
    .single();

  if (error) throw error;
  return data as NotificationRule;
}

export async function toggleNotificationRule(ruleId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('notification_rules')
    .update({ enabled })
    .eq('id', ruleId);

  if (error) throw error;
}

export async function deleteNotificationRule(ruleId: string): Promise<void> {
  // Soft delete
  const { error } = await supabase
    .from('notification_rules')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', ruleId);

  if (error) throw error;
}

export async function duplicateNotificationRule(ruleId: string): Promise<NotificationRule> {
  // Fetch original rule
  const { data: original, error: fetchError } = await supabase
    .from('notification_rules')
    .select('*')
    .eq('id', ruleId)
    .single();

  if (fetchError) throw fetchError;
  if (!original) throw new Error('Regla no encontrada');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No autenticado');

  // Create duplicate
  const { data, error } = await supabase
    .from('notification_rules')
    .insert({
      organization_id: original.organization_id,
      name: `${original.name} (copia)`,
      description: original.description,
      enabled: false, // Disabled by default
      workflow_types: original.workflow_types,
      alert_categories: original.alert_categories,
      severity_min: original.severity_min,
      trigger_event: original.trigger_event,
      trigger_params: original.trigger_params,
      dedupe_window_minutes: original.dedupe_window_minutes,
      max_per_10min: original.max_per_10min,
      recipient_mode: original.recipient_mode,
      recipient_emails: original.recipient_emails,
      recipient_role: original.recipient_role,
      use_recipient_directory: original.use_recipient_directory,
      subject_template: original.subject_template,
      body_template: original.body_template,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) throw error;
  return data as NotificationRule;
}

// ============================================
// NOTIFICATION RECIPIENTS
// ============================================

export async function fetchNotificationRecipients(organizationId: string): Promise<NotificationRecipient[]> {
  const { data, error } = await supabase
    .from('notification_recipients')
    .select('*')
    .eq('organization_id', organizationId)
    .order('label', { ascending: true });

  if (error) throw error;
  return (data || []) as NotificationRecipient[];
}

export async function createNotificationRecipient(
  organizationId: string,
  formData: NotificationRecipientFormData
): Promise<NotificationRecipient> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('notification_recipients')
    .insert({
      organization_id: organizationId,
      email: formData.email.toLowerCase().trim(),
      label: formData.label,
      enabled: formData.enabled,
      tags: formData.tags,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) throw error;
  return data as NotificationRecipient;
}

export async function updateNotificationRecipient(
  recipientId: string,
  formData: Partial<NotificationRecipientFormData>
): Promise<NotificationRecipient> {
  const updateData: Record<string, unknown> = {};
  
  if (formData.email !== undefined) updateData.email = formData.email.toLowerCase().trim();
  if (formData.label !== undefined) updateData.label = formData.label;
  if (formData.enabled !== undefined) updateData.enabled = formData.enabled;
  if (formData.tags !== undefined) updateData.tags = formData.tags;

  const { data, error } = await supabase
    .from('notification_recipients')
    .update(updateData)
    .eq('id', recipientId)
    .select()
    .single();

  if (error) throw error;
  return data as NotificationRecipient;
}

export async function deleteNotificationRecipient(recipientId: string): Promise<void> {
  const { error } = await supabase
    .from('notification_recipients')
    .delete()
    .eq('id', recipientId);

  if (error) throw error;
}

export async function toggleNotificationRecipient(recipientId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('notification_recipients')
    .update({ enabled })
    .eq('id', recipientId);

  if (error) throw error;
}

// ============================================
// RULE MATCHING LOGIC (for edge functions)
// ============================================

/**
 * Check if an alert matches any enabled notification rules
 * This is used by edge functions to determine if an email should be sent
 */
export async function findMatchingRules(
  organizationId: string,
  params: {
    triggerEvent: TriggerEvent;
    severity: Severity;
    workflowType?: string;
    alertCategory?: string;
  }
): Promise<NotificationRule[]> {
  const { data, error } = await supabase
    .from('notification_rules')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('enabled', true)
    .eq('trigger_event', params.triggerEvent)
    .is('deleted_at', null);

  if (error) throw error;

  const severityOrder: Record<string, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };
  const currentSeverityLevel = severityOrder[params.severity] ?? 0;

  // Filter rules based on criteria
  return (data || []).filter((rule) => {
    // Check severity threshold
    const ruleSeverityLevel = severityOrder[rule.severity_min] ?? 0;
    if (currentSeverityLevel < ruleSeverityLevel) return false;

    // Check workflow type filter (empty = all)
    if (rule.workflow_types && rule.workflow_types.length > 0 && params.workflowType) {
      if (!rule.workflow_types.includes(params.workflowType)) return false;
    }

    // Check alert category filter (empty = all)
    if (rule.alert_categories && rule.alert_categories.length > 0 && params.alertCategory) {
      if (!rule.alert_categories.includes(params.alertCategory)) return false;
    }

    return true;
  }) as unknown as NotificationRule[];
}

/**
 * Check if sending is allowed based on dedupe and rate limits
 */
export async function canSendEmail(
  organizationId: string,
  rule: NotificationRule,
  dedupeKey: string
): Promise<{ allowed: boolean; reason?: string }> {
  // Check dedupe window
  if (rule.dedupe_window_minutes > 0) {
    const windowStart = new Date(Date.now() - rule.dedupe_window_minutes * 60 * 1000).toISOString();
    
    const { data: existing } = await supabase
      .from('email_outbox')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('dedupe_key', dedupeKey)
      .gte('created_at', windowStart)
      .limit(1);

    if (existing && existing.length > 0) {
      return { allowed: false, reason: 'Duplicate within dedupe window' };
    }
  }

  // Check rate limit
  if (rule.max_per_10min > 0) {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    
    const { count } = await supabase
      .from('email_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('notification_rule_id', rule.id)
      .gte('created_at', tenMinutesAgo);

    if (count !== null && count >= rule.max_per_10min) {
      return { allowed: false, reason: 'Rate limit exceeded' };
    }
  }

  return { allowed: true };
}
