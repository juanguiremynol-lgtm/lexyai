import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { WorkflowType, CGPPhase, ItemSource } from "@/lib/workflow-constants";
import { getDefaultStage } from "@/lib/workflow-constants";
import { createRemindersForWorkItem, isEligibleForReminders } from "@/lib/reminders/reminder-service";

// Interface for initial actuaciones from lookup
interface InitialActuacion {
  fecha: string;
  actuacion: string;
  anotacion?: string;
  fecha_registro?: string;
  estado?: string;
  anexos?: number;
  indice?: string;
}

export interface CreateWorkItemData {
  // Core classification
  workflow_type: WorkflowType;
  stage: string;
  cgp_phase?: CGPPhase;
  
  // Basic metadata
  title?: string;
  radicado?: string;
  radicado_raw?: string;
  radicado_verified?: boolean;
  authority_name?: string;
  authority_city?: string;
  authority_department?: string;
  source_reference?: string;
  
  // Parties
  demandantes?: string;
  demandados?: string;
  
  // Workflow-specific fields
  // CGP
  cgp_class?: string;
  cgp_variant?: string;
  cgp_cuantia?: string;
  
  // Peticion
  filing_date?: string;
  
  // Tutela
  auto_admisorio_date?: string;
  
  // CPACA
  cpaca_medio_control?: string;
  cpaca_phase?: string;
  
  // Client and matter
  client_id?: string;
  matter_id?: string;
  
  // Additional
  notes?: string;
  description?: string;
  source?: ItemSource;
  
  // Initial actuaciones from lookup (to persist on creation)
  initial_actuaciones?: InitialActuacion[];
  lookup_source?: string; // e.g., 'CPNU', 'SAMAI'
}

export function useCreateWorkItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateWorkItemData) => {
      // Get current user
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error("No autenticado");
      }

      // Derive CGP phase if applicable
      let cgpPhase: CGPPhase | null = null;
      let cgpPhaseSource: 'AUTO' | 'MANUAL' | null = null;
      
      if (data.workflow_type === 'CGP') {
        cgpPhase = data.cgp_phase || 'FILING';
        cgpPhaseSource = 'MANUAL';
      }

      // Build the insert payload
      const workItemData = {
        owner_id: user.id,
        workflow_type: data.workflow_type,
        stage: data.stage || getDefaultStage(data.workflow_type, cgpPhase || undefined),
        status: 'ACTIVE' as const,
        source: data.source || 'MANUAL' as const,
        
        // Basic metadata
        title: data.title || null,
        radicado: data.radicado || null,
        radicado_raw: data.radicado_raw || data.radicado || null,
        radicado_verified: data.radicado_verified ?? false,
        authority_name: data.authority_name || null,
        authority_city: data.authority_city || null,
        authority_department: data.authority_department || null,
        
        // Parties
        demandantes: data.demandantes || null,
        demandados: data.demandados || null,
        
        // CGP-specific
        cgp_phase: cgpPhase,
        cgp_phase_source: cgpPhaseSource,
        cgp_class: data.cgp_class || null,
        cgp_variant: data.cgp_variant || null,
        cgp_cuantia: data.cgp_cuantia || null,
        
        // Dates
        filing_date: data.filing_date || null,
        auto_admisorio_date: data.auto_admisorio_date || null,
        
        // Client / matter
        client_id: data.client_id || null,
        matter_id: data.matter_id || null,
        
        // Notes
        notes: data.notes || null,
        description: data.description || null,
        source_reference: data.source_reference || null,
        
        // Defaults
        is_flagged: false,
        monitoring_enabled: data.workflow_type === 'CGP' || data.workflow_type === 'CPACA' || data.workflow_type === 'LABORAL' || data.workflow_type === 'PENAL_906',
        email_linking_enabled: true,
      };

      const { data: workItem, error } = await supabase
        .from("work_items")
        .insert(workItemData as any) // Cast until types regenerate with new workflow types
        .select()
        .single();

      if (error) {
        console.error("Error creating work item:", error);
        throw new Error(error.message);
      }

      // Save initial actuaciones if provided (from lookup preview)
      if (data.initial_actuaciones && data.initial_actuaciones.length > 0 && workItem) {
        console.log(`[use-create-work-item] Saving ${data.initial_actuaciones.length} initial actuaciones`);
        
        const actuacionesToInsert = data.initial_actuaciones.map((act) => {
          // Generate fingerprint for deduplication
          const normalized = `${workItem.id}|${act.fecha || ''}|${(act.actuacion || '').toLowerCase().trim().slice(0, 200)}`;
          let hash = 0;
          for (let i = 0; i < normalized.length; i++) {
            const char = normalized.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          const fingerprint = `wi_${workItem.id.slice(0, 8)}_${Math.abs(hash).toString(16)}`;
          
          return {
            work_item_id: workItem.id,
            owner_id: workItem.owner_id,
            organization_id: workItem.organization_id || null,
            act_date: act.fecha || null,
            act_date_raw: act.fecha || null,
            raw_text: act.actuacion || '',
            normalized_text: act.anotacion || act.actuacion || '',
            source: data.lookup_source || 'CPNU',
            hash_fingerprint: fingerprint,
            raw_data: act,
            // SAMAI-specific fields
            fecha_registro: act.fecha_registro || null,
            estado: act.estado || null,
            anexos_count: act.anexos || null,
            indice: act.indice || null,
          };
        });

        const { error: actsError } = await supabase
          .from("actuaciones")
          .upsert(actuacionesToInsert as any, { 
            onConflict: 'hash_fingerprint',
            ignoreDuplicates: true 
          });

        if (actsError) {
          console.warn("[use-create-work-item] Failed to save initial actuaciones:", actsError);
          // Non-blocking - work item was created successfully
        } else {
          console.log(`[use-create-work-item] Successfully saved ${actuacionesToInsert.length} actuaciones`);
        }
      }

      return workItem;
    },
    onSuccess: async (workItem) => {
      toast.success("Asunto creado exitosamente");
      
      // Create milestone reminders for judicial workflows
      try {
        const workItemForReminders = {
          id: workItem.id,
          owner_id: workItem.owner_id,
          workflow_type: workItem.workflow_type,
          radicado: workItem.radicado,
          authority_name: workItem.authority_name,
          expediente_url: workItem.expediente_url,
          auto_admisorio_date: workItem.auto_admisorio_date,
        };
        
        if (isEligibleForReminders(workItemForReminders)) {
          // Use owner_id as org_id for now (simplified)
          await createRemindersForWorkItem(workItemForReminders, workItem.owner_id);
        }
      } catch (err) {
        console.error("Error creating reminders:", err);
      }
      
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["cgp-work-items"] });
      queryClient.invalidateQueries({ queryKey: ["peticiones-work-items"] });
      queryClient.invalidateQueries({ queryKey: ["tutelas-work-items"] });
      queryClient.invalidateQueries({ queryKey: ["cpaca-work-items"] });
      queryClient.invalidateQueries({ queryKey: ["gov-procedure-work-items"] });
      queryClient.invalidateQueries({ queryKey: ["laboral-work-items"] });
      
      if (workItem.client_id) {
        queryClient.invalidateQueries({ queryKey: ["client-work-items", workItem.client_id] });
      }
    },
    onError: (error: Error) => {
      toast.error("Error al crear el asunto: " + error.message);
    },
  });
}
