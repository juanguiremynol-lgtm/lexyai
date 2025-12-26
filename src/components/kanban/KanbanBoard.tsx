import { useState } from "react";
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
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCard } from "./KanbanCard";
import { KANBAN_COLUMNS } from "@/lib/constants";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { FilingStatus } from "@/lib/constants";

interface Filing {
  id: string;
  status: FilingStatus;
  filing_type: string;
  sla_acta_due_at: string | null;
  sla_court_reply_due_at: string | null;
  matter: { client_name: string; matter_name: string } | null;
  client_id: string | null;
}

interface KanbanBoardProps {
  filings: Filing[];
  onFilingUpdated: () => void;
}

export function KanbanBoard({ filings, onFilingUpdated }: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const activeFiling = activeId
    ? filings.find((f) => f.id === activeId)
    : null;

  const getFilingsByStatus = (status: FilingStatus) =>
    filings.filter((f) => f.status === status);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const filingId = active.id as string;
    const newStatus = over.id as FilingStatus;

    const filing = filings.find((f) => f.id === filingId);
    if (!filing || filing.status === newStatus) return;

    // Validate status transitions
    const currentIndex = KANBAN_COLUMNS.indexOf(filing.status);
    const newIndex = KANBAN_COLUMNS.indexOf(newStatus);

    // Allow moving forward or backward in the pipeline
    if (currentIndex === -1 || newIndex === -1) return;

    try {
      const updates: Record<string, unknown> = { status: newStatus };

      // Set timestamps based on new status
      if (newStatus === "ACTA_RECEIVED_PARSED" && !filing.sla_court_reply_due_at) {
        const courtReplyDue = new Date();
        courtReplyDue.setDate(courtReplyDue.getDate() + 3);
        updates.acta_received_at = new Date().toISOString();
        updates.sla_court_reply_due_at = courtReplyDue.toISOString();
      }

      const { error } = await supabase
        .from("filings")
        .update(updates)
        .eq("id", filingId);

      if (error) throw error;

      toast.success("Estado actualizado");
      onFilingUpdated();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      toast.error("Error al actualizar: " + message);
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {KANBAN_COLUMNS.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            filings={getFilingsByStatus(status)}
            isOver={false}
          />
        ))}
      </div>

      <DragOverlay>
        {activeFiling ? (
          <KanbanCard filing={activeFiling} isDragging />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
