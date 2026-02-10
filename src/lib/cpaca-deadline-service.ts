/**
 * CPACA Deadline Service
 * Generates and manages CPACA deadlines with alert integration
 */

import { supabase } from "@/integrations/supabase/client";
import { createAlertIdempotent } from "@/lib/alerts";
import {
  addBusinessDays,
  calculateFechaInicioTermino,
  calculateVencimientoTrasladoDemanda,
  calculateVencimientoTrasladoExcepciones,
  calculateVencimientoApelacionSentencia,
  calculateVencimientoApelacionAuto,
  getBusinessDaysRemaining,
} from "./cpaca-term-calculator";
import { CPACA_TERMS, CPACA_ALERT_CONFIGS, type CpacaPhase } from "./cpaca-constants";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export type DeadlineType = 
  | 'TRASLADO_DEMANDA'
  | 'TRASLADO_EXCEPCIONES'
  | 'APELACION_SENTENCIA'
  | 'APELACION_AUTO'
  | 'CADUCIDAD'
  | 'CONCILIACION_LIMITE'
  | 'AUDIENCIA_INICIAL'
  | 'AUDIENCIA_PRUEBAS';

export interface WorkItemDeadline {
  id?: string;
  owner_id: string;
  work_item_id: string;
  deadline_type: string; // Using string for DB compatibility
  label: string;
  description?: string;
  trigger_event: string;
  trigger_date: string;
  deadline_date: string;
  business_days_count?: number;
  status: 'PENDING' | 'MET' | 'MISSED' | 'CANCELLED';
  calculation_meta?: Record<string, unknown>;
}

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

/**
 * Calculate urgency based on business days remaining
 */
export function calculateUrgency(businessDaysRemaining: number): {
  severity: AlertSeverity;
  label: string;
  color: string;
} {
  if (businessDaysRemaining < 0) {
    return { severity: 'CRITICAL', label: 'VENCIDO', color: 'destructive' };
  }
  if (businessDaysRemaining <= 1) {
    return { severity: 'CRITICAL', label: 'CRÍTICO', color: 'destructive' };
  }
  if (businessDaysRemaining <= 3) {
    return { severity: 'WARNING', label: 'URGENTE', color: 'warning' };
  }
  if (businessDaysRemaining <= 5) {
    return { severity: 'WARNING', label: 'PRÓXIMO', color: 'secondary' };
  }
  return { severity: 'INFO', label: 'EN TÉRMINO', color: 'default' };
}

/**
 * Generate all CPACA deadlines for a work item
 */
