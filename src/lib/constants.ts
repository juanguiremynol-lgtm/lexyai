// Filing status definitions with labels and colors
export const FILING_STATUSES = {
  DRAFTED: { label: 'Borrador', color: 'drafted', order: 0 },
  SENT_TO_REPARTO: { label: 'Enviado a Reparto', color: 'sent', order: 1 },
  RECEIPT_CONFIRMED: { label: 'Recibo Confirmado', color: 'received', order: 2 },
  ACTA_PENDING: { label: 'Acta Pendiente', color: 'pending', order: 3 },
  ACTA_RECEIVED_PARSED: { label: 'Acta Recibida', color: 'received', order: 4 },
  COURT_EMAIL_DRAFTED: { label: 'Correo Juzgado Borrador', color: 'pending', order: 5 },
  COURT_EMAIL_SENT: { label: 'Correo Juzgado Enviado', color: 'sent', order: 6 },
  RADICADO_PENDING: { label: 'Radicado Pendiente', color: 'pending', order: 7 },
  RADICADO_CONFIRMED: { label: 'Radicado Confirmado', color: 'confirmed', order: 8 },
  ICARUS_SYNC_PENDING: { label: 'Pendiente Auto Admisorio', color: 'pending', order: 9 },
  MONITORING_ACTIVE: { label: 'En Seguimiento', color: 'active', order: 10 },
  CLOSED: { label: 'Cerrado', color: 'closed', order: 11 },
} as const;

export type FilingStatus = keyof typeof FILING_STATUSES;

// Document types
export const DOCUMENT_KINDS = {
  DEMANDA: { label: 'Demanda', icon: 'FileText' },
  ACTA_REPARTO: { label: 'Acta de Reparto', icon: 'FileCheck' },
  AUTO_RECEIPT: { label: 'Auto de Recibo', icon: 'Receipt' },
  COURT_RESPONSE: { label: 'Respuesta del Juzgado', icon: 'Mail' },
  OTHER: { label: 'Otro', icon: 'File' },
} as const;

export type DocumentKind = keyof typeof DOCUMENT_KINDS;

// Task types
export const TASK_TYPES = {
  FOLLOW_UP_REPARTO: { label: 'Seguimiento a Reparto', color: 'warning' },
  FOLLOW_UP_COURT: { label: 'Seguimiento al Juzgado', color: 'warning' },
  ENTER_RADICADO: { label: 'Ingresar Radicado', color: 'safe' },
  ADD_TO_ICARUS: { label: 'Agregar a Icarus', color: 'safe' },
  REVIEW_ACTA_PARSE: { label: 'Revisar Acta', color: 'warning' },
  REVIEW_PROCESS: { label: 'Revisar Proceso', color: 'warning' },
  REVIEW_FILING: { label: 'Revisar Radicación', color: 'warning' },
  IMPORT_ESTADOS: { label: 'Importar Estados', color: 'safe' },
  GENERIC: { label: 'Tarea General', color: 'safe' },
} as const;

export type TaskType = keyof typeof TASK_TYPES;

// Practice areas for Colombia
export const PRACTICE_AREAS = [
  'Civil',
  'Laboral',
  'Administrativo',
  'Penal',
  'Familia',
  'Comercial',
  'Constitucional',
  'Tributario',
  'Otro',
] as const;

// Filing types
export const FILING_TYPES = [
  'Petición',
  'Demanda',
  'Acción de Tutela',
  'Habeas Corpus',
  'Denuncia',
  'Querella',
  'Incidente',
  'Recurso',
  'Memorial',
  'Otro',
] as const;

// Filing methods
export const FILING_METHODS = {
  EMAIL: { label: 'Correo electrónico', icon: 'Mail' },
  PLATFORM: { label: 'Plataforma digital', icon: 'Globe' },
  PHYSICAL: { label: 'Envío físico', icon: 'Package' },
} as const;

export type FilingMethod = keyof typeof FILING_METHODS;

