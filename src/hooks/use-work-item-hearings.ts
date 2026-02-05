/**
 * React Query hooks for managing work item hearings (audiencias)
 * 
 * CRUD operations with audit trail via process_events
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

export interface Hearing {
  id: string;
  title: string;
  scheduled_at: string;
  location: string | null;
  is_virtual: boolean | null;
  virtual_link: string | null;
  notes: string | null;
  auto_detected: boolean | null;
  reminder_sent: boolean | null;
  work_item_id: string | null;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateHearingInput {
  work_item_id: string;
  title: string;
  scheduled_at: string;
  location?: string;
  is_virtual?: boolean;
  virtual_link?: string;
  notes?: string;
}

export interface UpdateHearingInput {
  id: string;
  title?: string;
  scheduled_at?: string;
  location?: string;
  is_virtual?: boolean;
  virtual_link?: string;
  notes?: string;
}

/**
 * Fetch all hearings for a specific work item
 */
export function useWorkItemHearings(workItemId: string | undefined) {
  const { organization } = useOrganization();
  
  return useQuery({
    queryKey: ["work-item-hearings", organization?.id, workItemId],
    queryFn: async () => {
      if (!workItemId) return [];
      
      const { data, error } = await supabase
        .from("hearings")
        .select("*")
        .eq("work_item_id", workItemId)
        .order("scheduled_at", { ascending: true });
      
      if (error) throw error;
      return data as Hearing[];
    },
    enabled: !!workItemId && !!organization?.id,
  });
}

/**
 * Create a new hearing with audit trail
 */
export function useCreateHearing() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  
  return useMutation({
    mutationFn: async (input: CreateHearingInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      // Insert the hearing
      const { data: hearing, error: hearingError } = await supabase
        .from("hearings")
        .insert({
          owner_id: user.id,
          organization_id: organization?.id,
          work_item_id: input.work_item_id,
          title: input.title,
          scheduled_at: input.scheduled_at,
          location: input.location || null,
          notes: input.notes || null,
          is_virtual: input.is_virtual || false,
          virtual_link: input.virtual_link || null,
          auto_detected: false,
        })
        .select("id")
        .single();
      
      if (hearingError) throw hearingError;
      
      // Create process_event audit trail
      const eventPayload = {
        hearing_id: hearing.id,
        work_item_id: input.work_item_id,
        title: input.title,
        scheduled_at: input.scheduled_at,
        location: input.location || null,
        is_virtual: input.is_virtual || false,
      };
      
      await supabase.from("process_events").insert({
        owner_id: user.id,
        work_item_id: input.work_item_id,
        event_type: "HEARING_CREATED",
        description: `Audiencia programada: ${input.title}`,
        source: "USER_UI",
        raw_data: eventPayload as unknown as Json,
      });
      
      // Create an alert for the hearing
      const scheduledAt = new Date(input.scheduled_at);
      const daysUntil = Math.ceil((scheduledAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      
      await supabase.from("alerts").insert({
        owner_id: user.id,
        severity: daysUntil <= 3 ? "CRITICAL" : daysUntil <= 7 ? "WARN" : "INFO",
        message: `Audiencia programada: ${input.title} para ${scheduledAt.toLocaleDateString('es-CO')}`,
        is_read: false,
      });
      
      return hearing;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["work-item-hearings", organization?.id, variables.work_item_id] });
      queryClient.invalidateQueries({ queryKey: ["all-hearings", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["alerts", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["process-events"] });
      toast.success("Audiencia programada con éxito");
    },
    onError: (error) => {
      toast.error("Error al crear audiencia: " + error.message);
    },
  });
}

/**
 * Update an existing hearing with audit trail
 */
export function useUpdateHearing() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  
  return useMutation({
    mutationFn: async (input: UpdateHearingInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      // Get current hearing data for audit
      const { data: currentHearing } = await supabase
        .from("hearings")
        .select("*, work_item_id")
        .eq("id", input.id)
        .single();
      
      if (!currentHearing) throw new Error("Audiencia no encontrada");
      
      // Update the hearing
      const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.title !== undefined) updateData.title = input.title;
      if (input.scheduled_at !== undefined) updateData.scheduled_at = input.scheduled_at;
      if (input.location !== undefined) updateData.location = input.location || null;
      if (input.is_virtual !== undefined) updateData.is_virtual = input.is_virtual;
      if (input.virtual_link !== undefined) updateData.virtual_link = input.virtual_link || null;
      if (input.notes !== undefined) updateData.notes = input.notes || null;
      
      const { error } = await supabase
        .from("hearings")
        .update(updateData)
        .eq("id", input.id);
      
      if (error) throw error;
      
      // Create process_event audit trail
      if (currentHearing.work_item_id) {
        const eventPayload = {
          hearing_id: input.id,
          work_item_id: currentHearing.work_item_id,
          changes: updateData,
          previous: {
            title: currentHearing.title,
            scheduled_at: currentHearing.scheduled_at,
            location: currentHearing.location,
          },
        };
        await supabase.from("process_events").insert({
          owner_id: user.id,
          work_item_id: currentHearing.work_item_id,
          event_type: "HEARING_UPDATED",
          description: `Audiencia actualizada: ${input.title || currentHearing.title}`,
          source: "USER_UI",
          raw_data: eventPayload as unknown as Json,
        });
      }
      
      return { ...currentHearing, ...updateData };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["work-item-hearings", organization?.id, result.work_item_id] });
      queryClient.invalidateQueries({ queryKey: ["all-hearings", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["process-events"] });
      toast.success("Audiencia actualizada");
    },
    onError: (error) => {
      toast.error("Error al actualizar: " + error.message);
    },
  });
}

/**
 * Delete a hearing with audit trail
 */
export function useDeleteHearing() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  
  return useMutation({
    mutationFn: async (hearing: Hearing) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      // Create process_event audit trail before deletion
      if (hearing.work_item_id) {
        const eventPayload = {
          hearing_id: hearing.id,
          work_item_id: hearing.work_item_id,
          title: hearing.title,
          scheduled_at: hearing.scheduled_at,
        };
        await supabase.from("process_events").insert({
          owner_id: user.id,
          work_item_id: hearing.work_item_id,
          event_type: "HEARING_DELETED",
          description: `Audiencia eliminada: ${hearing.title}`,
          source: "USER_UI",
          raw_data: eventPayload as unknown as Json,
        });
      }
      
      // Hard delete the hearing
      const { error } = await supabase
        .from("hearings")
        .delete()
        .eq("id", hearing.id);
      
      if (error) throw error;
      
      return hearing;
    },
    onSuccess: (hearing) => {
      queryClient.invalidateQueries({ queryKey: ["work-item-hearings", organization?.id, hearing.work_item_id] });
      queryClient.invalidateQueries({ queryKey: ["all-hearings", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["process-events"] });
      toast.success("Audiencia eliminada");
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });
}
