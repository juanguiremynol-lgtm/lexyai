/**
 * Email Delivery Log Service
 * Fetches email outbox entries with full audit trail
 */

import { supabase } from '@/integrations/supabase/client';
import type { EmailOutboxEntry, EmailDeliveryEvent } from './types';

export interface DeliveryLogFilters {
  status?: string;
  ruleId?: string;
  recipient?: string;
  workflowType?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface DeliveryLogPage {
  data: EmailOutboxEntry[];
  count: number;
  page: number;
  pageSize: number;
}

export async function fetchDeliveryLog(
  organizationId: string,
  filters: DeliveryLogFilters = {},
  page = 1,
  pageSize = 25
): Promise<DeliveryLogPage> {
  let query = supabase
    .from('email_outbox')
    .select(`
      *,
      work_item:work_items(id, radicado, title, workflow_type),
      notification_rule:notification_rules(id, name)
    `, { count: 'exact' })
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  // Apply filters
  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  if (filters.ruleId) {
    query = query.eq('notification_rule_id', filters.ruleId);
  }

  if (filters.recipient) {
    query = query.ilike('to_email', `%${filters.recipient}%`);
  }

  if (filters.dateFrom) {
    query = query.gte('created_at', filters.dateFrom);
  }

  if (filters.dateTo) {
    query = query.lte('created_at', filters.dateTo);
  }

  if (filters.search) {
    query = query.or(`subject.ilike.%${filters.search}%,to_email.ilike.%${filters.search}%`);
  }

  // Pagination
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) throw error;

  return {
    data: (data || []) as EmailOutboxEntry[],
    count: count || 0,
    page,
    pageSize,
  };
}

export async function fetchEmailDetails(emailId: string): Promise<EmailOutboxEntry | null> {
  const { data, error } = await supabase
    .from('email_outbox')
    .select(`
      *,
      work_item:work_items(id, radicado, title, workflow_type),
      notification_rule:notification_rules(id, name)
    `)
    .eq('id', emailId)
    .maybeSingle();

  if (error) throw error;
  return data as EmailOutboxEntry | null;
}

export async function fetchDeliveryEvents(emailOutboxId: string): Promise<EmailDeliveryEvent[]> {
  const { data, error } = await supabase
    .from('email_delivery_events')
    .select('*')
    .eq('email_outbox_id', emailOutboxId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as EmailDeliveryEvent[];
}

export async function retryEmail(emailId: string): Promise<{ success: boolean; newEmailId?: string; error?: string }> {
  // Fetch original email
  const { data: original, error: fetchError } = await supabase
    .from('email_outbox')
    .select('*')
    .eq('id', emailId)
    .single();

  if (fetchError) return { success: false, error: fetchError.message };
  if (!original) return { success: false, error: 'Email no encontrado' };

  // Only allow retry for failed emails
  if (!['FAILED_TEMP', 'FAILED_PERM', 'BOUNCED'].includes(original.status)) {
    return { success: false, error: 'Solo se pueden reintentar emails fallidos' };
  }

  // Create new outbox entry (don't mutate original)
  const { data: newEmail, error: insertError } = await supabase
    .from('email_outbox')
    .insert({
      organization_id: original.organization_id,
      to_email: original.to_email,
      subject: original.subject,
      html: original.html,
      status: 'QUEUED',
      notification_rule_id: original.notification_rule_id,
      trigger_reason: `retry_of_${emailId}`,
      trigger_event: original.trigger_event,
      work_item_id: original.work_item_id,
      alert_instance_id: original.alert_instance_id,
      template_id: original.template_id,
      template_variables: original.template_variables,
      // Don't copy dedupe_key to allow retry
    })
    .select('id')
    .single();

  if (insertError) return { success: false, error: insertError.message };

  return { success: true, newEmailId: newEmail.id };
}

export async function getDeliveryStats(organizationId: string, days = 30): Promise<{
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  opened: number;
}> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('email_outbox')
    .select('status')
    .eq('organization_id', organizationId)
    .gte('created_at', since);

  if (error) throw error;

  const stats = {
    total: data?.length || 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    opened: 0,
  };

  (data || []).forEach((row) => {
    switch (row.status) {
      case 'SENT':
        stats.sent++;
        break;
      case 'DELIVERED':
        stats.delivered++;
        break;
      case 'OPENED':
      case 'CLICKED':
        stats.opened++;
        break;
      case 'FAILED_TEMP':
      case 'FAILED_PERM':
      case 'BOUNCED':
      case 'COMPLAINED':
        stats.failed++;
        break;
    }
  });

  return stats;
}
