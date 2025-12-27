import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Paperclip, Check, X, Link2, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ENTITY_TYPE_LABELS, ENTITY_TYPE_COLORS, LINK_STATUS_COLORS } from "@/lib/email-constants";
import type { InboundMessage, MessageLink, InboundAttachment } from "@/types/email";

interface InboundMessageWithLinks extends InboundMessage {
  message_links: MessageLink[];
  inbound_attachments: InboundAttachment[];
}

interface EmailMessageCardProps {
  message: InboundMessageWithLinks;
  onConfirmLink: (linkId: string) => void;
  onDismissLink: (linkId: string) => void;
  onManualLink: () => void;
}

export function EmailMessageCard({ 
  message, 
  onConfirmLink, 
  onDismissLink, 
  onManualLink 
}: EmailMessageCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const suggestedLinks = message.message_links?.filter(l => l.link_status === "LINK_SUGGESTED") || [];
  const confirmedLinks = message.message_links?.filter(l => 
    l.link_status === "AUTO_LINKED" || l.link_status === "MANUALLY_LINKED"
  ) || [];
  const hasAttachments = message.inbound_attachments?.length > 0;

  return (
    <Card className="hover:bg-muted/30 transition-colors">
      <CardContent className="p-4">
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <div className="flex items-start gap-3">
            {/* Left: Main info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium truncate">
                  {message.from_name || message.from_email}
                </span>
                {message.from_name && (
                  <span className="text-xs text-muted-foreground truncate">
                    &lt;{message.from_email}&gt;
                  </span>
                )}
                {hasAttachments && (
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                )}
              </div>
              <p className="font-medium text-sm truncate">{message.subject}</p>
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {message.body_preview}
              </p>
            </div>

            {/* Right: Date and status */}
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {format(new Date(message.received_at), "dd MMM, HH:mm", { locale: es })}
              </span>
              
              {/* Link badges */}
              <div className="flex flex-wrap gap-1 justify-end">
                {confirmedLinks.map((link) => (
                  <Badge 
                    key={link.id} 
                    variant="secondary"
                    className={`text-xs ${ENTITY_TYPE_COLORS[link.entity_type]} text-white`}
                  >
                    {ENTITY_TYPE_LABELS[link.entity_type]}
                  </Badge>
                ))}
                {suggestedLinks.length > 0 && (
                  <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-600">
                    {suggestedLinks.length} sugerencia{suggestedLinks.length > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
            </div>

            {/* Expand toggle */}
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="flex-shrink-0">
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="mt-4 space-y-4">
            {/* Full message preview */}
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-2 space-y-1">
                <p><strong>De:</strong> {message.from_name ? `${message.from_name} <${message.from_email}>` : message.from_email}</p>
                <p><strong>Para:</strong> {message.to_emails?.join(", ") || "—"}</p>
                {message.cc_emails?.length > 0 && (
                  <p><strong>CC:</strong> {message.cc_emails.join(", ")}</p>
                )}
                <p><strong>Fecha:</strong> {format(new Date(message.received_at), "PPpp", { locale: es })}</p>
              </div>
              <div className="text-sm whitespace-pre-wrap max-h-40 overflow-y-auto">
                {message.text_body || message.body_preview || "(Sin contenido)"}
              </div>
            </div>

            {/* Attachments */}
            {hasAttachments && (
              <div>
                <p className="text-xs font-medium mb-1">Adjuntos:</p>
                <div className="flex flex-wrap gap-2">
                  {message.inbound_attachments.map((att) => (
                    <Badge key={att.id} variant="outline" className="text-xs">
                      <Paperclip className="h-3 w-3 mr-1" />
                      {att.filename}
                      {att.size_bytes && (
                        <span className="text-muted-foreground ml-1">
                          ({(att.size_bytes / 1024).toFixed(0)} KB)
                        </span>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Suggested links */}
            {suggestedLinks.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-2">Vínculos sugeridos:</p>
                <div className="space-y-2">
                  {suggestedLinks.map((link) => (
                    <div 
                      key={link.id} 
                      className="flex items-center justify-between p-2 bg-yellow-50 dark:bg-yellow-950 rounded border border-yellow-200 dark:border-yellow-800"
                    >
                      <div>
                        <Badge className={`${ENTITY_TYPE_COLORS[link.entity_type]} text-white`}>
                          {ENTITY_TYPE_LABELS[link.entity_type]}
                        </Badge>
                        <p className="text-xs text-muted-foreground mt-1">
                          {link.link_reasons?.join(", ")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Confianza: {Math.round((link.link_confidence || 0) * 100)}%
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="text-green-600 hover:text-green-700 hover:bg-green-100"
                          onClick={() => onConfirmLink(link.id)}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="text-red-600 hover:text-red-700 hover:bg-red-100"
                          onClick={() => onDismissLink(link.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Confirmed links */}
            {confirmedLinks.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-2">Vínculos confirmados:</p>
                <div className="flex flex-wrap gap-2">
                  {confirmedLinks.map((link) => (
                    <Badge 
                      key={link.id}
                      className={`${LINK_STATUS_COLORS[link.link_status]}`}
                    >
                      {ENTITY_TYPE_LABELS[link.entity_type]}
                      {link.link_status === "AUTO_LINKED" && " (auto)"}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={onManualLink}>
                <Link2 className="h-4 w-4 mr-1" />
                Vincular manualmente
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
