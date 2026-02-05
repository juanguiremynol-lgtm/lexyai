/**
 * Reminder Service
 * Core business logic for milestone reminders
 */

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { calculateNextReminderDate } from "./business-days";
import { 
  type ReminderType, 
  type WorkItemReminder,
  REMINDER_CONFIG,
  JUDICIAL_WORKFLOW_TYPES,
  WORKFLOW_REMINDERS,
  type JudicialWorkflowType,
} from "./reminder-types";

interface WorkItemForReminders {
  id: string;
  owner_id: string;
  workflow_type: string;
  radicado: string | null;
  authority_name: string | null;
  expediente_url: string | null;
  auto_admisorio_date: string | null;
  acta_reparto_received_at?: string | null;
  source?: string;
}

/**
 * Validate 23-digit radicado format (ends with 00 or 01)
 */
export function isValidRadicado(radicado: string | null): boolean {
  if (!radicado) return false;
  const cleaned = radicado.replace(/[^0-9]/g, '');
  if (cleaned.length !== 23) return false;
  const lastTwo = cleaned.slice(-2);
  return lastTwo === '00' || lastTwo === '01';
}

/**
 * Check which milestones are incomplete for a work item
 */
export function getIncompleteMilestones(workItem: WorkItemForReminders): ReminderType[] {
  const incomplete: ReminderType[] = [];
  
  // M1: Acta de Reparto - completed when court assigned or acta received
  if (!workItem.authority_name && !workItem.acta_reparto_received_at) {
    incomplete.push('ACTA_REPARTO_PENDING');
  }
  
  // M2: Radicado - completed when valid 23-digit radicado present
  if (!isValidRadicado(workItem.radicado)) {
    incomplete.push('RADICADO_PENDING');
  }
  
  // M3: Expediente electrónico - completed when URL present
  if (!workItem.expediente_url) {
    incomplete.push('EXPEDIENTE_PENDING');
  }
  
  // M4: Auto Admisorio - completed when date set
  if (!workItem.auto_admisorio_date) {
    incomplete.push('AUTO_ADMISORIO_PENDING');
  }
  
  return incomplete;
}

/**
 * Check if work item is eligible for reminders
 */
export function isEligibleForReminders(workItem: WorkItemForReminders): boolean {
  // Only judicial workflows
  if (!JUDICIAL_WORKFLOW_TYPES.includes(workItem.workflow_type as JudicialWorkflowType)) {
    return false;
  }
  
  // Skip if imported with all milestones already complete
  const incomplete = getIncompleteMilestones(workItem);
  return incomplete.length > 0;
}

/**
 * Get applicable reminders for a workflow type
 */
export function getApplicableReminders(workflowType: string): ReminderType[] {
  if (!JUDICIAL_WORKFLOW_TYPES.includes(workflowType as JudicialWorkflowType)) {
    return [];
  }
  return WORKFLOW_REMINDERS[workflowType as JudicialWorkflowType];
}

/**
 * Create initial reminders for a new work item
 */
export async function createRemindersForWorkItem(
  workItem: WorkItemForReminders,
  organizationId: string
): Promise<{ created: number; errors: string[] }> {
  const errors: string[] = [];
  let created = 0;
  
  if (!isEligibleForReminders(workItem)) {
    return { created, errors };
  }
  
  const applicableReminders = getApplicableReminders(workItem.workflow_type);
  const incompleteMilestones = getIncompleteMilestones(workItem);
  
  // Only create reminders for incomplete milestones
  const remindersToCreate = applicableReminders.filter(r => incompleteMilestones.includes(r));
  
  for (const reminderType of remindersToCreate) {
    const config = REMINDER_CONFIG[reminderType];
    const nextRunAt = calculateNextReminderDate(new Date(), config.cadenceDays);
    
    try {
      const { error } = await supabase.from("work_item_reminders").insert({
        organization_id: organizationId,
        owner_id: workItem.owner_id,
        work_item_id: workItem.id,
        reminder_type: reminderType,
        cadence_business_days: config.cadenceDays,
        next_run_at: nextRunAt.toISOString(),
        status: 'ACTIVE',
        created_by: workItem.owner_id,
      } as any);
      
      if (error) {
        // Ignore unique constraint violations (reminder already exists)
        if (!error.message.includes('duplicate key')) {
          errors.push(`Failed to create ${reminderType}: ${error.message}`);
        }
      } else {
        created++;
        
        // Create audit event
        await createReminderAuditEvent(workItem.id, 'REMINDER_CREATED', {
          reminder_type: reminderType,
          next_run_at: nextRunAt.toISOString(),
        });
      }
    } catch (err: any) {
      errors.push(`Error creating ${reminderType}: ${err.message}`);
    }
  }
  
  return { created, errors };
}

/**
 * Complete a reminder (milestone was achieved)
 */
export async function completeReminder(
  workItemId: string,
  reminderType: ReminderType
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from("work_item_reminders")
    .update({
      status: 'COMPLETED',
      completed_at: new Date().toISOString(),
    } as any)
    .eq("work_item_id", workItemId)
    .eq("reminder_type", reminderType)
    .eq("status", 'ACTIVE');
  
  if (error) {
    return { success: false, error: error.message };
  }
  
  await createReminderAuditEvent(workItemId, 'REMINDER_COMPLETED', {
    reminder_type: reminderType,
    completed_at: new Date().toISOString(),
  });
  
  return { success: true };
}

/**
 * Snooze a reminder (push next_run_at forward)
 */
