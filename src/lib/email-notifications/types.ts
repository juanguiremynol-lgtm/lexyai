/**
 * Email Notifications Types
 * Admin-managed notification rules and delivery tracking
 */

export type TriggerEvent = 
  | 'ON_ALERT_CREATE'
  | 'ON_STATUS_CHANGE'
  | 'ON_DUE_APPROACHING'
  | 'ON_STALE'
  | 'ON_MILESTONE_DETECTED'
  | 'ON_HEARING_SCHEDULED'
  | 'ON_TERM_EXPIRING';

export type RecipientMode = 
  | 'OWNER'
  | 'ASSIGNED'
  | 'SPECIFIC'
  | 'DISTRIBUTION'
  | 'ROLE';

export type AlertCategory = 
  | 'MILESTONE'
  | 'HEARING'
  | 'TERMS'
  | 'SYSTEM'
  | 'UPDATES';

export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';

export type EmailStatus = 
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'OPENED'
  | 'CLICKED'
  | 'BOUNCED'
  | 'COMPLAINED'
  | 'FAILED_TEMP'
  | 'FAILED_PERM';

export interface NotificationRule {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  workflow_types: string[];
  alert_categories: string[];
  severity_min: Severity;
  trigger_event: TriggerEvent;
  trigger_params?: Record<string, unknown>;
  dedupe_window_minutes: number;
  max_per_10min: number;
  recipient_mode: RecipientMode;
  recipient_emails: string[];
  recipient_role?: string | null;
  use_recipient_directory: boolean;
  email_template_id?: string | null;
  subject_template?: string | null;
  body_template?: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  deleted_at?: string | null;
}

