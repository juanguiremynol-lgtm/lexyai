/**
 * MemorialGenerator — Inline panel for generating Memorial de Impulso Procesal.
 * Opens as a dialog from work item document menu. Generates text that the user
 * copies to clipboard and pastes into their own Word/email workflow.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Copy, FileText, Sparkles, History, ChevronDown, ChevronUp,
  Check, Loader2, Wand2, Bot,
} from "lucide-react";

import {
  MEMORIAL_TYPE_OPTIONS,
  getExtraFields,
  resolveMemorialVariables,
  generateMemorialText,
  generateMemorialHtml,
  type MemorialType,
  type MemorialVariables,
  type MemorialContext,
} from "@/lib/memorial-templates";
import type { WorkItemParty } from "@/lib/party-utils";
import type { WorkItem } from "@/types/work-item";

// ─── Props ──────────────────────────────────────────────

interface MemorialGeneratorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workItem: WorkItem;
}

// ─── Quick AI Suggestions ───────────────────────────────

const AI_QUICK_ACTIONS = [
  { label: "Hacer más formal", instruction: "Reescribe el cuerpo del memorial con un tono más formal y solemne, apropiado para un juzgado de alta jerarquía." },
  { label: "Hacer más urgente", instruction: "Agrega lenguaje de urgencia: menciona los términos vencidos, las consecuencias del retraso, y la afectación al derecho fundamental al acceso a la justicia." },
  { label: "Agregar hechos", instruction: "Agrega una sección breve de HECHOS antes de la petición, basándote en la información del caso proporcionada." },
  { label: "Simplificar", instruction: "Simplifica el texto: hazlo más corto, directo y fácil de leer sin perder formalidad legal." },
];

// ─── Component ──────────────────────────────────────────

export function MemorialGenerator({ open, onOpenChange, workItem }: MemorialGeneratorProps) {
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // State
  const [memorialType, setMemorialType] = useState<MemorialType>("impulso_general");
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [generatedText, setGeneratedText] = useState("");
  const [copied, setCopied] = useState<"plain" | "rich" | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [textBeforeAI, setTextBeforeAI] = useState<string | null>(null);

  // ─── Fetch profile ───────────────────────────────────
  const { data: profile } = useQuery({
    queryKey: ["memorial-profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("full_name, email, firma_abogado_nombre_completo, firma_abogado_cc, firma_abogado_tp, firma_abogado_correo, litigation_email, organization_id")
        .eq("id", user.id)
        .maybeSingle();
      return data;
    },
    staleTime: 60_000,
  });

  // ─── Fetch parties ──────────────────────────────────
  const { data: parties = [] } = useQuery({
    queryKey: ["memorial-parties", workItem.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("work_item_parties")
        .select("*")
        .eq("work_item_id", workItem.id)
        .order("display_order");
      return (data || []) as WorkItemParty[];
    },
  });

  // ─── Fetch history ──────────────────────────────────
  const { data: historyItems = [] } = useQuery({
    queryKey: ["memorial-history", workItem.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("memorial_history")
        .select("id, memorial_type, created_at, generated_text")
        .eq("work_item_id", workItem.id)
        .order("created_at", { ascending: false })
        .limit(10);
      return data || [];
    },
    enabled: open,
  });

  // ─── Resolve variables ─────────────────────────────
  const variables = useMemo<MemorialVariables>(() => {
    if (!profile) {
      return {
        judge_name: "", court_name: workItem.authority_name || "", court_city: workItem.authority_city || "",
        court_email: workItem.authority_email || "", radicado: workItem.radicado || "",
        plaintiff_names: workItem.demandantes || "—", defendant_names: workItem.demandados || "—",
        process_type: "civil", represented_side: "demandante",
        lawyer_full_name: "", lawyer_cedula: "", lawyer_tarjeta_profesional: "", lawyer_litigation_email: "",
      };
    }
    const ctx: MemorialContext = {
      workItem,
      parties,
      profile,
    };
    return resolveMemorialVariables(ctx);
  }, [workItem, parties, profile]);

  // ─── Generate text on type/extras/variables change ─
  useEffect(() => {
    const text = generateMemorialText(memorialType, variables, extras);
    setGeneratedText(text);
    setTextBeforeAI(null);
  }, [memorialType, variables, extras]);

  // ─── Reset extras when type changes ────────────────
  useEffect(() => {
    setExtras({});
  }, [memorialType]);

  // ─── Copy handlers ────────────────────────────────
  const handleCopyPlain = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(generatedText);
      setCopied("plain");
      setTimeout(() => setCopied(null), 2000);
      toast.success("Texto copiado al portapapeles");
    } catch {
      toast.error("Error al copiar");
    }
  }, [generatedText]);

  const handleCopyRich = useCallback(async () => {
    try {
      const html = generateMemorialHtml(memorialType, variables, extras);
      const blob = new Blob([html], { type: "text/html" });
      const plainBlob = new Blob([generatedText], { type: "text/plain" });
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": blob, "text/plain": plainBlob }),
      ]);
      setCopied("rich");
      setTimeout(() => setCopied(null), 2000);
      toast.success("Texto copiado con formato Word");
    } catch {
      // Fallback to plain text
      await navigator.clipboard.writeText(generatedText);
      setCopied("plain");
      setTimeout(() => setCopied(null), 2000);
      toast.success("Texto copiado (sin formato)");
    }
  }, [generatedText, memorialType, variables, extras]);

  // ─── Save to history on copy ──────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !profile?.organization_id) return;
      await supabase.from("memorial_history").insert({
        work_item_id: workItem.id,
        organization_id: profile.organization_id,
        created_by: user.id,
        memorial_type: memorialType,
        generated_text: generatedText,
        variables: { ...variables, ...extras } as any,
        ai_used: textBeforeAI !== null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memorial-history", workItem.id] });
    },
  });

  const handleCopyAndSave = useCallback(async (mode: "plain" | "rich") => {
    if (mode === "plain") await handleCopyPlain();
    else await handleCopyRich();
    saveMutation.mutate();
  }, [handleCopyPlain, handleCopyRich, saveMutation]);

  // ─── AI Enhancement ───────────────────────────────
  const handleAIEnhance = useCallback(async (instruction: string) => {
    if (!instruction.trim()) return;
    setAiLoading(true);
    setTextBeforeAI(generatedText);
    try {
      const { data, error } = await supabase.functions.invoke("atenia-ai-memorial", {
        body: {
          current_text: generatedText,
          instruction,
          context: {
            radicado: workItem.radicado,
            court_name: workItem.authority_name,
            workflow_type: workItem.workflow_type,
            parties: parties.map(p => ({ name: p.name, side: p.party_side, is_client: p.is_our_client })),
          },
        },
      });
      if (error) throw error;
      if (data?.enhanced_text) {
        setGeneratedText(data.enhanced_text);
        toast.success("Texto mejorado por Atenia AI");
      }
    } catch (err) {
      console.error("AI memorial error:", err);
      toast.error("Error al procesar con AI");
      setTextBeforeAI(null);
    } finally {
      setAiLoading(false);
      setAiInstruction("");
    }
  }, [generatedText, workItem, parties]);

  const handleUndoAI = useCallback(() => {
    if (textBeforeAI) {
      setGeneratedText(textBeforeAI);
      setTextBeforeAI(null);
      toast.info("Cambios de AI revertidos");
    }
  }, [textBeforeAI]);

  // ─── Load from history ────────────────────────────
  const handleReuseHistory = useCallback((text: string) => {
    setGeneratedText(text);
    setShowHistory(false);
    toast.info("Texto cargado del historial");
  }, []);

  // Extra fields for current type
  const extraFields = useMemo(() => getExtraFields(memorialType), [memorialType]);

  const typeOption = MEMORIAL_TYPE_OPTIONS.find(o => o.value === memorialType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Memorial de Impulso Procesal
          </DialogTitle>
          <DialogDescription>
            {workItem.radicado && (
              <span className="font-mono text-xs">{workItem.radicado}</span>
            )}
            {workItem.authority_name && (
              <span className="ml-2 text-xs">{workItem.authority_name}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Type selector */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Tipo de impulso</label>
            <Select value={memorialType} onValueChange={(v) => setMemorialType(v as MemorialType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMORIAL_TYPE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex flex-col items-start">
                      <span>{opt.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {typeOption && (
              <p className="text-xs text-muted-foreground mt-1">{typeOption.description}</p>
            )}
          </div>

          {/* Extra fields for this type */}
          {extraFields.length > 0 && (
            <div className="space-y-3 rounded-lg border border-border p-3 bg-muted/20">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Campos adicionales</p>
              {extraFields.map(field => (
                <div key={field.key}>
                  <label className="text-sm font-medium mb-1 block">
                    {field.label} {field.required && <span className="text-destructive">*</span>}
                  </label>
                  {field.type === "select" ? (
                    <Select
                      value={extras[field.key] || ""}
                      onValueChange={(v) => setExtras(prev => ({ ...prev, [field.key]: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options?.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : field.type === "date" ? (
                    <Input
                      type="date"
                      value={extras[field.key] || ""}
                      onChange={(e) => setExtras(prev => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  ) : (
                    <Input
                      placeholder={field.placeholder}
                      value={extras[field.key] || ""}
                      onChange={(e) => setExtras(prev => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Generated text (editable) */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Texto generado</label>
            <Textarea
              ref={textareaRef}
              value={generatedText}
              onChange={(e) => setGeneratedText(e.target.value)}
              className="min-h-[350px] font-mono text-sm leading-relaxed"
              placeholder="El texto del memorial se generará aquí..."
            />
          </div>

          {/* AI undo banner */}
          {textBeforeAI && (
            <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="text-sm flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                Atenia AI aplicó cambios al texto
              </span>
              <Button variant="outline" size="sm" onClick={handleUndoAI}>
                Deshacer
              </Button>
            </div>
          )}

          {/* AI Assistance (collapsible) */}
          <Collapsible open={showAI} onOpenChange={setShowAI}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  Atenia AI — Ayuda con la redacción
                </span>
                {showAI ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <div className="flex flex-wrap gap-2">
                {AI_QUICK_ACTIONS.map(action => (
                  <Button
                    key={action.label}
                    variant="outline"
                    size="sm"
                    disabled={aiLoading}
                    onClick={() => handleAIEnhance(action.instruction)}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Describa lo que necesita cambiar..."
                  value={aiInstruction}
                  onChange={(e) => setAiInstruction(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAIEnhance(aiInstruction); } }}
                  disabled={aiLoading}
                />
                <Button
                  size="sm"
                  disabled={aiLoading || !aiInstruction.trim()}
                  onClick={() => handleAIEnhance(aiInstruction)}
                >
                  {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  Aplicar
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => handleCopyAndSave("plain")} className="gap-2">
              {copied === "plain" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied === "plain" ? "¡Copiado!" : "Copiar texto"}
            </Button>
            <Button variant="outline" onClick={() => handleCopyAndSave("rich")} className="gap-2">
              {copied === "rich" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied === "rich" ? "¡Copiado!" : "Copiar como formato Word"}
            </Button>

            <div className="flex-1" />

            {/* History toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHistory(!showHistory)}
              className="gap-1 text-muted-foreground"
            >
              <History className="h-4 w-4" />
              Historial {historyItems.length > 0 && `(${historyItems.length})`}
            </Button>
          </div>

          {/* History panel */}
          {showHistory && (
            <div className="rounded-lg border border-border p-3 space-y-2 bg-muted/10">
              <p className="text-sm font-medium">Historial de memoriales</p>
              {historyItems.length === 0 ? (
                <p className="text-xs text-muted-foreground">No hay memoriales anteriores para este expediente.</p>
              ) : (
                historyItems.map(item => {
                  const typeLabel = MEMORIAL_TYPE_OPTIONS.find(o => o.value === item.memorial_type)?.label || item.memorial_type;
                  return (
                    <div key={item.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/40 transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate">{typeLabel}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {format(new Date(item.created_at), "d MMM yyyy, h:mm a", { locale: es })}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs shrink-0"
                        onClick={() => handleReuseHistory(item.generated_text)}
                      >
                        Reusar
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
