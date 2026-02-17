/**
 * MessageDetailPanel — Full message view with safe HTML rendering + Atenia AI actions
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchInboxMessageDetail, fetchOutboxMessageDetail } from "@/lib/platform/email-console-service";
import {
  fetchEmailForAI,
  generateDraftReply,
  triageEmail,
  registerEmailInAteniaAI,
  type AIDraftResult,
  type AITriageResult,
} from "@/lib/platform/email-ai-service";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2, Paperclip, Link2, Brain, PenLine, Tag, Ticket, Copy, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import DOMPurify from "dompurify";
import { toast } from "sonner";

interface MessageDetailPanelProps {
  messageId: string;
  direction: "inbound" | "outbound";
  onBack: () => void;
}

const PLATFORM_ORG_ID = "00000000-0000-0000-0000-000000000000";

export function MessageDetailPanel({ messageId, direction, onBack }: MessageDetailPanelProps) {
  const isInbound = direction === "inbound";
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<AIDraftResult | null>(null);
  const [triageResult, setTriageResult] = useState<AITriageResult | null>(null);
  const [registered, setRegistered] = useState(false);
  const [copied, setCopied] = useState(false);

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

  // ─── AI Actions ───────────────────────────────────────────

  const handleDraftReply = async () => {
    setAiLoading("draft");
    try {
      const email = await fetchEmailForAI(messageId, direction);
      if (!email) { toast.error("No se pudo cargar el email"); return; }
      const result = await generateDraftReply(email);
      setDraftResult(result);
      toast.success("Borrador generado por Atenia AI");
    } catch (err) {
      toast.error("Error al generar borrador");
      console.error(err);
    } finally {
      setAiLoading(null);
    }
  };

  const handleTriage = async () => {
    setAiLoading("triage");
    try {
      const email = await fetchEmailForAI(messageId, direction);
      if (!email) { toast.error("No se pudo cargar el email"); return; }
      const result = await triageEmail(email);
      setTriageResult(result);
      toast.success("Email clasificado por Atenia AI");
    } catch (err) {
      toast.error("Error en triage");
      console.error(err);
    } finally {
      setAiLoading(null);
    }
  };

  const handleRegisterInAtenia = async () => {
    setAiLoading("register");
    try {
      const email = await fetchEmailForAI(messageId, direction);
      if (!email) { toast.error("No se pudo cargar el email"); return; }
      const triage = triageResult || await triageEmail(email);
      const convId = await registerEmailInAteniaAI(email, PLATFORM_ORG_ID, triage);
      if (convId) {
        setRegistered(true);
        toast.success("Email registrado en Atenia AI como incidente");
      } else {
        toast.error("No se pudo registrar");
      }
    } catch (err) {
      toast.error("Error al registrar en Atenia AI");
      console.error(err);
    } finally {
      setAiLoading(null);
    }
  };

  const handleCopyDraft = async () => {
    if (!draftResult?.draft) return;
    await navigator.clipboard.writeText(draftResult.draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

  const priorityColor: Record<string, string> = {
    LOW: "text-muted-foreground",
    MEDIUM: "text-yellow-500",
    HIGH: "text-orange-500",
    CRITICAL: "text-destructive",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Volver a la lista
        </Button>

        {/* AI Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDraftReply}
            disabled={!!aiLoading}
            className="gap-1.5"
          >
            {aiLoading === "draft" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />}
            Borrador IA
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTriage}
            disabled={!!aiLoading}
            className="gap-1.5"
          >
            {aiLoading === "triage" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tag className="h-3.5 w-3.5" />}
            Clasificar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRegisterInAtenia}
            disabled={!!aiLoading || registered}
            className="gap-1.5"
          >
            {aiLoading === "register" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : registered ? (
              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Ticket className="h-3.5 w-3.5" />
            )}
            {registered ? "Registrado" : "Ticket Atenia"}
          </Button>
        </div>
      </div>

      {/* AI Triage Result */}
      {triageResult && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" /> Análisis Atenia AI
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline">{triageResult.classification}</Badge>
              <Badge variant="outline" className={priorityColor[triageResult.priority]}>
                Prioridad: {triageResult.priority}
              </Badge>
              {triageResult.shouldCreateTicket && (
                <Badge variant="destructive" className="text-xs">Requiere ticket</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{triageResult.summary}</p>
            {triageResult.suggestedActions.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <strong>Acciones:</strong> {triageResult.suggestedActions.join(" • ")}
              </div>
            )}
            {triageResult.relatedEntities.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <strong>Entidades:</strong> {triageResult.relatedEntities.join(", ")}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* AI Draft Reply */}
      {draftResult && (
        <Card className="border-accent/20 bg-accent/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <PenLine className="h-4 w-4 text-accent-foreground" /> Borrador de Respuesta (Atenia AI)
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={handleCopyDraft} className="gap-1.5 text-xs">
                {copied ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-xs">Tono: {draftResult.tone}</Badge>
              <Badge variant="outline" className="text-xs">{draftResult.classification}</Badge>
              <Badge variant="outline" className="text-xs">Confianza: {Math.round(draftResult.confidence * 100)}%</Badge>
            </div>
            <div className="rounded-lg border p-3 bg-background text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
              {draftResult.draft}
            </div>
            {draftResult.suggestedActions.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <strong>Acciones sugeridas:</strong> {draftResult.suggestedActions.join(" • ")}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                {attachments.map((att: any) => (
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
                {links.map((link: any) => (
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
