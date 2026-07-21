import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { WorkflowType, CGPPhase, ItemSource } from "@/lib/workflow-constants";
import { getDefaultStage } from "@/lib/workflow-constants";
import { createRemindersForWorkItem, isEligibleForReminders } from "@/lib/reminders/reminder-service";
import { isOnlineSyncEligible } from "@/lib/externalSyncDisplay";

// Interface for initial actuaciones from lookup
interface InitialActuacion {
  fecha: string;
  actuacion: string;
  anotacion?: string;
  fecha_registro?: string;
  fecha_inicia_termino?: string;
  fecha_finaliza_termino?: string;
  estado?: string;
  anexos?: number;
  indice?: string;
  documentos?: Array<{ nombre: string; url: string }>;
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
  /** True when the user overrode the corp-guard suggestion. Persisted to
   *  work_items.raw_data for audit. */
  wizard_override_workflow?: boolean;
  /** Provenance marker for the workflow selection. Emitted by the wizard
   *  and persisted as an audit log. Known values:
   *    RADICADO_DERIVED         → matches derivation from radicado
   *    USER_OVERRIDE_CORP       → user overrode a high-confidence derivation
   *    USER_OVERRIDE_MIXED      → mixed-jurisdiction despacho (esp 88/89),
   *                                user picked the workflow manually
   *    USER_OVERRIDE_LABORAL    → user promoted a civil despacho to LABORAL
   *                                after despacho lookup hinted labor.
   *    MANUAL                   → no radicado / manual entry
   */
  workflow_origin?: string;
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
        monitoring_enabled: data.workflow_type === 'CGP' || data.workflow_type === 'CPACA' || data.workflow_type === 'LABORAL' || data.workflow_type === 'PENAL_906' || data.workflow_type === 'TUTELA',
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

      // Audit trail for corp-guard override (user proceeded despite the
      // radicado's derived jurisdiction disagreeing with their choice).
      if (data.wizard_override_workflow && workItem?.organization_id) {
        try {
          await supabase.from("audit_logs").insert({
            organization_id: workItem.organization_id,
            entity_type: "work_item",
            entity_id: workItem.id,
            actor_type: "user",
            actor_user_id: user.id,
            action: "WIZARD_WORKFLOW_OVERRIDE",
            metadata: {
              chosen_workflow: workItem.workflow_type,
              radicado: workItem.radicado,
            },
          });
        } catch (err) {
          console.warn("[use-create-work-item] audit_logs insert failed:", err);
        }
      }
      
      // Provenance audit: record how the workflow was resolved so
      // downstream ops (Atenia, DATA_QUALITY sweeps) can distinguish
      // radicado-derived items from manual overrides.
      if (data.workflow_origin && workItem?.id) {
        try {
          await supabase.from("audit_logs").insert({
            organization_id: workItem.organization_id ?? null,
            entity_type: "work_item",
            entity_id: workItem.id,
            actor_type: "user",
            actor_user_id: user.id,
            action: "WIZARD_WORKFLOW_ORIGIN",
            metadata: {
              origin: data.workflow_origin,
              chosen_workflow: workItem.workflow_type,
              radicado: workItem.radicado,
            },
          });
        } catch (err) {
          console.warn("[use-create-work-item] workflow_origin audit failed:", err);
        }
      }

      // Save initial actuaciones to CANONICAL work_item_acts table (NOT legacy actuaciones)
      if (data.initial_actuaciones && data.initial_actuaciones.length > 0 && workItem) {
        console.log(`[use-create-work-item] Saving ${data.initial_actuaciones.length} initial acts to work_item_acts`);
        
        const actsToInsert = data.initial_actuaciones.map((act) => {
          // Generate fingerprint for deduplication (same algo as sync-by-work-item)
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
            workflow_type: data.workflow_type,
            act_date: act.fecha || null,
            act_date_raw: act.fecha || null,
            description: act.actuacion || '',
            event_summary: act.anotacion || act.actuacion || '',
            // Emit canonical lowercase source label so it merges cleanly with
            // sync-by-work-item / adapter output and avoids case-drift dedup.
            source: (data.lookup_source || 'cpnu').toLowerCase(),
            source_platform: (data.lookup_source || 'cpnu').toLowerCase(),
            hash_fingerprint: fingerprint,
            raw_data: act,
          // Note: raw_data receives the full lookup act payload above so the
          // sync pipeline (sync-by-work-item) can recover extended fields
          // (fecha_registro, fecha_inicia_termino, documentos, …) even
          // before the first external re-sync.
          };
        });

        const { error: actsError } = await supabase
          .from("work_item_acts")
          .upsert(actsToInsert as any, { 
            onConflict: 'work_item_id,hash_fingerprint',
            ignoreDuplicates: true 
          });

        if (actsError) {
          console.warn("[use-create-work-item] Failed to save initial acts to work_item_acts:", actsError);
        } else {
          console.log(`[use-create-work-item] Successfully saved ${actsToInsert.length} acts to work_item_acts`);
        }
      }

      return workItem;
    },
    onSuccess: async (workItem) => {
      toast.success("Asunto creado exitosamente");

      // Explicit lifecycle event so the GCP outbox is guaranteed to fire
      // with actor='USER' (the AFTER INSERT trigger emits a SYSTEM event as
      // a safety net; this RPC returns no_op when the state already matches).
      supabase.rpc('set_work_item_lifecycle', {
        p_work_item_id: workItem.id,
        p_new_state: 'ACTIVE',
        p_reason: 'WIZARD_CREATE',
        p_actor: 'USER',
      }).then(({ error }) => {
        if (error) console.warn('[use-create-work-item] set_work_item_lifecycle failed:', error.message);
      });
      
      // Background sync: trigger publicaciones + actuaciones sync only for
      // online-sync-eligible workflows (CGP, CPACA, LABORAL, PENAL_906, TUTELA).
      // Ordered fire-and-forget: publicaciones (estados) FIRST so the term
      // engine has fecha_fijacion / fecha_desfijacion anchors before
      // actuaciones-driven deadline computation kicks in.
      const radicadoDigits = (workItem.radicado || '').replace(/\D/g, '');
      const eligibleForOnlineSync = isOnlineSyncEligible(workItem.workflow_type);
      if (workItem.id && radicadoDigits.length === 23 && eligibleForOnlineSync) {
        // Sequential: run publicaciones first, then actuaciones. Both stay
        // fire-and-forget from the caller's perspective (no await).
        (async () => {
          try {
            const { data: pubData } = await supabase.functions.invoke("sync-publicaciones-by-work-item", {
          body: { work_item_id: workItem.id },
            });
            if (pubData && pubData.ok === false) {
              console.log("[use-create-work-item] publicaciones sync degraded:", pubData.status ?? pubData.reason);
            }
          } catch (err) {
            console.warn("[use-create-work-item] Background publicaciones sync failed:", err);
          }
          try {
            const { data: actData } = await supabase.functions.invoke("sync-by-work-item", {
              body: { work_item_id: workItem.id },
            });
            if (actData && actData.ok === false) {
              console.log("[use-create-work-item] actuaciones sync degraded:", actData.status ?? actData.reason);
            }
          } catch (err) {
            console.warn("[use-create-work-item] Background actuaciones sync failed:", err);
          }
        })();
      }

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
          // RLS policy: WITH CHECK (auth.uid() = owner_id AND (organization_id IS NULL OR is_org_member(organization_id))).
          // Pass the work item's real organization_id (nullable for solo users) — NOT the owner_id.
          await createRemindersForWorkItem(
            workItemForReminders,
            workItem.organization_id ?? null,
          );
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
