/**
 * ContractDraftAIPanel — AI-assisted clause drafting for contract wizard.
 *
 * Side panel that generates legally appropriate Spanish drafts for:
 *   - Objeto del contrato (service scope) — 3 variants
 *   - Honorarios y forma de pago (fees) — 2 variants
 *
 * Follows the same pattern as FacultadesAIPanel but supports multi-variant output.
 */

import { useState, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  Check,
  AlertTriangle,
  MessageSquare,
  Copy,
  Pencil,
  FileText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type DraftField = "OBJETO" | "HONORARIOS";

interface Draft {
  title: string;
  text: string;
}

interface AIResult {
  drafts: Draft[];
  follow_up_question: string | null;
  assumptions: string[];
}

interface ContractDraftAIPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: DraftField;
  workItemId: string;
  wizardVariables: Record<string, string>;
  honorariosData?: any;
  serviceObject?: string;
  onApply: (text: string) => void;
}

const FIELD_LABELS: Record<DraftField, { title: string; description: string }> = {
  OBJETO: {
    title: "Objeto del Contrato",
    description: "Genera cláusulas de objeto del contrato adaptadas al tipo de proceso y contexto del expediente.",
  },
  HONORARIOS: {
    title: "Honorarios y Forma de Pago",
    description: "Genera cláusulas de honorarios y forma de pago con diferentes estructuras.",
  },
};

export function ContractDraftAIPanel({
  open,
  onOpenChange,
  field,
  workItemId,
  wizardVariables,
  honorariosData,
  serviceObject,
  onApply,
}: ContractDraftAIPanelProps) {
  const [userPrompt, setUserPrompt] = useState("");
  const [followUpAnswer, setFollowUpAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AIResult | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const [editMode, setEditMode] = useState(false);
  const [editedDraft, setEditedDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const labels = FIELD_LABELS[field];

  const generate = useCallback(
    async (regenerate = false, extraPrompt?: string) => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: fnErr } = await supabase.functions.invoke(
          "generate-contract-draft",
          {
            body: {
              doc_type: "contrato_servicios",
              field,
              context: {
                work_item_id: workItemId,
                wizard_variables: wizardVariables,
                honorarios_data: field === "HONORARIOS" ? honorariosData : undefined,
                service_object: field === "OBJETO" ? serviceObject : undefined,
              },
              user_prompt: extraPrompt || userPrompt || undefined,
              regenerate,
            },
          },
        );

        if (fnErr) throw fnErr;

        if (data?.error) {
          setError(data.error);
          return;
        }

        const aiResult = data as AIResult;
        setResult(aiResult);
        setSelectedIdx(0);

        if (aiResult.drafts.length > 0) {
          setEditedDraft(aiResult.drafts[0].text);
          setEditMode(false);
        }
      } catch (err: any) {
        const msg = err?.message || "Error al generar borrador";
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [workItemId, wizardVariables, userPrompt, field, honorariosData, serviceObject],
  );

  const handleApply = () => {
    const text = editMode ? editedDraft : result?.drafts[selectedIdx]?.text;
    if (text) {
      onApply(text);
      onOpenChange(false);
      toast.success(`${labels.title} aplicado al campo`);
    }
  };

  const handleFollowUpSubmit = () => {
    if (followUpAnswer.trim()) {
      generate(false, followUpAnswer.trim());
      setFollowUpAnswer("");
    }
  };

  const handleSelectDraft = (idx: number) => {
    setSelectedIdx(idx);
    setEditedDraft(result?.drafts[idx]?.text || "");
    setEditMode(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Andro IA — {labels.title}
          </SheetTitle>
          <SheetDescription>{labels.description}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 flex flex-col gap-4 mt-4 overflow-hidden">
          {/* User prompt */}
          {!result?.follow_up_question && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Instrucciones especiales (opcional)
              </label>
              <Textarea
                placeholder={
                  field === "OBJETO"
                    ? "Ej: Incluir medidas cautelares, enfocarse en proceso ejecutivo..."
                    : "Ej: Honorarios de $5.000.000, 50% al firmar y 50% al radicar..."
                }
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                rows={2}
                className="resize-none"
                disabled={loading}
              />
              <Button
                onClick={() => generate(false)}
                disabled={loading}
                className="w-full gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generando...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generar {labels.title}
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Follow-up question */}
          {result?.follow_up_question && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-amber-500/10 border-amber-500/30 p-4">
                <div className="flex items-start gap-2">
                  <MessageSquare className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      Andro IA necesita más información:
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {result.follow_up_question}
                    </p>
                  </div>
                </div>
              </div>
              <Textarea
                placeholder="Responde aquí..."
                value={followUpAnswer}
                onChange={(e) => setFollowUpAnswer(e.target.value)}
                rows={2}
                className="resize-none"
                disabled={loading}
              />
              <Button
                onClick={handleFollowUpSubmit}
                disabled={loading || !followUpAnswer.trim()}
                className="w-full gap-2"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Generar con esta información
              </Button>
            </div>
          )}

          {/* Generated drafts */}
          {result && result.drafts.length > 0 && (
            <div className="flex-1 flex flex-col gap-3 overflow-hidden">
              {/* Assumptions */}
              {result.assumptions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {result.assumptions.map((a, i) => (
                    <Badge key={i} variant="outline" className="text-xs text-amber-600 border-amber-300">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      {a}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Variant selector tabs */}
              {result.drafts.length > 1 && (
                <div className="flex gap-2 flex-wrap">
                  {result.drafts.map((d, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSelectDraft(i)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all border ${
                        selectedIdx === i
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                      }`}
                    >
                      <FileText className="h-3 w-3 inline mr-1" />
                      {d.title}
                    </button>
                  ))}
                </div>
              )}

              {/* Draft content */}
              <ScrollArea className="flex-1 border rounded-lg">
                <div className="p-4">
                  {editMode ? (
                    <Textarea
                      value={editedDraft}
                      onChange={(e) => setEditedDraft(e.target.value)}
                      rows={12}
                      className="resize-none border-0 p-0 focus-visible:ring-0 text-sm"
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed text-foreground">
                      {result.drafts[selectedIdx]?.text}
                    </pre>
                  )}
                </div>
              </ScrollArea>

              {/* Char count */}
              <div className="text-xs text-muted-foreground text-right">
                {(editMode ? editedDraft : result.drafts[selectedIdx]?.text || "").length} caracteres
              </div>

              <Separator />

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleApply} className="flex-1 gap-2">
                  <Check className="h-4 w-4" />
                  Aplicar al campo
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    if (editMode) {
                      setEditMode(false);
                    } else {
                      setEditedDraft(result.drafts[selectedIdx]?.text || "");
                      setEditMode(true);
                    }
                  }}
                  title={editMode ? "Ver borrador" : "Editar antes de aplicar"}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      editMode ? editedDraft : result.drafts[selectedIdx]?.text || "",
                    );
                    toast.success("Copiado al portapapeles");
                  }}
                  title="Copiar al portapapeles"
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => generate(true)}
                  disabled={loading}
                  className="gap-2"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  Regenerar
                </Button>
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <p className="text-[11px] text-muted-foreground leading-snug mt-auto">
            ⚠️ Contenido generado por IA. Revise y ajuste antes de aplicar. Las cláusulas
            deben ser verificadas por el abogado responsable. Los montos, fechas y hechos
            específicos NO son inventados por la IA — si no se proporcionaron, se usan marcadores.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
