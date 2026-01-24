import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Gavel, Calendar, FileText, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  DESACATO_PHASES,
  DESACATO_PHASES_ORDER,
  type DesacatoPhase,
} from "@/lib/tutela-constants";

// Stage configuration
interface DesacatoStageConfig {
  id: string;
  label: string;
  shortLabel: string;
  color: string;
  phase: DesacatoPhase;
}

const DESACATO_STAGES: DesacatoStageConfig[] = DESACATO_PHASES_ORDER.map((phase) => ({
  id: `desacato:${phase}`,
  label: DESACATO_PHASES[phase].label,
  shortLabel: DESACATO_PHASES[phase].shortLabel,
  color: DESACATO_PHASES[phase].color,
  phase,
}));

// Desacato item interface
export interface DesacatoItem {
  id: string;
  tutelaId: string;
  tutelaRadicado: string | null;
  courtName: string | null;
  demandantes: string | null;
  demandados: string | null;
  phase: DesacatoPhase;
  createdAt: string;
  notes: string | null;
  clientId: string | null;
  clientName: string | null;
}

interface RawDesacato {
  id: string;
  tutela_id: string;
  phase: string;
  notes: string | null;
  created_at: string;
  filings: {
    id: string;
    radicado: string | null;
    court_name: string | null;
    demandantes: string | null;
    demandados: string | null;
    client_id: string | null;
    clients: { id: string; name: string } | null;
  } | null;
}

function rawToDesacatoItem(raw: RawDesacato): DesacatoItem {
  return {
    id: raw.id,
    tutelaId: raw.tutela_id,
    tutelaRadicado: raw.filings?.radicado || null,
    courtName: raw.filings?.court_name || null,
    demandantes: raw.filings?.demandantes || null,
    demandados: raw.filings?.demandados || null,
    phase: (raw.phase as DesacatoPhase) || "DESACATO_RADICACION",
    createdAt: raw.created_at,
    notes: raw.notes,
    clientId: raw.filings?.client_id || null,
    clientName: raw.filings?.clients?.name || null,
  };
}

// Desacato Card Component
interface DesacatoCardProps {
  item: DesacatoItem;
  isDragging?: boolean;
}

