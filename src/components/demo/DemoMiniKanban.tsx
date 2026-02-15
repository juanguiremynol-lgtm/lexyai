/**
 * DemoMiniKanban — Client-side-only Kanban sandbox for the demo
 * 
 * Shows 5 CGP columns with the demo radicado as a draggable card.
 * Pure client state — no DB, no auth, uses @dnd-kit.
 */

import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Scale, GripVertical, ArrowRight } from "lucide-react";

const DEMO_STAGES = [
  { id: "RADICACION", label: "Radicación", color: "bg-slate-500" },
  { id: "ADMISION", label: "Admisión", color: "bg-blue-500" },
  { id: "CONTESTACION", label: "Contestación", color: "bg-indigo-500" },
  { id: "PRUEBAS", label: "Pruebas", color: "bg-amber-500" },
  { id: "FALLO", label: "Fallo", color: "bg-emerald-500" },
] as const;

interface Resumen {
  radicado_display: string;
  despacho: string | null;
  jurisdiccion: string | null;
  tipo_proceso: string | null;
}

interface Props {
  resumen: Resumen;
}

export function DemoMiniKanban({ resumen }: Props) {
  const [currentStage, setCurrentStage] = useState("RADICACION");
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDraggingId(null);
    const { over } = event;
    if (over) {
      setCurrentStage(String(over.id));
    }
  }, []);

  return (
    <div className="space-y-4 rounded-lg border bg-card/60 p-3 sm:p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          Pipeline — Arrastra la tarjeta
        </h4>
        <Badge variant="outline" className="text-xs">
          Sandbox interactivo
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        En Andromeda, cada proceso se ubica en una etapa del pipeline. Arrastra la tarjeta entre columnas para ver cómo funciona.
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-x-auto -mx-1 px-1 pb-2">
          <div className="grid grid-cols-5 gap-2 min-h-[180px] min-w-[500px]">
            {DEMO_STAGES.map((stage) => (
              <DemoColumn
                key={stage.id}
                stage={stage}
                hasCard={currentStage === stage.id}
                resumen={resumen}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {draggingId ? (
            <DemoCard resumen={resumen} isDragging />
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className="flex items-center justify-center gap-2 pt-2">
        <p className="text-xs text-muted-foreground">
          Con Andromeda, este proceso avanzaría automáticamente según las actuaciones detectadas
        </p>
        <ArrowRight className="h-3 w-3 text-primary" />
      </div>
    </div>
  );
}

function DemoColumn({
  stage,
  hasCard,
  resumen,
}: {
  stage: (typeof DEMO_STAGES)[number];
  hasCard: boolean;
  resumen: Resumen;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border-2 border-dashed p-2 transition-colors min-h-[150px]",
        isOver
          ? "border-primary bg-primary/10"
          : "border-border/60 bg-muted/30"
      )}
    >
      <div className="flex items-center gap-1.5 mb-2 bg-muted/50 rounded px-1.5 py-1">
        <div className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0", stage.color)} />
        <span className="text-xs font-semibold truncate">{stage.label}</span>
      </div>
      {hasCard && <DemoCard resumen={resumen} />}
    </div>
  );
}

function DemoCard({
  resumen,
  isDragging = false,
}: {
  resumen: Resumen;
  isDragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: "demo-card",
  });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  return (
    <Card
      ref={isDragging ? undefined : setNodeRef}
      style={isDragging ? undefined : style}
      {...(isDragging ? {} : attributes)}
      {...(isDragging ? {} : listeners)}
      className={cn(
        "cursor-grab active:cursor-grabbing transition-all duration-200",
        isDragging && "shadow-lg scale-105 rotate-1 ring-2 ring-primary opacity-90"
      )}
    >
      <CardContent className="p-2.5">
        <div className="flex items-start gap-1.5">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="min-w-0 space-y-1">
            <p className="font-mono text-[10px] leading-tight truncate">
              {resumen.radicado_display}
            </p>
            {resumen.despacho && (
              <p className="text-[10px] text-muted-foreground truncate">
                {resumen.despacho}
              </p>
            )}
            {resumen.tipo_proceso && (
              <Badge variant="secondary" className="text-[9px] px-1 py-0">
                {resumen.tipo_proceso}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
