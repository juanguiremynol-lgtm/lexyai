/**
 * Penal 906 Pipeline - Kanban board for criminal proceedings under Ley 906 de 2004
 * 
 * Uses UnifiedKanbanBoard engine with 14 phases from PENAL_906_PHASES
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { UnifiedKanbanBoard, type KanbanStage, type KanbanItem } from "@/components/kanban/UnifiedKanbanBoard";
import { KanbanCard } from "@/components/kanban/KanbanCard";
import { PENAL_906_PHASES, phaseName } from "@/lib/penal906";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Shield, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

// Map PENAL_906_PHASES to KanbanStage format
const PENAL_STAGES: KanbanStage[] = PENAL_906_PHASES.map((phase) => ({
  id: phase.id.toString(),
  label: phase.label,
  shortLabel: phase.shortLabel,
  color: phase.color,
  description: phase.description,
}));

// Extended interface for Penal items
interface PenalWorkItem extends KanbanItem {
  radicado: string | null;
  title: string | null;
  authority_name: string | null;
  client_name: string | null;
  is_flagged: boolean;
  last_event_summary: string | null;
  last_event_at: string | null;
  pipeline_stage: number;
  scraping_enabled: boolean;
}

export function PenalPipeline() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  // Fetch PENAL_906 work items
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["work-items", "PENAL_906"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_items")
        .select(`
          id,
          radicado,
          title,
          description,
          authority_name,
          is_flagged,
          pipeline_stage,
          last_event_at,
          last_event_summary,
          scraping_enabled,
          created_at,
          updated_at,
          clients(id, name)
        `)
        .eq("workflow_type", "PENAL_906")
        .is("deleted_at", null)
        .order("is_flagged", { ascending: false })
        .order("updated_at", { ascending: false });
      
      if (error) throw error;
      
      // Map to KanbanItem format
      return (data || []).map((item): PenalWorkItem => ({
        id: item.id,
        stage: (item.pipeline_stage ?? 0).toString(),
        radicado: item.radicado,
        title: item.title,
        authority_name: item.authority_name,
        client_name: (item.clients as { name: string } | null)?.name || null,
        is_flagged: item.is_flagged || false,
        last_event_summary: item.last_event_summary,
        last_event_at: item.last_event_at,
        pipeline_stage: item.pipeline_stage ?? 0,
        scraping_enabled: item.scraping_enabled ?? false,
      }));
    },
  });

  // Move mutation - updates pipeline_stage
  const handleStageDrop = useCallback(async (itemId: string, newStageId: string) => {
    const newStage = parseInt(newStageId, 10);
    
    const { error } = await supabase
      .from("work_items")
      .update({ 
        pipeline_stage: newStage,
        last_phase_change_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);
    
    if (error) {
      toast.error(`Error al actualizar: ${error.message}`);
      throw error;
    }
    
    toast.success(`Etapa actualizada a ${phaseName(newStage)}`);
  }, []);

  // Toggle flag
  const handleToggleFlag = useCallback(async (itemId: string) => {
    const item = items.find((w) => w.id === itemId);
    if (!item) return;
    
    const { error } = await supabase
      .from("work_items")
      .update({ is_flagged: !item.is_flagged })
      .eq("id", itemId);
    
    if (!error) {
      queryClient.invalidateQueries({ queryKey: ["work-items", "PENAL_906"] });
    }
  }, [items, queryClient]);

  // Sort items: flagged first, then by updated
  const sortItems = useCallback((a: PenalWorkItem, b: PenalWorkItem) => {
    if (a.is_flagged !== b.is_flagged) {
      return a.is_flagged ? -1 : 1;
    }
    return 0;
  }, []);

  // Render card
  const renderCard = useCallback((item: PenalWorkItem, options: {
    isDragging?: boolean;
    isFocused?: boolean;
    isSelected?: boolean;
    isSelectionMode?: boolean;
  }) => {
    return (
      <div
        className={cn(
          "bg-card rounded-lg border p-3 shadow-sm cursor-pointer hover:border-primary/50 transition-colors",
          options.isDragging && "opacity-50 ring-2 ring-primary",
          options.isFocused && "ring-2 ring-primary",
          options.isSelected && "border-primary bg-primary/5",
          item.is_flagged && "border-l-4 border-l-amber-500"
        )}
        onClick={() => navigate(`/app/work-items/${item.id}`)}
      >
        <div className="space-y-2">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Shield className="h-3.5 w-3.5 text-red-600 flex-shrink-0" />
              <span className="text-sm font-medium truncate">
                {item.radicado || item.title || "Sin radicado"}
              </span>
            </div>
            <Badge variant="outline" className="text-xs flex-shrink-0">
              {phaseName(item.pipeline_stage).split(" ")[0]}
            </Badge>
          </div>
          
          {/* Client / Authority */}
          {(item.client_name || item.authority_name) && (
            <p className="text-xs text-muted-foreground truncate">
              {item.client_name || item.authority_name}
            </p>
          )}
          
          {/* Last event summary */}
          {item.last_event_summary && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {item.last_event_summary}
            </p>
          )}
          
          {/* Footer */}
          {item.last_event_at && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>{new Date(item.last_event_at).toLocaleDateString("es-CO")}</span>
            </div>
          )}
        </div>
      </div>
    );
  }, [navigate]);

  return (
    <UnifiedKanbanBoard<PenalWorkItem, KanbanStage>
      stages={PENAL_STAGES}
      items={items}
      isLoading={isLoading}
      onStageDrop={handleStageDrop}
      renderCard={renderCard}
      sortItems={sortItems}
      invalidateQueries={[["work-items", "PENAL_906"]]}
      minColumnHeight="400px"
      isSelectionMode={isSelectionMode}
      selectedIds={selectedIds}
      focusedItemId={focusedItemId}
    />
  );
}
