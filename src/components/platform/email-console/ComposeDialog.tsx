/**
 * Compose Dialog — Platform Email Console
 * Enqueues emails to email_outbox with Atenia AI assistance.
 * Shows structured errors (validation / DB / RLS / trigger) instead of generic messages.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Send, Brain, Sparkles, CheckCircle, AlertTriangle, XCircle, RotateCcw,
} from "lucide-react";
import {
  composePlatformEmail,
  isComposeError,
  type ComposeError,
} from "@/lib/platform/email-console-service";
import { assistCompose, type AIComposeAssistResult } from "@/lib/platform/email-ai-service";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent?: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  validation: "Validación",
  insert: "Base de Datos",
  trigger: "Procesamiento",
  unknown: "Error",
};

export function ComposeDialog({ open, onOpenChange, onSent }: ComposeDialogProps) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIComposeAssistResult | null>(null);
  const [lastError, setLastError] = useState<ComposeError | null>(null);
  const [lastSuccessId, setLastSuccessId] = useState<string | null>(null);

  const resetState = () => {
    setTo("");
    setSubject("");
    setBody("");
    setAiResult(null);
    setLastError(null);
    setLastSuccessId(null);
  };

  const handleSend = async () => {
    setLastError(null);
    setLastSuccessId(null);

    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLastError({
          code: "NOT_AUTHENTICATED",
          message: "No hay sesión activa. Inicia sesión como Super Admin.",
          phase: "validation",
        });
        return;
      }

      const result = await composePlatformEmail(
        {
          to_email: to,
          subject,
          html: `<div>${body.replace(/\n/g, "<br/>")}</div>`,
        },
        user.id,
      );

      setLastSuccessId(result.id);
      toast.success(
        result.triggered
          ? "Email encolado y procesándose"
          : "Email encolado (se procesará en el próximo ciclo)",
      );

      // Delay reset so user sees success state
      setTimeout(() => {
        resetState();
        onOpenChange(false);
        onSent?.();
      }, 1500);
    } catch (err: unknown) {
      if (isComposeError(err)) {
        setLastError(err);
      } else {
        setLastError({
          code: "UNKNOWN",
          message: err instanceof Error ? err.message : "Error desconocido al enviar",
          phase: "unknown",
        });
      }
    } finally {
      setSending(false);
    }
  };

  const handleAiAssist = async () => {
    if (!body.trim()) {
      toast.error("Escribe algo primero para que Atenia AI lo mejore");
      return;
    }
    setAiLoading(true);
    try {
      const result = await assistCompose(to, subject, body);
      setAiResult(result);
      toast.success("Atenia AI analizó tu borrador");
    } catch (err) {
      toast.error("Error al consultar Atenia AI");
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  };

  const applyAiSuggestions = () => {
    if (!aiResult) return;
    setBody(aiResult.improved_body);
    if (aiResult.suggested_subject && (!subject || subject.trim() === "")) {
      setSubject(aiResult.suggested_subject);
    }
    toast.success("Sugerencias aplicadas");
    setAiResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetState(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Componer Email</DialogTitle>
          <DialogDescription>
            El email será encolado y enviado por el gateway configurado. Usa Atenia AI para mejorar tu redacción.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="to">Para</Label>
            <Input
              id="to"
              type="email"
              placeholder="destinatario@ejemplo.com"
              value={to}
              onChange={(e) => { setTo(e.target.value); setLastError(null); }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subject">Asunto</Label>
            <Input
              id="subject"
              placeholder="Asunto del email"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); setLastError(null); }}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="body">Mensaje</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleAiAssist}
                disabled={aiLoading || !body.trim()}
                className="gap-1.5 text-xs"
              >
                {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                Mejorar con IA
              </Button>
            </div>
            <Textarea
              id="body"
              placeholder="Escribe el contenido del email..."
              value={body}
              onChange={(e) => { setBody(e.target.value); setLastError(null); }}
              rows={8}
            />
          </div>

          {/* ── Success Banner ── */}
          {lastSuccessId && (
            <div className="flex items-center gap-2 p-3 rounded border border-green-500/30 bg-green-500/5">
              <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
              <div className="text-xs">
                <p className="font-medium text-green-500">Email encolado exitosamente</p>
                <p className="text-muted-foreground font-mono">ID: {lastSuccessId}</p>
              </div>
            </div>
          )}

          {/* ── Error Banner ── */}
          {lastError && (
            <div className="p-3 rounded border border-destructive/30 bg-destructive/5 space-y-2">
              <div className="flex items-start gap-2">
                <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-destructive">Error al enviar</span>
                    <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive">
                      {lastError.code}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      Fase: {PHASE_LABELS[lastError.phase]}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{lastError.message}</p>
                  {lastError.details && (
                    <pre className="text-[10px] text-muted-foreground mt-1 p-1.5 rounded bg-muted/50 overflow-x-auto font-mono max-h-20 overflow-y-auto">
                      {lastError.details}
                    </pre>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSend}
                disabled={sending}
                className="gap-1.5 text-xs w-full"
              >
                <RotateCcw className="h-3 w-3" /> Reintentar
              </Button>
            </div>
          )}

          {/* AI Suggestions */}
          {aiResult && (
            <div className="border rounded p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" /> Sugerencias de Atenia AI
                </span>
                <Button variant="ghost" size="sm" onClick={applyAiSuggestions} className="gap-1 text-xs">
                  <CheckCircle className="h-3 w-3" /> Aplicar
                </Button>
              </div>
              <Badge variant="outline" className="text-xs">Tono: {aiResult.tone_analysis}</Badge>
              {aiResult.suggested_subject && (
                <p className="text-xs text-muted-foreground">
                  <strong>Asunto sugerido:</strong> {aiResult.suggested_subject}
                </p>
              )}
              {aiResult.suggestions.length > 0 && (
                <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                  {aiResult.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
              <div className="text-xs border rounded p-2 max-h-32 overflow-y-auto bg-background">
                {aiResult.improved_body.slice(0, 500)}
                {aiResult.improved_body.length > 500 && "..."}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { resetState(); onOpenChange(false); }} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={sending || !!lastSuccessId}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
