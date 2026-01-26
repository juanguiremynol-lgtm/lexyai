/**
 * Platform Email Operations Service
 * Global email monitoring and governance for platform admins
 */

import { supabase } from '@/integrations/supabase/client';

export interface PlatformSettings {
  id: string;
  email_enabled: boolean;
  email_paused_at: string | null;
  email_paused_by: string | null;
  email_pause_reason: string | null;
  max_emails_per_org_per_hour: number;
  max_emails_per_org_per_day: number;
  max_global_emails_per_minute: number;
  max_retry_attempts: number;
  spike_detection_enabled: boolean;
  spike_threshold_multiplier: number;
  created_at: string;
  updated_at: string;
}

export interface GlobalEmailStats {
  total: number;
  queued: number;
  sent: number;
  failedTemp: number;
  failedPerm: number;
  retryVolume: number;
  queueDepth: number;
  avgSendLatencyMs: number | null;
}

export interface TopTenantByVolume {
  organization_id: string;
  organization_name: string;
  email_count: number;
  failed_count: number;
  failure_rate: number;
}

export interface FailureGroup {
  error_type: string;
  count: number;
  organizations: { id: string; name: string }[];
  domains: string[];
}

// ============================================
// PLATFORM SETTINGS
// ============================================

export async function fetchPlatformSettings(): Promise<PlatformSettings | null> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('*')
    .eq('id', 'singleton')
    .single();

  if (error) {
    console.error('Error fetching platform settings:', error);
    return null;
  }
  return data as PlatformSettings;
}

export async function updatePlatformSettings(updates: Partial<PlatformSettings>): Promise<void> {
  const { error } = await supabase
    .from('platform_settings')
    .update(updates)
    .eq('id', 'singleton');

  if (error) throw error;
}

export async function toggleGlobalEmailPause(pause: boolean, reason?: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  await updatePlatformSettings({
    email_enabled: !pause,
    email_paused_at: pause ? new Date().toISOString() : null,
    email_paused_by: pause ? user.id : null,
    email_pause_reason: pause ? (reason || 'Paused by platform admin') : null,
  });

  // Log action
  await logPlatformEmailAction('GLOBAL_' + (pause ? 'PAUSE' : 'RESUME'), null, null, reason);
}

// ============================================
// ORG SUSPENSION
// ============================================

export async function suspendOrgEmail(orgId: string, reason?: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('organizations')
    .update({
      email_suspended: true,
      email_suspend_reason: reason || 'Suspended by platform admin',
      email_suspended_at: new Date().toISOString(),
      email_suspended_by: user.id,
    })
    .eq('id', orgId);

  if (error) throw error;
  await logPlatformEmailAction('ORG_SUSPEND', orgId, null, reason);
}

export async function unsuspendOrgEmail(orgId: string): Promise<void> {
  const { error } = await supabase
    .from('organizations')
    .update({
      email_suspended: false,
      email_suspend_reason: null,
      email_suspended_at: null,
      email_suspended_by: null,
    })
    .eq('id', orgId);

  if (error) throw error;
  await logPlatformEmailAction('ORG_UNSUSPEND', orgId, null);
}

// ============================================
// GLOBAL STATS
// ============================================

export async function fetchGlobalEmailStats(days: number = 1): Promise<GlobalEmailStats> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Get stats by status
  const { data: emails, error } = await supabase
    .from('email_outbox')
    .select('status, failed_permanent, attempts, created_at, sent_at')
    .gte('created_at', since);

  if (error) throw error;

  const stats: GlobalEmailStats = {
    total: emails?.length || 0,
    queued: 0,
    sent: 0,
    failedTemp: 0,
    failedPerm: 0,
    retryVolume: 0,
    queueDepth: 0,
    avgSendLatencyMs: null,
  };

  const latencies: number[] = [];

  (emails || []).forEach((e) => {
    if (e.status === 'pending' || e.status === 'QUEUED') stats.queued++;
    if (e.status === 'sent' || e.status === 'SENT') stats.sent++;
    if (e.status === 'failed' && !e.failed_permanent) stats.failedTemp++;
    if (e.failed_permanent) stats.failedPerm++;
    if ((e.attempts || 0) > 1) stats.retryVolume++;
    if (e.status === 'pending' || e.status === 'QUEUED') stats.queueDepth++;

    // Calculate latency
    if (e.sent_at && e.created_at) {
      const diff = new Date(e.sent_at).getTime() - new Date(e.created_at).getTime();
      latencies.push(diff);
    }
  });

  if (latencies.length > 0) {
    latencies.sort((a, b) => a - b);
    stats.avgSendLatencyMs = latencies[Math.floor(latencies.length / 2)];
  }

  return stats;
}

