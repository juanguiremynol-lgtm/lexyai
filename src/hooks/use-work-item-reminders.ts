/**
 * useWorkItemReminders - React Query hooks for milestone reminders
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { WorkItemReminder, ReminderType } from "@/lib/reminders/reminder-types";
import { 
  snoozeReminder, 
  dismissReminder, 
  completeReminder, 
  triggerReminder,
  createRemindersForWorkItem,
  syncRemindersWithWorkItem,
  getIncompleteMilestones,
  isEligibleForReminders,
} from "@/lib/reminders/reminder-service";

interface UseWorkItemRemindersOptions {
  workItemId: string;
  enabled?: boolean;
}

/**
 * Fetch all reminders for a work item
 */
export function useWorkItemReminders({ workItemId, enabled = true }: UseWorkItemRemindersOptions) {
  return useQuery({
    queryKey: ["work-item-reminders", workItemId],
    queryFn: async (): Promise<WorkItemReminder[]> => {
      const { data, error } = await supabase
        .from("work_item_reminders")
        .select("*")
        .eq("work_item_id", workItemId)
        .order("created_at", { ascending: true });
      
      if (error) throw error;
      return (data || []) as unknown as WorkItemReminder[];
    },
    enabled: enabled && !!workItemId,
  });
}

/**
 * Fetch active reminders for a work item (pending action)
 */
export function useActiveReminders({ workItemId, enabled = true }: UseWorkItemRemindersOptions) {
  return useQuery({
    queryKey: ["work-item-reminders-active", workItemId],
    queryFn: async (): Promise<WorkItemReminder[]> => {
      const { data, error } = await supabase
        .from("work_item_reminders")
        .select("*")
        .eq("work_item_id", workItemId)
        .eq("status", "ACTIVE")
        .order("next_run_at", { ascending: true });
      
      if (error) throw error;
      return (data || []) as unknown as WorkItemReminder[];
    },
    enabled: enabled && !!workItemId,
  });
}

/**
 * Fetch due reminders for a work item (ready to show)
 */
export function useDueReminders({ workItemId, enabled = true }: UseWorkItemRemindersOptions) {
  const now = new Date().toISOString();
  
  return useQuery({
    queryKey: ["work-item-reminders-due", workItemId],
    queryFn: async (): Promise<WorkItemReminder[]> => {
      const { data, error } = await supabase
        .from("work_item_reminders")
        .select("*")
        .eq("work_item_id", workItemId)
        .eq("status", "ACTIVE")
        .lte("next_run_at", now)
        .order("next_run_at", { ascending: true });
      
      if (error) throw error;
      return (data || []) as unknown as WorkItemReminder[];
    },
    enabled: enabled && !!workItemId,
  });
}

/**
 * Snooze a reminder (defer for 3 business days)
 * Uses optimistic cache update to instantly remove the snoozed item from all lists.
 */
export function useSnoozeReminder() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ reminderId, snoozeDays = 3 }: { reminderId: string; snoozeDays?: number }) => {
      const result = await snoozeReminder(reminderId, snoozeDays);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result;
    },
    onMutate: async ({ reminderId }) => {
      await queryClient.cancelQueries({ queryKey: ["all-active-reminders"] });
      const previous = queryClient.getQueryData<any[]>(["all-active-reminders"]);
      queryClient.setQueryData<any[]>(["all-active-reminders"], (old) =>
        old ? old.filter((r: any) => r.id !== reminderId) : []
      );
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["all-active-reminders"], context.previous);
      }
      toast.error("Error al posponer: " + error.message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["work-item-reminders"] });
      queryClient.invalidateQueries({ queryKey: ["work-item-reminders-active"] });
      queryClient.invalidateQueries({ queryKey: ["work-item-reminders-due"] });
      queryClient.invalidateQueries({ queryKey: ["all-active-reminders"] });
      queryClient.invalidateQueries({ queryKey: ["unread-alert-count"] });
      queryClient.invalidateQueries({ queryKey: ["process-events"] });
    },
    onSuccess: () => {
      toast.success("Recordatorio pospuesto");
    },
  });
}

