/**
 * AteniaChat — Popup chat for the AI assistant mascot.
 * 
 * Renders via a manual React portal to document.body to escape
 * any stacking context created by theme CSS (isolation: isolate).
 */

import { createPortal } from "react-dom";
import { useLocation, useParams } from "react-router-dom";
import { Component, type ReactNode, useEffect, useState } from "react";
import type { BubbleContext } from "./mascot-bubbles";
import { Bot, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { AteniaAssistantDrawer } from "@/components/atenia/AteniaAssistantDrawer";

interface AteniaChatProps {
  open: boolean;
  onClose: () => void;
  prefillText: string | null;
  contexts: BubbleContext[];
}

/** Error boundary to catch silent crashes */
class ChatErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.error("[AteniaChat] ErrorBoundary caught:", error);
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  console.log("[AteniaChat] render, open:", open, "mounted:", mounted);

  if (!open || !mounted) return null;

  const chatPopup = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 animate-in fade-in-0"
        style={{ zIndex: 99998 }}
        onClick={onClose}
      />
      {/* Popup panel */}
      <div
        className="fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] w-[95vw] sm:max-w-lg h-[80vh] max-h-[700px] rounded-lg border shadow-2xl overflow-hidden flex flex-col animate-in fade-in-0 zoom-in-95"
        style={{
          zIndex: 99999,
          background: 'hsl(var(--background))',
          borderColor: 'hsl(var(--border))',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-sm opacity-70 hover:opacity-100 transition-opacity z-10"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>

        <ChatErrorBoundary
          fallback={
            <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
              <Bot className="h-12 w-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Error al cargar el asistente. Intenta cerrar y abrir de nuevo.
              </p>
              <Button variant="outline" size="sm" onClick={onClose}>
                Cerrar
              </Button>
            </div>
          }
        >
          <div className="flex-1 overflow-hidden flex flex-col">
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
        </ChatErrorBoundary>
      </div>
    </>
  );

  // Portal to document.body to escape any stacking context (isolation: isolate)
  return createPortal(chatPopup, document.body);
}
