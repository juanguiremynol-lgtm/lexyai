/**
 * MessageDetailPanel — Full message view with safe HTML rendering
 */

import { useQuery } from "@tanstack/react-query";
import { fetchInboxMessageDetail, fetchOutboxMessageDetail } from "@/lib/platform/email-console-service";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2, Paperclip, Link2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import DOMPurify from "dompurify";

interface MessageDetailPanelProps {
  messageId: string;
  direction: "inbound" | "outbound";
  onBack: () => void;
}

export function MessageDetailPanel({ messageId, direction, onBack }: MessageDetailPanelProps) {
  const isInbound = direction === "inbound";

  const { data: inboundData, isLoading: inboundLoading } = useQuery({
    queryKey: ["platform-email-detail", "inbound", messageId],
    queryFn: () => fetchInboxMessageDetail(messageId),
    enabled: isInbound,
  });

  const { data: outboundData, isLoading: outboundLoading } = useQuery({
    queryKey: ["platform-email-detail", "outbound", messageId],
    queryFn: () => fetchOutboxMessageDetail(messageId),
    enabled: !isInbound,
  });

  const isLoading = isInbound ? inboundLoading : outboundLoading;
  const data = isInbound ? inboundData : outboundData;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>Mensaje no encontrado</p>
        <Button variant="outline" onClick={onBack} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Volver
        </Button>
      </div>
    );
  }

  // Safe HTML rendering
  const htmlContent = isInbound ? inboundData?.html_body : outboundData?.html;
  const sanitizedHtml = htmlContent
    ? DOMPurify.sanitize(htmlContent, {
        ALLOWED_TAGS: [
          "p", "br", "strong", "em", "u", "a", "ul", "ol", "li",
          "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre",
          "code", "table", "thead", "tbody", "tr", "th", "td", "div", "span", "img",
        ],
        ALLOWED_ATTR: ["href", "src", "alt", "style", "class", "target"],
      })
    : null;

  const textContent = isInbound ? inboundData?.text_body : null;
  const attachments = isInbound ? (inboundData?.inbound_attachments ?? []) : [];
  const links = isInbound ? (inboundData?.message_links ?? []) : [];

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Volver a la lista
      </Button>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            {(isInbound ? inboundData?.subject : outboundData?.subject) || "(Sin asunto)"}
          </CardTitle>
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground mt-1">
            {isInbound && inboundData ? (
              <>
                <span><strong>De:</strong> {inboundData.from_name ? `${inboundData.from_name} <${inboundData.from_email}>` : inboundData.from_email}</span>
                <span><strong>Para:</strong> {(inboundData.to_emails ?? []).join(", ")}</span>
                {(inboundData.cc_emails ?? []).length > 0 && (
                  <span><strong>CC:</strong> {(inboundData.cc_emails ?? []).join(", ")}</span>
                )}
                <span><strong>Recibido:</strong> {format(new Date(inboundData.received_at), "dd MMM yyyy HH:mm", { locale: es })}</span>
              </>
            ) : outboundData ? (
              <>
                <span><strong>Para:</strong> {outboundData.to_email}</span>
                <span><strong>Estado:</strong> {outboundData.status}</span>
                <span><strong>Creado:</strong> {format(new Date(outboundData.created_at), "dd MMM yyyy HH:mm", { locale: es })}</span>
                {outboundData.sent_at && (
                  <span><strong>Enviado:</strong> {format(new Date(outboundData.sent_at), "dd MMM yyyy HH:mm", { locale: es })}</span>
                )}
              </>
            ) : null}
          </div>
        </CardHeader>

        <CardContent>
          <div className="border rounded-lg p-4 bg-background max-h-[500px] overflow-y-auto">
            {sanitizedHtml ? (
              <div
                className="prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
              />
            ) : textContent ? (
              <pre className="whitespace-pre-wrap text-sm font-sans">{textContent}</pre>
            ) : (
              <p className="text-muted-foreground italic">Sin contenido</p>
            )}
          </div>

          {attachments.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <Paperclip className="h-4 w-4" /> Adjuntos ({attachments.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {attachments.map((att) => (
                  <Badge key={att.id} variant="outline" className="text-xs">
                    {att.filename}
                    {att.size_bytes && ` (${Math.round(att.size_bytes / 1024)}KB)`}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {links.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <Link2 className="h-4 w-4" /> Vínculos ({links.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {links.map((link) => (
                  <Badge key={link.id} variant="outline" className="text-xs">
                    {link.entity_type} — {link.link_status}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {!isInbound && outboundData?.error && (
            <div className="mt-4 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
              <p className="text-sm text-destructive">{outboundData.error}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