export async function generateCpacaDeadlines(
  workItemId: string,
  ownerId: string,
  cpacaData: {
    phase: CpacaPhase;
    fecha_envio_notificacion_electronica?: string | null;
    prorroga_traslado_demanda?: boolean;
    fecha_notificacion_excepciones?: string | null;
    fecha_notificacion_sentencia?: string | null;
    fecha_notificacion_auto?: string | null;
    fecha_radicacion_conciliacion?: string | null;
    fecha_vencimiento_caducidad?: string | null;
    fecha_audiencia_inicial?: string | null;
    fecha_audiencia_pruebas?: string | null;
  }
): Promise<WorkItemDeadline[]> {
  const deadlines: WorkItemDeadline[] = [];
  
  // 1. Calculate traslado demanda deadline
  if (cpacaData.fecha_envio_notificacion_electronica) {
    const fechaNotificacion = new Date(cpacaData.fecha_envio_notificacion_electronica);
    const fechaInicioTermino = await calculateFechaInicioTermino(fechaNotificacion);
    const fechaVencimientoTraslado = await calculateVencimientoTrasladoDemanda(
      fechaInicioTermino,
      cpacaData.prorroga_traslado_demanda || false
    );
    
    const baseDays = CPACA_TERMS.TRASLADO_DEMANDA_DIAS;
    const totalDays = cpacaData.prorroga_traslado_demanda 
      ? baseDays + CPACA_TERMS.TRASLADO_DEMANDA_PRORROGA_DIAS 
      : baseDays;
    
    deadlines.push({
      owner_id: ownerId,
      work_item_id: workItemId,
      deadline_type: 'TRASLADO_DEMANDA',
      label: `Traslado Demanda (${totalDays} días)`,
      description: cpacaData.prorroga_traslado_demanda 
        ? 'Plazo para contestación con prórroga (+15 días)'
        : 'Plazo para contestación de demanda',
      trigger_event: 'NOTIFICACION_ELECTRONICA',
      trigger_date: format(fechaNotificacion, 'yyyy-MM-dd'),
      deadline_date: format(fechaVencimientoTraslado, 'yyyy-MM-dd'),
      business_days_count: totalDays,
      status: 'PENDING',
      calculation_meta: {
        art_199_dias: CPACA_TERMS.NOTIFICACION_DIAS_HABILES,
        fecha_inicio_termino: fechaInicioTermino.toISOString(),
        prorroga: cpacaData.prorroga_traslado_demanda || false,
      },
    });
    
    // Reforma deadline removed — stage no longer exists
  }
  
  // 3. Calculate excepciones deadline
  if (cpacaData.fecha_notificacion_excepciones) {
    const fechaExcepciones = new Date(cpacaData.fecha_notificacion_excepciones);
    const fechaVencimiento = await calculateVencimientoTrasladoExcepciones(fechaExcepciones);
    
    deadlines.push({
      owner_id: ownerId,
      work_item_id: workItemId,
      deadline_type: 'TRASLADO_EXCEPCIONES',
      label: `Traslado Excepciones (${CPACA_TERMS.TRASLADO_EXCEPCIONES_DIAS} días)`,
      description: 'Plazo para pronunciarse sobre excepciones',
      trigger_event: 'NOTIFICACION_EXCEPCIONES',
      trigger_date: format(fechaExcepciones, 'yyyy-MM-dd'),
      deadline_date: format(fechaVencimiento, 'yyyy-MM-dd'),
      business_days_count: CPACA_TERMS.TRASLADO_EXCEPCIONES_DIAS,
      status: 'PENDING',
    });
  }
  
  // 4. Calculate apelación sentencia deadline
  if (cpacaData.fecha_notificacion_sentencia) {
    const fechaSentencia = new Date(cpacaData.fecha_notificacion_sentencia);
    const fechaVencimiento = await calculateVencimientoApelacionSentencia(fechaSentencia);
    
    deadlines.push({
      owner_id: ownerId,
      work_item_id: workItemId,
      deadline_type: 'APELACION_SENTENCIA',
      label: `Apelación Sentencia (${CPACA_TERMS.APELACION_SENTENCIA_DIAS} días)`,
      description: 'Plazo para interponer recurso de apelación contra sentencia',
      trigger_event: 'NOTIFICACION_SENTENCIA',
      trigger_date: format(fechaSentencia, 'yyyy-MM-dd'),
      deadline_date: format(fechaVencimiento, 'yyyy-MM-dd'),
      business_days_count: CPACA_TERMS.APELACION_SENTENCIA_DIAS,
      status: 'PENDING',
    });
  }
  
  // 5. Calculate apelación auto deadline
  if (cpacaData.fecha_notificacion_auto) {
    const fechaAuto = new Date(cpacaData.fecha_notificacion_auto);
    const fechaVencimiento = await calculateVencimientoApelacionAuto(fechaAuto);
    
    deadlines.push({
      owner_id: ownerId,
      work_item_id: workItemId,
      deadline_type: 'APELACION_AUTO',
      label: `Apelación Auto (${CPACA_TERMS.APELACION_AUTO_DIAS} días)`,
      description: 'Plazo para interponer recurso de apelación contra auto',
      trigger_event: 'NOTIFICACION_AUTO',
      trigger_date: format(fechaAuto, 'yyyy-MM-dd'),
      deadline_date: format(fechaVencimiento, 'yyyy-MM-dd'),
      business_days_count: CPACA_TERMS.APELACION_AUTO_DIAS,
      status: 'PENDING',
    });
  }
  
  // 6. Add caducidad tracking if exists
  if (cpacaData.fecha_vencimiento_caducidad) {
    const fechaCaducidad = new Date(cpacaData.fecha_vencimiento_caducidad);
    
    deadlines.push({
      owner_id: ownerId,
      work_item_id: workItemId,
      deadline_type: 'CADUCIDAD',
      label: 'Vencimiento Caducidad',
      description: 'Fecha límite para radicar demanda',
      trigger_event: 'ACTO_ADMINISTRATIVO',
      trigger_date: format(new Date(), 'yyyy-MM-dd'), // Placeholder
      deadline_date: format(fechaCaducidad, 'yyyy-MM-dd'),
      status: 'PENDING',
      calculation_meta: {
        is_calendar_days: true,
        critical: true,
      },
    });
  }
  
  return deadlines;
}

