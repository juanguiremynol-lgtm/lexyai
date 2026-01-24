/**
 * Normalized Ingestion Types for ATENIA
 * 
 * These types represent a stable, source-agnostic format for process data
 * that can be produced by any data source (Excel import, external scraper, CPNU, etc.)
 */

// Data sources that can produce snapshots
export type IngestionSource = 
  | 'ICARUS_EXCEL_PROCESS'      // ICARUS Excel full process list
  | 'ICARUS_EXCEL_ESTADOS'      // ICARUS Excel estados/status updates
  | 'EXTERNAL_SCRAPER'          // Future AWS/GCP scraper service
  | 'CPNU'                      // Consulta Procesos Nacional Unificada
  | 'PUBLICACIONES'             // Publicaciones Procesales
  | 'HISTORICO'                 // Portal Histórico
  | 'MANUAL';                   // Manual entry by user

// Workflow type suggestion based on process data
export type SuggestedWorkflowType = 
  | 'CGP' 
  | 'CPACA' 
  | 'TUTELA' 
  | 'PETICION' 
  | 'UNKNOWN';

// Party in a legal process
export interface ProcessParty {
  role: 'DEMANDANTE' | 'DEMANDADO' | 'ACCIONANTE' | 'ACCIONADO' | 'TERCERO' | 'UNKNOWN';
  name: string;
  id_number?: string;
}

// Authority/court information
export interface AuthorityInfo {
  despacho_name: string;
  city?: string;
  department?: string;
  judge_name?: string;
  email?: string;
  circuit?: string;
  specialty?: string;
}

// Notification/estado data (critical for term triggering)
export interface EstadoNotification {
  notification_date: string | null;      // ISO date
  notification_date_raw: string;         // Original string
  notification_type?: string;            // Type of notification
  summary: string;                        // Description
  triggers_term: boolean;                 // Whether this starts a judicial term
  term_start_date?: string | null;       // When the term starts counting
  anotacion?: string;                     // Additional notes
  source_columns?: Record<string, string>; // All original columns
}

// Last action/actuación summary
export interface LastActionInfo {
  action_date: string | null;            // ISO date
  action_date_raw: string;               // Original string
  description: string;                    // Action description
  action_type?: string;                   // Type classification
}

/**
 * NormalizedProcessSnapshot
 * 
 * A stable shape produced by any ingestion source.
 * This is the contract between data sources and ATENIA's processing pipeline.
 */
export interface NormalizedProcessSnapshot {
  // Required: 23-digit radicado
  radicado: string;
  radicado_raw?: string;                 // Original format before normalization
  
  // Workflow type suggestion (if detectable)
  suggested_workflow_type: SuggestedWorkflowType;
  
  // Authority/court information
  authority: AuthorityInfo | null;
  
  // Parties
  parties: ProcessParty[];
  // Convenience: flattened party strings
  demandantes_text?: string;
  demandados_text?: string;
  
  // Last action summary
  last_action: LastActionInfo | null;
  
  // Notification/estado fields (critical for term triggering)
  last_notification: EstadoNotification | null;
  
  // Process metadata
  process_type?: string;                 // e.g., "PROCESO ORDINARIO"
  process_class?: string;                // e.g., "CIVIL"
  filing_date?: string | null;           // Date process was filed
  
  // Source tracking
  source: IngestionSource;
  source_run_id?: string;                // ID of the import/sync run
  source_timestamp: string;              // When this snapshot was created
  source_payload?: Record<string, unknown>; // Raw data from source
  
  // Validation
  is_valid: boolean;
  validation_errors: string[];
}

/**
 * IngestionRunResult
 * 
 * Result of processing a batch of snapshots
 */
export interface IngestionRunResult {
  run_id: string;
  source: IngestionSource;
  started_at: string;
  finished_at: string;
  
  // Counts
  total_processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  
  // Events created
  process_events_created: number;
  milestones_triggered: number;
  alerts_created: number;
  
  // Details
  item_results: Array<{
    radicado: string;
    work_item_id?: string;
    status: 'CREATED' | 'UPDATED' | 'SKIPPED' | 'ERROR';
    reason?: string;
  }>;
}

/**
 * IngestionContext
 * 
 * Context for an ingestion operation
 */
export interface IngestionContext {
  owner_id: string;
  organization_id?: string;
  source: IngestionSource;
  run_id: string;
  
  // Optional: default values to apply
  default_client_id?: string;
  default_workflow_type?: string;
  default_stage?: string;
  
  // Flags
  create_process_events: boolean;
  trigger_milestones: boolean;
  trigger_alerts: boolean;
  update_existing: boolean;
}

/**
 * SyncByRadicadoRequest
 * 
 * Request to sync a single radicado
 */
export interface SyncByRadicadoRequest {
  radicado: string;
  force_refresh?: boolean;
  source?: 'CPNU' | 'EXTERNAL_SCRAPER' | 'AUTO';
}

/**
 * SyncByRadicadoResponse
 * 
 * Response from syncing a single radicado
 */
export interface SyncByRadicadoResponse {
  success: boolean;
  work_item_id?: string;
  created: boolean;           // true if new work_item was created
  updated: boolean;           // true if existing was updated
  
  // What was found
  found_in_source: boolean;
  source_used: IngestionSource | null;
  
  // Counts
  new_events_count: number;
  milestones_triggered: number;
  
  // Error info
  error?: string;
  classification?: string;
  
  // Debug
  attempts?: Array<{
    source: string;
    success: boolean;
    latency_ms: number;
    error?: string;
  }>;
}

/**
 * ExternalScraperConfig
 * 
 * Configuration for external scraper service
 */
export interface ExternalScraperConfig {
  enabled: boolean;
  base_url?: string;
  api_key_configured: boolean;
  last_health_check?: string;
  health_status?: 'OK' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
}
