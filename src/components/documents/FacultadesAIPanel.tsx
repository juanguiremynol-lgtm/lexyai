/**
 * FacultadesAIPanel — AI-assisted Facultades drafting panel for POA wizard.
 *
 * Side panel that generates legally appropriate facultades using Andro IA (Gemini).
 * Scoped strictly to the Facultades field — not a general chatbot.
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
import {
  Sparkles,
  Loader2,
  RefreshCw,
  Check,
  AlertTriangle,
  MessageSquare,
  Copy,
  Pencil,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface FacultadesAIPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workItemId: string;
  wizardState: Record<string, string>;
  onApply: (facultades: string) => void;
}

interface AIResult {
  draftText: string | null;
  assumptions: string[];
  followUpQuestion: string | null;
}

export function FacultadesAIPanel({
  open,
  onOpenChange,
  workItemId,
  wizardState,
  onApply,
}: FacultadesAIPanelProps) {
  const [userPrompt, setUserPrompt] = useState("");
  const [followUpAnswer, setFollowUpAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AIResult | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedDraft, setEditedDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (regenerate = false, extraPrompt?: string) => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: fnErr } = await supabase.functions.invoke(
          "generate-facultades-draft",
          {
            body: {
              workItemId,
              wizardState,
              userPrompt: extraPrompt || userPrompt || undefined,
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

        if (aiResult.draftText) {
          setEditedDraft(aiResult.draftText);
          setEditMode(false);
        }
      } catch (err: any) {
        const msg = err?.message || "Error al generar facultades";
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [workItemId, wizardState, userPrompt],
  );

  const handleApply = () => {
    const text = editMode ? editedDraft : result?.draftText;
    if (text) {
      onApply(text);
      onOpenChange(false);
      toast.success("Facultades aplicadas al campo");
    }
  };

  const handleFollowUpSubmit = () => {
    if (followUpAnswer.trim()) {
      generate(false, followUpAnswer.trim());
      setFollowUpAnswer("");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Andro IA — Facultades
          </SheetTitle>
          <SheetDescription>
            Genera una cláusula de facultades adaptada al contexto de tu poder especial.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 flex flex-col gap-4 mt-4 overflow-hidden">
          {/* User prompt (optional special instructions) */}
          {!result?.followUpQuestion && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Instrucciones especiales (opcional)
              </label>
              <Textarea
                placeholder="Ej: Incluir facultad de sustituir poder, no incluir facultad de recibir dineros..."
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
                    Generar Facultades
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

          {/* Follow-up question from AI */}
          {result?.followUpQuestion && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-amber-500/10 border-amber-500/30 p-4">
                <div className="flex items-start gap-2">
                  <MessageSquare className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      Andro IA necesita más información:
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {result.followUpQuestion}
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

          {/* Generated draft */}
          {result?.draftText && (
            <div className="flex-1 flex flex-col gap-3 overflow-hidden">
              {/* Assumptions badges */}
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

              {/* Draft content */}
              <ScrollArea className="flex-1 border rounded-lg">
                <div className="p-4">
                  {editMode ? (
                    <Textarea
                      value={editedDraft}
                      onChange={(e) => setEditedDraft(e.target.value)}
                      rows={14}
                      className="resize-none border-0 p-0 focus-visible:ring-0 text-sm"
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed text-foreground">
                      {result.draftText}
                    </pre>
                  )}
                </div>
              </ScrollArea>

              {/* Character count */}
              <div className="text-xs text-muted-foreground text-right">
                {(editMode ? editedDraft : result.draftText).length} / 2000 caracteres
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
                      setEditedDraft(result.draftText!);
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
                      editMode ? editedDraft : result.draftText!,
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
            ⚠️ Contenido generado por IA. Revise y ajuste antes de aplicar. Las facultades deben ser
            verificadas por el abogado responsable para asegurar conformidad con el caso específico.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
