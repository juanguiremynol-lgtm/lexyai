/**
 * Ingestion Service
 * 
 * Unified pipeline for processing normalized process snapshots
 * from any source (Excel, scraper, CPNU, etc.)
 */

import { supabase } from "@/integrations/supabase/client";
import type { 
  NormalizedProcessSnapshot, 
  IngestionContext, 
  IngestionRunResult,
  IngestionSource 
} from "./types";
import type { Database } from "@/integrations/supabase/types";

// Type alias for workflow_type enum
type WorkflowType = Database["public"]["Enums"]["workflow_type"];
type ItemSource = Database["public"]["Enums"]["item_source"];

/**
 * Process a single normalized snapshot into work_items and related tables
 */
export async function processSnapshot(
  snapshot: NormalizedProcessSnapshot,
  context: IngestionContext
): Promise<{ 
  work_item_id: string | null; 
  status: 'CREATED' | 'UPDATED' | 'SKIPPED' | 'ERROR';
  reason?: string;
  acts_created: number;
}> {
  try {
    // Validate radicado
    if (!snapshot.radicado || snapshot.radicado.length !== 23) {
      return { 
        work_item_id: null, 
        status: 'SKIPPED', 
        reason: `Radicado inválido: ${snapshot.radicado?.length || 0} dígitos`,
        acts_created: 0
      };
    }

    // Check for existing work_item with this radicado
    const { data: existing } = await supabase
      .from("work_items")
      .select("id, last_action_date, last_action_description")
      .eq("owner_id", context.owner_id)
      .eq("radicado", snapshot.radicado)
      .maybeSingle();

    let workItemId: string;
    let isNew = false;

    if (existing && context.update_existing) {
      // Update existing work_item
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      // Only update fields if they have new data
      if (snapshot.authority?.despacho_name) {
        updateData.authority_name = snapshot.authority.despacho_name;
      }
      if (snapshot.authority?.city) {
        updateData.authority_city = snapshot.authority.city;
      }
      if (snapshot.authority?.department) {
        updateData.authority_department = snapshot.authority.department;
      }
      if (snapshot.demandantes_text) {
        updateData.demandantes = snapshot.demandantes_text;
      }
      if (snapshot.demandados_text) {
        updateData.demandados = snapshot.demandados_text;
      }
      if (snapshot.last_action?.action_date) {
        updateData.last_action_date = snapshot.last_action.action_date;
        updateData.last_action_description = snapshot.last_action.description;
      }
      
      // Source tracking
      updateData.source_reference = context.run_id;

      const { error: updateError } = await supabase
        .from("work_items")
        .update(updateData)
        .eq("id", existing.id);

      if (updateError) {
        return { 
          work_item_id: existing.id, 
          status: 'ERROR', 
          reason: updateError.message,
          acts_created: 0
        };
      }

      workItemId = existing.id;
    } else if (existing) {
      // Exists but not updating
      return { 
        work_item_id: existing.id, 
        status: 'SKIPPED', 
        reason: 'Ya existe',
        acts_created: 0
      };
    } else {
      // Determine workflow type - use context default or detect from data
      const workflowType = (context.default_workflow_type as WorkflowType) || 
        detectWorkflowType(snapshot);
      
      // Create new work_item - use type assertion to avoid deep type inference
      const insertResult = await (supabase
        .from("work_items") as any)
        .insert({
          owner_id: context.owner_id,
          radicado: snapshot.radicado,
          radicado_verified: false,
          workflow_type: workflowType,
          stage: context.default_stage || 'MONITORING',
          status: 'ACTIVE',
          authority_name: snapshot.authority?.despacho_name || null,
          authority_city: snapshot.authority?.city || null,
          authority_department: snapshot.authority?.department || null,
          demandantes: snapshot.demandantes_text || null,
          demandados: snapshot.demandados_text || null,
          last_action_date: snapshot.last_action?.action_date || null,
          last_action_description: snapshot.last_action?.description || null,
          source: mapSourceToEnum(snapshot.source),
          source_reference: context.run_id,
          source_payload: snapshot.source_payload || null,
          client_id: context.default_client_id || null,
          is_flagged: false,
          monitoring_enabled: true,
          email_linking_enabled: true,
        })
        .select("id")
        .single();

      if (insertResult.error || !insertResult.data) {
        return { 
          work_item_id: null, 
          status: 'ERROR', 
          reason: insertResult.error?.message || 'Insert failed',
          acts_created: 0
        };
      }

      workItemId = insertResult.data.id;
      isNew = true;
    }

    // Create work_item_act if this is a notification/estado
    let actsCreated = 0;
    if (context.create_process_events && snapshot.last_notification) {
      const actCreated = await createActRecord(
        workItemId,
        context.owner_id,
        snapshot
      );
      if (actCreated) actsCreated++;
    }

    return { 
      work_item_id: workItemId, 
      status: isNew ? 'CREATED' : 'UPDATED',
      acts_created: actsCreated
    };

  } catch (error) {
    return { 
      work_item_id: null, 
      status: 'ERROR', 
      reason: error instanceof Error ? error.message : 'Unknown error',
      acts_created: 0
    };
  }
}

