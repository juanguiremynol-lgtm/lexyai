/**
 * Hook for CRUD operations on work_item_tasks
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { toast } from "sonner";

export interface WorkItemTask {
  id: string;
  owner_id: string;
  organization_id: string | null;
  work_item_id: string;
  title: string;
  description: string | null;
  status: 'PENDIENTE' | 'COMPLETADA';
  priority: 'ALTA' | 'MEDIA' | 'BAJA';
  due_date: string | null;
  assigned_to: string | null;
  alert_enabled: boolean;
  alert_channels: string[];
  alert_cadence_days: number | null;
  template_key: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  assigned_profile?: { id: string; full_name: string | null; email: string | null } | null;
}

export interface CreateTaskInput {
  work_item_id: string;
  title: string;
  description?: string;
  priority?: 'ALTA' | 'MEDIA' | 'BAJA';
  due_date?: string;
  assigned_to?: string;
  alert_enabled?: boolean;
  alert_channels?: string[];
  alert_cadence_days?: number;
  template_key?: string;
}

export function useWorkItemTasks(workItemId: string | undefined) {
  return useQuery({
    queryKey: ["work-item-tasks-v2", workItemId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No authenticated user");

      const { data, error } = await supabase
        .from("work_item_tasks")
        .select("*")
        .eq("work_item_id", workItemId!)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as unknown as WorkItemTask[];
    },
    enabled: !!workItemId,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();

  return useMutation({
    mutationFn: async (input: CreateTaskInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No authenticated user");

      const { data, error } = await supabase
        .from("work_item_tasks")
        .insert({
          owner_id: user.id,
          organization_id: organization?.id || null,
          work_item_id: input.work_item_id,
          title: input.title,
          description: input.description || null,
          priority: input.priority || 'MEDIA',
          due_date: input.due_date || null,
          assigned_to: input.assigned_to || null,
          alert_enabled: input.alert_enabled || false,
          alert_channels: input.alert_channels || [],
          alert_cadence_days: input.alert_cadence_days || 3,
          template_key: input.template_key || null,
        } as any)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      toast.success("Tarea creada");
      queryClient.invalidateQueries({ queryKey: ["work-item-tasks-v2", variables.work_item_id] });
    },
    onError: (err: Error) => {
      toast.error("Error al crear tarea: " + err.message);
    },
  });
}

export function useToggleTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, workItemId, currentStatus }: { taskId: string; workItemId: string; currentStatus: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No authenticated user");

      const newStatus = currentStatus === 'PENDIENTE' ? 'COMPLETADA' : 'PENDIENTE';
      const updateData: any = {
        status: newStatus,
        completed_at: newStatus === 'COMPLETADA' ? new Date().toISOString() : null,
        completed_by: newStatus === 'COMPLETADA' ? user.id : null,
      };

      const { error } = await supabase
        .from("work_item_tasks")
        .update(updateData)
        .eq("id", taskId);

      if (error) throw error;
      return { workItemId };
    },
    onSuccess: (result) => {
      toast.success("Tarea actualizada");
      queryClient.invalidateQueries({ queryKey: ["work-item-tasks-v2", result.workItemId] });
    },
    onError: (err: Error) => {
      toast.error("Error: " + err.message);
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, workItemId }: { taskId: string; workItemId: string }) => {
      const { error } = await supabase
        .from("work_item_tasks")
        .delete()
        .eq("id", taskId);

      if (error) throw error;
      return { workItemId };
    },
    onSuccess: (result) => {
      toast.success("Tarea eliminada");
      queryClient.invalidateQueries({ queryKey: ["work-item-tasks-v2", result.workItemId] });
    },
    onError: (err: Error) => {
      toast.error("Error: " + err.message);
    },
  });
}

/** Fetch org members for assignment dropdown (BUSINESS tier orgs only) */
export function useOrgMembers(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["org-members-for-assignment", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("organization_memberships")
        .select("user_id, role, profiles:user_id(id, full_name, email)")
        .eq("organization_id", organizationId);

      if (error) throw error;
      return (data || []).map((m: any) => ({
        id: m.user_id,
        full_name: m.profiles?.full_name || m.profiles?.email || "Sin nombre",
        email: m.profiles?.email,
        role: m.role,
      }));
    },
    enabled: !!organizationId,
  });
}
