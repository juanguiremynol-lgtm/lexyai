/**
 * CGP Terms Engine - Core calculation and management logic
 * 
 * This module handles:
 * - Term computation based on milestones
 * - Due date calculation with judicial suspensions
 * - Term status management (running, paused, expired, satisfied)
 * - Inactivity tracking for desistimiento tácito
 */

import { addDays, addMonths, addYears, differenceInDays, differenceInMonths, isAfter, isBefore, parseISO, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { addBusinessDaysWithRegime, isBusinessDay } from "./term-calculator";
import { getActiveJudicialSuspensions, JudicialTermSuspension } from "./judicial-suspensions";
import type { Json } from "@/integrations/supabase/types";

// ============= Types =============

export type CgpMilestoneType = 
  | 'DEMANDA_RADICADA'
  | 'AUTO_ADMISORIO'
  | 'AUTO_ADMISORIO_NOTIFICADO'
  | 'MANDAMIENTO_DE_PAGO'
  | 'MANDAMIENTO_EJECUTIVO_NOTIFICADO'
  | 'NOTIFICACION_EVENT'
  | 'AUTO_SEGUIR_ADELANTE_EJECUCION'
  | 'TRASLADO_EVENT'
  | 'RECURSO_INTERPUESTO'
  | 'RECURSO_DECIDIDO'
  | 'REQUERIMIENTO_PAGO_NOTIFICADO'
  | 'TRASLADO_EXCEPCIONES_NOTIFICADO'
  | 'TRASLADO_DEMANDA_NOTIFICADO'
  | 'CONTESTACION_PRESENTADA'
  | 'EXCEPCIONES_PROPUESTAS'
  | 'EXCEPCIONES_RESUELTAS'
  | 'RECURSO_REPOSICION_INTERPUESTO'
  | 'RECURSO_REPOSICION_RESUELTO'
  | 'RECURSO_APELACION_INTERPUESTO'
  | 'RECURSO_APELACION_CONCEDIDO'
  | 'RECURSO_APELACION_RESUELTO'
  | 'RECURSO_SUPLICA_INTERPUESTO'
  | 'RECURSO_QUEJA_INTERPUESTO'
  | 'EXPEDIENTE_AL_DESPACHO'
  | 'EXPEDIENTE_A_SECRETARIA'
  | 'AUDIENCIA_PROGRAMADA'
  | 'AUDIENCIA_CELEBRADA'
  | 'SENTENCIA_PRIMERA_INSTANCIA'
  | 'SENTENCIA_SEGUNDA_INSTANCIA'
  | 'EXPEDIENTE_RECIBIDO_SUPERIOR'
  | 'ULTIMA_ACTUACION'
  | 'SILENCIO_DEUDOR'
  | 'OPOSICION_MONITORIO'
  | 'EMBARGO_SECUESTRO_PRACTICADO'
  | 'SENTENCIA_EJECUTORIA'
  | 'AVALUO_BIENES'
  | 'CUSTOM';

export type CgpTermStatus = 
  | 'PENDING'
  | 'RUNNING'
  | 'PAUSED'
  | 'EXPIRED'
  | 'SATISFIED'
  | 'NOT_APPLICABLE'
  | 'INTERRUPTED';

export type CgpStartRule = 
  | 'NEXT_DAY_AFTER_NOTIFICATION'
  | 'SAME_DAY_IN_AUDIENCE'
  | 'NEXT_DAY_AFTER_LAST_NOTIFICATION'
  | 'IMMEDIATE';

export type CgpDurationUnit = 'BUSINESS_DAYS' | 'CALENDAR_DAYS' | 'MONTHS' | 'YEARS';

export type CgpProcessType = 
  | 'VERBAL'
  | 'VERBAL_SUMARIO'
  | 'MONITORIO'
  | 'EJECUTIVO'
  | 'EJECUTIVO_HIPOTECARIO'
  | 'RECURSOS'
  | 'GENERAL';

export interface CgpMilestone {
  id: string;
  owner_id: string;
  filing_id?: string | null;
  process_id?: string | null;
  milestone_type: CgpMilestoneType;
  custom_type_name?: string | null;
  occurred: boolean;
  event_date?: string | null;
  event_time?: string | null;
  in_audience: boolean;
  notes?: string | null;
  attachments?: Json | null;
  created_at: string;
  updated_at: string;
}

export interface CgpMilestoneInput {
  filing_id?: string | null;
  process_id?: string | null;
  milestone_type: CgpMilestoneType;
  custom_type_name?: string | null;
  occurred: boolean;
  event_date?: string | null;
  event_time?: string | null;
  in_audience: boolean;
  notes?: string | null;
  attachments?: unknown[];
  created_at: string;
  updated_at: string;
}

export interface CgpTermTemplate {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  legal_basis?: string | null;
  process_family: string;
  process_type: CgpProcessType;
  trigger_milestone_type: CgpMilestoneType;
  start_rule: CgpStartRule;
  duration_value: number;
  duration_unit: CgpDurationUnit;
  alerts_days_before: number[];
  pause_on_judicial_suspension: boolean;
  pause_on_expediente_al_despacho: boolean;
  pause_on_resource_filed: boolean;
  satisfied_by_milestone_type?: CgpMilestoneType | null;
  consequence_summary?: string | null;
  is_system: boolean;
  active: boolean;
}

export interface CgpTermInstance {
  id: string;
  owner_id: string;
  filing_id?: string | null;
  process_id?: string | null;
  term_template_id?: string | null;
  term_template_code: string;
  term_name: string;
  trigger_milestone_id?: string | null;
  trigger_date: string;
  in_audience: boolean;
  start_date: string;
  due_date: string;
  original_due_date: string;
  status: CgpTermStatus;
  pause_reason?: string | null;
  paused_at?: string | null;
  paused_days_accumulated: number;
  satisfied_at?: string | null;
  satisfied_by_milestone_id?: string | null;
  satisfaction_notes?: string | null;
  computed_with_suspensions: boolean;
  last_computed_at: string;
  created_at: string;
  updated_at: string;
}

export interface CgpInactivityTracker {
  id: string;
  owner_id: string;
  filing_id?: string | null;
  process_id?: string | null;
  last_activity_date: string;
  last_activity_description?: string | null;
  inactivity_threshold_months: number;
  has_favorable_sentencia: boolean;
  is_at_risk: boolean;
  risk_since?: string | null;
}

// ============= Milestone Labels =============

export const MILESTONE_LABELS: Record<CgpMilestoneType, string> = {
  DEMANDA_RADICADA: 'Demanda Radicada',
  AUTO_ADMISORIO: 'Auto Admisorio',
  AUTO_ADMISORIO_NOTIFICADO: 'Auto Admisorio Notificado',
  MANDAMIENTO_DE_PAGO: 'Mandamiento de Pago',
  MANDAMIENTO_EJECUTIVO_NOTIFICADO: 'Mandamiento Ejecutivo Notificado',
  NOTIFICACION_EVENT: 'Notificación',
  AUTO_SEGUIR_ADELANTE_EJECUCION: 'Auto Seguir Adelante Ejecución',
  TRASLADO_EVENT: 'Traslado',
  RECURSO_INTERPUESTO: 'Recurso Interpuesto',
  RECURSO_DECIDIDO: 'Recurso Decidido',
  REQUERIMIENTO_PAGO_NOTIFICADO: 'Requerimiento de Pago Notificado',
  TRASLADO_EXCEPCIONES_NOTIFICADO: 'Traslado de Excepciones Notificado',
  TRASLADO_DEMANDA_NOTIFICADO: 'Traslado de Demanda Notificado',
  CONTESTACION_PRESENTADA: 'Contestación Presentada',
  EXCEPCIONES_PROPUESTAS: 'Excepciones Propuestas',
  EXCEPCIONES_RESUELTAS: 'Excepciones Resueltas',
  RECURSO_REPOSICION_INTERPUESTO: 'Recurso de Reposición Interpuesto',
  RECURSO_REPOSICION_RESUELTO: 'Recurso de Reposición Resuelto',
  RECURSO_APELACION_INTERPUESTO: 'Recurso de Apelación Interpuesto',
  RECURSO_APELACION_CONCEDIDO: 'Recurso de Apelación Concedido',
  RECURSO_APELACION_RESUELTO: 'Recurso de Apelación Resuelto',
  RECURSO_SUPLICA_INTERPUESTO: 'Recurso de Súplica Interpuesto',
  RECURSO_QUEJA_INTERPUESTO: 'Recurso de Queja Interpuesto',
  EXPEDIENTE_AL_DESPACHO: 'Expediente al Despacho',
  EXPEDIENTE_A_SECRETARIA: 'Expediente a Secretaría',
  AUDIENCIA_PROGRAMADA: 'Audiencia Programada',
  AUDIENCIA_CELEBRADA: 'Audiencia Celebrada',
  SENTENCIA_PRIMERA_INSTANCIA: 'Sentencia 1ª Instancia',
  SENTENCIA_SEGUNDA_INSTANCIA: 'Sentencia 2ª Instancia',
  EXPEDIENTE_RECIBIDO_SUPERIOR: 'Expediente Recibido por Superior',
  ULTIMA_ACTUACION: 'Última Actuación',
  SILENCIO_DEUDOR: 'Silencio del Deudor',
  OPOSICION_MONITORIO: 'Oposición en Monitorio',
  EMBARGO_SECUESTRO_PRACTICADO: 'Embargo/Secuestro Practicado',
  SENTENCIA_EJECUTORIA: 'Sentencia Ejecutoriada',
  AVALUO_BIENES: 'Avalúo de Bienes',
  CUSTOM: 'Otro Hito',
};

export const TERM_STATUS_LABELS: Record<CgpTermStatus, { label: string; color: string }> = {
  PENDING: { label: 'Pendiente', color: 'slate' },
  RUNNING: { label: 'Corriendo', color: 'blue' },
  PAUSED: { label: 'Pausado', color: 'amber' },
  EXPIRED: { label: 'Vencido', color: 'red' },
  SATISFIED: { label: 'Cumplido', color: 'green' },
  NOT_APPLICABLE: { label: 'No Aplica', color: 'gray' },
  INTERRUPTED: { label: 'Interrumpido', color: 'orange' },
};

// ============= Core Functions =============

/**
 * Calculate due date based on template rules and trigger date
 */
export function calculateDueDate(
  triggerDate: Date,
  template: CgpTermTemplate,
  inAudience: boolean,
  suspensions: JudicialTermSuspension[] = []
): { startDate: Date; dueDate: Date } {
  let startDate: Date;

  // Determine start date based on rule
  switch (template.start_rule) {
    case 'SAME_DAY_IN_AUDIENCE':
      startDate = inAudience ? triggerDate : addDays(triggerDate, 1);
      break;
    case 'IMMEDIATE':
      startDate = triggerDate;
      break;
    case 'NEXT_DAY_AFTER_LAST_NOTIFICATION':
    case 'NEXT_DAY_AFTER_NOTIFICATION':
    default:
      startDate = addDays(triggerDate, 1);
      break;
  }

  // Calculate due date based on duration unit
  let dueDate: Date;

  switch (template.duration_unit) {
    case 'BUSINESS_DAYS':
      dueDate = addBusinessDaysWithRegime(
        triggerDate, // Function adds 1 day internally
        template.duration_value,
        'JUDICIAL',
        template.pause_on_judicial_suspension ? suspensions : []
      );
      break;
    case 'CALENDAR_DAYS':
      dueDate = addDays(startDate, template.duration_value);
      // If falls on non-business day, move to next business day
      while (!isBusinessDay(dueDate, 'JUDICIAL', suspensions)) {
        dueDate = addDays(dueDate, 1);
      }
      break;
    case 'MONTHS':
      dueDate = addMonths(startDate, template.duration_value);
      // Adjust if falls on non-business day
      while (!isBusinessDay(dueDate, 'JUDICIAL', suspensions)) {
        dueDate = addDays(dueDate, 1);
      }
      break;
    case 'YEARS':
      dueDate = addYears(startDate, template.duration_value);
      // Adjust if falls on non-business day
      while (!isBusinessDay(dueDate, 'JUDICIAL', suspensions)) {
        dueDate = addDays(dueDate, 1);
      }
      break;
    default:
      dueDate = startDate;
  }

  return { startDate, dueDate };
}

/**
 * Get days remaining until due date (business days for JUDICIAL regime)
 */
export function getDaysRemaining(
  dueDate: Date,
  suspensions: JudicialTermSuspension[] = []
): number {
  const today = startOfDay(new Date());
  const due = startOfDay(dueDate);

  if (isBefore(due, today)) {
    // Already expired - return negative days
    return differenceInDays(due, today);
  }

  // Count business days remaining
  let count = 0;
  let currentDate = today;

  while (isBefore(currentDate, due)) {
    currentDate = addDays(currentDate, 1);
    if (isBusinessDay(currentDate, 'JUDICIAL', suspensions)) {
      count++;
    }
  }

  return count;
}

/**
 * Get term urgency level based on days remaining
 */
export function getTermUrgency(daysRemaining: number): 'critical' | 'warning' | 'normal' | 'expired' {
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining === 0) return 'critical';
  if (daysRemaining <= 3) return 'warning';
  return 'normal';
}