/**
 * Process a batch of snapshots
 */
export async function processBatch(
  snapshots: NormalizedProcessSnapshot[],
  context: IngestionContext
): Promise<IngestionRunResult> {
  const startedAt = new Date().toISOString();
  const results: IngestionRunResult['item_results'] = [];
  
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let actsCreated = 0;

  for (const snapshot of snapshots) {
    const result = await processSnapshot(snapshot, context);
    
    results.push({
      radicado: snapshot.radicado,
      work_item_id: result.work_item_id || undefined,
      status: result.status,
      reason: result.reason,
    });

    switch (result.status) {
      case 'CREATED': created++; break;
      case 'UPDATED': updated++; break;
      case 'SKIPPED': skipped++; break;
      case 'ERROR': errors++; break;
    }
    
    actsCreated += result.acts_created;
  }

  return {
    run_id: context.run_id,
    source: context.source,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    total_processed: snapshots.length,
    created,
    updated,
    skipped,
    errors,
    process_events_created: actsCreated,
    milestones_triggered: 0, // TODO: implement milestone triggering
    alerts_created: 0, // TODO: implement alert creation
    item_results: results,
  };
}

/**
 * Create a work_item_acts record (used for estados imports)
 */
async function createActRecord(
  workItemId: string,
  ownerId: string,
  snapshot: NormalizedProcessSnapshot
): Promise<boolean> {
  if (!snapshot.last_notification) return false;

  const notification = snapshot.last_notification;


  const fingerprint = computeEventFingerprint(
    snapshot.source,
    snapshot.radicado,
    notification.notification_date,
    notification.summary
  );

  // Check if act already exists
  const { data: existing } = await supabase
    .from("work_item_acts")
    .select("id")
    .eq("hash_fingerprint", fingerprint)
    .maybeSingle();

  if (existing) return false;

  const { error } = await supabase
    .from("work_item_acts")
    .insert({
      owner_id: ownerId,
      work_item_id: workItemId,
      act_date: notification.notification_date,
      act_date_raw: notification.notification_date_raw,
      description: notification.summary,
      act_type: notification.notification_type || 'ESTADO',
      source: snapshot.source,
      source_reference: snapshot.source_run_id,
      raw_data: notification.source_columns || {},
      hash_fingerprint: fingerprint,
    });

  return !error;
}

/**
 * Map ingestion source to database enum
 */
function mapSourceToEnum(source: IngestionSource): ItemSource {
  switch (source) {
    case 'ICARUS_EXCEL_PROCESS':
    case 'ICARUS_EXCEL_ESTADOS':
      return 'ICARUS_IMPORT';
    case 'EXTERNAL_SCRAPER':
    case 'CPNU':
    case 'PUBLICACIONES':
    case 'HISTORICO':
      return 'SCRAPE_API';
    case 'MANUAL':
    default:
      return 'MANUAL';
  }
}

/**
 * Detect workflow type from snapshot data
 */
function detectWorkflowType(snapshot: NormalizedProcessSnapshot): WorkflowType {
  const despacho = (snapshot.authority?.despacho_name || '').toLowerCase();
  const processType = (snapshot.process_type || '').toLowerCase();
  
  // Tutela detection
  if (despacho.includes('tutela') || processType.includes('tutela')) {
    return 'TUTELA';
  }
  
  // Administrative detection
  if (
    despacho.includes('contencioso administrativo') || 
    processType.includes('contencioso') ||
    processType.includes('nulidad') ||
    processType.includes('reparacion directa')
  ) {
    return 'CPACA';
  }
  
  // Default to CGP (civil/commercial)
  return 'CGP';
}

/**
 * Compute fingerprint for event deduplication
 */
function computeEventFingerprint(
  source: string,
  radicado: string,
  eventDate: string | null,
  description: string
): string {
  const data = `${source}|${radicado}|${eventDate || ''}|${description}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Create ingestion context with defaults
 */
export function createIngestionContext(
  ownerId: string,
  source: IngestionSource,
  options: Partial<IngestionContext> = {}
): IngestionContext {
  return {
    owner_id: ownerId,
    source,
    run_id: crypto.randomUUID(),
    create_process_events: true,
    trigger_milestones: true,
    trigger_alerts: true,
    update_existing: true,
    ...options,
  };
}

/**
 * Apply a single normalized snapshot (convenience wrapper)
 */
export async function applyNormalizedSnapshot(
  snapshot: NormalizedProcessSnapshot,
  ownerId: string,
  options: Partial<IngestionContext> = {}
): Promise<{ 
  work_item_id: string | null; 
  status: 'CREATED' | 'UPDATED' | 'SKIPPED' | 'ERROR';
  reason?: string;
  events_created: number;
}> {
  const context = createIngestionContext(
    ownerId,
    snapshot.source,
    {
      ...options,
      create_process_events: true,
      update_existing: true,
    }
  );
  return processSnapshot(snapshot, context);
}