// Colombian departments
export const COLOMBIAN_DEPARTMENTS = [
  'Amazonas', 'Antioquia', 'Arauca', 'Atlántico', 'Bogotá D.C.', 
  'Bolívar', 'Boyacá', 'Caldas', 'Caquetá', 'Casanare',
  'Cauca', 'Cesar', 'Chocó', 'Córdoba', 'Cundinamarca',
  'Guainía', 'Guaviare', 'Huila', 'La Guajira', 'Magdalena',
  'Meta', 'Nariño', 'Norte de Santander', 'Putumayo', 'Quindío',
  'Risaralda', 'San Andrés y Providencia', 'Santander', 'Sucre', 'Tolima',
  'Valle del Cauca', 'Vaupés', 'Vichada',
] as const;

// Kanban columns for radicaciones pipeline (ends at ICARUS_SYNC_PENDING)
export const KANBAN_COLUMNS: FilingStatus[] = [
  'SENT_TO_REPARTO',
  'ACTA_PENDING',
  'ACTA_RECEIVED_PARSED',
  'COURT_EMAIL_DRAFTED',
  'RADICADO_PENDING',
  'RADICADO_CONFIRMED',
  'ICARUS_SYNC_PENDING',
];

// Process pipeline stages
export const PROCESS_STAGES = {
  EN_SEGUIMIENTO: { label: 'En Seguimiento', color: 'active', order: 0 },
} as const;

export type ProcessStage = keyof typeof PROCESS_STAGES;

// Email templates
export const EMAIL_TEMPLATES = {
  REMINDER_REPARTO: {
    id: 'reminder_reparto',
    name: 'Recordatorio a Reparto',
    subject: 'Solicitud de confirmación – Acta de reparto pendiente – {{reparto_reference}}',
    body: `Cordial saludo.

Respetuosamente solicito confirmar el estado del reparto/distribución del trámite remitido el {{sent_at}} a este correo, correspondiente a {{matter_name}} – {{client_name}}.

A la fecha no he recibido el Acta de Reparto. Agradezco su remisión o, en su defecto, la indicación del estado y el tiempo estimado de asignación.

Quedo atento.

Cordialmente,
{{signature_block}}`,
  },
  COURT_REQUEST: {
    id: 'court_request',
    name: 'Solicitud al Juzgado',
    subject: 'Solicitud de radicado y acceso a expediente electrónico – {{matter_name}}',
    body: `Respetado(a) Despacho {{court_name}}
{{court_city}}, {{court_department}}

Cordial saludo.

En atención al Acta de Reparto recibida el {{acta_received_at}}, mediante la cual se asignó el trámite a su despacho, solicito respetuosamente:

1. Informar el número de radicado asignado al proceso, en caso de que ya se encuentre generado.

2. Facilitar las instrucciones y/o habilitar el acceso al expediente electrónico (carpeta digital) para consulta y seguimiento, una vez se encuentre disponible.

Para su referencia, adjunto el Acta de Reparto y el escrito radicado a reparto.

Agradezco confirmar el recibo del presente mensaje y la gestión correspondiente.

Cordialmente,
{{signature_block}}`,
  },
  COURT_FOLLOWUP: {
    id: 'court_followup',
    name: 'Seguimiento al Juzgado',
    subject: 'Seguimiento – Radicado/Acceso expediente electrónico pendiente – {{matter_name}}',
    body: `Respetado(a) Despacho {{court_name}}
{{court_city}}, {{court_department}}

Cordial saludo.

En seguimiento a mi comunicación anterior de fecha {{court_email_sent_at}}, me permito reiterar respetuosamente la solicitud de:

1. Informar el número de radicado asignado al proceso.
2. Facilitar el acceso al expediente electrónico.

Adjunto nuevamente el Acta de Reparto para su referencia.

Agradezco su pronta gestión.

Cordialmente,
{{signature_block}}`,
  },
} as const;

// Radicado validation (23 digits for Colombia)
export const RADICADO_REGEX = /^\d{23}$/;

export function validateRadicado(radicado: string): boolean {
  return RADICADO_REGEX.test(radicado);
}

// Format date for Colombia
export function formatDateColombia(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Calculate SLA status
export function getSlaStatus(dueDate: Date | string | null): 'safe' | 'warning' | 'critical' | null {
  if (!dueDate) return null;
  
  const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  
  if (diffDays < 0) return 'critical';
  if (diffDays < 2) return 'warning';
  return 'safe';
}

// Get days until/since date
export function getDaysDiff(date: Date | string | null): number | null {
  if (!date) return null;
  
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
