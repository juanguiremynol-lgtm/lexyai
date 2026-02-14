/**
 * AteniaChat — Chat panel wrapper that opens in a Sheet.
 * Wraps the existing AteniaAssistantDrawer chat experience
 * and adds a welcome view with grouped capabilities + context-aware chips.
 *
 * Context-first resolution: automatically extracts workItemId from route
 * so users never need to paste IDs when on a work item detail page.
 */

import { useLocation, useParams } from "react-router-dom";
import { AteniaAssistantDrawer } from "@/components/atenia/AteniaAssistantDrawer";
import type { BubbleContext } from "./mascot-bubbles";

interface AteniaChatProps {
  open: boolean;
  onClose: () => void;
  prefillText: string | null;
  contexts: BubbleContext[];
}

/**
 * CaseContextResolver — extracts workItemId from the current route.
 * Priority: 1) route params  2) pathname regex match
 */
function useResolvedWorkItemId(): string | undefined {
  const location = useLocation();
  const params = useParams<{ id?: string }>();

  // Direct route param (e.g. /work-items/:id)
  if (params.id && params.id.length > 10) return params.id;

  // Fallback: regex extract from pathname (covers nested routes)
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

  console.log("[AteniaChat] render, open:", open, "workItemId:", resolvedWorkItemId);

  return (
    <AteniaAssistantDrawer
      open={open}
      onOpenChange={(isOpen) => {
        console.log("[AteniaChat] onOpenChange:", isOpen);
        if (!isOpen) onClose();
      }}
      scope={isWorkItemContext ? "WORK_ITEM" : "ORG"}
      workItemId={resolvedWorkItemId}
      initialMessage={prefillText ?? undefined}
      mascotContexts={contexts}
    />
  );
}
