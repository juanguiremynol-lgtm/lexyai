/**
 * Hearing Alert System
 * 
 * Creates alert_instances and optional email_outbox entries for hearing reminders.
 * Follows the same pattern as peticion/CGP alerts in alert-system.ts.
 */

import { supabase } from "@/integrations/supabase/client";

export interface HearingAlertConfig {
  ownerId: string;
  hearingId: string;
  workItemId: string | null;
  organizationId: string | null;
  title: string;
  scheduledAt: Date;
  location?: string | null;
  isVirtual?: boolean;
  virtualLink?: string | null;
  emailEnabled?: boolean;
  userEmail?: string | null;
  /** Reminder intervals in hours before the hearing (default: [24, 1]) */
  reminderHoursBefore?: number[];
}

/**
 * Create alert rules + initial alert instance for a hearing.
 * Also enqueues email reminders if email is enabled.
 */
export async function createHearingAlerts(config: HearingAlertConfig): Promise<void> {
  const {
    ownerId,
    hearingId,
    workItemId,
    organizationId,
    title,
    scheduledAt,
    location,
    isVirtual,
    virtualLink,
    emailEnabled = false,
    userEmail,
    reminderHoursBefore = [24, 1],
  } = config;

  const channels = emailEnabled && userEmail ? ['IN_APP', 'EMAIL'] : ['IN_APP'];
  const emailRecipients = emailEnabled && userEmail ? [userEmail] : [];

  // Calculate first reminder fire time
  const maxHours = Math.max(...reminderHoursBefore);
  const firstFireAt = new Date(scheduledAt.getTime() - maxHours * 60 * 60 * 1000);

  // Create alert rule for the hearing deadline
  const { error: ruleError } = await supabase.from('alert_rules').insert({
    owner_id: ownerId,
    entity_type: 'HEARING',
    entity_id: hearingId,
    rule_kind: 'DATE_DUE',
    title: `Audiencia: ${title}`,
    description: `Recordatorio de audiencia programada para ${scheduledAt.toLocaleDateString('es-CO')}`,
    channels,
    email_recipients: emailRecipients,
    is_optional_user_defined: false,
    is_system_mandatory: true,
    due_at: scheduledAt.toISOString(),
    first_fire_at: firstFireAt.toISOString(),
    next_fire_at: firstFireAt.toISOString(),
    active: true,
    organization_id: organizationId,
    stop_condition: { hearing_completed: true },
  });

  if (ruleError) {
    console.error('[hearing-alerts] Error creating alert rule:', ruleError);
  }

  // Create immediate INFO alert (hearing created confirmation)
  const locationText = isVirtual ? 'Virtual' : (location || 'Por confirmar');
  const dateStr = scheduledAt.toLocaleDateString('es-CO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const timeStr = scheduledAt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  await supabase.from('alert_instances').insert({
    owner_id: ownerId,
    entity_type: 'HEARING',
    entity_id: hearingId,
    severity: 'INFO',
    status: 'SENT',
    title: 'Audiencia programada',
    message: `${title} — ${dateStr} a las ${timeStr}. Lugar: ${locationText}.`,
    alert_type: 'HEARING_CREATED',
    alert_source: 'USER',
    organization_id: organizationId,
    payload: {
      hearing_id: hearingId,
      work_item_id: workItemId,
      scheduled_at: scheduledAt.toISOString(),
      location,
      is_virtual: isVirtual,
      virtual_link: virtualLink,
    },
    actions: workItemId
      ? [{ label: 'Ver proceso', action: 'navigate', params: { path: `/app/work-items/${workItemId}` } }]
      : [],
  });

  // Create scheduled reminder alert_instances for each interval
  for (const hoursBefore of reminderHoursBefore) {
    const fireAt = new Date(scheduledAt.getTime() - hoursBefore * 60 * 60 * 1000);
    if (fireAt <= new Date()) continue; // Skip past reminders

    const severity = hoursBefore <= 1 ? 'CRITICAL' : 'WARNING';
    const label = hoursBefore >= 24
      ? `${Math.round(hoursBefore / 24)} día(s)`
      : `${hoursBefore} hora(s)`;

    await supabase.from('alert_instances').insert({
      owner_id: ownerId,
      entity_type: 'HEARING',
      entity_id: hearingId,
      severity,
      status: 'PENDING',
      title: `⏰ Audiencia en ${label}`,
      message: `${title} — ${dateStr} a las ${timeStr}. Lugar: ${locationText}.`,
      alert_type: 'HEARING_REMINDER',
      alert_source: 'SYSTEM',
      organization_id: organizationId,
      fired_at: fireAt.toISOString(),
      payload: {
        hearing_id: hearingId,
        work_item_id: workItemId,
        scheduled_at: scheduledAt.toISOString(),
        hours_before: hoursBefore,
      },
      actions: workItemId
        ? [{ label: 'Ver proceso', action: 'navigate', params: { path: `/app/work-items/${workItemId}` } }]
        : [],
    });

    // Enqueue email reminder if enabled
    if (emailEnabled && userEmail && organizationId) {
      const virtualLinkHtml = isVirtual && virtualLink
        ? `<p>🔗 <a href="${virtualLink}">Unirse a audiencia virtual</a></p>`
        : '';

      await supabase.from('email_outbox').insert({
        organization_id: organizationId,
        to_email: userEmail,
        subject: `⏰ Recordatorio: Audiencia en ${label} — ${title}`,
        html: `
          <h2>Recordatorio de Audiencia</h2>
          <p><strong>${title}</strong></p>
          <p>📅 ${dateStr} a las ${timeStr}</p>
          <p>📍 ${locationText}</p>
          ${virtualLinkHtml}
          <hr />
          <p style="color: #666; font-size: 12px;">Este es un recordatorio automático de Lexy.</p>
        `,
        status: 'PENDING',
        next_attempt_at: fireAt.toISOString(),
        trigger_reason: 'hearing_reminder',
        trigger_event: 'HEARING_REMINDER',
        work_item_id: workItemId,
        dedupe_key: `hearing-${hearingId}-${hoursBefore}h`,
      });
    }
  }
}

/**
 * Cancel all alerts for a hearing (when deleted or rescheduled)
 */
export async function cancelHearingAlerts(hearingId: string): Promise<void> {
  // Resolve pending alert instances
  await supabase
    .from('alert_instances')
    .update({ status: 'RESOLVED', resolved_at: new Date().toISOString() })
    .eq('entity_type', 'HEARING')
    .eq('entity_id', hearingId)
    .in('status', ['PENDING', 'SENT']);

  // Deactivate alert rules
  await supabase
    .from('alert_rules')
    .update({ active: false })
    .eq('entity_type', 'HEARING')
    .eq('entity_id', hearingId);
}
