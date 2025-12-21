// Type definitions matching the database schema
// These complement the auto-generated Supabase types

export type FilingStatus = 
  | 'DRAFTED'
  | 'SENT_TO_REPARTO'
  | 'RECEIPT_CONFIRMED'
  | 'ACTA_PENDING'
  | 'ACTA_RECEIVED_PARSED'
  | 'COURT_EMAIL_DRAFTED'
  | 'COURT_EMAIL_SENT'
  | 'RADICADO_PENDING'
  | 'RADICADO_CONFIRMED'
  | 'ICARUS_SYNC_PENDING'
  | 'MONITORING_ACTIVE'
  | 'CLOSED';

export type DocumentKind = 
  | 'DEMANDA'
  | 'ACTA_REPARTO'
  | 'AUTO_RECEIPT'
  | 'COURT_RESPONSE'
  | 'OTHER';

export type TaskType = 
  | 'FOLLOW_UP_REPARTO'
  | 'FOLLOW_UP_COURT'
  | 'ENTER_RADICADO'
  | 'ADD_TO_ICARUS'
  | 'REVIEW_ACTA_PARSE'
  | 'GENERIC';

export type TaskStatus = 'OPEN' | 'DONE' | 'SNOOZED';

export type EmailDirection = 'OUT' | 'IN' | 'DRAFT';

export type AlertSeverity = 'INFO' | 'WARN' | 'CRITICAL';

// Extended types with relations
export interface Profile {
  id: string;
  full_name: string | null;
  firm_name: string;
  timezone: string;
  signature_block: string | null;
  sla_receipt_hours: number;
  sla_acta_days: number;
  sla_court_reply_days: number;
  reparto_directory: RepartoEntry[];
  created_at: string;
  updated_at: string;
}

export interface RepartoEntry {
  city: string;
  circuit: string;
  email: string;
}

export interface Matter {
  id: string;
  owner_id: string;
  client_name: string;
  client_id_number: string | null;
  matter_name: string;
  practice_area: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Filing {
  id: string;
  owner_id: string;
  matter_id: string;
  filing_type: string;
  reparto_email_to: string | null;
  sent_at: string | null;
  status: FilingStatus;
  sla_receipt_due_at: string | null;
  sla_acta_due_at: string | null;
  sla_court_reply_due_at: string | null;
  reparto_reference: string | null;
  acta_received_at: string | null;
  radicado: string | null;
  court_name: string | null;
  court_email: string | null;
  court_city: string | null;
  court_department: string | null;
  last_event_at: string;
  created_at: string;
  updated_at: string;
  // Relations
  matter?: Matter;
  documents?: Document[];
  emails?: Email[];
  tasks?: Task[];
}

export interface Document {
  id: string;
  owner_id: string;
  filing_id: string;
  kind: DocumentKind;
  file_path: string;
  original_filename: string;
  sha256: string | null;
  uploaded_at: string;
  extracted_json: ExtractedData | null;
}

export interface ExtractedData {
  radicado?: string;
  despacho_raw?: string;
  excerpt?: string;
  [key: string]: unknown;
}

export interface EmailThread {
  id: string;
  owner_id: string;
  filing_id: string;
  subject: string;
  created_at: string;
}

export interface Email {
  id: string;
  owner_id: string;
  filing_id: string;
  thread_id: string | null;
  direction: EmailDirection;
  recipient: string | null;
  cc: string | null;
  sender: string | null;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  status: string;
  created_at: string;
  sent_at: string | null;
  received_at: string | null;
}

export interface Task {
  id: string;
  owner_id: string;
  filing_id: string | null;
  type: TaskType;
  title: string;
  due_at: string;
  status: TaskStatus;
  auto_generated: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  // Relations
  filing?: Filing;
}

export interface Alert {
  id: string;
  owner_id: string;
  filing_id: string | null;
  severity: AlertSeverity;
  message: string;
  created_at: string;
  is_read: boolean;
  // Relations
  filing?: Filing;
}

// Form types
export interface CreateMatterForm {
  client_name: string;
  client_id_number?: string;
  matter_name: string;
  practice_area?: string;
  notes?: string;
}

export interface CreateFilingForm {
  matter_id: string;
  filing_type: string;
  reparto_email_to?: string;
  sent_at?: string;
  reparto_reference?: string;
}

export interface UpdateFilingForm {
  court_name?: string;
  court_email?: string;
  court_city?: string;
  court_department?: string;
  radicado?: string;
  status?: FilingStatus;
}