// ============= Database Operations =============

/**
 * Fetch all term templates (system + user)
 */
export async function fetchTermTemplates(): Promise<CgpTermTemplate[]> {
  const { data, error } = await supabase
    .from('cgp_term_templates')
    .select('*')
    .eq('active', true)
    .order('name');

  if (error) {
    console.error('Error fetching term templates:', error);
    return [];
  }

  return (data || []).map(t => ({
    ...t,
    alerts_days_before: t.alerts_days_before as number[],
  }));
}

/**
 * Fetch milestones for a filing or process
 */
export async function fetchMilestones(
  filingId?: string,
  processId?: string
): Promise<CgpMilestone[]> {
  let query = supabase.from('cgp_milestones').select('*');

  if (filingId) {
    query = query.eq('filing_id', filingId);
  } else if (processId) {
    query = query.eq('process_id', processId);
  } else {
    return [];
  }

  const { data, error } = await query.order('event_date', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('Error fetching milestones:', error);
    return [];
  }

  return (data || []) as CgpMilestone[];
}

/**
 * Fetch term instances for a filing or process
 */
export async function fetchTermInstances(
  filingId?: string,
  processId?: string
): Promise<CgpTermInstance[]> {
  let query = supabase.from('cgp_term_instances').select('*');

  if (filingId) {
    query = query.eq('filing_id', filingId);
  } else if (processId) {
    query = query.eq('process_id', processId);
  } else {
    return [];
  }

  const { data, error } = await query.order('due_date', { ascending: true });

  if (error) {
    console.error('Error fetching term instances:', error);
    return [];
  }

  return data || [];
}

