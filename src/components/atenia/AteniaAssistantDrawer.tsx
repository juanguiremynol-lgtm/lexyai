/**
 * AteniaAssistantDrawer — Unified Atenia AI interface.
 *
 * Merges the former "Preguntar a Atenia" chat and "Reportar a Atenia AI" dialog
 * into a single right-side drawer with two modes:
 *   - Chat: ask questions, get AI answers, execute proposed actions
 *   - Report: structured issue report with auto-diagnosis, Gemini analysis, submit
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { BubbleContext } from "@/components/atenia-mascot/mascot-bubbles";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Send,
  Bot,
  User,
  Zap,
  AlertTriangle,
  CheckCircle,
  Shield,
  MessageSquare,
  FileWarning,
  Search,
  Brain,
  ClipboardCopy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import {
  generateAutoDiagnosis,
  submitUserReport,
  type AutoDiagnosis,
} from "@/lib/services/atenia-ai-autonomous";
import { callGeminiViaEdge } from "@/lib/services/atenia-ai-engine";
import { buildAteniaAiTechnicalReport } from "@/lib/services/atenia-ai-technical-report";
import { toast } from "sonner";
import { AteniaWelcomeView } from "@/components/atenia-mascot/AteniaWelcomeView";

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
  initialMessage?: string;
  mascotContexts?: BubbleContext[];
}

type DrawerTab = "chat" | "report";

const ACTION_LABELS: Record<string, string> = {
  RUN_SYNC_WORK_ITEM: "Ejecutar sincronización",
  RUN_SYNC_PUBLICACIONES_WORK_ITEM: "Sincronizar publicaciones",
  TOGGLE_MONITORING: "Cambiar monitoreo",
  RUN_MASTER_SYNC_SCOPE: "Sincronización masiva",
  ESCALATE_TO_ADMIN_QUEUE: "Escalar a administrador",
  CREATE_USER_REPORT: "Crear reporte",
  TOGGLE_TICKER: "Cambiar ticker de estados",
  GET_BILLING_SUMMARY: "Ver resumen de facturación",
  GET_SUBSCRIPTION_STATUS: "Ver estado de suscripción",
  INVITE_USER_TO_ORG: "Invitar usuario a organización",
  REMOVE_USER_FROM_ORG: "Eliminar usuario de organización",
  CHANGE_MEMBER_ROLE: "Cambiar rol de miembro",
  ORG_USAGE_SUMMARY: "Resumen de uso de la organización",
  CREATE_SUPPORT_TICKET: "Crear ticket de soporte",
  EXPLAIN_CURRENT_PAGE: "Explicar esta página",
  GET_ANALYTICS_STATUS: "Ver estado de analíticas",
  UPDATE_ORG_ANALYTICS: "Cambiar analíticas de organización",
};

const QUICK_QUESTIONS = [
  { label: "¿Por qué no se actualiza?", message: "¿Por qué este proceso no se está actualizando? Analiza los traces recientes y el estado de monitoreo." },
  { label: "Resumen del proceso", message: "Resume este asunto y sus últimas actuaciones. Incluye ficha del proceso, últimas actuaciones y acciones recomendadas." },
  { label: "¿Qué debo hacer?", message: "Basado en el estado actual de este proceso, ¿qué acciones debería tomar? Sugiere pasos concretos." },
];

export function AteniaAssistantDrawer({
  open,
  onOpenChange,
  scope,
  workItemId,
  workItemRadicado,
  initialMessage,
  mascotContexts,
}: AteniaAssistantDrawerProps) {
  const { organization } = useOrganization();

  // Shared
  const [activeTab, setActiveTab] = useState<DrawerTab>("chat");

  // Chat state
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [confirmingAction, setConfirmingAction] = useState<ProposedAction | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Report state
  const [reportDescription, setReportDescription] = useState("");
  const [reportType, setReportType] = useState("sync_issue");
  const [diagnosis, setDiagnosis] = useState<AutoDiagnosis | null>(null);
  const [geminiAnalysis, setGeminiAnalysis] = useState<string | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [isEscalating, setIsEscalating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Reset when drawer opens
  useEffect(() => {
    if (open) {
      setMessages([]);
      setSessionId(null);
      setInput(initialMessage ?? "");
      setConfirmingAction(null);
      setActiveTab("chat");
      // Reset report state
      setReportDescription("");
      setReportType("sync_issue");
      setDiagnosis(null);
      setGeminiAnalysis(null);
      setSubmitted(false);

      // Auto-send initial message if provided
      if (initialMessage) {
        setTimeout(() => {
          callAssistant(initialMessage);
          setInput("");
        }, 300);
      }
    }
  }, [open, workItemId]);

  // Auto-diagnosis when switching to report tab
  useEffect(() => {
    if (activeTab === "report" && workItemId && !diagnosis && !isDiagnosing) {
      runDiagnosis();
    }
  }, [activeTab, workItemId]);

  // ---- Chat logic ----

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
        body: { mode, message, scope, work_item_id: workItemId, session_id: sessionId },
      });
      if (error) throw error;
      if (data?.session_id && !sessionId) setSessionId(data.session_id);

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
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `❌ Error: ${errMsg}`,
        timestamp: new Date(),
      }]);
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
        body: { mode: "EXECUTE", action: { type: action.type, params: action.params }, confirmed: true, scope, work_item_id: workItemId, session_id: sessionId },
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
      if (data?.ok) toast.success(`Acción ejecutada: ${ACTION_LABELS[action.type] || action.type}`);
    } catch (err: unknown) {
      toast.error(`Error: ${err instanceof Error ? err.message : "Error"}`);
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

  // ---- Report logic ----

  const runDiagnosis = async () => {
    if (!workItemId) return;
    setIsDiagnosing(true);
    try {
      const result = await generateAutoDiagnosis(workItemId);
      setDiagnosis(result);
    } catch (err) {
      console.error("[AteniaAssistant] Diagnosis failed:", err);
    } finally {
      setIsDiagnosing(false);
    }
  };

  const escalateToGemini = async () => {
    if (!diagnosis) return;
    setIsEscalating(true);
    try {
      const prompt = `Eres Andro IA. Un usuario reportó un problema con el radicado ${diagnosis.radicado || "desconocido"}.

CONTEXTO:
- Tipo: ${diagnosis.workflow_type}
- Última sync: ${diagnosis.last_synced_at || "NUNCA"}
- Actuaciones: ${diagnosis.actuaciones_count}
- Estados: ${diagnosis.publicaciones_count}
- Errores recientes: ${diagnosis.sync_traces_recent.filter((t: any) => !t.success).map((t: any) => t.error_code).join(", ") || "ninguno"}

DESCRIPCIÓN DEL USUARIO:
${reportDescription || "Sin descripción"}

DIAGNÓSTICO AUTOMÁTICO:
${diagnosis.diagnosis_summary}

Genera un análisis breve (máximo 3 oraciones) y una recomendación.`;

      const result = await callGeminiViaEdge(prompt);
      setGeminiAnalysis(result);
    } catch {
      setGeminiAnalysis("No se pudo conectar con Gemini.");
    } finally {
      setIsEscalating(false);
    }
  };

  const handleCopyReport = async () => {
    if (!diagnosis) return;
    const report = buildAteniaAiTechnicalReport(diagnosis, geminiAnalysis, reportDescription || undefined);
    try {
      await navigator.clipboard.writeText(report);
      toast.success("Diagnóstico técnico copiado al portapapeles");
    } catch {
      toast.error("No se pudo copiar al portapapeles");
    }
  };

  const handleSubmitReport = async () => {
    if (!organization?.id || !reportDescription.trim()) return;
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      await submitUserReport({
        organizationId: organization.id,
        reporterUserId: user.id,
        workItemId: workItemId || undefined,
        reportType,
        description: reportDescription.trim(),
        autoDiagnosis: diagnosis || undefined,
      });
      setSubmitted(true);
      toast.success("Reporte enviado a Andro IA", {
        description: "Tu reporte será analizado y se tomarán acciones correctivas si es necesario.",
      });
    } catch (err: any) {
      toast.error("Error al enviar reporte: " + (err.message || "Error desconocido"));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- Render ----

  // Debug: log open state changes
  console.log("[AteniaAssistantDrawer] render, open=", open, "scope=", scope);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0 z-[70] bg-background"
        style={{ background: 'var(--ds-glass-bg-strong, hsl(var(--background)))' }}>

        {/* Header */}
        <SheetHeader className="p-4 pb-2 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Andro IA — Asistente
          </SheetTitle>
          <SheetDescription className="text-xs">
            {scope === "WORK_ITEM" && workItemRadicado
              ? `Analizando: ${workItemRadicado}`
              : scope === "PLATFORM"
                ? "Modo plataforma"
                : "Tu asistente de cuenta y organización"}
          </SheetDescription>
        </SheetHeader>

        {/* Tab switcher */}
        <div className="flex border-b">
          <button
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "chat"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("chat")}
          >
            <MessageSquare className="h-4 w-4" />
            Chat
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "report"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("report")}
          >
            <FileWarning className="h-4 w-4" />
            Reportar problema
          </button>
        </div>

        {/* ---- CHAT TAB ---- */}
        {activeTab === "chat" && (
          <>
            {/* Welcome view with capabilities + chips on first load */}
            {messages.length === 0 && (
              <AteniaWelcomeView
                contexts={mascotContexts ?? (scope === "WORK_ITEM" ? ["WORK_ITEM_DETAIL"] : ["GLOBAL"])}
                onSelectPrompt={(prompt) => {
                  setInput(prompt);
                  // Auto-send immediately
                  setTimeout(() => {
                    callAssistant(prompt, scope === "WORK_ITEM" ? "DIAGNOSE_WORK_ITEM" : "CHAT");
                  }, 100);
                }}
              />
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
                  placeholder="Pregunta a Andro IA..."
                  className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm min-h-[40px] max-h-[100px]"
                  rows={1}
                  disabled={isLoading}
                />
                <Button size="icon" onClick={handleSend} disabled={isLoading || !input.trim()}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ---- REPORT TAB ---- */}
        {activeTab === "report" && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {submitted ? (
              <div className="py-8 text-center space-y-3">
                <CheckCircle className="h-10 w-10 text-primary mx-auto" />
                <p className="text-sm font-medium">Reporte enviado exitosamente</p>
                <p className="text-xs text-muted-foreground">
                  Tu reporte será analizado por Andro IA. Si se requiere acción correctiva, se ejecutará automáticamente.
                </p>
                <div className="flex justify-center gap-2">
                  {diagnosis && (
                    <Button variant="outline" size="sm" onClick={handleCopyReport} className="gap-2">
                      <ClipboardCopy className="h-3.5 w-3.5" />
                      Copiar diagnóstico
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => { setSubmitted(false); setReportDescription(""); }}>
                    Nuevo reporte
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* Radicado badge */}
                {workItemRadicado && (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">
                      {workItemRadicado}
                    </Badge>
                  </div>
                )}

                {/* Report type */}
                <Select value={reportType} onValueChange={setReportType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sync_issue">Problema de sincronización</SelectItem>
                    <SelectItem value="missing_data">Datos faltantes o incorrectos</SelectItem>
                    <SelectItem value="stage_incorrect">Etapa procesal incorrecta</SelectItem>
                    <SelectItem value="alert_missing">No recibí alerta esperada</SelectItem>
                    <SelectItem value="other">Otro</SelectItem>
                  </SelectContent>
                </Select>

                {/* Description */}
                <Textarea
                  placeholder="Describe el problema que estás experimentando..."
                  value={reportDescription}
                  onChange={(e) => setReportDescription(e.target.value)}
                  rows={3}
                />

                {/* Auto-diagnosis */}
                {workItemId && (
                  <Card className="border-dashed">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Search className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Diagnóstico Automático</span>
                        {isDiagnosing && <Loader2 className="h-3 w-3 animate-spin" />}
                      </div>
                      {diagnosis ? (
                        <div className="text-xs space-y-1 whitespace-pre-line text-muted-foreground">
                          {diagnosis.diagnosis_summary.split("\n").map((line, i) => (
                            <div key={i} className="flex items-start gap-1">
                              {line.startsWith("✅") && <CheckCircle className="h-3 w-3 text-primary mt-0.5 shrink-0" />}
                              {(line.startsWith("⚠️") || line.startsWith("🔴") || line.startsWith("🟡")) && (
                                <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                              )}
                              <span>{line.replace(/^[✅⚠️🔴🟡]\s*/, "")}</span>
                            </div>
                          ))}
                          <div className="mt-2 flex gap-3 text-[10px]">
                            <span>Actuaciones: {diagnosis.actuaciones_count}</span>
                            <span>Estados: {diagnosis.publicaciones_count}</span>
                            <span>Trazas: {diagnosis.sync_traces_recent.length}</span>
                          </div>
                          <div className="mt-3 flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={escalateToGemini}
                              disabled={isEscalating}
                              className="text-xs gap-1 h-7"
                            >
                              {isEscalating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                              Análisis AI
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleCopyReport}
                              className="text-xs gap-1 h-7"
                            >
                              <ClipboardCopy className="h-3 w-3" />
                              Copiar diagnóstico
                            </Button>
                          </div>
                        </div>
                      ) : !isDiagnosing ? (
                        <Button variant="ghost" size="sm" onClick={runDiagnosis} className="text-xs">
                          Ejecutar diagnóstico
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                )}

                {/* Gemini Analysis */}
                {geminiAnalysis && (
                  <Card className="border-primary/20">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Brain className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">Análisis de Andro IA</span>
                      </div>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{geminiAnalysis}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Submit */}
                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1 gap-2"
                    onClick={handleSubmitReport}
                    disabled={isSubmitting || !reportDescription.trim()}
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Enviar reporte
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
