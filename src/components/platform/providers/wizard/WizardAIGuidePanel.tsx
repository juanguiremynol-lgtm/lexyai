/**
 * WizardAIGuidePanel — Right-side Gemini AI assistant for the provider wizard.
 * Provides step-specific guidance, misconfiguration detection, and free-form Q&A.
 * Never sends secrets to Gemini.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Send, Loader2, AlertTriangle, CheckCircle2, Info, Copy, ShieldAlert, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { WizardMode, WizardState } from "./WizardTypes";

interface WizardAIGuidePanelProps {
  mode: WizardMode;
  wizardState: WizardState;
  stepId: string;
}

interface AIGuidance {
  session_id?: string;
  step_id?: string;
  diagnosis?: { status: string; reasons: string[] };
  recommended_actions?: Array<{ type: string; path?: string; value?: unknown; why: string }>;
  security_warnings?: Array<{ code: string; message: string }>;
  routing_advice?: { strategy?: string; why?: string };
  mapping_advice?: { suggestion?: string; why?: string };
  explanation?: string;
  next_questions?: string[];
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  guidance?: AIGuidance;
  timestamp: Date;
}

export function WizardAIGuidePanel({ mode, wizardState, stepId }: WizardAIGuidePanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastStepRef = useRef<string>("");

  // Auto-fire on step change
  useEffect(() => {
    if (stepId !== lastStepRef.current) {
      lastStepRef.current = stepId;
      fetchGuidance();
    }
  }, [stepId]);

  const fetchGuidance = useCallback(async (question?: string) => {
    setIsLoading(true);
    try {
      // Redact secrets client-side before sending
      const safeState = {
        mode: wizardState.mode,
        step: wizardState.step,
        templateChoice: wizardState.templateChoice,
        connector: wizardState.connector ? {
          id: wizardState.connector.id,
          name: wizardState.connector.name,
          capabilities: wizardState.connector.capabilities,
          allowed_domains: wizardState.connector.allowed_domains,
          schema_version: wizardState.connector.schema_version,
          is_enabled: wizardState.connector.is_enabled,
          visibility: wizardState.connector.visibility,
        } : null,
        instance: wizardState.instance ? {
          id: wizardState.instance.id,
          name: wizardState.instance.name,
          auth_type: wizardState.instance.auth_type,
          timeout_ms: wizardState.instance.timeout_ms,
          rpm_limit: wizardState.instance.rpm_limit,
          is_enabled: wizardState.instance.is_enabled,
          // base_url included (not secret)
          base_url: wizardState.instance.base_url,
        } : null,
        preflightPassed: wizardState.preflightPassed,
        routingConfigured: wizardState.routingConfigured,
        wildcardAcknowledged: wizardState.wildcardAcknowledged,
        globalAcknowledged: wizardState.globalAcknowledged,
      };

      if (question) {
        setMessages((prev) => [...prev, { role: "user", content: question, timestamp: new Date() }]);
      }

      const { data, error } = await supabase.functions.invoke("provider-wizard-ai-guide", {
        body: {
          session_id: sessionId,
          mode,
          step_id: stepId,
          wizard_state: safeState,
          preflight: wizardState.preflightResult,
          e2e_result: wizardState.e2eResult,
          question,
        },
      });

      if (error) throw error;

      if (data?.session_id) setSessionId(data.session_id);

      const guidance: AIGuidance = data || {};
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: guidance.explanation || "Análisis completado.",
        guidance,
        timestamp: new Date(),
      }]);
    } catch (err: any) {
      const msg = err?.message || "Error al consultar la guía AI";
      if (err?.status === 429) {
        toast.error("Límite de consultas alcanzado. Intente en unos minutos.");
      } else if (err?.status === 402) {
        toast.error("Créditos de IA agotados.");
      } else {
        toast.error(msg);
      }
    } finally {
      setIsLoading(false);
    }
  }, [wizardState, mode, stepId, sessionId]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    const q = input.trim();
    setInput("");
    fetchGuidance(q);
  };

  const handleQuickAction = (question: string) => {
    fetchGuidance(question);
  };

  const copyDiagnostic = () => {
    const lastGuidance = messages.filter((m) => m.guidance).pop()?.guidance;
    if (lastGuidance) {
      navigator.clipboard.writeText(JSON.stringify(lastGuidance, null, 2));
      toast.success("Diagnóstico copiado");
    }
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const lastGuidance = messages.filter((m) => m.guidance).pop()?.guidance;
  const diagStatus = lastGuidance?.diagnosis?.status;

  return (
    <div className="bg-card border border-border/50 rounded-xl overflow-hidden flex flex-col">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors w-full text-left"
      >
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Guía AI</span>
          {diagStatus && (
            <Badge variant="outline" className={`text-[10px] ${
              diagStatus === "OK" ? "text-primary border-primary/30" :
              diagStatus === "WARN" ? "text-amber-500 border-amber-500/30" :
              "text-destructive border-destructive/30"
            }`}>
              {diagStatus}
            </Badge>
          )}
          {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {isExpanded && (
        <>
          {/* Quick actions */}
          <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-border/30">
            <Button size="sm" variant="ghost" className="text-[10px] h-6 px-2" onClick={() => handleQuickAction("Explica este paso del wizard")}>
              <Info className="h-3 w-3 mr-1" /> Explicar paso
            </Button>
            <Button size="sm" variant="ghost" className="text-[10px] h-6 px-2" onClick={() => handleQuickAction("¿Por qué está bloqueado el botón Siguiente?")}>
              <ShieldAlert className="h-3 w-3 mr-1" /> ¿Por qué bloqueado?
            </Button>
            <Button size="sm" variant="ghost" className="text-[10px] h-6 px-2" onClick={() => handleQuickAction("Explica el impacto del routing actual")}>
              <Sparkles className="h-3 w-3 mr-1" /> Impacto routing
            </Button>
            {lastGuidance && (
              <Button size="sm" variant="ghost" className="text-[10px] h-6 px-2" onClick={copyDiagnostic}>
                <Copy className="h-3 w-3 mr-1" /> Copiar diagnóstico
              </Button>
            )}
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 max-h-[400px]">
            <div className="p-3 space-y-3">
              {messages.length === 0 && !isLoading && (
                <div className="text-center py-6 space-y-2">
                  <Bot className="h-8 w-8 text-muted-foreground mx-auto" />
                  <p className="text-xs text-muted-foreground">
                    La Guía AI analizará cada paso y responderá tus preguntas sobre la configuración.
                  </p>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`text-xs ${msg.role === "user" ? "text-right" : ""}`}>
                  {msg.role === "user" ? (
                    <div className="inline-block bg-primary/10 text-foreground rounded-lg px-3 py-2 max-w-[85%]">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* Diagnosis badge */}
                      {msg.guidance?.diagnosis && (
                        <div className="flex items-center gap-1.5">
                          {msg.guidance.diagnosis.status === "OK" && <CheckCircle2 className="h-3 w-3 text-primary" />}
                          {msg.guidance.diagnosis.status === "WARN" && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                          {msg.guidance.diagnosis.status === "BLOCK" && <ShieldAlert className="h-3 w-3 text-destructive" />}
                          <span className="font-medium text-foreground">{msg.guidance.diagnosis.status}</span>
                          {msg.guidance.diagnosis.reasons?.map((r, j) => (
                            <span key={j} className="text-muted-foreground">• {r}</span>
                          ))}
                        </div>
                      )}

                      {/* Explanation */}
                      <p className="text-foreground/80 leading-relaxed">{msg.content}</p>

                      {/* Security warnings */}
                      {msg.guidance?.security_warnings?.map((w, j) => (
                        <div key={j} className="flex items-start gap-1.5 bg-destructive/5 border border-destructive/20 rounded p-2">
                          <ShieldAlert className="h-3 w-3 text-destructive mt-0.5 shrink-0" />
                          <span className="text-destructive/80">{w.message}</span>
                        </div>
                      ))}

                      {/* Recommended actions */}
                      {msg.guidance?.recommended_actions?.map((a, j) => (
                        <div key={j} className="flex items-start gap-1.5 bg-primary/5 border border-primary/20 rounded p-2">
                          <Sparkles className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                          <div>
                            <span className="font-medium text-foreground">{a.type}</span>
                            <span className="text-muted-foreground ml-1">— {a.why}</span>
                          </div>
                        </div>
                      ))}

                      {/* Next questions */}
                      {msg.guidance?.next_questions && msg.guidance.next_questions.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {msg.guidance.next_questions.map((q, j) => (
                            <button
                              key={j}
                              onClick={() => handleQuickAction(q)}
                              className="text-[10px] bg-muted/40 hover:bg-muted/60 text-foreground/70 rounded px-2 py-1 transition-colors"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Analizando...
                </div>
              )}

              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="p-2 border-t border-border/30 flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Pregunta sobre este paso..."
              className="text-xs h-8"
              disabled={isLoading}
            />
            <Button size="sm" className="h-8 px-2" onClick={handleSend} disabled={isLoading || !input.trim()}>
              <Send className="h-3 w-3" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
