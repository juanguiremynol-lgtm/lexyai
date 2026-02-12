/**
 * AteniaAssistantDrawer — Right-side drawer for the Atenia AI Attending Assistant.
 *
 * Can be opened from WorkItemDetail (WORK_ITEM scope) or global nav (ORG/PLATFORM scope).
 * Features:
 *   - Chat interface with Gemini
 *   - Quick diagnosis buttons
 *   - Action proposal cards with confirmation
 *   - Full audit logging
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Send, Bot, User, Zap, AlertTriangle, CheckCircle, Shield, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ---- Types ----

interface Citation {
  source: string;
  id: string;
  note: string;
}

interface ProposedAction {
  type: string;
  risk: "SAFE" | "CONFIRM_REQUIRED";
  why: string;
  params?: Record<string, unknown>;
}

interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  proposed_actions?: ProposedAction[];
  timestamp: Date;
}

interface AteniaAssistantDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: "WORK_ITEM" | "ORG" | "PLATFORM";
  workItemId?: string;
  workItemRadicado?: string;
}

const ACTION_LABELS: Record<string, string> = {
  RUN_SYNC_WORK_ITEM: "Ejecutar sincronización",
  RUN_SYNC_PUBLICACIONES_WORK_ITEM: "Sincronizar publicaciones",
  TOGGLE_MONITORING: "Cambiar monitoreo",
  RUN_MASTER_SYNC_SCOPE: "Sincronización masiva",
  ESCALATE_TO_ADMIN_QUEUE: "Escalar a administrador",
  CREATE_USER_REPORT: "Crear reporte",
};

const QUICK_QUESTIONS = [
  { label: "¿Por qué no se actualiza?", message: "¿Por qué este proceso no se está actualizando? Analiza los traces recientes y el estado de monitoreo." },
  { label: "Resumen de actuaciones", message: "Resume las últimas actuaciones de este proceso. ¿Hay algo importante o urgente?" },
  { label: "¿Qué debo hacer?", message: "Basado en el estado actual de este proceso, ¿qué acciones debería tomar? Sugiere pasos concretos." },
];

export function AteniaAssistantDrawer({
  open,
  onOpenChange,
  scope,
  workItemId,
  workItemRadicado,
}: AteniaAssistantDrawerProps) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [confirmingAction, setConfirmingAction] = useState<ProposedAction | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Reset when drawer opens with new context
  useEffect(() => {
    if (open) {
      setMessages([]);
      setSessionId(null);
      setInput("");
      setConfirmingAction(null);
    }
  }, [open, workItemId]);

  const callAssistant = useCallback(async (message: string, mode: "CHAT" | "DIAGNOSE_WORK_ITEM" = "CHAT") => {
    setIsLoading(true);

    const userMsg: AssistantMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const { data, error } = await supabase.functions.invoke("atenia-assistant", {
        body: {
          mode,
          message,
          scope,
          work_item_id: workItemId,
          session_id: sessionId,
        },
      });

      if (error) throw error;

      if (data?.session_id && !sessionId) {
        setSessionId(data.session_id);
      }

      const assistantMsg: AssistantMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data?.answer || "No se pudo obtener una respuesta.",
        citations: data?.citations,
        proposed_actions: data?.proposed_actions,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Error desconocido";
      toast.error(`Error del asistente: ${errMsg}`);

      const errorMsg: AssistantMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `❌ Error: ${errMsg}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [scope, workItemId, sessionId]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    const msg = input.trim();
    setInput("");
    callAssistant(msg);
  };

  const handleExecuteAction = async (action: ProposedAction) => {
    if (action.risk === "CONFIRM_REQUIRED") {
      setConfirmingAction(action);
      return;
    }
    await doExecuteAction(action);
  };

  const doExecuteAction = async (action: ProposedAction) => {
    setExecutingAction(action.type);
    setConfirmingAction(null);

    try {
      const { data, error } = await supabase.functions.invoke("atenia-assistant", {
        body: {
          mode: "EXECUTE",
          action: { type: action.type, params: action.params },
          confirmed: true,
          scope,
          work_item_id: workItemId,
          session_id: sessionId,
        },
      });

      if (error) throw error;

      const resultMsg: AssistantMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data?.ok
          ? `✅ Acción "${ACTION_LABELS[action.type] || action.type}" ejecutada correctamente.`
          : `❌ Error ejecutando acción: ${data?.error || "Error desconocido"}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, resultMsg]);

      if (data?.ok) {
        toast.success(`Acción ejecutada: ${ACTION_LABELS[action.type] || action.type}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Error";
      toast.error(`Error: ${errMsg}`);
    } finally {
      setExecutingAction(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="p-4 pb-2 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Atenia AI Assistant
          </SheetTitle>
          <SheetDescription className="text-xs">
            {scope === "WORK_ITEM" && workItemRadicado
              ? `Analizando: ${workItemRadicado}`
              : scope === "PLATFORM"
                ? "Modo plataforma"
                : "Asistente de la organización"}
          </SheetDescription>
        </SheetHeader>

        {/* Quick actions (only for WORK_ITEM scope on first load) */}
        {messages.length === 0 && scope === "WORK_ITEM" && (
          <div className="p-4 space-y-2 border-b">
            <p className="text-xs text-muted-foreground font-medium">Preguntas rápidas:</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_QUESTIONS.map((q) => (
                <Button
                  key={q.label}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  disabled={isLoading}
                  onClick={() => callAssistant(q.message, "DIAGNOSE_WORK_ITEM")}
                >
                  <Zap className="h-3 w-3 mr-1" />
                  {q.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <div className={`max-w-[85%] space-y-2 ${msg.role === "user" ? "order-first" : ""}`}>
                <div
                  className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground ml-auto"
                      : "bg-muted"
                  }`}
                >
                  {msg.content}
                </div>

                {/* Citations */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {msg.citations.map((c, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">
                        {c.source}: {c.note}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Proposed actions */}
                {msg.proposed_actions && msg.proposed_actions.length > 0 && (
                  <div className="space-y-2">
                    {msg.proposed_actions.map((action, i) => (
                      <Card key={i} className="border-dashed">
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {action.risk === "SAFE" ? (
                                <CheckCircle className="h-4 w-4 text-primary" />
                              ) : (
                                <Shield className="h-4 w-4 text-destructive" />
                              )}
                              <span className="text-sm font-medium">
                                {ACTION_LABELS[action.type] || action.type}
                              </span>
                              <Badge variant={action.risk === "SAFE" ? "secondary" : "outline"} className="text-[10px]">
                                {action.risk === "SAFE" ? "Seguro" : "Requiere confirmación"}
                              </Badge>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">{action.why}</p>
                          <Button
                            size="sm"
                            variant={action.risk === "SAFE" ? "default" : "outline"}
                            className="w-full text-xs"
                            disabled={!!executingAction}
                            onClick={() => handleExecuteAction(action)}
                          >
                            {executingAction === action.type ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : (
                              <Zap className="h-3 w-3 mr-1" />
                            )}
                            Ejecutar
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
              {msg.role === "user" && (
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-foreground/10 flex items-center justify-center">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-2 items-center">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary animate-pulse" />
              </div>
              <div className="bg-muted rounded-lg px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            </div>
          )}
        </div>

        {/* Confirmation modal (inline) */}
        {confirmingAction && (
          <div className="p-4 border-t bg-accent/50 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm font-medium">Confirmar acción</span>
            </div>
            <p className="text-xs text-muted-foreground">
              ¿Estás seguro de ejecutar "{ACTION_LABELS[confirmingAction.type] || confirmingAction.type}"?
            </p>
            <p className="text-xs">{confirmingAction.why}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={() => doExecuteAction(confirmingAction)}>
                Confirmar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmingAction(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pregunta a Atenia AI..."
              className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm min-h-[40px] max-h-[100px]"
              rows={1}
              disabled={isLoading}
            />
            <Button size="icon" onClick={handleSend} disabled={isLoading || !input.trim()}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