/**
 * Save deadlines to database and create corresponding alerts
 */
export async function saveCpacaDeadlinesWithAlerts(
  workItemId: string,
  ownerId: string,
  deadlines: WorkItemDeadline[],
  workItemTitle: string
): Promise<{ deadlinesCreated: number; alertsCreated: number }> {
  let deadlinesCreated = 0;
  let alertsCreated = 0;
  
  for (const deadline of deadlines) {
    // Check if deadline already exists
    const { data: existing } = await supabase
      .from('work_item_deadlines')
      .select('id')
      .eq('work_item_id', workItemId)
      .eq('deadline_type', deadline.deadline_type)
      .single();
    
    if (existing) {
      // Update existing deadline
      await supabase
        .from('work_item_deadlines')
        .update({
          deadline_date: deadline.deadline_date,
          trigger_date: deadline.trigger_date,
          business_days_count: deadline.business_days_count,
          calculation_meta: deadline.calculation_meta ? JSON.parse(JSON.stringify(deadline.calculation_meta)) : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      // Insert new deadline - transform for Supabase JSON type
      const insertData = {
        owner_id: deadline.owner_id,
        work_item_id: deadline.work_item_id,
        deadline_type: deadline.deadline_type,
        label: deadline.label,
        description: deadline.description,
        trigger_event: deadline.trigger_event,
        trigger_date: deadline.trigger_date,
        deadline_date: deadline.deadline_date,
        business_days_count: deadline.business_days_count,
        status: deadline.status,
        calculation_meta: deadline.calculation_meta ? JSON.parse(JSON.stringify(deadline.calculation_meta)) : null,
      };
      
      const { error } = await supabase
        .from('work_item_deadlines')
        .insert(insertData);
      
      if (!error) {
        deadlinesCreated++;
        
        // Create alert rule for this deadline
        const deadlineDate = new Date(deadline.deadline_date);
        const businessDaysRemaining = await getBusinessDaysRemaining(deadlineDate);
        
        // Determine when to fire alerts based on remaining days
        let nextFireDays: number;
        if (businessDaysRemaining <= 1) {
          nextFireDays = 0; // Fire immediately
        } else if (businessDaysRemaining <= 3) {
          nextFireDays = 1;
        } else if (businessDaysRemaining <= 5) {
          nextFireDays = businessDaysRemaining - 3;
        } else {
          nextFireDays = businessDaysRemaining - 5;
        }
        
        const nextFireDate = await addBusinessDays(new Date(), nextFireDays);
        
        // Create alert rule
        const { error: ruleError } = await supabase.from('alert_rules').insert({
          owner_id: ownerId,
          entity_type: 'CPACA',
          entity_id: workItemId,
          rule_kind: 'DATE_DUE',
          title: `${deadline.label} - ${workItemTitle}`,
          description: deadline.description,
          channels: ['IN_APP'],
          is_optional_user_defined: false,
          is_system_mandatory: true,
          due_at: deadlineDate.toISOString(),
          next_fire_at: nextFireDate.toISOString(),
          active: true,
          stop_condition: { deadline_type: deadline.deadline_type, status: 'MET' },
        });
        
        if (!ruleError) {
          alertsCreated++;
        }
        
        // Create immediate alert if deadline is critical (idempotent)
        const urgency = calculateUrgency(businessDaysRemaining);
        if (urgency.severity === 'CRITICAL' || urgency.severity === 'WARNING') {
          await createAlertIdempotent({
            ownerId,
            entityType: 'CPACA',
            entityId: workItemId,
            severity: urgency.severity,
            title: `${urgency.label}: ${deadline.label}`,
            message: `${deadline.description}. Vence el ${format(deadlineDate, "d 'de' MMMM, yyyy", { locale: es })}.`,
            payload: {
              deadline_type: deadline.deadline_type,
              deadline_date: deadline.deadline_date,
              business_days_remaining: businessDaysRemaining,
            },
            actions: [
              { label: 'Ver Proceso', action: 'navigate', params: { path: `/app/work-items/${workItemId}?tab=deadlines` } },
            ],
            fingerprintKeys: {
              eventType: deadline.deadline_type,
              eventDate: deadline.deadline_date,
            },
          });
        }
      }
    }
  }
  
  return { deadlinesCreated, alertsCreated };
}

/**
 * Recalculate and update deadlines for a CPACA work item
 */
export async function recalculateCpacaDeadlines(
  workItemId: string
): Promise<void> {
  // Fetch work item with CPACA data
  const { data: workItem, error } = await supabase
    .from('work_items')
    .select('*')
    .eq('id', workItemId)
    .single();
  
  if (error || !workItem || workItem.workflow_type !== 'CPACA') {
    return;
  }
  
  // Generate new deadlines - use available work_items fields
  // For CPACA processes, stage can indicate phase
  const stageToPhase = (stage: string | null): CpacaPhase => {
    if (!stage) return 'PRECONTENCIOSO';
    // Map stage to CPACA phase
    const mapping: Record<string, CpacaPhase> = {
      'PRECONTENCIOSO': 'PRECONTENCIOSO',
      'DEMANDA_POR_RADICAR': 'DEMANDA_POR_RADICAR',
      'DEMANDA_RADICADA': 'DEMANDA_RADICADA',
      'AUTO_ADMISORIO': 'AUTO_ADMISORIO',
      'TRASLADO_DEMANDA': 'TRASLADO_DEMANDA',
    };
    return mapping[stage] || 'PRECONTENCIOSO';
  };
  
  const deadlines = await generateCpacaDeadlines(
    workItemId,
    workItem.owner_id,
    {
      phase: stageToPhase(workItem.stage),
      fecha_envio_notificacion_electronica: workItem.filing_date,
      prorroga_traslado_demanda: false,
      fecha_notificacion_excepciones: null,
      fecha_notificacion_sentencia: null,
      fecha_notificacion_auto: null,
      fecha_radicacion_conciliacion: null,
      fecha_vencimiento_caducidad: null, // Would come from legacy_cpaca_id if needed
    }
  );
  
  // Save with alerts
  await saveCpacaDeadlinesWithAlerts(
    workItemId,
    workItem.owner_id,
    deadlines,
    workItem.title || 'Proceso CPACA'
  );
}

/**
 * Mark a deadline as met
 */
export async function markDeadlineAsMet(
  deadlineId: string
): Promise<void> {
  await supabase
    .from('work_item_deadlines')
    .update({
      status: 'MET',
      met_at: new Date().toISOString(),
    })
    .eq('id', deadlineId);
  
  // Cancel related pending alerts
  const { data: deadline } = await supabase
    .from('work_item_deadlines')
    .select('work_item_id, deadline_type')
    .eq('id', deadlineId)
    .single();
  
  if (deadline) {
    await supabase
      .from('alert_rules')
      .update({ active: false })
      .eq('entity_type', 'CPACA')
      .eq('entity_id', deadline.work_item_id)
      .contains('stop_condition', { deadline_type: deadline.deadline_type });
  }
}

/**
 * Get all pending deadlines for a work item with urgency
 */
export async function getPendingDeadlinesWithUrgency(
  workItemId: string
): Promise<Array<{
  id: string;
  deadline_type: string;
  label: string;
  description: string | null;
  trigger_event: string;
  trigger_date: string;
  deadline_date: string;
  business_days_count: number | null;
  status: string;
  calculation_meta: Record<string, unknown> | null;
  business_days_remaining: number;
  urgency: ReturnType<typeof calculateUrgency>;
}>> {
  const { data: deadlines, error } = await supabase
    .from('work_item_deadlines')
    .select('*')
    .eq('work_item_id', workItemId)
    .eq('status', 'PENDING')
    .order('deadline_date', { ascending: true });
  
  if (error || !deadlines) return [];
  
  const results = await Promise.all(
    deadlines.map(async (deadline) => {
      const deadlineDate = new Date(deadline.deadline_date);
      const businessDaysRemaining = await getBusinessDaysRemaining(deadlineDate);
      const urgency = calculateUrgency(businessDaysRemaining);
      
      return {
        id: deadline.id,
        deadline_type: deadline.deadline_type,
        label: deadline.label,
        description: deadline.description,
        trigger_event: deadline.trigger_event,
        trigger_date: deadline.trigger_date,
        deadline_date: deadline.deadline_date,
        business_days_count: deadline.business_days_count,
        status: deadline.status,
        calculation_meta: deadline.calculation_meta as Record<string, unknown> | null,
        business_days_remaining: businessDaysRemaining,
        urgency,
      };
    })
  );
  
  return results;
}
