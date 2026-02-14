/**
 * AteniaChat — Popup wrapper for the AI assistant.
 * Uses Dialog instead of Sheet as a workaround for persistent
 * Sheet rendering issues across themes.
 */

import { useLocation, useParams } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AteniaAssistantDrawer } from "@/components/atenia/AteniaAssistantDrawer";
import type { BubbleContext } from "./mascot-bubbles";

interface AteniaChatProps {
  open: boolean;
  onClose: () => void;
  prefillText: string | null;
  contexts: BubbleContext[];
}

function useResolvedWorkItemId(): string | undefined {
  const location = useLocation();
  const params = useParams<{ id?: string }>();
  if (params.id && params.id.length > 10) return params.id;
  const match = location.pathname.match(/\/work-items?\/([0-9a-f-]{36})/i);
  if (match) return match[1];
  return undefined;
}

export function AteniaChat({
  open,
  onClose,
  prefillText,
  contexts,
}: AteniaChatProps) {
  const resolvedWorkItemId = useResolvedWorkItemId();
  const isWorkItemContext = !!resolvedWorkItemId || contexts.includes("WORK_ITEM_DETAIL");

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent
        className="sm:max-w-lg w-[95vw] h-[80vh] max-h-[700px] p-0 flex flex-col overflow-hidden z-[70] bg-background"
        style={{ background: 'hsl(var(--background))' }}
      >
        <DialogTitle className="sr-only">Andro IA Asistente</DialogTitle>
        <DialogDescription className="sr-only">Chat con tu asistente de IA</DialogDescription>

        <div className="flex-1 overflow-hidden">
          <AteniaAssistantDrawer
            open={true}
            onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}
            scope={isWorkItemContext ? "WORK_ITEM" : "ORG"}
            workItemId={resolvedWorkItemId}
            initialMessage={prefillText ?? undefined}
            mascotContexts={contexts}
            embedded
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
