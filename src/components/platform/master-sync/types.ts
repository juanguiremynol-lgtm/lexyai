export interface MasterSyncConfig {
  scope: "ALL" | "MONITORING_ONLY" | "FAILED_ONLY";
  includePublicaciones: boolean;
  forceRefresh: boolean;
  batchSize: number;
  workflowFilter: string[];
  organizationId: string;
}

export interface ItemSyncResult {
  work_item_id: string;
  radicado: string;
  workflow_type: string;
  stage: string | null;

  act_status: "pending" | "running" | "success" | "empty" | "error" | "skipped";
  act_ok: boolean | null;
  act_inserted: number;
  act_skipped: number;
  act_provider: string | null;
  act_latency_ms: number | null;
  act_error_code: string | null;
  act_error_message: string | null;
  act_provider_attempts: any[];
  act_raw_response: any;

  pub_status: "pending" | "running" | "success" | "error" | "skipped" | "not_applicable" | "partial_error";
  pub_ok: boolean | null;
  pub_inserted: number;
  pub_skipped: number;
  pub_latency_ms: number | null;
  pub_error_message: string | null;
  pub_raw_response: any;

  started_at: string | null;
  completed_at: string | null;
  total_ms: number | null;
}

export interface MasterSyncState {
  status: "idle" | "loading_items" | "previewing" | "running" | "completed" | "cancelled";
  items: ItemSyncResult[];
  startedAt: string | null;
  completedAt: string | null;
  currentBatch: number;
  totalBatches: number;
  totalItems: number;
  completedItems: number;
  successCount: number;
  errorCount: number;
  totalActInserted: number;
  totalPubInserted: number;
}

export interface WorkItemPreview {
  id: string;
  radicado: string;
  workflow_type: string;
  stage: string | null;
  monitoring_enabled: boolean;
  last_synced_at: string | null;
  last_crawled_at: string | null;
  scrape_status: string | null;
  authority_name: string | null;
  total_actuaciones: number | null;
}

export const HEAVY_ITEM_THRESHOLD = 100;

export const DEFAULT_CONFIG: MasterSyncConfig = {
  scope: "ALL",
  includePublicaciones: true,
  forceRefresh: false,
  batchSize: 3,
  workflowFilter: ["CGP", "LABORAL", "CPACA", "TUTELA", "PENAL_906"],
  organizationId: "a0000000-0000-0000-0000-000000000001",
};

export const WORKFLOW_OPTIONS = [
  { value: "CGP", label: "CGP" },
  { value: "LABORAL", label: "Laboral" },
  { value: "CPACA", label: "CPACA" },
  { value: "TUTELA", label: "Tutela" },
  { value: "PENAL_906", label: "Penal 906" },
];
