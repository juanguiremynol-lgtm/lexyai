/**
 * EmailLinksTab — Correos vinculados al expediente.
 *
 * Solo metadata: asunto, dirección, fecha, evidencia y enlace a Outlook web.
 * Andromeda nunca almacena ni muestra el cuerpo del correo.
 */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, ArrowUpRight, ArrowDownLeft, Paperclip, ExternalLink, ShieldCheck, Reply } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useWorkItemEmailLinks, useEmailConnection } from "@/hooks/use-email-connection";
import { useEmailLinkEffects } from "@/hooks/use-email-link-effects";
import { OutlookComposeDialog } from "@/components/email/OutlookComposeDialog";
import { SuggestedEmailLinksQueue } from "@/components/email/SuggestedEmailLinksQueue";
import { OUTLOOK_SEND_ENABLED } from "@/lib/feature-flags";

const EVIDENCE_LABELS: Record<string, string> = {
  MEMORIAL_ENVIADO: "Memorial enviado",
  NOTIFICACION_JUZGADO: "Notificación del juzgado",
  TRASLADO: "Traslado",
  REQUERIMIENTO: "Requerimiento",
  OTRO: "Otro",
};

const MATCH_LABELS: Record<string, string> = {
  RADICADO: "Radicado",
  DESPACHO: "Despacho",
  PARTE: "Parte",
  CLIENTE: "Cliente",
  MANUAL: "Manual",
};

const SUBTYPE_LABELS: Record<string, string> = {
  AUTO_ADMISORIO: "Auto admisorio",
  INADMISION: "Inadmisión",
  TRASLADO: "Traslado",
  REQUERIMIENTO: "Requerimiento",
  CITACION_AUDIENCIA: "Citación a audiencia",
  FALLO_SENTENCIA: "Fallo / sentencia",
  FIJACION_ESTADO: "Fijación en estado",
  DESISTIMIENTO: "Desistimiento",
  ACTA_REPARTO: "Acta de reparto",
  NOTIFICACION_PERSONAL: "Notificación personal",
  ACCESO_EXPEDIENTE: "Acceso a expediente",
  ACUSE_AUTOMATICO: "Acuse automático",
  OTRO_JUDICIAL: "Comunicación judicial",
  APELACION: "Apelación",
  IMPUGNACION: "Impugnación",
  SUBSANACION: "Subsanación",
  CONTESTACION: "Contestación",
  ALEGATOS: "Alegatos",
  REPOSICION: "Reposición",
  EXCEPCIONES: "Excepciones",
  DESACATO: "Desacato",
  CUMPLIMIENTO: "Cumplimiento",
  PODER: "Poder",
  RECURSO: "Recurso",
  TUTELA: "Tutela",
  MEMORIAL_GENERAL: "Memorial",
};

export function EmailLinksTab({ workItemId }: { workItemId: string }) {
  const { data: links, isLoading } = useWorkItemEmailLinks(workItemId);
  const { data: effectsByLink = {} } = useEmailLinkEffects(workItemId);
  const { connection, sync, canSend } = useEmailConnection();
  const [reply, setReply] = useState<{ to: string[]; subject: string } | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  const all = links ?? [];
  const items = all.filter((l) => l.link_status !== "SUGGESTED");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4" aria-hidden />
              Correos vinculados
              <Badge variant="secondary">{items.length}</Badge>
            </CardTitle>
            <CardDescription>
              Andromeda solo lee metadatos. El contenido de los correos nunca se almacena.
            </CardDescription>
          </div>
          {connection?.status === "CONNECTED" && (
            <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
              {sync.isPending ? "Revisando…" : "Revisar mi correo"}
            </Button>
          )}
        </CardHeader>
      </Card>

      {connection?.status !== "CONNECTED" && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Conecta tu buzón de Outlook en <strong>Ajustes → Conexiones</strong> para que Andromeda
            vincule automáticamente los correos de tus expedientes.
          </CardContent>
        </Card>
      )}

      <SuggestedEmailLinksQueue workItemId={workItemId} hideWhenEmpty />

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Mail className="mx-auto mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Aún no hay correos vinculados a este expediente.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((link) => (
            <Card key={link.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    {link.direction === "sent" ? (
                      <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    ) : (
                      <ArrowDownLeft className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{link.subject ?? "(sin asunto)"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {link.direction === "sent" ? "Enviado" : "Recibido"}
                        {link.sender ? ` · ${link.sender}` : ""}
                        {link.received_at
                          ? ` · ${format(new Date(link.received_at), "d MMM yyyy, HH:mm", { locale: es })}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  {link.web_link && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={link.web_link} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                        Abrir en Outlook
                      </a>
                    </Button>
                  )}
                  {OUTLOOK_SEND_ENABLED && canSend && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setReply({
                          to: [link.sender ?? ""].filter(Boolean),
                          subject: (link.subject ?? "").startsWith("Re:")
                            ? (link.subject as string)
                            : `Re: ${link.subject ?? ""}`.trim(),
                        })}
                    >
                      <Reply className="mr-1 h-3.5 w-3.5" aria-hidden />
                      Responder
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {link.evidence_type && (
                    <Badge variant={link.evidence_type === "MEMORIAL_ENVIADO" ? "default" : "secondary"}>
                      <ShieldCheck className="mr-1 h-3 w-3" aria-hidden />
                      {EVIDENCE_LABELS[link.evidence_type] ?? link.evidence_type}
                    </Badge>
                  )}
                  {(() => {
                    const subtype =
                      (link as { evidence_subtype?: string | null; memorial_subtype?: string | null })
                        .evidence_subtype ??
                      (link as { memorial_subtype?: string | null }).memorial_subtype ??
                      null;
                    return subtype ? (
                      <Badge variant="secondary">{SUBTYPE_LABELS[subtype] ?? subtype}</Badge>
                    ) : null;
                  })()}
                  <Badge variant="outline">
                    Vinculado por {MATCH_LABELS[link.matched_by] ?? link.matched_by} ·{" "}
                    {Math.round(Number(link.confidence) * 100)}%
                  </Badge>
                  {link.link_status === "SUGGESTED" && <Badge variant="outline">Sugerido</Badge>}
                  {link.has_attachments && (
                    <Badge variant="outline">
                      <Paperclip className="mr-1 h-3 w-3" aria-hidden />
                      Con adjuntos
                    </Badge>
                  )}
                </div>
                {(effectsByLink[link.id] ?? []).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
                    {(effectsByLink[link.id] ?? []).map((fx) => (
                      <Badge key={fx.id} variant="default" className="font-normal">
                        {fx.label}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <OutlookComposeDialog
        open={OUTLOOK_SEND_ENABLED && reply !== null}
        onOpenChange={(open) => !open && setReply(null)}
        defaultTo={reply?.to ?? []}
        defaultSubject={reply?.subject ?? ""}
        workItemId={workItemId}
        title="Responder desde mi Outlook"
      />
    </div>
  );
}