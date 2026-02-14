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

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  if (!open || !mounted) return null;

  const chatPopup = (
    <div
      id="atenia-chat-portal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647, // max 32-bit int — absolutely nothing can be above this
        pointerEvents: "auto",
        isolation: "isolate", // own stacking context
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          zIndex: 1,
        }}
        onClick={onClose}
      />

      {/* Popup panel — right side drawer style */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(28rem, 95vw)",
          zIndex: 2,
          background: "hsl(var(--background))",
          borderLeft: "1px solid hsl(var(--border))",
          boxShadow: "-8px 0 30px rgba(0,0,0,0.3)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            right: 12,
            top: 12,
            zIndex: 10,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 4,
            borderRadius: 4,
            color: "hsl(var(--foreground))",
            opacity: 0.7,
          }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseOut={(e) => (e.currentTarget.style.opacity = "0.7")}
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
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
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
    </div>
  );

  return createPortal(chatPopup, document.body);
}