export interface NotificationRecipient {
  id: string;
  organization_id: string;
  email: string;
  label: string;
  enabled: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

export interface EmailOutboxEntry {
  id: string;
  organization_id: string;
  to_email: string;
  to_user_id?: string | null;
  subject: string;
  html: string;
  status: string;
  created_at: string;
  sent_at?: string | null;
  attempts: number;
  error?: string | null;
  failed_permanent: boolean;
  provider_message_id?: string | null;
  notification_rule_id?: string | null;
  trigger_reason?: string | null;
  trigger_event?: string | null;
  work_item_id?: string | null;
  alert_instance_id?: string | null;
  template_id?: string | null;
  template_variables?: Record<string, unknown>;
  triggered_by?: string | null;
  dedupe_key?: string | null;
  metadata?: Record<string, unknown>;
  next_attempt_at?: string | null;
  last_attempt_at?: string | null;
  suppressed_reason?: string | null;
  last_event_type?: string | null;
  last_event_at?: string | null;
  failure_type?: string | null;
  // Joined data
  work_item?: {
    id: string;
    radicado?: string | null;
    title?: string | null;
    workflow_type: string;
  } | null;
  notification_rule?: {
    id: string;
    name: string;
  } | null;
}

export interface EmailDeliveryEvent {
  id: string;
  organization_id: string;
  email_outbox_id?: string | null;
  event_type: string;
  raw_payload?: Record<string, unknown>;
  provider_event_id?: string | null;
  created_at: string;
}

// Form types for creating/editing rules
export interface NotificationRuleFormData {
  name: string;
  description?: string;
  enabled: boolean;
  workflow_types: string[];
  alert_categories: string[];
  severity_min: Severity;
  trigger_event: TriggerEvent;
  trigger_params?: Record<string, unknown>;
  dedupe_window_minutes: number;
  max_per_10min: number;
  recipient_mode: RecipientMode;
  recipient_emails: string[];
  recipient_role?: string;
  use_recipient_directory: boolean;
  subject_template?: string;
  body_template?: string;
}

export interface NotificationRecipientFormData {
  email: string;
  label: string;
  enabled: boolean;
  tags: string[];
}

// Constants
export const TRIGGER_EVENTS: { value: TriggerEvent; label: string; description: string }[] = [
  { value: 'ON_ALERT_CREATE', label: 'Al crear alerta', description: 'Cuando se crea una nueva alerta' },
  { value: 'ON_STATUS_CHANGE', label: 'Al cambiar estado', description: 'Cuando cambia el estado de un asunto' },
  { value: 'ON_DUE_APPROACHING', label: 'Al aproximarse vencimiento', description: 'Cuando un término está por vencer' },
  { value: 'ON_STALE', label: 'Sin actividad', description: 'Cuando no hay actividad por tiempo prolongado' },
  { value: 'ON_MILESTONE_DETECTED', label: 'Al detectar hito', description: 'Cuando se detecta un hito procesal' },
  { value: 'ON_HEARING_SCHEDULED', label: 'Audiencia programada', description: 'Cuando se programa o aproxima una audiencia' },
  { value: 'ON_TERM_EXPIRING', label: 'Término por vencer', description: 'Cuando un término legal está por expirar' },
];

export const RECIPIENT_MODES: { value: RecipientMode; label: string; description: string }[] = [
  { value: 'OWNER', label: 'Propietario', description: 'El propietario del asunto' },
  { value: 'ASSIGNED', label: 'Asignados', description: 'Usuarios asignados al asunto' },
  { value: 'SPECIFIC', label: 'Emails específicos', description: 'Lista de emails definidos en la regla' },
  { value: 'DISTRIBUTION', label: 'Directorio', description: 'Emails del directorio de destinatarios' },
  { value: 'ROLE', label: 'Por rol', description: 'Usuarios con un rol específico' },
];

export const ALERT_CATEGORIES: { value: AlertCategory; label: string }[] = [
  { value: 'MILESTONE', label: 'Hitos' },
  { value: 'HEARING', label: 'Audiencias' },
  { value: 'TERMS', label: 'Términos' },
  { value: 'SYSTEM', label: 'Sistema' },
  { value: 'UPDATES', label: 'Actualizaciones' },
];

export const SEVERITY_LEVELS: { value: Severity; label: string; color: string }[] = [
  { value: 'INFO', label: 'Información', color: 'bg-blue-100 text-blue-700' },
  { value: 'WARNING', label: 'Advertencia', color: 'bg-amber-100 text-amber-700' },
  { value: 'CRITICAL', label: 'Crítico', color: 'bg-red-100 text-red-700' },
];

export const WORKFLOW_TYPES = [
  { value: 'CGP', label: 'CGP' },
  { value: 'CPACA', label: 'CPACA' },
  { value: 'TUTELA', label: 'Tutela' },
  { value: 'LABORAL', label: 'Laboral' },
  { value: 'PENAL_906', label: 'Penal 906' },
  { value: 'PETICION', label: 'Petición' },
  { value: 'GOV_PROCEDURE', label: 'Trámite Gubernamental' },
];

export const EMAIL_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  QUEUED: { label: 'En cola', color: 'bg-slate-100 text-slate-700' },
  SENDING: { label: 'Enviando', color: 'bg-blue-100 text-blue-700' },
  SENT: { label: 'Enviado', color: 'bg-green-100 text-green-700' },
  DELIVERED: { label: 'Entregado', color: 'bg-emerald-100 text-emerald-700' },
  OPENED: { label: 'Abierto', color: 'bg-teal-100 text-teal-700' },
  CLICKED: { label: 'Clic', color: 'bg-cyan-100 text-cyan-700' },
  BOUNCED: { label: 'Rebotado', color: 'bg-orange-100 text-orange-700' },
  COMPLAINED: { label: 'Queja', color: 'bg-red-100 text-red-700' },
  FAILED_TEMP: { label: 'Error temporal', color: 'bg-amber-100 text-amber-700' },
  FAILED_PERM: { label: 'Error permanente', color: 'bg-red-100 text-red-700' },
};