/**
 * Dismiss a reminder permanently.
 * ROOT CAUSE FIX: Previously used only invalidateQueries (in onSuccess), which
 * marks the query stale but doesn't synchronously remove items from the cache.
 * The stale-while-revalidate window caused dismissed hitos to flash back.
 * Fix: onMutate optimistically removes the item, onSettled reconciles with server.
 */
export function useDismissReminder() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (reminderId: string) => {
      const result = await dismissReminder(reminderId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result;
    },
    onMutate: async (reminderId: string) => {
      await queryClient.cancelQueries({ queryKey: ["all-active-reminders"] });
      const previous = queryClient.getQueryData<any[]>(["all-active-reminders"]);
      queryClient.setQueryData<any[]>(["all-active-reminders"], (old) =>
        old ? old.filter((r: any) => r.id !== reminderId) : []
      );
      return { previous };
    },
    onError: (error: Error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["all-active-reminders"], context.previous);
      }
      toast.error("Error al descartar: " + error.message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["work-item-reminders"] });
      queryClient.invalidateQueries({ queryKey: ["work-item-reminders-active"] });
      queryClient.invalidateQueries({ queryKey: ["work-item-reminders-due"] });
      queryClient.invalidateQueries({ queryKey: ["all-active-reminders"] });
      queryClient.invalidateQueries({ queryKey: ["unread-alert-count"] });
      queryClient.invalidateQueries({ queryKey: ["process-events"] });
    },
    onSuccess: () => {
      toast.success("Recordatorio descartado");
    },
  });
}

/**
 * Complete a reminder (milestone achieved)
 */
export function useCompleteReminder() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ workItemId, reminderType }: { workItemId: string; reminderType: ReminderType }) => {
      const result = await completeReminder(workItemId, reminderType);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result;
    },
    onSuccess: () => {
      toast.success("Hito registrado correctamente");
      queryClient.invalidateQueries({ queryKey: ["work-item-reminders"] });
      queryClient.invalidateQueries({ queryKey: ["work-item-reminders-active"] });
      queryClient.invalidateQueries({ queryKey: ["work-item-reminders-due"] });
      queryClient.invalidateQueries({ queryKey: ["work-item-detail"] });
      queryClient.invalidateQueries({ queryKey: ["process-events"] });
    },
    onError: (error: Error) => {
      toast.error("Error al registrar: " + error.message);
    },
  });
}

/**
 * Create reminders for a work item
 */
export function useCreateReminders() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      workItem, 
      organizationId 
    }: { 
      workItem: Parameters<typeof createRemindersForWorkItem>[0];
      organizationId: string;
    }) => {
      return await createRemindersForWorkItem(workItem, organizationId);
    },
    onSuccess: (result, variables) => {
      if (result.created > 0) {
        queryClient.invalidateQueries({ queryKey: ["work-item-reminders", variables.workItem.id] });
        queryClient.invalidateQueries({ queryKey: ["work-item-reminders-active", variables.workItem.id] });
        queryClient.invalidateQueries({ queryKey: ["work-item-reminders-due", variables.workItem.id] });
      }
    },
  });
}

/**
 * Sync reminders with work item state (auto-complete when milestones are done)
 */
export function useSyncReminders() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (workItem: Parameters<typeof syncRemindersWithWorkItem>[0]) => {
      return await syncRemindersWithWorkItem(workItem);
    },
    onSuccess: (result, workItem) => {
      if (result.completed.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["work-item-reminders", workItem.id] });
        queryClient.invalidateQueries({ queryKey: ["work-item-reminders-active", workItem.id] });
        queryClient.invalidateQueries({ queryKey: ["work-item-reminders-due", workItem.id] });
        queryClient.invalidateQueries({ queryKey: ["process-events"] });
      }
    },
  });
}

// Re-export utilities for convenience
export { getIncompleteMilestones, isEligibleForReminders };
