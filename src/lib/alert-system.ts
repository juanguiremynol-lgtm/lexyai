/**
 * Alert System v2 - Utility functions for creating and managing alerts
 */

import { supabase } from "@/integrations/supabase/client";
import { addBusinessDays } from "./colombian-holidays";

export type EntityType = 'CGP_FILING' | 'CGP_CASE' | 'ADMIN_PROCESS' | 'PETICION' | 'TUTELA';
export type RuleKind = 'DATE_DUE' | 'REPEAT_INTERVAL' | 'PHASE_TRIGGER';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertStatus = 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'RESOLVED' | 'CANCELLED';

export interface AlertRule {
  id?: string;
  owner_id: string;
  entity_type: EntityType;
  entity_id: string;
  rule_kind: RuleKind;
  title: string;
  description?: string;
  channels: string[];
  email_recipients?: string[];
  is_optional_user_defined?: boolean;
  is_system_mandatory?: boolean;
  due_at?: string;
  first_fire_at?: string;
  repeat_every_business_days?: number;
  repeat_every_days?: number;
  next_fire_at?: string;
  active?: boolean;
  stop_condition?: Record<string, unknown>;
}

export interface AlertInstance {
  id?: string;
  owner_id: string;
  alert_rule_id?: string;
  entity_type: EntityType;
  entity_id: string;
  severity: AlertSeverity;
  status?: AlertStatus;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
  actions?: Array<{
    label: string;
    action: string;
    params?: Record<string, unknown>;
  }>;
}

/**
 * Create alert rules for a new Petición (automatic - 15 business days deadline)
 */
export async function createPeticionAlerts(
  ownerId: string,
  peticionId: string,
  filedAt: Date,
  subject: string,
  entityName: string,
  emailEnabled: boolean = false,
  userEmail?: string
): Promise<void> {
  // Calculate 15 business days deadline
  const deadline = addBusinessDays(filedAt, 15);
  
  // Calculate reminder dates
  const reminder3Days = addBusinessDays(deadline, -3);
  const reminder1Day = addBusinessDays(deadline, -1);
  
  const channels = emailEnabled && userEmail ? ['IN_APP', 'EMAIL'] : ['IN_APP'];
  const emailRecipients = emailEnabled && userEmail ? [userEmail] : [];

  // Create main deadline rule
  const { error: ruleError } = await supabase.from('alert_rules').insert({
    owner_id: ownerId,
    entity_type: 'PETICION',
    entity_id: peticionId,
    rule_kind: 'DATE_DUE',
    title: `Vencimiento petición: ${subject}`,
    description: `Petición ante ${entityName} vence el ${deadline.toLocaleDateString('es-CO')}`,
    channels,
    email_recipients: emailRecipients,
    is_optional_user_defined: false,
    is_system_mandatory: true,
    due_at: deadline.toISOString(),
    next_fire_at: reminder3Days.toISOString(),
    active: true,
    stop_condition: { phase: 'RESPUESTA' },
  });

  if (ruleError) {
    console.error('Error creating peticion alert rule:', ruleError);
  }

  // Create initial INFO alert
  await supabase.from('alert_instances').insert({
    owner_id: ownerId,
    entity_type: 'PETICION',
    entity_id: peticionId,
    severity: 'INFO',
    status: 'SENT',
    title: 'Petición radicada',
    message: `Petición "${subject}" ante ${entityName}. Vence el ${deadline.toLocaleDateString('es-CO')} (15 días hábiles).`,
    payload: {
      deadline: deadline.toISOString(),
      entity_name: entityName,
      subject,
    },
    actions: [
      { label: 'Ver Petición', action: 'navigate', params: { path: `/peticiones/${peticionId}` } },
    ],
  });
}

/**
 * Create alert rules for a new CGP Filing (automatic - every 5 business days until milestones)
 */
export async function createCGPFilingAlerts(
  ownerId: string,
  filingId: string,
  filedAt: Date,
  filingType: string,
  emailEnabled: boolean = false,
  userEmail?: string
): Promise<void> {
  // First alert fires 5 business days after filing
  const firstFire = addBusinessDays(filedAt, 5);
  
  const channels = emailEnabled && userEmail ? ['IN_APP', 'EMAIL'] : ['IN_APP'];
  const emailRecipients = emailEnabled && userEmail ? [userEmail] : [];

  // Create repeating rule for acta de reparto
  const { error: ruleError } = await supabase.from('alert_rules').insert({
    owner_id: ownerId,
    entity_type: 'CGP_FILING',
    entity_id: filingId,
    rule_kind: 'REPEAT_INTERVAL',
    title: `Verificar respuesta de reparto: ${filingType}`,
    description: 'Verificar si ya existe respuesta de reparto / Acta de reparto',
    channels,
    email_recipients: emailRecipients,
    is_optional_user_defined: false,
    is_system_mandatory: true,
    first_fire_at: firstFire.toISOString(),
    repeat_every_business_days: 5,
    next_fire_at: firstFire.toISOString(),
    active: true,
    stop_condition: { acta_received_at: { $ne: null } },
  });

  if (ruleError) {
    console.error('Error creating CGP filing alert rule:', ruleError);
  }

  // Create initial INFO alert
  await supabase.from('alert_instances').insert({
    owner_id: ownerId,
    entity_type: 'CGP_FILING',
    entity_id: filingId,
    severity: 'INFO',
    status: 'SENT',
    title: 'Radicación CGP creada',
    message: `Demanda ${filingType} radicada. Objetivos: Obtener acta de reparto, radicado judicial, acceso a expediente.`,
    payload: {
      filing_type: filingType,
      filed_at: filedAt.toISOString(),
    },
    actions: [
      { label: 'Ver Radicación', action: 'navigate', params: { path: `/filings/${filingId}` } },
      { label: 'Registrar Acta', action: 'register_milestone', params: { milestone: 'acta_reparto' } },
    ],
  });
}