/**
 * Create a new milestone and trigger term creation if applicable
 */
export async function createMilestone(
  ownerId: string,
  milestone: Omit<CgpMilestone, 'id' | 'created_at' | 'updated_at' | 'owner_id'>
): Promise<CgpMilestone | null> {
  const { data, error } = await supabase
    .from('cgp_milestones')
    .insert({
      owner_id: ownerId,
      filing_id: milestone.filing_id,
      process_id: milestone.process_id,
      milestone_type: milestone.milestone_type,
      custom_type_name: milestone.custom_type_name,
      occurred: milestone.occurred,
      event_date: milestone.event_date,
      event_time: milestone.event_time,
      in_audience: milestone.in_audience,
      notes: milestone.notes,
      attachments: milestone.attachments,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating milestone:', error);
    return null;
  }

  // If milestone occurred, check for triggered terms
  if (data.occurred && data.event_date) {
    await triggerTermsForMilestone(ownerId, data as CgpMilestone);
  }

  return data as CgpMilestone;
}

/**
 * Update a milestone
 */
export async function updateMilestone(
  id: string,
  updates: Partial<CgpMilestone>
): Promise<CgpMilestone | null> {
  // Create a clean update object with proper types
  const updateData: Record<string, unknown> = {};
  if (updates.milestone_type !== undefined) updateData.milestone_type = updates.milestone_type;
  if (updates.custom_type_name !== undefined) updateData.custom_type_name = updates.custom_type_name;
  if (updates.occurred !== undefined) updateData.occurred = updates.occurred;
  if (updates.event_date !== undefined) updateData.event_date = updates.event_date;
  if (updates.event_time !== undefined) updateData.event_time = updates.event_time;
  if (updates.in_audience !== undefined) updateData.in_audience = updates.in_audience;
  if (updates.notes !== undefined) updateData.notes = updates.notes;
  if (updates.attachments !== undefined) updateData.attachments = updates.attachments;

  const { data, error } = await supabase
    .from('cgp_milestones')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating milestone:', error);
    return null;
  }

  return data as CgpMilestone;
}

