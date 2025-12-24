import { useState } from "react";
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
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { PROCESS_PHASES_ORDER, type ProcessPhase } from "@/lib/constants";
import { toast } from "sonner";
import { ProcessPipelineColumn } from "./ProcessPipelineColumn";
import { ProcessPipelineCard } from "./ProcessPipelineCard";

interface MonitoredProcess {
  id: string;
  radicado: string;
  despacho_name: string | null;
  monitoring_enabled: boolean;
  last_checked_at: string | null;
  last_change_at: string | null;
  phase: ProcessPhase | null;
  clients: { id: string; name: string } | null;
}

export function ProcessPipeline() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const { data: processes, isLoading } = useQuery({
    queryKey: ["process-pipeline"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("monitored_processes")
        .select(
          "id, radicado, despacho_name, monitoring_enabled, last_checked_at, last_change_at, phase, clients(id, name)"
        )
        .eq("owner_id", user.user.id)
        .eq("monitoring_enabled", true)
        .order("last_change_at", { ascending: false, nullsFirst: false });

      if (error) throw error;
      return data as unknown as MonitoredProcess[];
    },
  });

  const updatePhaseMutation = useMutation({
    mutationFn: async ({ processId, newPhase }: { processId: string; newPhase: ProcessPhase }) => {
      const { error } = await supabase
        .from("monitored_processes")
        .update({ phase: newPhase })
        .eq("id", processId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["process-pipeline"] });
      toast.success("Fase actualizada");
    },
    onError: () => {
      toast.error("Error al actualizar la fase");
    },
  });

  const activeProcess = activeId
    ? processes?.find((p) => p.id === activeId)
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const processId = active.id as string;
    const newPhase = over.id as ProcessPhase;

    const process = processes?.find((p) => p.id === processId);
    if (!process) return;

    const currentPhase = process.phase || "PENDIENTE_REGISTRO_MEDIDA_CAUTELAR";
    if (currentPhase === newPhase) return;

    // Validate phase is valid
    if (!PROCESS_PHASES_ORDER.includes(newPhase)) return;

    updatePhaseMutation.mutate({ processId, newPhase });
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  if (isLoading) {
    return (
      <div className="flex gap-4">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-[400px] w-64 flex-shrink-0" />
        ))}
      </div>
    );
  }

  const allProcesses = processes || [];

  // Group processes by phase
  const processesByPhase: Record<ProcessPhase, MonitoredProcess[]> = {} as Record<ProcessPhase, MonitoredProcess[]>;
  PROCESS_PHASES_ORDER.forEach((phase) => {
    processesByPhase[phase] = [];
  });

  allProcesses.forEach((process) => {
    const phase = process.phase || "PENDIENTE_REGISTRO_MEDIDA_CAUTELAR";
    if (processesByPhase[phase]) {
      processesByPhase[phase].push(process);
    }
  });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex gap-3 pb-4">
          {PROCESS_PHASES_ORDER.map((phase) => (
            <ProcessPipelineColumn
              key={phase}
              phase={phase}
              processes={processesByPhase[phase]}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <DragOverlay>
        {activeProcess ? (
          <ProcessPipelineCard process={activeProcess} isDragging />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