/**
 * Create optional alert rules for Tutela (user-defined frequency)
 */
export async function createTutelaAlerts(
  ownerId: string,
  tutelaId: string,
  alertConfig: {
    enabled: boolean;
    frequency: number; // days
    inApp: boolean;
    email: boolean;
    userEmail?: string;
  }
): Promise<void> {
  if (!alertConfig.enabled) return;

  const channels: string[] = [];
  if (alertConfig.inApp) channels.push('IN_APP');
  if (alertConfig.email && alertConfig.userEmail) channels.push('EMAIL');

  const firstFire = addBusinessDays(new Date(), alertConfig.frequency);

  const { error } = await supabase.from('alert_rules').insert({
    owner_id: ownerId,
    entity_type: 'TUTELA',
    entity_id: tutelaId,
    rule_kind: 'REPEAT_INTERVAL',
    title: 'Seguimiento de tutela',
    description: `Recordatorio cada ${alertConfig.frequency} días`,
    channels,
    email_recipients: alertConfig.email && alertConfig.userEmail ? [alertConfig.userEmail] : [],
    is_optional_user_defined: true,
    is_system_mandatory: false,
    first_fire_at: firstFire.toISOString(),
    repeat_every_days: alertConfig.frequency,
    next_fire_at: firstFire.toISOString(),
    active: true,
    stop_condition: { status: 'CLOSED' },
  });

  if (error) {
    console.error('Error creating tutela alert rule:', error);
  }
}

/**
 * Recalculate peticion alerts when prórroga is registered
 */
export async function recalculatePeticionProrogaAlerts(
  ownerId: string,
  peticionId: string,
  originalDeadline: Date,
  subject: string,
  entityName: string
): Promise<void> {
  // Cancel existing pending alerts for this peticion
  await supabase
    .from('alert_instances')
    .update({ status: 'CANCELLED' })
    .eq('entity_type', 'PETICION')
    .eq('entity_id', peticionId)
    .eq('status', 'PENDING');

  // Deactivate existing rules
  await supabase
    .from('alert_rules')
    .update({ active: false })
    .eq('entity_type', 'PETICION')
    .eq('entity_id', peticionId);

  // Calculate new deadline (15 business days from original deadline)
  const newDeadline = addBusinessDays(originalDeadline, 15);
  const reminder3Days = addBusinessDays(newDeadline, -3);

  // Create new rule for prórroga
  await supabase.from('alert_rules').insert({
    owner_id: ownerId,
    entity_type: 'PETICION',
    entity_id: peticionId,
    rule_kind: 'DATE_DUE',
    title: `Vencimiento prórroga: ${subject}`,
    description: `Prórroga de petición ante ${entityName} vence el ${newDeadline.toLocaleDateString('es-CO')}`,
    channels: ['IN_APP'],
    is_optional_user_defined: false,
    is_system_mandatory: true,
    due_at: newDeadline.toISOString(),
    next_fire_at: reminder3Days.toISOString(),
    active: true,
    stop_condition: { phase: 'RESPUESTA' },
  });

  // Create info alert about prórroga
  await supabase.from('alert_instances').insert({
    owner_id: ownerId,
    entity_type: 'PETICION',
    entity_id: peticionId,
    severity: 'INFO',
    status: 'SENT',
    title: 'Prórroga registrada',
    message: `Prórroga de petición "${subject}". Nuevo vencimiento: ${newDeadline.toLocaleDateString('es-CO')} (15 días hábiles adicionales).`,
    payload: {
      new_deadline: newDeadline.toISOString(),
      original_deadline: originalDeadline.toISOString(),
    },
  });
}

/**
 * Resolve alerts when peticion receives response
 */
export async function resolvePeticionAlerts(peticionId: string): Promise<void> {
  // Mark all pending alerts as resolved
  await supabase
    .from('alert_instances')
    .update({ 
      status: 'RESOLVED',
      resolved_at: new Date().toISOString(),
    })
    .eq('entity_type', 'PETICION')
    .eq('entity_id', peticionId)
    .in('status', ['PENDING', 'SENT']);

  // Deactivate all rules
  await supabase
    .from('alert_rules')
    .update({ active: false })
    .eq('entity_type', 'PETICION')
    .eq('entity_id', peticionId);
}

/**
 * Update CGP filing alerts when milestone is registered
 */
export async function updateCGPFilingMilestone(
  ownerId: string,
  filingId: string,
  milestone: 'acta_reparto' | 'radicado' | 'acceso_expediente' | 'auto_admisorio'
): Promise<void> {
  if (milestone === 'acta_reparto') {
    // Deactivate the acta reparto rule
    await supabase
      .from('alert_rules')
      .update({ active: false })
      .eq('entity_type', 'CGP_FILING')
      .eq('entity_id', filingId)
      .ilike('title', '%reparto%');

    // Create new rule for remaining milestones
    const firstFire = addBusinessDays(new Date(), 5);

    await supabase.from('alert_rules').insert({
      owner_id: ownerId,
      entity_type: 'CGP_FILING',
      entity_id: filingId,
      rule_kind: 'REPEAT_INTERVAL',
      title: 'Verificar radicado y expediente',
      description: 'Verificar radicado judicial, acceso a expediente y auto admisorio',
      channels: ['IN_APP'],
      is_optional_user_defined: false,
      is_system_mandatory: true,
      first_fire_at: firstFire.toISOString(),
      repeat_every_business_days: 5,
      next_fire_at: firstFire.toISOString(),
      active: true,
      stop_condition: {
        radicado: { $ne: null },
        has_auto_admisorio: true,
      },
    });
  }
}
