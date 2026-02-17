/**
 * Compose Dialog — Platform Email Console
 * Enqueues emails to email_outbox with Atenia AI assistance.
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
import { Loader2, Send, Brain, Sparkles, CheckCircle } from "lucide-react";
import { composePlatformEmail } from "@/lib/platform/email-console-service";
import { assistCompose, type AIComposeAssistResult } from "@/lib/platform/email-ai-service";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent?: () => void;
}

export function ComposeDialog({ open, onOpenChange, onSent }: ComposeDialogProps) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIComposeAssistResult | null>(null);

  const handleSend = async () => {
    if (!to || !subject || !body) {
      toast.error("Completa todos los campos");
      return;
    }

    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      await composePlatformEmail(
        { to_email: to, subject, html: `<div>${body.replace(/\n/g, "<br/>")}</div>` },
        user.id
      );

      toast.success("Email encolado para envío");
      setTo("");
      setSubject("");
      setBody("");
      setAiResult(null);
      onOpenChange(false);
      onSent?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error al enviar");
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subject">Asunto</Label>
            <Input
              id="subject"
              placeholder="Asunto del email"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
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
              onChange={(e) => setBody(e.target.value)}
              rows={8}
            />
          </div>

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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
