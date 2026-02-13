/**
 * AteniaChat — Chat panel wrapper that opens in a Sheet.
 * Wraps the existing AteniaAssistantDrawer chat experience
 * and adds a welcome view with grouped capabilities + context-aware chips.
 */

import { AteniaAssistantDrawer } from "@/components/atenia/AteniaAssistantDrawer";
import type { BubbleContext } from "./mascot-bubbles";

interface AteniaChatProps {
  open: boolean;
  onClose: () => void;
  prefillText: string | null;
  contexts: BubbleContext[];
}

export function AteniaChat({
  open,
  onClose,
  prefillText,
  contexts,
}: AteniaChatProps) {
  return (
    <AteniaAssistantDrawer
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      scope="ORG"
      initialMessage={prefillText ?? undefined}
      mascotContexts={contexts}
    />
  );
}
