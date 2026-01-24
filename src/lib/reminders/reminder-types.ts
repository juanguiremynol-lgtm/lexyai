/**
 * Reminder Types - Type definitions for the milestone reminder system
 */

export type ReminderType = 
  | 'ACTA_REPARTO_PENDING'
  | 'RADICADO_PENDING'
  | 'EXPEDIENTE_PENDING'
  | 'AUTO_ADMISORIO_PENDING';

export type ReminderStatus = 'ACTIVE' | 'COMPLETED' | 'SNOOZED' | 'DISMISSED';

export interface WorkItemReminder {
  id: string;
  organization_id: string;
  owner_id: string;
  work_item_id: string;
  reminder_type: ReminderType;
  cadence_business_days: number;
  next_run_at: string;
  last_triggered_at: string | null;
  trigger_count: number;
  status: ReminderStatus;
  completed_at: string | null;
  dismissed_at: string | null;
  snoozed_until: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Reminder configuration for each milestone type
export const REMINDER_CONFIG: Record<ReminderType, {
  label: string;
  description: string;
  message: string;
  ctaLabel: string;
  cadenceDays: number;
}> = {
  ACTA_REPARTO_PENDING: {
    label: 'Acta de Reparto',
    description: 'Constancia de radicación ante el juzgado',
    message: 'Este proceso aún no tiene ACTA DE REPARTO registrada. ¿Ya recibiste la constancia de reparto? Regístrala aquí.',
    ctaLabel: 'Registrar Acta de Reparto',
    cadenceDays: 5,
  },
  RADICADO_PENDING: {
    label: 'Número de Radicado',
    description: 'Número de 23 dígitos del proceso judicial',
    message: 'Este proceso aún no tiene NÚMERO DE RADICADO. Actualízalo para poder hacer seguimiento por Rama Judicial.',
    ctaLabel: 'Agregar Radicado',
    cadenceDays: 5,
  },
  EXPEDIENTE_PENDING: {
    label: 'Expediente Electrónico',
    description: 'Enlace al expediente digital (OneDrive/SharePoint)',
    message: 'Aún no se ha registrado el enlace al EXPEDIENTE ELECTRÓNICO. Agrégalo para acceso rápido al expediente digital.',
    ctaLabel: 'Agregar Enlace',
    cadenceDays: 5,
  },
  AUTO_ADMISORIO_PENDING: {
    label: 'Auto Admisorio',
    description: 'Auto de admisión de la demanda',
    message: 'Aún no se registra AUTO ADMISORIO. Verifica estados o expediente y actualiza cuando llegue.',
    ctaLabel: 'Registrar Auto Admisorio',
    cadenceDays: 5,
  },
};

// Judicial workflows that trigger reminders
export const JUDICIAL_WORKFLOW_TYPES = ['CGP', 'CPACA', 'TUTELA', 'LABORAL'] as const;
export type JudicialWorkflowType = typeof JUDICIAL_WORKFLOW_TYPES[number];

// Map workflow types to applicable reminders
export const WORKFLOW_REMINDERS: Record<JudicialWorkflowType, ReminderType[]> = {
  CGP: ['ACTA_REPARTO_PENDING', 'RADICADO_PENDING', 'EXPEDIENTE_PENDING', 'AUTO_ADMISORIO_PENDING'],
  CPACA: ['ACTA_REPARTO_PENDING', 'RADICADO_PENDING', 'EXPEDIENTE_PENDING', 'AUTO_ADMISORIO_PENDING'],
  TUTELA: ['ACTA_REPARTO_PENDING', 'RADICADO_PENDING', 'EXPEDIENTE_PENDING', 'AUTO_ADMISORIO_PENDING'],
  LABORAL: ['ACTA_REPARTO_PENDING', 'RADICADO_PENDING', 'EXPEDIENTE_PENDING', 'AUTO_ADMISORIO_PENDING'],
};