/**
 * Check and create term instances when a milestone is registered
 */
export async function triggerTermsForMilestone(
  ownerId: string,
  milestone: CgpMilestone
): Promise<CgpTermInstance[]> {
  const templates = await fetchTermTemplates();
  const suspensions = await getActiveJudicialSuspensions();
  const createdTerms: CgpTermInstance[] = [];

  // Find templates triggered by this milestone type
  const triggeredTemplates = templates.filter(
    t => t.trigger_milestone_type === milestone.milestone_type
  );

  for (const template of triggeredTemplates) {
    // Check if term already exists
    const { data: existing } = await supabase
      .from('cgp_term_instances')
      .select('id')
      .eq('trigger_milestone_id', milestone.id)
      .eq('term_template_code', template.code)
      .single();

    if (existing) continue; // Term already exists

    const triggerDate = parseISO(milestone.event_date!);
    const { startDate, dueDate } = calculateDueDate(
      triggerDate,
      template,
      milestone.in_audience,
      suspensions
    );

    const { data: term, error } = await supabase
      .from('cgp_term_instances')
      .insert({
        owner_id: ownerId,
        filing_id: milestone.filing_id,
        process_id: milestone.process_id,
        term_template_id: template.id,
        term_template_code: template.code,
        term_name: template.name,
        trigger_milestone_id: milestone.id,
        trigger_date: milestone.event_date,
        in_audience: milestone.in_audience,
        start_date: startDate.toISOString().split('T')[0],
        due_date: dueDate.toISOString().split('T')[0],
        original_due_date: dueDate.toISOString().split('T')[0],
        status: 'RUNNING',
        computed_with_suspensions: template.pause_on_judicial_suspension && suspensions.length > 0,
        paused_days_accumulated: 0,
      })
      .select()
      .single();

    if (!error && term) {
      createdTerms.push(term);
      // Create alerts for this term
      await createTermAlerts(ownerId, term, template);
    }
  }

  return createdTerms;
}

