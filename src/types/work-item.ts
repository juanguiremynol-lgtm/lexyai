/**
 * Unified Work Item Types
 * Core types for the unified work item model
 */

import type { WorkflowType, ItemSource, ItemStatus, CGPPhase } from '@/lib/workflow-constants';

// Work Item - the canonical entity representing any tracked legal item
export interface WorkItem {
  id: string;
  owner_id: string;
  organization_id?: string;
  
  // Client and matter relationships
  client_id: string | null;
  matter_id: string | null;
  
  // Workflow classification
  workflow_type: WorkflowType;
  stage: string;
  status: ItemStatus;
  
  // CGP-specific phase
  cgp_phase: CGPPhase | null;
  cgp_phase_source: 'AUTO' | 'MANUAL' | null;
  
  // Source tracking
  source: ItemSource;
  source_reference: string | null;
  source_payload: Record<string, unknown> | null;
  
  // Core identification
  radicado: string | null;
  radicado_verified: boolean;
  tutela_code: string | null; // TUTELA-specific identifier (T + digits)
  corte_status: string | null; // SELECCIONADA / NO_SELECCIONADA / PENDIENTE
  sentencia_ref: string | null; // T-123/2026, SU-045/2026
  provider_sources: Record<string, unknown> | null; // Which providers have data
  
  // Authority/court information
  authority_name: string | null;
  authority_email: string | null;
  authority_city: string | null;
  authority_department: string | null;
  
  // Parties
  demandantes: string | null;
  demandados: string | null;
  
  // Descriptive info
  title: string | null;
  description: string | null;
  notes: string | null;
  
  // Key dates
  auto_admisorio_date: string | null;
  filing_date: string | null;
  last_action_date: string | null;
  last_action_description: string | null;
  
  // Flags and UI state
  is_flagged: boolean;
  monitoring_enabled: boolean;
  email_linking_enabled: boolean;
  
  // External references
  expediente_url: string | null;
  sharepoint_url: string | null;
  onedrive_url?: string | null;
  acta_radicacion_url?: string | null;
  auto_admisorio_url?: string | null;
  
  // Scraping/monitoring state
  scrape_status: 'NOT_ATTEMPTED' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'PARTIAL_SUCCESS';
  last_synced_at: string | null;
  last_checked_at: string | null;
  last_crawled_at: string | null;
  scraped_fields: Record<string, unknown> | null;
  
  // Penal 906 specific fields
  pipeline_stage?: number | null;
  last_event_at?: string | null;
  last_event_summary?: string | null;
  last_phase_change_at?: string | null;
  last_scrape_at?: string | null;
  scraping_enabled?: boolean;
  source_platform?: string | null;
  
  // Statistics
  total_actuaciones: number;
  
  // External API IDs
  pp_id: number | null;
  
  // Legacy IDs
  legacy_filing_id: string | null;
  legacy_process_id: string | null;
  legacy_cgp_item_id: string | null;
  legacy_peticion_id: string | null;
  legacy_cpaca_id: string | null;
  legacy_admin_process_id: string | null;
  
  // Timestamps
  created_at: string;
  updated_at: string;
  
  // Joined data (optional)
  clients?: {
    id: string;
    name: string;
  } | null;
  matters?: {
    id: string;
    matter_name: string;
  } | null;

  // CPNU enrichment fields (from external API)
  cpnu_status?: string | null;
  cpnu_total_procesos?: number | null;
  cpnu_total_sujetos?: number | null;
  ultimo_run_status?: string | null;
  ultimo_run_has_novedad?: boolean | null;
  tipo_novedad?: string | null;
  valor_anterior?: string | null;
  valor_nuevo?: string | null;
  ultima_novedad_descripcion?: string | null;
  ultima_novedad_revisada?: boolean | null;
  ultima_novedad_fecha?: string | null;
}

// Work Item Act - actuaciones linked to work items
export interface WorkItemAct {
  id: string;
  owner_id: string;
  work_item_id: string;
  
  act_date: string | null;
  act_date_raw: string | null;
  description: string;
  act_type: string | null;
  
  source: string;
  source_reference: string | null;
  raw_data: Record<string, unknown> | null;
  
  hash_fingerprint: string;
  created_at: string;
}

// Form types for creating/updating work items
export interface CreateWorkItemForm {
  workflow_type: WorkflowType;
  stage: string;
  cgp_phase?: CGPPhase;
  client_id?: string;
  matter_id?: string;
  radicado?: string;
  title?: string;
  description?: string;
  authority_name?: string;
  authority_city?: string;
  authority_department?: string;
  demandantes?: string;
  demandados?: string;
  source?: ItemSource;
  source_reference?: string;
  source_payload?: Record<string, unknown>;
}

export interface UpdateWorkItemForm {
  stage?: string;
  status?: ItemStatus;
  cgp_phase?: CGPPhase;
  cgp_phase_source?: 'AUTO' | 'MANUAL';
  client_id?: string | null;
  matter_id?: string | null;
  radicado?: string;
  title?: string;
  description?: string;
  notes?: string;
  authority_name?: string;
  authority_email?: string;
  authority_city?: string;
  authority_department?: string;
  demandantes?: string;
  demandados?: string;
  is_flagged?: boolean;
  monitoring_enabled?: boolean;
  email_linking_enabled?: boolean;
  expediente_url?: string;
  sharepoint_url?: string;
  auto_admisorio_date?: string;
}

// Classification result from user input
export interface WorkflowClassification {
  workflow_type: WorkflowType;
  stage: string;
  cgp_phase?: CGPPhase; // Only for CGP
}

// Kanban item representation for UI
export interface KanbanItem {
  id: string;
  workflow_type: WorkflowType;
  stage: string;
  cgp_phase?: CGPPhase;
  radicado: string | null;
  title: string | null;
  authority_name: string | null;
  client_name: string | null;
  is_flagged: boolean;
  last_action_date: string | null;
  created_at: string;
}
