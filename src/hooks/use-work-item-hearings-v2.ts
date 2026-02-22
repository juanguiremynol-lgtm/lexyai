/**
 * React Query hooks for work item hearings CRUD (v2 - work_item_hearings table)
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface WorkItemHearing {
  id: string;
  organization_id: string;
  work_item_id: string;
  hearing_type_id: string | null;
  custom_name: string | null;
  status: "planned" | "scheduled" | "held" | "postponed" | "cancelled";
  postponed_to_id: string | null;
  scheduled_at: string | null;
  occurred_at: string | null;
  duration_minutes: number | null;
  modality: "presencial" | "virtual" | "mixta" | null;
  location: string | null;
  meeting_link: string | null;
  participants: any[];
  decisions_summary: string | null;
  notes_rich_text: string | null;
  notes_plain_text: string | null;
  key_moments: any[];
  flow_order: number | null;
  tags: string[];
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  hearing_type?: {
    id: string;
    name: string;
    short_name: string;
    legal_basis: string | null;
    typical_purpose: string | null;
    jurisdiction: string;
  } | null;
}

export function useWorkItemHearingsV2(workItemId: string | undefined) {
  return useQuery({
    queryKey: ["work-item-hearings-v2", workItemId],
    queryFn: async () => {
      if (!workItemId) return [];

      const { data, error } = await supabase
        .from("work_item_hearings")
        .select("*, hearing_types(id, name, short_name, legal_basis, typical_purpose, jurisdiction)")
        .eq("work_item_id", workItemId)
        .order("flow_order", { ascending: true, nullsFirst: false })
        .order("scheduled_at", { ascending: true, nullsFirst: true });

      if (error) throw error;
      return (data || []).map((h: any) => ({
        ...h,
        hearing_type: h.hearing_types || null,
      })) as WorkItemHearing[];
    },
    enabled: !!workItemId,
  });
}

export function useCreateWorkItemHearing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      work_item_id: string;
      organization_id: string;
      hearing_type_id?: string;
      custom_name?: string;
      scheduled_at?: string;
      modality?: string;
      location?: string;
      meeting_link?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { data, error } = await supabase
        .from("work_item_hearings")
        .insert({
          organization_id: input.organization_id,
          work_item_id: input.work_item_id,
          hearing_type_id: input.hearing_type_id || null,
          custom_name: input.custom_name || null,
          status: input.scheduled_at ? "scheduled" : "planned",
          scheduled_at: input.scheduled_at || null,
          modality: input.modality || null,
          location: input.location || null,
          meeting_link: input.meeting_link || null,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (error) throw error;

      // Audit log
      await supabase.from("hearing_audit_log").insert([{
        organization_id: input.organization_id,
        user_id: user.id,
        action: "hearing_created" as const,
        work_item_id: input.work_item_id,
        work_item_hearing_id: data.id,
        detail: { hearing_type_id: input.hearing_type_id, custom_name: input.custom_name } as any,
      }]);

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["work-item-hearings-v2", variables.work_item_id] });
      toast.success("Audiencia agregada");
    },
    onError: (error) => {
      toast.error("Error al crear audiencia: " + error.message);
    },
  });
}

export function useUpdateWorkItemHearing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      work_item_id: string;
      organization_id: string;
      status?: string;
      scheduled_at?: string;
      occurred_at?: string;
      duration_minutes?: number;
      modality?: string;
      location?: string;
      meeting_link?: string;
      participants?: any[];
      decisions_summary?: string;
      notes_rich_text?: string;
      notes_plain_text?: string;
      key_moments?: any[];
      tags?: string[];
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { id, work_item_id, organization_id, ...updateFields } = input;
      const updateData: Record<string, unknown> = {
        ...updateFields,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      };

      // Remove undefined fields
      Object.keys(updateData).forEach((k) => {
        if (updateData[k] === undefined) delete updateData[k];
      });

      const { error } = await supabase
        .from("work_item_hearings")
        .update(updateData)
        .eq("id", id);

      if (error) throw error;

      // Determine audit action
      const action = input.status ? "hearing_status_changed" as const : "hearing_updated" as const;
      await supabase.from("hearing_audit_log").insert([{
        organization_id,
        user_id: user.id,
        action,
        work_item_id,
        work_item_hearing_id: id,
        detail: updateData as any,
      }]);

      return { id, work_item_id };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["work-item-hearings-v2", result.work_item_id] });
      toast.success("Audiencia actualizada");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });
}

export function useDeleteWorkItemHearing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; work_item_id: string; organization_id: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      await supabase.from("hearing_audit_log").insert([{
        organization_id: input.organization_id,
        user_id: user.id,
        action: "hearing_deleted" as const,
        work_item_id: input.work_item_id,
        work_item_hearing_id: input.id,
      }]);

      const { error } = await supabase
        .from("work_item_hearings")
        .delete()
        .eq("id", input.id);

      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      queryClient.invalidateQueries({ queryKey: ["work-item-hearings-v2", input.work_item_id] });
      toast.success("Audiencia eliminada");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });
}

export const HEARING_STATUS_LABELS: Record<string, string> = {
  planned: "Planificada",
  scheduled: "Programada",
  held: "Celebrada",
  postponed: "Aplazada",
  cancelled: "Cancelada",
};

export const HEARING_STATUS_COLORS: Record<string, string> = {
  planned: "bg-muted text-muted-foreground",
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  held: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  postponed: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};