/**
 * Create alerts for a term instance based on template policy
 */
async function createTermAlerts(
  ownerId: string,
  term: CgpTermInstance,
  template: CgpTermTemplate
): Promise<void> {
  const dueDate = parseISO(term.due_date);
  const alertDays = template.alerts_days_before || [-5, -3, -1, 0];

  for (const daysBefore of alertDays) {
    const fireAt = addDays(dueDate, daysBefore);
    
    // Skip alerts in the past
    if (isBefore(fireAt, new Date())) continue;

    const severity = daysBefore >= 0 ? 'CRITICAL' : (daysBefore >= -1 ? 'WARNING' : 'INFO');
    const title = daysBefore === 0
      ? `¡HOY VENCE! ${term.term_name}`
      : daysBefore > 0
        ? `VENCIDO hace ${daysBefore} día(s): ${term.term_name}`
        : `Vence en ${Math.abs(daysBefore)} día(s): ${term.term_name}`;

    await supabase.from('alert_instances').insert({
      owner_id: ownerId,
      entity_type: term.filing_id ? 'CGP_FILING' : 'CGP_CASE',
      entity_id: term.filing_id || term.process_id,
      severity,
      status: 'SCHEDULED',
      title,
      message: `${term.term_name} - ${template.consequence_summary || 'Término procesal CGP'}`,
      payload: {
        term_instance_id: term.id,
        term_template_code: term.term_template_code,
        due_date: term.due_date,
        days_before: daysBefore,
      },
      next_fire_at: fireAt.toISOString(),
    });
  }
}

/**
 * Mark a term as satisfied
 */
export async function satisfyTerm(
  termId: string,
  satisfiedByMilestoneId?: string,
  notes?: string
): Promise<void> {
  const { error } = await supabase
    .from('cgp_term_instances')
    .update({
      status: 'SATISFIED',
      satisfied_at: new Date().toISOString(),
      satisfied_by_milestone_id: satisfiedByMilestoneId,
      satisfaction_notes: notes,
    })
    .eq('id', termId);

  if (error) {
    console.error('Error satisfying term:', error);
    return;
  }

  // Cancel pending alerts for this term
  // Note: JSON path filtering requires casting, using contains instead
  const { data: alerts } = await supabase
    .from('alert_instances')
    .select('id')
    .eq('status', 'SCHEDULED')
    .contains('payload', { term_instance_id: termId });

  if (alerts && alerts.length > 0) {
    const alertIds = alerts.map(a => a.id);
    await supabase
      .from('alert_instances')
      .update({ status: 'CANCELLED' })
      .in('id', alertIds);
  }
}

