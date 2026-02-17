import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Reply, ReplyAll, Forward, Archive, Trash2, Paperclip, ArrowLeft, Bot, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import DOMPurify from "dompurify";
import type { MockEmail } from "./email-client-types";

interface EmailDetailProps {
  email: MockEmail;
  onBack?: () => void;
}

/** Dispatch event to open Andro IA with email context pre-filled */
function openAndroWithEmail(email: MockEmail, action: "register" | "diagnose" | "ticket") {
  const actionLabels = {
    register: "Registra este email en el sistema",
    diagnose: "Diagnostica el contenido de este email",
    ticket: "Crea un ticket de soporte basado en este email",
  };

  const prompt = `${actionLabels[action]}:

📧 De: ${email.from.name} <${email.from.email}>
📋 Asunto: ${email.subject}
📅 Fecha: ${email.date}
📝 Contenido: ${email.preview}

Email dirigido a: info@andromeda.legal`;

  // Dispatch mascot open event with prefilled prompt
  window.dispatchEvent(
    new CustomEvent("atenia:open-with-prompt", { detail: { prompt } })
  );
}

export function EmailDetail({ email, onBack }: EmailDetailProps) {
  const sanitizedHtml = DOMPurify.sanitize(email.htmlBody, {
    ALLOWED_TAGS: ["div", "p", "br", "strong", "em", "a", "ul", "ol", "li", "h1", "h2", "h3", "span", "b", "i", "u", "table", "tr", "td", "th", "thead", "tbody", "img"],
    ALLOWED_ATTR: ["href", "target", "style", "class", "src", "alt"],
  });

  const handleAction = (action: string) => {
    toast.info(`${action} — Funcionalidad próximamente disponible`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center gap-2">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <h2 className="text-lg font-semibold flex-1 truncate">{email.subject}</h2>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 text-sm min-w-0">
            <p>
              <span className="font-medium">{email.from.name}</span>
              <span className="text-muted-foreground ml-1">&lt;{email.from.email}&gt;</span>
            </p>
            <p className="text-muted-foreground text-xs">
              Para: info@andromeda.legal
              {email.cc && email.cc.length > 0 && <> · CC: {email.cc.join(", ")}</>}
            </p>
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {format(new Date(email.date), "PPpp", { locale: es })}
          </span>
        </div>

        {/* Email Actions */}
        <div className="flex gap-1 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => handleAction("Responder")}>
            <Reply className="h-3.5 w-3.5 mr-1" /> Responder
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleAction("Responder a todos")}>
            <ReplyAll className="h-3.5 w-3.5 mr-1" /> Resp. todos
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleAction("Reenviar")}>
            <Forward className="h-3.5 w-3.5 mr-1" /> Reenviar
          </Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => handleAction("Archivar")}>
            <Archive className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleAction("Eliminar")}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Andro IA Integration Actions */}
        <Separator />
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5 text-primary" />
            Andro IA — Acciones inteligentes
          </p>
          <div className="flex gap-1.5 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="text-primary border-primary/30 hover:bg-primary/10"
              onClick={() => openAndroWithEmail(email, "register")}
            >
              <Bot className="h-3.5 w-3.5 mr-1" /> Registrar en Atenia
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-primary border-primary/30 hover:bg-primary/10"
              onClick={() => openAndroWithEmail(email, "diagnose")}
            >
              <Bot className="h-3.5 w-3.5 mr-1" /> Diagnosticar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-primary border-primary/30 hover:bg-primary/10"
              onClick={() => openAndroWithEmail(email, "ticket")}
            >
              <Ticket className="h-3.5 w-3.5 mr-1" /> Crear ticket
            </Button>
          </div>
        </div>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1 p-4">
        <div
          className="prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />

        {/* Attachments */}
        {email.hasAttachments && email.attachments && (
          <>
            <Separator className="my-4" />
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                {email.attachments.length} adjunto{email.attachments.length > 1 ? "s" : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {email.attachments.map((att, i) => (
                  <Badge key={i} variant="outline" className="cursor-pointer hover:bg-muted/50 transition-colors py-1.5 px-3">
                    <Paperclip className="h-3 w-3 mr-1.5" />
                    {att.name}
                    <span className="text-muted-foreground ml-1.5">({att.size})</span>
                  </Badge>
                ))}
              </div>
            </div>
          </>
        )}
      </ScrollArea>
    </div>
  );
}
