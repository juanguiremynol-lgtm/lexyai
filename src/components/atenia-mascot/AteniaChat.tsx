/**
 * AteniaChat — Chat panel wrapper that opens in a Sheet.
 * Wraps the existing AteniaAssistantDrawer chat experience
 * and adds contextual quick prompts from the mascot.
 */

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Bot, Shield } from "lucide-react";
import { QuickPrompts } from "./QuickPrompts";
import { AteniaAssistantDrawer } from "@/components/atenia/AteniaAssistantDrawer";
import type { BubbleContext } from "./mascot-bubbles";
import { useIsMobile } from "@/hooks/use-mobile";

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
  // We reuse the existing AteniaAssistantDrawer directly
  // It already handles chat, report, actions, confirmations
  return (
    <AteniaAssistantDrawer
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      scope="ORG"
      initialMessage={prefillText ?? undefined}
    />
  );
}
