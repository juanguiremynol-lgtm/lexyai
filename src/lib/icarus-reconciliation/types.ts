// Types for the Icarus reconciliation / bulk-import flow.

import type { Database } from "@/integrations/supabase/types";

export type WorkflowType = Database["public"]["Tables"]["work_items"]["Row"]["workflow_type"];

export interface BatchItem {
  radicado: string;
  despacho: string;
  demandantes: string[];
  demandados: string[];
  suggested_workflow_type: WorkflowType;
}

export type ReconciliationStatus = "pendiente" | "ya_existe" | "divergente";

export interface ReconciledItem extends BatchItem {
  status: ReconciliationStatus;
  existing_workflow_type?: WorkflowType;
  existing_work_item_id?: string;
}

export type ClientAssignment =
  | { mode: "demandante"; clientId?: string; createName?: string }
  | { mode: "demandado"; clientId?: string; createName?: string }
  | { mode: "self_curador" }
  | { mode: "otro"; clientId?: string; createName?: string };

export interface ImportResult {
  radicado: string;
  ok: boolean;
  workItemId?: string;
  error?: string;
}