function DesacatoCard({ item, isDragging = false }: DesacatoCardProps) {
  const navigate = useNavigate();
  
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `desacato:${item.id}`,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "cursor-grab active:cursor-grabbing transition-all duration-200",
        "hover:shadow-md hover:border-orange-500/50 border-orange-300",
        isDragging && "opacity-50 rotate-2 scale-105 shadow-xl"
      )}
    >
      <CardContent className="p-3 space-y-2">
        {/* Header */}
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <p className="text-sm font-medium">Incidente de Desacato</p>
        </div>

        {/* Radicado */}
        {item.tutelaRadicado && (
          <p className="text-xs font-mono text-muted-foreground">
            Tutela: {item.tutelaRadicado}
          </p>
        )}

        {/* Court name */}
        {item.courtName && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="h-3 w-3" />
            <span className="truncate">{item.courtName}</span>
          </div>
        )}

        {/* Parties */}
        {item.demandantes && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Accionante:</span>{" "}
            <span className="truncate">{item.demandantes}</span>
          </div>
        )}
        {item.demandados && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Accionado:</span>{" "}
            <span className="truncate">{item.demandados}</span>
          </div>
        )}

        {/* Notes */}
        {item.notes && (
          <p className="text-xs text-muted-foreground italic truncate">
            {item.notes}
          </p>
        )}

        {/* Created date */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span>{format(new Date(item.createdAt), "dd/MM/yyyy", { locale: es })}</span>
        </div>

        {/* Action button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs w-full"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/work-items/${item.tutelaId}`);
          }}
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          Ver tutela
        </Button>
      </CardContent>
    </Card>
  );
}

// Desacato Column Component
interface DesacatoColumnProps {
  stage: DesacatoStageConfig;
  items: DesacatoItem[];
}

function DesacatoColumn({ stage, items }: DesacatoColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-shrink-0 w-64 rounded-lg border bg-card/50",
        isOver && "ring-2 ring-orange-500 bg-orange-50 dark:bg-orange-950/20"
      )}
    >
      {/* Header */}
      <div className={cn("px-3 py-2 rounded-t-lg", stage.color)}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white">{stage.shortLabel}</span>
          <Badge variant="secondary" className="bg-white/20 text-white text-xs">
            {items.length}
          </Badge>
        </div>
      </div>

      {/* Items */}
      <ScrollArea className="h-[300px]">
        <div className="p-2 space-y-2">
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              Sin incidentes
            </p>
          ) : (
            items.map((item) => (
              <DesacatoCard key={item.id} item={item} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// Main Pipeline Component
export function DesacatoPipeline() {
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState<DesacatoItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor)
  );

  // Fetch desacatos
  const { data: desacatos, isLoading } = useQuery({
    queryKey: ["desacatos"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("desacato_incidents")
        .select(`
          id, tutela_id, phase, notes, created_at,
          filings!desacato_incidents_tutela_id_fkey(
            id, radicado, court_name, demandantes, demandados, client_id,
            clients(id, name)
          )
        `)
        .eq("owner_id", user.user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data as unknown as RawDesacato[]).map(rawToDesacatoItem);
    },
  });

  // Update phase mutation
  const updatePhaseMutation = useMutation({
    mutationFn: async ({ desacatoId, newPhase }: { desacatoId: string; newPhase: DesacatoPhase }) => {
      const { error } = await supabase
        .from("desacato_incidents")
        .update({ phase: newPhase })
        .eq("id", desacatoId);
      
      if (error) throw error;
      return { desacatoId, newPhase };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["desacatos"] });
      toast.success("Fase de desacato actualizada");
    },
    onError: () => toast.error("Error al actualizar fase"),
  });

  // Drag handlers
  const handleDragStart = (event: DragStartEvent) => {
    const itemId = event.active.id as string;
    const [, id] = itemId.split(":");
    const item = desacatos?.find(d => d.id === id);
    setActiveItem(item || null);
  };

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveItem(null);

    if (!over) return;

    const activeId = active.id as string;
    const [, itemId] = activeId.split(":");
    const [, targetPhase] = (over.id as string).split(":");

    const item = desacatos?.find(d => d.id === itemId);
    if (!item) return;

    if (item.phase !== targetPhase) {
      updatePhaseMutation.mutate({ desacatoId: itemId, newPhase: targetPhase as DesacatoPhase });
    }
  }, [desacatos, updatePhaseMutation]);

  const handleDragCancel = () => {
    setActiveItem(null);
  };

  // Group items by stage
  const itemsByStage = useMemo(() => {
    const result: Record<string, DesacatoItem[]> = {};
    DESACATO_STAGES.forEach(stage => {
      result[stage.id] = [];
    });

    desacatos?.forEach(item => {
      const stageId = `desacato:${item.phase}`;
      if (result[stageId]) {
        result[stageId].push(item);
      } else {
        result[DESACATO_STAGES[0].id].push(item);
      }
    });

    return result;
  }, [desacatos]);

  if (isLoading) {
    return (
      <div className="flex gap-4">
        {DESACATO_STAGES.map((_, i) => (
          <Skeleton key={i} className="h-[350px] w-64 flex-shrink-0" />
        ))}
      </div>
    );
  }

  const totalDesacatos = desacatos?.length || 0;

  if (totalDesacatos === 0) {
    return null; // Don't show pipeline if no desacatos exist
  }

  return (
    <div className="mt-6 pt-6 border-t border-orange-200 dark:border-orange-900/50">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <h3 className="text-lg font-semibold text-orange-700 dark:text-orange-400">
          Incidentes de Desacato
        </h3>
        <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300 px-3 py-1">
          <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
          {totalDesacatos} Incidente{totalDesacatos !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Pipeline */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex gap-3 pb-4">
            {DESACATO_STAGES.map((stage) => (
              <DesacatoColumn
                key={stage.id}
                stage={stage}
                items={itemsByStage[stage.id] || []}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <DragOverlay>
          {activeItem ? <DesacatoCard item={activeItem} isDragging /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