export async function snoozeReminder(
  reminderId: string,
  snoozeDays: number = 3
): Promise<{ success: boolean; error?: string }> {
  const nextRunAt = calculateNextReminderDate(new Date(), snoozeDays);
  
  const { data: reminder, error: fetchError } = await supabase
    .from("work_item_reminders")
    .select("work_item_id, reminder_type, next_run_at")
    .eq("id", reminderId)
    .single();
  
  if (fetchError || !reminder) {
    return { success: false, error: fetchError?.message || "Reminder not found" };
  }
  
  const { error } = await supabase
    .from("work_item_reminders")
    .update({
      next_run_at: nextRunAt.toISOString(),
      snoozed_until: nextRunAt.toISOString(),
    } as any)
    .eq("id", reminderId);
  
  if (error) {
    return { success: false, error: error.message };
  }
  
  await createReminderAuditEvent(reminder.work_item_id, 'REMINDER_SNOOZED', {
    reminder_type: reminder.reminder_type,
    previous_run_at: reminder.next_run_at,
    next_run_at: nextRunAt.toISOString(),
    snoozed_days: snoozeDays,
  });
  
  return { success: true };
}

/**
 * Dismiss a reminder permanently
 */
export async function dismissReminder(
  reminderId: string
): Promise<{ success: boolean; error?: string }> {
  const { data: reminder, error: fetchError } = await supabase
    .from("work_item_reminders")
    .select("work_item_id, reminder_type")
    .eq("id", reminderId)
    .single();
  
  if (fetchError || !reminder) {
    return { success: false, error: fetchError?.message || "Reminder not found" };
  }
  
  const { error } = await supabase
    .from("work_item_reminders")
    .update({
      status: 'DISMISSED',
      dismissed_at: new Date().toISOString(),
    } as any)
    .eq("id", reminderId);
  
  if (error) {
    return { success: false, error: error.message };
  }
  
  await createReminderAuditEvent(reminder.work_item_id, 'REMINDER_DISMISSED', {
    reminder_type: reminder.reminder_type,
    dismissed_at: new Date().toISOString(),
  });
  
  return { success: true };
}

/**
 * Trigger a reminder (mark as triggered and reschedule)
 */
export async function triggerReminder(
  reminder: WorkItemReminder
): Promise<{ success: boolean; error?: string }> {
  const config = REMINDER_CONFIG[reminder.reminder_type];
  const nextRunAt = calculateNextReminderDate(new Date(), config.cadenceDays);
  
  const { error } = await supabase
    .from("work_item_reminders")
    .update({
      last_triggered_at: new Date().toISOString(),
      trigger_count: reminder.trigger_count + 1,
      next_run_at: nextRunAt.toISOString(),
    } as any)
    .eq("id", reminder.id);
  
  if (error) {
    return { success: false, error: error.message };
  }
  
  await createReminderAuditEvent(reminder.work_item_id, 'REMINDER_TRIGGERED', {
    reminder_type: reminder.reminder_type,
    trigger_count: reminder.trigger_count + 1,
    next_run_at: nextRunAt.toISOString(),
  });
  
  return { success: true };
}

/**
 * Get due reminders for a work item (those that should show in UI)
 */
export async function getDueReminders(workItemId: string): Promise<WorkItemReminder[]> {
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from("work_item_reminders")
    .select("*")
    .eq("work_item_id", workItemId)
    .eq("status", 'ACTIVE')
    .lte("next_run_at", now)
    .order("next_run_at", { ascending: true });
  
  if (error) {
    console.error("Error fetching due reminders:", error);
    return [];
  }
  
  return (data || []) as unknown as WorkItemReminder[];
}

/**
 * Create audit event for reminder lifecycle
 */
async function createReminderAuditEvent(
  workItemId: string,
  eventType: string,
  payload: Record<string, any>
): Promise<void> {
  try {
    // Get the work_item owner
    const { data: workItem } = await supabase
      .from("work_items")
      .select("owner_id")
      .eq("id", workItemId)
      .single();
    
    if (!workItem) return;
    
    // Create process_event for audit trail
    await supabase.from("process_events").insert({
      owner_id: workItem.owner_id,
      work_item_id: workItemId,
      event_type: eventType,
      description: `Reminder: ${eventType}`,
      raw_data: {
        ...payload,
        work_item_id: workItemId,
        timestamp: new Date().toISOString(),
      } as unknown as Json,
    });
  } catch (err) {
    console.error("Error creating reminder audit event:", err);
  }
}

/**
 * Check and auto-complete reminders based on current work item state
 */
export async function syncRemindersWithWorkItem(
  workItem: WorkItemForReminders
): Promise<{ completed: ReminderType[] }> {
  const completed: ReminderType[] = [];
  const incompleteMilestones = getIncompleteMilestones(workItem);
  
  // Get all active reminders for this work item
  const { data: activeReminders } = await supabase
    .from("work_item_reminders")
    .select("*")
    .eq("work_item_id", workItem.id)
    .eq("status", 'ACTIVE');
  
  if (!activeReminders || activeReminders.length === 0) {
    return { completed };
  }
  
  // Complete reminders for milestones that are now complete
  for (const reminder of activeReminders) {
    const reminderType = reminder.reminder_type as ReminderType;
    if (!incompleteMilestones.includes(reminderType)) {
      // Milestone is now complete, complete the reminder
      const result = await completeReminder(workItem.id, reminderType);
      if (result.success) {
        completed.push(reminderType);
      }
    }
  }
  
  return { completed };
}
