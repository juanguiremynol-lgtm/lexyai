/**
 * React Query hooks for managing work item hearings (audiencias)
 *
 * LEGACY-COMPAT SHIM (2026-07): This module previously read/wrote the legacy
 * `hearings` table. It now delegates to the canonical `work_item_hearings`
 * table so every consumer (HearingsTab, dialogs, etc.) shares a single source
 * of truth. The public shape (Hearing/CreateHearingInput/UpdateHearingInput)
 * is preserved to avoid a large-scale UI refactor.
 *
 * Column mapping legacy → canonical:
 *   title         → custom_name
 *   notes         → notes_plain_text
 *   is_virtual    → modality ('virtual' | 'presencial')
 *   virtual_link  → meeting_link
 *   auto_detected → auto_detected (same name in canonical)
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
  teams_link: string | null;
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
  teams_link?: string;
  notes?: string;
}

export interface UpdateHearingInput {
  id: string;
  title?: string;
  scheduled_at?: string;
  location?: string;
  is_virtual?: boolean;
  virtual_link?: string;
  teams_link?: string;
  notes?: string;
}

// Map canonical work_item_hearings row → legacy-shaped Hearing.
function mapCanonicalToLegacy(row: any): Hearing {
  const title =
    row.custom_name ||
    row.hearing_types?.name ||
    row.hearing_type?.name ||
    "Audiencia";
  const scheduled = row.scheduled_at || row.occurred_at || row.created_at;
  const isVirtual = row.modality === "virtual" || row.modality === "mixta";
  return {
    id: row.id,
    title,
    scheduled_at: scheduled,
    location: row.location ?? null,
    is_virtual: isVirtual,
    virtual_link: isVirtual ? row.meeting_link ?? null : null,
    teams_link: row.meeting_link ?? null,
    notes: row.notes_plain_text ?? null,
    auto_detected: row.auto_detected ?? false,
    reminder_sent: false,
    work_item_id: row.work_item_id ?? null,
    organization_id: row.organization_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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
        .from("work_item_hearings")
        .select("*, hearing_types(name)")
        .eq("work_item_id", workItemId)
        .order("scheduled_at", { ascending: true, nullsFirst: false });

      if (error) throw error;
      return (data || []).map(mapCanonicalToLegacy);
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
      if (!organization?.id) throw new Error("Sin organización activa");

      // Insert the hearing into the canonical table
      const modality = input.is_virtual
        ? "virtual"
        : input.location
        ? "presencial"
        : null;
      const meetingLink = input.virtual_link || input.teams_link || null;

      const { data: hearing, error: hearingError } = await supabase
        .from("work_item_hearings")
        .insert({
          organization_id: organization.id,
          work_item_id: input.work_item_id,
          custom_name: input.title,
          scheduled_at: input.scheduled_at,
          status: "scheduled",
          location: input.location || null,
          modality,
          meeting_link: meetingLink,
          notes_plain_text: input.notes || null,
          created_by: user.id,
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
      queryClient.invalidateQueries({ queryKey: ["work-item-hearings-v2", variables.work_item_id] });
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
        .from("work_item_hearings")
        .select("*, hearing_types(name)")
        .eq("id", input.id)
        .single();

      if (!currentHearing) throw new Error("Audiencia no encontrada");

      // Update the hearing on the canonical table
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      };
      if (input.title !== undefined) updateData.custom_name = input.title;
      if (input.scheduled_at !== undefined) updateData.scheduled_at = input.scheduled_at;
      if (input.location !== undefined) updateData.location = input.location || null;
      if (input.is_virtual !== undefined) {
        updateData.modality = input.is_virtual ? "virtual" : "presencial";
      }
      if (input.virtual_link !== undefined || input.teams_link !== undefined) {
        updateData.meeting_link =
          input.virtual_link || input.teams_link || null;
      }
      if (input.notes !== undefined)
        updateData.notes_plain_text = input.notes || null;

      const { error } = await supabase
        .from("work_item_hearings")
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
            title: currentHearing.custom_name,
            scheduled_at: currentHearing.scheduled_at,
            location: currentHearing.location,
          },
        };
        await supabase.from("process_events").insert({
          owner_id: user.id,
          work_item_id: currentHearing.work_item_id,
          event_type: "HEARING_UPDATED",
          description: `Audiencia actualizada: ${input.title || currentHearing.custom_name || "audiencia"}`,
          source: "USER_UI",
          raw_data: eventPayload as unknown as Json,
        });
      }
      
      return { ...currentHearing, ...updateData } as any;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["work-item-hearings", organization?.id, (result as any).work_item_id] });
      queryClient.invalidateQueries({ queryKey: ["work-item-hearings-v2", (result as any).work_item_id] });
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

      // Hard delete from canonical table
      const { error } = await supabase
        .from("work_item_hearings")
        .delete()
        .eq("id", hearing.id);
      
      if (error) throw error;
      
      return hearing;
    },
    onSuccess: (hearing) => {
      queryClient.invalidateQueries({ queryKey: ["work-item-hearings", organization?.id, hearing.work_item_id] });
      queryClient.invalidateQueries({ queryKey: ["work-item-hearings-v2", hearing.work_item_id] });
      queryClient.invalidateQueries({ queryKey: ["all-hearings", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["process-events"] });
      toast.success("Audiencia eliminada");
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });
}
