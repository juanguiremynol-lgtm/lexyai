/**
 * Compose Dialog — Platform Email Console
 * Enqueues emails to email_outbox for provider-agnostic delivery.
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
import { Loader2, Send } from "lucide-react";
import { composePlatformEmail } from "@/lib/platform/email-console-service";
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
      onOpenChange(false);
      onSent?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Componer Email</DialogTitle>
          <DialogDescription>
            El email será encolado y enviado por el gateway configurado.
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
            <Label htmlFor="body">Mensaje</Label>
            <Textarea
              id="body"
              placeholder="Escribe el contenido del email..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
            />
          </div>
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