/**
 * Pause a term (e.g., due to judicial suspension or expediente al despacho)
 */
export async function pauseTerm(
  termId: string,
  reason: string
): Promise<void> {
  await supabase
    .from('cgp_term_instances')
    .update({
      status: 'PAUSED',
      pause_reason: reason,
      paused_at: new Date().toISOString(),
    })
    .eq('id', termId);
}

/**
 * Resume a paused term and recalculate due date
 */
export async function resumeTerm(
  termId: string
): Promise<void> {
  const { data: term, error } = await supabase
    .from('cgp_term_instances')
    .select('*')
    .eq('id', termId)
    .single();

  if (error || !term) return;

  // Calculate paused days
  const pausedAt = term.paused_at ? parseISO(term.paused_at) : new Date();
  const pausedDays = differenceInDays(new Date(), pausedAt);
  const totalPausedDays = (term.paused_days_accumulated || 0) + pausedDays;

  // Extend due date by paused days
  const newDueDate = addDays(parseISO(term.due_date), pausedDays);

  await supabase
    .from('cgp_term_instances')
    .update({
      status: 'RUNNING',
      pause_reason: null,
      paused_at: null,
      paused_days_accumulated: totalPausedDays,
      due_date: newDueDate.toISOString().split('T')[0],
      last_computed_at: new Date().toISOString(),
    })
    .eq('id', termId);
}

/**
 * Update inactivity tracker when activity is registered
 */
export async function registerActivity(
  ownerId: string,
  filingId?: string,
  processId?: string,
  description?: string,
  milestoneId?: string
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  // Upsert inactivity tracker
  const { data: existing } = await supabase
    .from('cgp_inactivity_tracker')
    .select('id')
    .eq(filingId ? 'filing_id' : 'process_id', filingId || processId)
    .single();

  if (existing) {
    await supabase
      .from('cgp_inactivity_tracker')
      .update({
        last_activity_date: today,
        last_activity_description: description,
        last_activity_milestone_id: milestoneId,
        is_at_risk: false,
        risk_since: null,
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('cgp_inactivity_tracker').insert({
      owner_id: ownerId,
      filing_id: filingId,
      process_id: processId,
      last_activity_date: today,
      last_activity_description: description,
      last_activity_milestone_id: milestoneId,
      inactivity_threshold_months: 12,
      has_favorable_sentencia: false,
      is_at_risk: false,
    });
  }
}

/**
 * Check inactivity risk for a case
 */
export async function checkInactivityRisk(
  filingId?: string,
  processId?: string
): Promise<{ isAtRisk: boolean; monthsInactive: number; thresholdMonths: number } | null> {
  const { data, error } = await supabase
    .from('cgp_inactivity_tracker')
    .select('*')
    .eq(filingId ? 'filing_id' : 'process_id', filingId || processId)
    .single();

  if (error || !data) return null;

  const lastActivity = parseISO(data.last_activity_date);
  const monthsInactive = differenceInMonths(new Date(), lastActivity);
  const thresholdMonths = data.has_favorable_sentencia ? 24 : 12;
  const isAtRisk = monthsInactive >= thresholdMonths - 3; // Warning at 3 months before

  return { isAtRisk, monthsInactive, thresholdMonths };
}

/**
 * Recompute all open terms for a case (e.g., when suspensions change)
 */
export async function recomputeOpenTerms(
  filingId?: string,
  processId?: string
): Promise<void> {
  const terms = await fetchTermInstances(filingId, processId);
  const suspensions = await getActiveJudicialSuspensions();
  const templates = await fetchTermTemplates();

  for (const term of terms) {
    if (term.status !== 'RUNNING' && term.status !== 'PENDING') continue;

    const template = templates.find(t => t.code === term.term_template_code);
    if (!template) continue;

    const triggerDate = parseISO(term.trigger_date);
    const { dueDate } = calculateDueDate(triggerDate, template, term.in_audience, suspensions);

    await supabase
      .from('cgp_term_instances')
      .update({
        due_date: dueDate.toISOString().split('T')[0],
        computed_with_suspensions: suspensions.length > 0,
        last_computed_at: new Date().toISOString(),
      })
      .eq('id', term.id);
  }
}