export async function fetchTopTenantsByVolume(days: number = 7, limit: number = 10): Promise<TopTenantByVolume[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: emails } = await supabase
    .from('email_outbox')
    .select('organization_id, failed_permanent')
    .gte('created_at', since);

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name');

  const orgMap = new Map(orgs?.map((o) => [o.id, o.name]) || []);
  const tenantStats = new Map<string, { total: number; failed: number }>();

  (emails || []).forEach((e) => {
    const stat = tenantStats.get(e.organization_id) || { total: 0, failed: 0 };
    stat.total++;
    if (e.failed_permanent) stat.failed++;
    tenantStats.set(e.organization_id, stat);
  });

  return Array.from(tenantStats.entries())
    .map(([orgId, stat]) => ({
      organization_id: orgId,
      organization_name: orgMap.get(orgId) || 'Unknown',
      email_count: stat.total,
      failed_count: stat.failed,
      failure_rate: stat.total > 0 ? (stat.failed / stat.total) * 100 : 0,
    }))
    .sort((a, b) => b.email_count - a.email_count)
    .slice(0, limit);
}

// ============================================
// FAILURE ANALYSIS
// ============================================

export async function fetchFailureGroups(days: number = 7): Promise<FailureGroup[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: failures } = await supabase
    .from('email_outbox')
    .select('id, organization_id, to_email, error, failure_type')
    .or('status.eq.failed,failed_permanent.eq.true')
    .gte('created_at', since);

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name');

  const orgMap = new Map(orgs?.map((o) => [o.id, o.name]) || []);
  const groups = new Map<string, { count: number; orgIds: Set<string>; domains: Set<string> }>();

  (failures || []).forEach((f) => {
    const errorType = f.failure_type || f.error?.substring(0, 50) || 'UNKNOWN';
    const domain = f.to_email?.split('@')[1] || 'unknown';
    
    const group = groups.get(errorType) || { count: 0, orgIds: new Set(), domains: new Set() };
    group.count++;
    group.orgIds.add(f.organization_id);
    group.domains.add(domain);
    groups.set(errorType, group);
  });

  return Array.from(groups.entries())
    .map(([errorType, g]) => ({
      error_type: errorType,
      count: g.count,
      organizations: Array.from(g.orgIds).map((id) => ({ id, name: orgMap.get(id) || 'Unknown' })),
      domains: Array.from(g.domains),
    }))
    .sort((a, b) => b.count - a.count);
}

// ============================================
// EMAIL ACTIONS
// ============================================

export async function forceStopRetries(emailId: string): Promise<void> {
  const { error } = await supabase
    .from('email_outbox')
    .update({ failed_permanent: true, status: 'failed' })
    .eq('id', emailId);

  if (error) throw error;
  await logPlatformEmailAction('FORCE_STOP_RETRIES', null, emailId);
}

export async function requeueEmail(emailId: string): Promise<string> {
  // Get original email
  const { data: original, error: fetchError } = await supabase
    .from('email_outbox')
    .select('*')
    .eq('id', emailId)
    .single();

  if (fetchError) throw fetchError;
  if (!original) throw new Error('Email not found');

  // Create new entry (don't mutate original)
  const { data: newEmail, error: insertError } = await supabase
    .from('email_outbox')
    .insert({
      organization_id: original.organization_id,
      to_email: original.to_email,
      subject: original.subject,
      html: original.html,
      status: 'pending',
      attempts: 0,
      failed_permanent: false,
      notification_rule_id: original.notification_rule_id,
      trigger_reason: 'REQUEUED_BY_PLATFORM',
      work_item_id: original.work_item_id,
      alert_instance_id: original.alert_instance_id,
      metadata: { requeued_from: emailId },
    })
    .select('id')
    .single();

  if (insertError) throw insertError;
  await logPlatformEmailAction('REQUEUE', original.organization_id, emailId, `Requeued as ${newEmail?.id}`);
  return newEmail?.id || '';
}

// ============================================
// AUDIT LOGGING
// ============================================

async function logPlatformEmailAction(
  actionType: string,
  orgId: string | null,
  emailId: string | null,
  reason?: string
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('platform_email_actions').insert({
    action_type: actionType,
    target_org_id: orgId,
    target_email_outbox_id: emailId,
    actor_user_id: user.id,
    reason: reason || null,
  });
}

export async function fetchPlatformEmailActions(limit: number = 50) {
  const { data, error } = await supabase
    .from('platform_email_actions')
    .select('*, organizations:target_org_id(name)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// ============================================
// GLOBAL EMAIL LOG
// ============================================

export interface GlobalEmailLogFilters {
  status?: string;
  organizationId?: string;
  failuresOnly?: boolean;
  stuckRetries?: boolean;
  dateFrom?: string;
  dateTo?: string;
  triggerReason?: string;
}

export async function fetchGlobalEmailLog(
  filters: GlobalEmailLogFilters = {},
  page: number = 1,
  pageSize: number = 50
) {
  let query = supabase
    .from('email_outbox')
    .select('*, organizations:organization_id(name), work_items:work_item_id(id, radicado, title)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  }
  if (filters.organizationId && filters.organizationId !== 'all') {
    query = query.eq('organization_id', filters.organizationId);
  }
  if (filters.failuresOnly) {
    query = query.or('status.eq.failed,failed_permanent.eq.true');
  }
  if (filters.stuckRetries) {
    query = query.gt('attempts', 3).eq('failed_permanent', false);
  }
  if (filters.dateFrom) {
    query = query.gte('created_at', filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte('created_at', filters.dateTo);
  }
  if (filters.triggerReason) {
    query = query.eq('trigger_reason', filters.triggerReason);
  }

  const { data, count, error } = await query;

  if (error) throw error;
  return { data: data || [], count: count || 0, page, pageSize };
}

// ============================================
// TENANT DRILLDOWN
// ============================================

export interface TenantEmailProfile {
  organization_id: string;
  organization_name: string;
  email_suspended: boolean;
  email_suspend_reason: string | null;
  total_emails: number;
  sent_count: number;
  failed_count: number;
  failure_rate: number;
  queue_depth: number;
  active_rules_count: number;
  recipients_count: number;
  top_triggers: { trigger: string; count: number }[];
  top_domains: { domain: string; count: number }[];
}

export async function fetchTenantEmailProfile(orgId: string, days: number = 30): Promise<TenantEmailProfile | null> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Get org info
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, email_suspended, email_suspend_reason')
    .eq('id', orgId)
    .single();

  if (!org) return null;

  // Get email stats
  const { data: emails } = await supabase
    .from('email_outbox')
    .select('status, failed_permanent, trigger_reason, to_email')
    .eq('organization_id', orgId)
    .gte('created_at', since);

  // Get rules count
  const { count: rulesCount } = await supabase
    .from('notification_rules')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('enabled', true)
    .is('deleted_at', null);

  // Get recipients count
  const { count: recipientsCount } = await supabase
    .from('notification_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('enabled', true);

  const triggerCounts = new Map<string, number>();
  const domainCounts = new Map<string, number>();
  let sent = 0, failed = 0, queued = 0;

  (emails || []).forEach((e) => {
    if (e.status === 'sent' || e.status === 'SENT') sent++;
    if (e.failed_permanent) failed++;
    if (e.status === 'pending' || e.status === 'QUEUED') queued++;

    if (e.trigger_reason) {
      triggerCounts.set(e.trigger_reason, (triggerCounts.get(e.trigger_reason) || 0) + 1);
    }
    const domain = e.to_email?.split('@')[1];
    if (domain) {
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    }
  });

  const total = emails?.length || 0;

  return {
    organization_id: org.id,
    organization_name: org.name,
    email_suspended: org.email_suspended,
    email_suspend_reason: org.email_suspend_reason,
    total_emails: total,
    sent_count: sent,
    failed_count: failed,
    failure_rate: total > 0 ? (failed / total) * 100 : 0,
    queue_depth: queued,
    active_rules_count: rulesCount || 0,
    recipients_count: recipientsCount || 0,
    top_triggers: Array.from(triggerCounts.entries())
      .map(([trigger, count]) => ({ trigger, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    top_domains: Array.from(domainCounts.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}
